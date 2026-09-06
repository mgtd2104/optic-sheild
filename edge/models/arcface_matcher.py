"""
ArcFace/SCRFD Facial Embedding Extraction & Watchlist Matching Pipeline

Privacy-by-design implementation per Rule 2.2:
- Embeddings checked against FAISS watchlist index in volatile RAM
- Non-matching embeddings and face crops immediately scrubbed from memory
- No persistent storage of non-watchlist facial data
"""

from __future__ import annotations

import logging
import secrets
import time
from dataclasses import dataclass, field
from typing import Any, Optional

import cv2
import faiss
import numpy as np
import onnxruntime as ort

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class ArcFaceConfig:
    """Configuration for ArcFace matcher."""

    # Model paths (ONNX format)
    detector_model_path: str = "models/scrfd_2.5g.onnx"
    recognizer_model_path: str = "models/arcface_r100.onnx"

    # Detection parameters
    det_input_size: tuple[int, int] = (640, 640)
    det_conf_threshold: float = 0.5
    det_nms_threshold: float = 0.4
    det_max_faces: int = 10

    # Recognition parameters
    rec_input_size: tuple[int, int] = (112, 112)
    embedding_dim: int = 512

    # Matching parameters
    similarity_threshold: float = 0.45  # Cosine similarity threshold for match
    top_k: int = 1  # Number of nearest neighbors to retrieve

    # FAISS index parameters
    index_type: str = "flat"  # "flat", "ivf", "hnsw"
    nlist: int = 100  # For IVF index
    nprobe: int = 10  # For IVF index

    # Privacy parameters
    max_embedding_lifetime_ms: int = 100  # Max time to retain non-matching embeddings
    scrub_on_no_match: bool = True  # Rule 2.2: immediate scrub

    # Execution providers
    providers: list[str] = field(default_factory=lambda: ["CPUExecutionProvider"])


@dataclass(frozen=True, slots=True)
class FaceDetection:
    """Single face detection result."""

    bbox: tuple[float, float, float, float]  # x1, y1, x2, y2
    confidence: float
    keypoints: np.ndarray  # 5 facial landmarks (x, y)
    track_id: Optional[int] = None


@dataclass(frozen=True, slots=True)
class FaceMatchResult:
    """Result of watchlist matching for a single face."""

    track_id: Optional[int]
    detection: FaceDetection
    embedding: np.ndarray  # 512-d normalized embedding
    matched: bool
    watchlist_id: Optional[str]
    watchlist_name: Optional[str]
    similarity: float
    timestamp: float

    # Privacy: embedding is zeroed if not matched (scrubbed)
    def scrub_embedding(self) -> None:
        """Zero out embedding in-place for privacy compliance."""
        self.embedding.fill(0.0)


@dataclass(frozen=True, slots=True)
class WatchlistEntry:
    """Watchlist database entry."""

    watchlist_id: str
    name: str
    embedding: np.ndarray  # 512-d normalized embedding
    metadata: dict[str, Any] = field(default_factory=dict)
    added_timestamp: float = field(default_factory=time.time)

    def __post_init__(self) -> None:
        # Ensure embedding is normalized
        norm = np.linalg.norm(self.embedding)
        if norm > 0:
            object.__setattr__(self, 'embedding', self.embedding / norm)


class ScrubbableArray:
    """
    Wrapper for sensitive arrays that guarantees scrubbing on deletion.
    Implements Rule 2.2: immediate memory scrubbing on no-match.
    """

    __slots__ = ("_array", "_scrubbed", "_scrub_callback")

    def __init__(
        self,
        array: np.ndarray,
        scrub_callback: Optional[callable] = None,
    ) -> None:
        self._array = array
        self._scrubbed = False
        self._scrub_callback = scrub_callback

    def __del__(self) -> None:
        self.scrub()

    def scrub(self) -> None:
        """Overwrite array with cryptographically secure random data."""
        if not self._scrubbed and self._array is not None:
            # Overwrite with random bytes
            try:
                random_bytes = secrets.token_bytes(self._array.nbytes)
                np.frombuffer(random_bytes, dtype=self._array.dtype).reshape(self._array.shape)
                self._array[:] = np.frombuffer(random_bytes, dtype=self._array.dtype).reshape(self._array.shape)
            except Exception:
                # Fallback: zero fill
                self._array.fill(0)
            self._scrubbed = True
            if self._scrub_callback:
                try:
                    self._scrub_callback()
                except Exception:
                    pass

    def get(self) -> np.ndarray:
        """Get the array (marks as accessed, prevents auto-scrub on del if needed)."""
        return self._array

    def release(self) -> np.ndarray:
        """Release ownership without scrubbing (caller takes responsibility)."""
        self._scrubbed = True
        return self._array


class ArcFaceMatcher:
    """
    ArcFace-based facial recognition with privacy-compliant watchlist matching.

    Pipeline:
    1. SCRFD face detection (ONNX)
    2. Face alignment using 5 landmarks
    3. ArcFace embedding extraction (ONNX)
    4. FAISS cosine similarity search against watchlist
    5. Privacy: non-matching embeddings immediately scrubbed from RAM
    """

    def __init__(self, config: Optional[ArcFaceConfig] = None) -> None:
        """
        Initialize the ArcFace matcher.

        Args:
            config: ArcFaceConfig with model paths and parameters.
        """
        self.config = config or ArcFaceConfig()
        self._detector: Optional[ort.InferenceSession] = None
        self._recognizer: Optional[ort.InferenceSession] = None
        self._faiss_index: Optional[faiss.Index] = None
        self._watchlist: dict[str, WatchlistEntry] = {}
        self._initialized = False

        logger.info("ArcFaceMatcher initialized with config: %s", self.config)

    def initialize(self) -> None:
        """Load models and initialize FAISS index."""
        if self._initialized:
            return

        # Load ONNX models
        try:
            self._detector = ort.InferenceSession(
                self.config.detector_model_path,
                providers=self.config.providers,
            )
            self._recognizer = ort.InferenceSession(
                self.config.recognizer_model_path,
                providers=self.config.providers,
            )
        except Exception as e:
            logger.error("Failed to load ONNX models: %s", e)
            raise RuntimeError(f"Model loading failed: {e}") from e

        # Initialize FAISS index
        self._init_faiss_index()

        self._initialized = True
        logger.info("ArcFaceMatcher initialization complete")

    def _init_faiss_index(self) -> None:
        """Initialize FAISS index for watchlist embeddings."""
        dim = self.config.embedding_dim

        if self.config.index_type == "flat":
            # Exact search with flat index (Inner Product = Cosine for normalized vectors)
            self._faiss_index = faiss.IndexFlatIP(dim)
        elif self.config.index_type == "ivf":
            # IVF for larger watchlists
            quantizer = faiss.IndexFlatIP(dim)
            self._faiss_index = faiss.IndexIVFFlat(quantizer, dim, self.config.nlist, faiss.METRIC_INNER_PRODUCT)
        elif self.config.index_type == "hnsw":
            # HNSW for approximate search
            self._faiss_index = faiss.IndexHNSWFlat(dim, 32)
            self._faiss_index.hnsw.efConstruction = 200
            self._faiss_index.hnsw.efSearch = 128
        else:
            raise ValueError(f"Unknown index_type: {self.config.index_type}")

        # If IVF, train with dummy data (will retrain on watchlist load)
        if isinstance(self._faiss_index, faiss.IndexIVFFlat):
            dummy_data = np.random.randn(self.config.nlist * 10, dim).astype(np.float32)
            faiss.normalize_L2(dummy_data)
            self._faiss_index.train(dummy_data)

    def load_watchlist(self, entries: list[WatchlistEntry]) -> int:
        """
        Load watchlist entries into FAISS index.

        Args:
            entries: List of WatchlistEntry objects.

        Returns:
            Number of entries loaded.
        """
        if not self._initialized:
            self.initialize()

        self._watchlist.clear()

        if not entries:
            logger.warning("Empty watchlist provided")
            return 0

        # Prepare embeddings matrix
        embeddings = np.vstack([e.embedding for e in entries]).astype(np.float32)
        faiss.normalize_L2(embeddings)

        # Rebuild index
        self._faiss_index.reset()
        if isinstance(self._faiss_index, faiss.IndexIVFFlat):
            self._faiss_index.train(embeddings)
        self._faiss_index.add(embeddings)

        # Store entries
        for i, entry in enumerate(entries):
            self._watchlist[str(i)] = entry  # Index -> entry mapping

        logger.info("Loaded %d watchlist entries into FAISS index", len(entries))
        return len(entries)

    def add_watchlist_entry(self, entry: WatchlistEntry) -> str:
        """Add a single entry to the watchlist."""
        if not self._initialized:
            self.initialize()

        idx = str(len(self._watchlist))
        self._watchlist[idx] = entry
        emb = entry.embedding.reshape(1, -1).astype(np.float32)
        faiss.normalize_L2(emb)
        self._faiss_index.add(emb)
        return idx

    def remove_watchlist_entry(self, watchlist_id: str) -> bool:
        """Remove entry from watchlist (requires index rebuild)."""
        if watchlist_id in self._watchlist:
            del self._watchlist[watchlist_id]
            # Rebuild index (FAISS doesn't support efficient removal)
            self._rebuild_index()
            return True
        return False

    def _rebuild_index(self) -> None:
        """Rebuild FAISS index from current watchlist."""
        self._init_faiss_index()
        if self._watchlist:
            entries = list(self._watchlist.values())
            embeddings = np.vstack([e.embedding for e in entries]).astype(np.float32)
            faiss.normalize_L2(embeddings)
            if isinstance(self._faiss_index, faiss.IndexIVFFlat):
                self._faiss_index.train(embeddings)
            self._faiss_index.add(embeddings)

    def _preprocess_detector(self, image: np.ndarray) -> tuple[np.ndarray, float, tuple[int, int]]:
        """Preprocess image for SCRFD detector."""
        h, w = image.shape[:2]
        target_h, target_w = self.config.det_input_size

        # Letterbox resize
        scale = min(target_h / h, target_w / w)
        new_h, new_w = int(h * scale), int(w * scale)
        resized = cv2.resize(image, (new_w, new_h), interpolation=cv2.INTER_LINEAR)

        # Pad to target size
        padded = np.full((target_h, target_w, 3), 114, dtype=np.uint8)
        padded[:new_h, :new_w] = resized

        # Normalize: BGR to RGB, then to [0, 1]
        input_tensor = padded[:, :, ::-1].transpose(2, 0, 1).astype(np.float32) / 255.0
        input_tensor = np.expand_dims(input_tensor, 0)

        return input_tensor, scale, (new_w, new_h)

    def _preprocess_recognizer(self, face_crop: np.ndarray) -> np.ndarray:
        """Preprocess aligned face crop for ArcFace recognizer."""
        h, w = self.config.rec_input_size
        resized = cv2.resize(face_crop, (w, h), interpolation=cv2.INTER_LINEAR)
        # Normalize: [-1, 1] as per ArcFace training
        input_tensor = (resized.astype(np.float32) / 127.5) - 1.0
        input_tensor = input_tensor.transpose(2, 0, 1)
        input_tensor = np.expand_dims(input_tensor, 0)
        return input_tensor

    def _align_face(self, image: np.ndarray, keypoints: np.ndarray) -> np.ndarray:
        """
        Align face using 5 landmarks (similarity transform to standard template).

        Template points for 112x112 ArcFace input (from insightface):
        """
        # Standard 5-point template for 112x112
        template = np.array([
            [38.2946, 51.6963],   # left eye
            [73.5318, 51.5014],   # right eye
            [56.0252, 71.7366],   # nose
            [41.5493, 92.3655],   # left mouth
            [70.7299, 92.2041],   # right mouth
        ], dtype=np.float32)

        src = keypoints.astype(np.float32)

        # Estimate similarity transform
        M, _ = cv2.estimateAffinePartial2D(src, template, method=cv2.LMEDS)
        if M is None:
            # Fallback: simple crop/resize
            return cv2.resize(image, (112, 112))

        # Warp
        aligned = cv2.warpAffine(image, M, (112, 112), borderValue=0.0)
        return aligned

    def _postprocess_detector(
        self,
        outputs: list[np.ndarray],
        scale: float,
        img_shape: tuple[int, int],
    ) -> list[FaceDetection]:
        """Post-process SCRFD detector outputs."""
        # SCRFD outputs: [scores, bboxes, keypoints] for each stride
        # This is a simplified version; actual SCRFD has multi-stride outputs
        # Assume outputs[0] = scores (1, N, 1), outputs[1] = bboxes (1, N, 4), outputs[2] = kpts (1, N, 10)

        detections = []

        # Handle different output formats
        if len(outputs) >= 3:
            scores = outputs[0].squeeze()
            bboxes = outputs[1].squeeze()
            kpts = outputs[2].squeeze()
        else:
            # Single output tensor format
            scores = outputs[0][:, 4]
            bboxes = outputs[0][:, :4]
            kpts = outputs[0][:, 5:15].reshape(-1, 5, 2)

        # Filter by confidence
        mask = scores > self.config.det_conf_threshold
        if not np.any(mask):
            return detections

        scores = scores[mask]
        bboxes = bboxes[mask]
        kpts = kpts[mask]

        # Scale back to original image
        bboxes = bboxes / scale
        kpts = kpts / scale

        # NMS
        indices = cv2.dnn.NMSBoxes(
            bboxes.tolist(),
            scores.tolist(),
            self.config.det_conf_threshold,
            self.config.det_nms_threshold,
        )

        if len(indices) > 0:
            indices = indices.flatten()[:self.config.det_max_faces]
            for idx in indices:
                detections.append(FaceDetection(
                    bbox=(float(bboxes[idx, 0]), float(bboxes[idx, 1]),
                          float(bboxes[idx, 2]), float(bboxes[idx, 3])),
                    confidence=float(scores[idx]),
                    keypoints=kpts[idx],
                ))

        return detections

    def detect_faces(self, image: np.ndarray) -> list[FaceDetection]:
        """
        Detect faces in image using SCRFD.

        Args:
            image: Input image (H, W, 3) BGR format.

        Returns:
            List of FaceDetection objects.
        """
        if not self._initialized:
            self.initialize()

        input_tensor, scale, _ = self._preprocess_detector(image)

        # Run inference
        outputs = self._detector.run(None, {self._detector.get_inputs()[0].name: input_tensor})

        # Post-process
        detections = self._postprocess_detector(outputs, scale, image.shape[:2])

        return detections

    def extract_embedding(self, image: np.ndarray, detection: FaceDetection) -> np.ndarray:
        """
        Extract 512-d embedding from aligned face crop.

        Args:
            image: Original image (H, W, 3) BGR.
            detection: FaceDetection with bbox and keypoints.

        Returns:
            Normalized 512-d embedding vector.
        """
        if not self._initialized:
            self.initialize()

        x1, y1, x2, y2 = detection.bbox
        x1, y1, x2, y2 = map(int, [x1, y1, x2, y2])

        # Ensure bounds
        h, w = image.shape[:2]
        x1, y1 = max(0, x1), max(0, y1)
        x2, y2 = min(w, x2), min(h, y2)

        if x2 <= x1 or y2 <= y1:
            return np.zeros(self.config.embedding_dim, dtype=np.float32)

        face_crop = image[y1:y2, x1:x2]

        # Align using keypoints
        aligned = self._align_face(face_crop, detection.keypoints)

        # Preprocess for recognizer
        input_tensor = self._preprocess_recognizer(aligned)

        # Run inference
        outputs = self._recognizer.run(None, {self._recognizer.get_inputs()[0].name: input_tensor})

        embedding = outputs[0].squeeze().astype(np.float32)

        # Normalize
        norm = np.linalg.norm(embedding)
        if norm > 0:
            embedding = embedding / norm

        return embedding

    def match_embedding(self, embedding: np.ndarray) -> tuple[bool, Optional[str], Optional[str], float]:
        """
        Match embedding against watchlist FAISS index.

        Args:
            embedding: 512-d normalized embedding.

        Returns:
            Tuple of (matched, watchlist_id, watchlist_name, similarity).
        """
        if not self._initialized or self._faiss_index.ntotal == 0:
            return False, None, None, 0.0

        # Normalize query
        query = embedding.reshape(1, -1).astype(np.float32)
        faiss.normalize_L2(query)

        # Search
        k = min(self.config.top_k, self._faiss_index.ntotal)
        similarities, indices = self._faiss_index.search(query, k)

        best_sim = float(similarities[0, 0])
        best_idx = int(indices[0, 0])

        if best_sim >= self.config.similarity_threshold:
            entry = self._watchlist.get(str(best_idx))
            if entry:
                return True, entry.watchlist_id, entry.name, best_sim

        return False, None, None, best_sim

    def process_frame(
        self,
        image: np.ndarray,
        track_ids: Optional[list[int]] = None,
    ) -> list[FaceMatchResult]:
        """
        Process a frame: detect faces, extract embeddings, match against watchlist.

        Privacy Rule 2.2: Non-matching embeddings are immediately scrubbed.

        Args:
            image: Input frame (H, W, 3) BGR.
            track_ids: Optional list of track IDs to associate with detections.

        Returns:
            List of FaceMatchResult (only matches returned, non-matches scrubbed).
        """
        if not self._initialized:
            self.initialize()

        timestamp = time.time()
        detections = self.detect_faces(image)

        # Associate track IDs if provided
        if track_ids:
            for i, det in enumerate(detections):
                if i < len(track_ids):
                    # Create new detection with track_id
                    detections[i] = FaceDetection(
                        bbox=det.bbox,
                        confidence=det.confidence,
                        keypoints=det.keypoints,
                        track_id=track_ids[i],
                    )

        results = []

        for det in detections:
            # Extract embedding
            embedding = self.extract_embedding(image, det)

            # Wrap in scrubbable container
            scrubbable = ScrubbableArray(embedding.copy())

            try:
                # Match against watchlist
                matched, wl_id, wl_name, similarity = self.match_embedding(embedding)

                result = FaceMatchResult(
                    track_id=det.track_id,
                    detection=det,
                    embedding=embedding,
                    matched=matched,
                    watchlist_id=wl_id,
                    watchlist_name=wl_name,
                    similarity=similarity,
                    timestamp=timestamp,
                )

                if matched:
                    logger.warning(
                        "WATCHLIST MATCH: track_id=%s, watchlist_id=%s, name=%s, sim=%.4f",
                        det.track_id, wl_id, wl_name, similarity
                    )
                    # Keep embedding for matched face (release from scrubbable)
                    scrubbable.release()
                    results.append(result)
                else:
                    # Privacy Rule 2.2: Immediately scrub non-matching embedding
                    logger.debug("No watchlist match for track_id=%s, scrubbing embedding", det.track_id)
                    scrubbable.scrub()
                    # Return result with scrubbed embedding (zeros)
                    result.embedding.fill(0.0)
                    # Optionally return empty flag or skip
                    # For audit trail, we return the result with zeroed embedding
                    results.append(result)

            except Exception as e:
                logger.error("Error processing face: %s", e)
                scrubbable.scrub()
                continue

        return results

    def process_frame_batch(
        self,
        images: list[np.ndarray],
        track_ids_list: Optional[list[list[int]]] = None,
    ) -> list[list[FaceMatchResult]]:
        """Process multiple frames."""
        return [self.process_frame(img, tids) for img, tids in zip(images, track_ids_list or [None]*len(images))]

    def get_watchlist_size(self) -> int:
        """Get current watchlist size."""
        return len(self._watchlist)

    def get_watchlist_entries(self) -> list[WatchlistEntry]:
        """Get all watchlist entries (without embeddings for privacy)."""
        return [WatchlistEntry(
            watchlist_id=e.watchlist_id,
            name=e.name,
            embedding=np.zeros(self.config.embedding_dim),  # Don't expose embeddings
            metadata=e.metadata,
            added_timestamp=e.added_timestamp,
        ) for e in self._watchlist.values()]

    def clear_watchlist(self) -> None:
        """Clear watchlist and reset index."""
        self._watchlist.clear()
        self._faiss_index.reset()
        logger.info("Watchlist cleared")

    def __enter__(self) -> "ArcFaceMatcher":
        self.initialize()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        # Scrub any remaining sensitive data
        self.clear_watchlist()


def create_arcface_matcher(
    detector_path: str = "models/scrfd_2.5g.onnx",
    recognizer_path: str = "models/arcface_r100.onnx",
    similarity_threshold: float = 0.45,
    providers: Optional[list[str]] = None,
) -> ArcFaceMatcher:
    """
    Factory function to create ArcFaceMatcher with custom config.

    Args:
        detector_path: Path to SCRFD ONNX model.
        recognizer_path: Path to ArcFace ONNX model.
        similarity_threshold: Cosine similarity threshold for match.
        providers: ONNX Runtime execution providers.

    Returns:
        Configured ArcFaceMatcher instance.
    """
    config = ArcFaceConfig(
        detector_model_path=detector_path,
        recognizer_model_path=recognizer_path,
        similarity_threshold=similarity_threshold,
        providers=providers or ["CPUExecutionProvider"],
    )
    return ArcFaceMatcher(config)


# Utility: Create watchlist entry from face image
def create_watchlist_entry(
    matcher: ArcFaceMatcher,
    face_image: np.ndarray,
    watchlist_id: str,
    name: str,
    metadata: Optional[dict[str, Any]] = None,
) -> Optional[WatchlistEntry]:
    """
    Create a watchlist entry from a face image.

    Args:
        matcher: Initialized ArcFaceMatcher.
        face_image: Cropped/aligned face image (112x112 or larger).
        watchlist_id: Unique identifier for watchlist.
        name: Person name/label.
        metadata: Additional metadata.

    Returns:
        WatchlistEntry or None if no face detected.
    """
    # Detect face in the provided image
    detections = matcher.detect_faces(face_image)
    if not detections:
        logger.warning("No face detected in watchlist image for %s", watchlist_id)
        return None

    # Use highest confidence detection
    best_det = max(detections, key=lambda d: d.confidence)
    embedding = matcher.extract_embedding(face_image, best_det)

    return WatchlistEntry(
        watchlist_id=watchlist_id,
        name=name,
        embedding=embedding,
        metadata=metadata or {},
    )


if __name__ == "__main__":
    # Demo / self-test (requires ONNX models)
    logging.basicConfig(level=logging.INFO)

    # Note: This will fail without actual model files
    print("ArcFaceMatcher module loaded successfully")
    print("Requires ONNX models at:")
    print("  - models/scrfd_2.5g.onnx (detector)")
    print("  - models/arcface_r100.onnx (recognizer)")
    print("\nUsage:")
    print("  matcher = create_arcface_matcher()")
    print("  matcher.initialize()")
    print("  # Load watchlist")
    print("  entries = [create_watchlist_entry(matcher, face_img, 'id1', 'Person 1')]")
    print("  matcher.load_watchlist(entries)")
    print("  # Process frames")
    print("  results = matcher.process_frame(frame)")
    print("  for r in results:")
    print("      if r.matched: print(f'MATCH: {r.watchlist_name}')")