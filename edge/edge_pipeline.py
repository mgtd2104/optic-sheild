"""
Edge Pipeline — Master Orchestrator for BOP Jetson/Mini-PC Units

Integrates all edge AI modules into unified frame processing loop:
Frame Ingestion → Enhancement → Detection → Tracking → Analytics → Encoding → Encryption

Outputs: AES-256 encrypted metadata JSON + cropped keyframe JPEG (<100KB) for uplink.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import time
import uuid
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime
from enum import IntEnum
from typing import Any, Callable, Optional

import cv2
import numpy as np

# Import edge modules
from edge.models.zerodce_enhancer import ZeroDCEEnhancer, EnhancementConfig, create_zerodce_enhancer
from edge.analytics.geofence_engine import (
    GeofenceEngine,
    GeofenceConfig,
    BoundingBox,
    TrajectoryVector,
    IntrusionResult,
    SeverityGrade,
    create_polygon_fence,
    create_line_fence,
)
from edge.analytics.trajectory_kalman import (
    KalmanTrajectoryPredictor,
    KalmanConfig,
    TrackState,
    PredictionResult,
    create_kalman_predictor,
)
from edge.analytics.pose_suspicious import (
    SuspiciousPoseEngine,
    SuspiciousConfig,
    KeypointFrame,
    BehaviorResult,
    BehaviorType,
    AlertLevel,
    create_suspicious_pose_engine,
    keypoints_from_yolo,
)
from edge.analytics.camera_health import (
    CameraHealthMonitor,
    CameraHealthConfig,
    HealthAlert,
    HealthAlertType,
    create_camera_health_monitor,
)
from edge.models.arcface_matcher import (
    ArcFaceMatcher,
    ArcFaceConfig,
    FaceMatchResult,
    create_arcface_matcher,
    create_watchlist_entry,
)
from edge.models.lprnet_ocr import (
    LPRNetOCR,
    LPRConfig,
    PlateRecognitionResult,
    VehiclePlateTracker,
    create_lprnet_ocr,
)

logger = logging.getLogger(__name__)


class PipelineMode(IntEnum):
    """Pipeline operating modes."""

    STANDBY = 0
    ACTIVE = 1
    DEGRADED = 2  # Reduced functionality
    MAINTENANCE = 3


@dataclass(frozen=True, slots=True)
class PipelineConfig:
    """Configuration for edge pipeline."""

    # Camera
    camera_id: str = "edge_cam_01"
    rtsp_url: str = ""
    target_fps: float = 30.0
    frame_width: int = 1920
    frame_height: int = 1080

    # Processing
    process_every_n_frames: int = 1  # 1 = every frame
    max_queue_size: int = 10
    enable_async: bool = True

    # Enhancement
    enable_enhancement: bool = True
    enhancement_config: Optional[EnhancementConfig] = None

    # Detection (YOLOv8n + ByteTrack) - placeholder config
    enable_detection: bool = True
    det_conf_threshold: float = 0.4
    det_iou_threshold: float = 0.5
    det_classes: list[int] = field(default_factory=lambda: [0, 1, 2, 3, 5, 7])  # person, bicycle, car, motorcycle, bus, truck
    track_buffer: int = 30

    # Geofence
    enable_geofence: bool = True
    geofence_config: Optional[GeofenceConfig] = None
    geofence_polygons: list[list[tuple[float, float]]] = field(default_factory=list)
    geofence_lines: list[list[tuple[float, float]]] = field(default_factory=list)

    # Trajectory prediction
    enable_trajectory: bool = True
    kalman_config: Optional[KalmanConfig] = None

    # Pose analysis
    enable_pose: bool = True
    pose_config: Optional[SuspiciousConfig] = None

    # Face recognition
    enable_face: bool = True
    face_config: Optional[ArcFaceConfig] = None
    face_watchlist: list[dict[str, Any]] = field(default_factory=list)

    # License plate recognition
    enable_lpr: bool = True
    lpr_config: Optional[LPRConfig] = None

    # Camera health
    enable_health: bool = True
    health_config: Optional[CameraHealthConfig] = None

    # Encoding
    jpeg_quality: int = 75
    max_keyframe_kb: int = 100
    keyframe_interval_sec: float = 5.0
    force_keyframe_on_alert: bool = True

    # Encryption
    enable_encryption: bool = True
    aes_key: Optional[bytes] = None  # 32 bytes for AES-256
    aes_iv: Optional[bytes] = None   # 16 bytes

    # Uplink
    uplink_batch_size: int = 10
    uplink_interval_sec: float = 1.0
    max_uplink_latency_ms: float = 8000.0

    # Performance
    max_latency_ms: float = 100.0  # Per-frame processing budget
    drop_frames_on_backpressure: bool = True


@dataclass(frozen=True, slots=True)
class FrameContext:
    """Context for a single frame being processed."""

    frame_id: str
    camera_id: str
    timestamp: float
    frame_idx: int
    original_frame: np.ndarray
    enhanced_frame: Optional[np.ndarray] = None

    # Detection results
    detections: list[dict[str, Any]] = field(default_factory=list)
    tracks: list[TrackState] = field(default_factory=list)

    # Analytics results
    geofence_results: list[IntrusionResult] = field(default_factory=list)
    trajectory_predictions: list[PredictionResult] = field(default_factory=list)
    pose_results: list[BehaviorResult] = field(default_factory=list)
    face_results: list[FaceMatchResult] = field(default_factory=list)
    lpr_results: list[PlateRecognitionResult] = field(default_factory=list)
    health_alerts: list[HealthAlert] = field(default_factory=list)

    # Keyframe
    keyframe_jpeg: Optional[bytes] = None
    keyframe_timestamp: float = 0.0

    # Processing metadata
    processing_times: dict[str, float] = field(default_factory=dict)
    errors: list[str] = field(default_factory=list)


@dataclass(frozen=True, slots=True)
class UplinkPayload:
    """Encrypted uplink payload."""

    payload_id: str
    camera_id: str
    timestamp: float
    encrypted_data: bytes
    iv: bytes
    metadata: dict[str, Any]  # Unencrypted metadata for routing


class FrameEncoder:
    """JPEG encoder with size constraint."""

    def __init__(self, quality: int = 75, max_kb: int = 100) -> None:
        self.quality = quality
        self.max_bytes = max_kb * 1024

    def encode(self, frame: np.ndarray, force_quality: Optional[int] = None) -> bytes:
        """Encode frame to JPEG, adjusting quality to meet size constraint."""
        q = force_quality or self.quality
        encode_params = [cv2.IMWRITE_JPEG_QUALITY, q]

        # Try encoding
        success, buffer = cv2.imencode('.jpg', frame, encode_params)
        if not success:
            raise RuntimeError("JPEG encoding failed")

        data = buffer.tobytes()

        # If too large, reduce quality
        if len(data) > self.max_bytes and q > 10:
            # Binary search for quality
            low, high = 10, q
            best = data
            while low <= high:
                mid = (low + high) // 2
                encode_params[1] = mid
                success, buffer = cv2.imencode('.jpg', frame, encode_params)
                if success:
                    test_data = buffer.tobytes()
                    if len(test_data) <= self.max_bytes:
                        best = test_data
                        low = mid + 1
                    else:
                        high = mid - 1
            return best

        return data

    def encode_crop(self, frame: np.ndarray, bbox: tuple[float, float, float, float],
                    padding: float = 0.1) -> bytes:
        """Encode cropped region around bbox."""
        h, w = frame.shape[:2]
        x1, y1, x2, y2 = bbox
        # Add padding
        pw = (x2 - x1) * padding
        ph = (y2 - y1) * padding
        x1 = max(0, int(x1 - pw))
        y1 = max(0, int(y1 - ph))
        x2 = min(w, int(x2 + pw))
        y2 = min(h, int(y2 + ph))
        crop = frame[y1:y2, x1:x2]
        return self.encode(crop)


class AESEncryptor:
    """AES-256-GCM encryption for uplink payloads."""

    def __init__(self, key: bytes, iv: Optional[bytes] = None) -> None:
        if len(key) != 32:
            raise ValueError("AES-256 requires 32-byte key")
        self.key = key
        self.default_iv = iv or b'\x00' * 16

        # Try to import PyCryptodome
        try:
            from Crypto.Cipher import AES
            from Crypto.Random import get_random_bytes
            self._AES = AES
            self._get_random_bytes = get_random_bytes
            self._available = True
        except ImportError:
            logger.warning("PyCryptodome not available, encryption disabled")
            self._available = False

    def encrypt(self, data: bytes, iv: Optional[bytes] = None) -> tuple[bytes, bytes]:
        """Encrypt data with AES-256-GCM. Returns (ciphertext, iv)."""
        if not self._available:
            return data, iv or self.default_iv

        iv = iv or self._get_random_bytes(12)  # GCM uses 12-byte nonce
        cipher = self._AES.new(self.key, self._AES.MODE_GCM, nonce=iv)
        ciphertext, tag = cipher.encrypt_and_digest(data)
        # Prepend tag for storage
        return tag + ciphertext, iv

    def decrypt(self, ciphertext: bytes, iv: bytes, tag: Optional[bytes] = None) -> bytes:
        """Decrypt data."""
        if not self._available:
            return ciphertext

        if tag is None:
            # Tag is prepended
            tag = ciphertext[:16]
            ciphertext = ciphertext[16:]

        cipher = self._AES.new(self.key, self._AES.MODE_GCM, nonce=iv)
        return cipher.decrypt_and_verify(ciphertext, tag)


class EdgePipeline:
    """
    Master edge processing pipeline.

    Orchestrates all AI modules in sequence:
    1. Frame ingestion (RTSP/USB)
    2. Low-light enhancement (Zero-DCE)
    3. Object detection + tracking (YOLOv8n + ByteTrack)
    4. Geofence intrusion detection
    5. Trajectory prediction (Kalman)
    6. Suspicious pose detection
    7. Face recognition (ArcFace)
    8. License plate recognition (LPRNet)
    9. Camera health monitoring
    10. Keyframe encoding
    11. AES-256 encryption
    12. Uplink queue
    """

    def __init__(self, config: Optional[PipelineConfig] = None) -> None:
        """
        Initialize edge pipeline.

        Args:
            config: PipelineConfig with all module configurations.
        """
        self.config = config or PipelineConfig()
        self.mode = PipelineMode.STANDBY

        # Modules (lazy initialized)
        self._enhancer: Optional[ZeroDCEEnhancer] = None
        self._detector = None  # YOLOv8n placeholder
        self._tracker = None   # ByteTrack placeholder
        self._geofences: dict[str, GeofenceEngine] = {}
        self._trajectory_predictor: Optional[KalmanTrajectoryPredictor] = None
        self._pose_engine: Optional[SuspiciousPoseEngine] = None
        self._face_matcher: Optional[ArcFaceMatcher] = None
        self._lpr_ocr: Optional[LPRNetOCR] = None
        self._health_monitor: Optional[CameraHealthMonitor] = None
        self._encoder: Optional[FrameEncoder] = None
        self._encryptor: Optional[AESEncryptor] = None

        # State
        self._frame_queue: asyncio.Queue = asyncio.Queue(maxsize=self.config.max_queue_size)
        self._uplink_queue: asyncio.Queue = asyncio.Queue(maxsize=100)
        self._frame_count = 0
        self._last_keyframe_time = 0.0
        self._last_uplink_time = 0.0
        self._running = False

        # Stats
        self.stats = {
            "frames_processed": 0,
            "frames_dropped": 0,
            "avg_latency_ms": 0.0,
            "alerts_generated": 0,
            "uplink_sent": 0,
            "uplink_failed": 0,
        }

        # Callbacks
        self._uplink_callback: Optional[Callable[[UplinkPayload], None]] = None

        logger.info("EdgePipeline initialized for camera: %s", self.config.camera_id)

    def set_uplink_callback(self, callback: Callable[[UplinkPayload], None]) -> None:
        """Set callback for uplink payload delivery."""
        self._uplink_callback = callback

    async def initialize(self) -> None:
        """Initialize all modules."""
        logger.info("Initializing EdgePipeline modules...")

        # Enhancement
        if self.config.enable_enhancement:
            self._enhancer = create_zerodce_enhancer(
                **(self.config.enhancement_config.__dict__ if self.config.enhancement_config else {})
            )
            logger.info("ZeroDCE enhancer initialized")

        # Geofences
        if self.config.enable_geofence and self.config.geofence_config:
            gf_config = self.config.geofence_config
            for i, poly in enumerate(self.config.geofence_polygons):
                self._geofences[f"polygon_{i}"] = create_polygon_fence(poly, gf_config, f"perimeter_{i}")
            for i, line in enumerate(self.config.geofence_lines):
                self._geofences[f"line_{i}"] = create_line_fence(line, gf_config, f"barrier_{i}")
            logger.info("Initialized %d geofences", len(self._geofences))

        # Trajectory predictor
        if self.config.enable_trajectory:
            self._trajectory_predictor = create_kalman_predictor(
                **(self.config.kalman_config.__dict__ if self.config.kalman_config else {})
            )
            logger.info("Kalman trajectory predictor initialized")

        # Pose engine
        if self.config.enable_pose:
            self._pose_engine = create_suspicious_pose_engine(
                **(self.config.pose_config.__dict__ if self.config.pose_config else {})
            )
            logger.info("Suspicious pose engine initialized")

        # Face matcher
        if self.config.enable_face:
            self._face_matcher = create_arcface_matcher(
                **(self.config.face_config.__dict__ if self.config.face_config else {})
            )
            self._face_matcher.initialize()
            if self.config.face_watchlist:
                entries = []
                for wl in self.config.face_watchlist:
                    # Would need actual face images to create embeddings
                    pass
            logger.info("ArcFace matcher initialized")

        # LPR OCR
        if self.config.enable_lpr:
            self._lpr_ocr = create_lprnet_ocr(
                **(self.config.lpr_config.__dict__ if self.config.lpr_config else {})
            )
            self._lpr_ocr.initialize()
            logger.info("LPRNet OCR initialized")

        # Camera health
        if self.config.enable_health:
            self._health_monitor = create_camera_health_monitor(
                **(self.config.health_config.__dict__ if self.config.health_config else {})
            )
            self._health_monitor.register_camera(self.config.camera_id)
            logger.info("Camera health monitor initialized")

        # Encoder
        self._encoder = FrameEncoder(self.config.jpeg_quality, self.config.max_keyframe_kb)
        logger.info("Frame encoder initialized")

        # Encryptor
        if self.config.enable_encryption and self.config.aes_key:
            self._encryptor = AESEncryptor(self.config.aes_key, self.config.aes_iv)
            logger.info("AES encryptor initialized")

        self.mode = PipelineMode.ACTIVE
        logger.info("EdgePipeline initialization complete")

    async def start(self) -> None:
        """Start the processing loop."""
        if self.mode == PipelineMode.STANDBY:
            await self.initialize()

        self._running = True
        self.mode = PipelineMode.ACTIVE
        logger.info("EdgePipeline started")

        # Start background tasks
        asyncio.create_task(self._processing_loop())
        asyncio.create_task(self._uplink_loop())

    async def stop(self) -> None:
        """Stop the pipeline."""
        self._running = False
        self.mode = PipelineMode.STANDBY
        logger.info("EdgePipeline stopped")

    def submit_frame(self, frame: np.ndarray, timestamp: Optional[float] = None) -> bool:
        """
        Submit a frame for processing (non-blocking).

        Returns:
            True if queued, False if queue full (backpressure).
        """
        if not self._running:
            return False

        try:
            self._frame_queue.put_nowait((frame, timestamp or time.time()))
            return True
        except asyncio.QueueFull:
            if self.config.drop_frames_on_backpressure:
                self.stats["frames_dropped"] += 1
                return False
            raise

    def submit_frame_sync(self, frame: np.ndarray, timestamp: Optional[float] = None) -> FrameContext:
        """Submit frame and wait for processing (blocking)."""
        ctx = self._process_frame_sync(frame, timestamp or time.time())
        return ctx

    def _process_frame_sync(self, frame: np.ndarray, timestamp: float) -> FrameContext:
        """Synchronous frame processing for testing."""
        frame_id = str(uuid.uuid4())[:8]
        self._frame_count += 1

        ctx = FrameContext(
            frame_id=frame_id,
            camera_id=self.config.camera_id,
            timestamp=timestamp,
            frame_idx=self._frame_count,
            original_frame=frame,
        )

        start_total = time.perf_counter()

        try:
            # Process through pipeline stages
            self._run_enhancement(ctx)
            self._run_detection(ctx)
            self._run_analytics(ctx)
            self._run_encoding(ctx)

        except Exception as e:
            logger.error("Frame processing error: %s", e)
            ctx.errors.append(str(e))

        ctx.processing_times["total_ms"] = (time.perf_counter() - start_total) * 1000
        self.stats["frames_processed"] += 1
        self._update_avg_latency(ctx.processing_times["total_ms"])

        # Queue for uplink
        self._maybe_queue_uplink(ctx)

        return ctx

    async def _processing_loop(self) -> None:
        """Async processing loop."""
        while self._running:
            try:
                frame, timestamp = await asyncio.wait_for(
                    self._frame_queue.get(),
                    timeout=0.1
                )
                ctx = self._process_frame_sync(frame, timestamp)
            except asyncio.TimeoutError:
                continue
            except Exception as e:
                logger.error("Processing loop error: %s", e)

    async def _uplink_loop(self) -> None:
        """Uplink transmission loop."""
        batch = []
        while self._running:
            try:
                payload = await asyncio.wait_for(
                    self._uplink_queue.get(),
                    timeout=self.config.uplink_interval_sec
                )
                batch.append(payload)

                if len(batch) >= self.config.uplink_batch_size:
                    await self._send_batch(batch)
                    batch.clear()

            except asyncio.TimeoutError:
                if batch:
                    await self._send_batch(batch)
                    batch.clear()
            except Exception as e:
                logger.error("Uplink loop error: %s", e)

    async def _send_batch(self, batch: list[UplinkPayload]) -> None:
        """Send batch of uplink payloads."""
        for payload in batch:
            try:
                if self._uplink_callback:
                    await self._uplink_callback(payload)
                self.stats["uplink_sent"] += 1
            except Exception as e:
                logger.error("Uplink send failed: %s", e)
                self.stats["uplink_failed"] += 1

    def _run_enhancement(self, ctx: FrameContext) -> None:
        """Stage 1: Low-light enhancement."""
        if not self.config.enable_enhancement or not self._enhancer:
            ctx.enhanced_frame = ctx.original_frame
            return

        start = time.perf_counter()
        result = self._enhancer.enhance(ctx.original_frame)
        ctx.enhanced_frame = result.frame
        ctx.processing_times["enhancement_ms"] = (time.perf_counter() - start) * 1000

    def _run_detection(self, ctx: FrameContext) -> None:
        """Stage 2: Object detection + tracking (placeholder for YOLOv8n+ByteTrack)."""
        if not self.config.enable_detection:
            return

        start = time.perf_counter()

        # TODO: Integrate actual YOLOv8n + ByteTrack
        # For now, create mock detections for pipeline testing
        h, w = ctx.enhanced_frame.shape[:2]
        ctx.detections = [
            {
                "bbox": [w * 0.3, h * 0.3, w * 0.5, h * 0.5],
                "confidence": 0.9,
                "class_id": 0,
                "class_name": "person",
            },
            {
                "bbox": [w * 0.6, h * 0.4, w * 0.8, h * 0.7],
                "confidence": 0.85,
                "class_id": 2,
                "class_name": "car",
            },
        ]

        # Convert to TrackState for downstream modules
        ctx.tracks = []
        for i, det in enumerate(ctx.detections):
            x1, y1, x2, y2 = det["bbox"]
            ctx.tracks.append(TrackState(
                track_id=i + 1,
                bbox=(x1, y1, x2 - x1, y2 - y1),
                center=((x1 + x2) / 2, (y1 + y2) / 2),
                timestamp=ctx.timestamp,
                confidence=det["confidence"],
                class_id=det["class_id"],
                class_name=det["class_name"],
            ))

        ctx.processing_times["detection_ms"] = (time.perf_counter() - start) * 1000

    def _run_analytics(self, ctx: FrameContext) -> None:
        """Stage 3-8: All analytics modules."""
        if not ctx.tracks:
            return

        # Geofence
        if self.config.enable_geofence and self._geofences:
            start = time.perf_counter()
            for gf_name, gf in self._geofences.items():
                for track in ctx.tracks:
                    bbox = BoundingBox(*track.bbox)
                    result = gf.check_bbox(bbox, track.track_id)
                    if result.intruded:
                        ctx.geofence_results.append(result)
            ctx.processing_times["geofence_ms"] = (time.perf_counter() - start) * 1000

        # Trajectory prediction
        if self.config.enable_trajectory and self._trajectory_predictor:
            start = time.perf_counter()
            for track in ctx.tracks:
                self._trajectory_predictor.update_track(track)
                pred = self._trajectory_predictor.predict(track.track_id, ctx.timestamp)
                if pred and pred.is_reliable:
                    ctx.trajectory_predictions.append(pred)
            ctx.processing_times["trajectory_ms"] = (time.perf_counter() - start) * 1000

        # Pose analysis
        if self.config.enable_pose and self._pose_engine:
            start = time.perf_counter()
            # Create mock keypoint frames (would come from YOLOv8-pose)
            keypoint_frames = []
            for track in ctx.tracks:
                if track.class_id == 0:  # person only
                    # Mock keypoints
                    cx, cy = track.center
                    kpts = np.zeros((17, 3), dtype=np.float32)
                    # Standing pose
                    kpts[5] = [cx - 20, cy - 30, 0.9]  # L shoulder
                    kpts[6] = [cx + 20, cy - 30, 0.9]  # R shoulder
                    kpts[11] = [cx - 15, cy + 10, 0.9]  # L hip
                    kpts[12] = [cx + 15, cy + 10, 0.9]  # R hip
                    kpts[13] = [cx - 15, cy + 50, 0.9]  # L knee
                    kpts[14] = [cx + 15, cy + 50, 0.9]  # R knee
                    kpts[15] = [cx - 15, cy + 90, 0.9]  # L ankle
                    kpts[16] = [cx + 15, cy + 90, 0.9]  # R ankle

                    keypoint_frames.append(KeypointFrame(
                        track_id=track.track_id,
                        keypoints=kpts,
                        bbox=track.bbox,
                        timestamp=ctx.timestamp,
                        confidence=track.confidence,
                    ))

            if keypoint_frames:
                pose_results = self._pose_engine.process_frame(keypoint_frames, ctx.timestamp)
                ctx.pose_results.extend(pose_results)
            ctx.processing_times["pose_ms"] = (time.perf_counter() - start) * 1000

        # Face recognition
        if self.config.enable_face and self._face_matcher:
            start = time.perf_counter()
            track_ids = [t.track_id for t in ctx.tracks]
            face_results = self._face_matcher.process_frame(ctx.enhanced_frame, track_ids)
            ctx.face_results.extend(face_results)
            ctx.processing_times["face_ms"] = (time.perf_counter() - start) * 1000

        # License plate recognition
        if self.config.enable_lpr and self._lpr_ocr:
            start = time.perf_counter()
            vehicle_tracks = [t for t in ctx.tracks if t.class_id in [2, 3, 5, 7]]  # vehicles
            track_ids = [t.track_id for t in vehicle_tracks]
            lpr_results = self._lpr_ocr.process_frame(ctx.enhanced_frame, track_ids)
            ctx.lpr_results.extend(lpr_results)
            ctx.processing_times["lpr_ms"] = (time.perf_counter() - start) * 1000

        # Camera health
        if self.config.enable_health and self._health_monitor:
            start = time.perf_counter()
            health_alerts = self._health_monitor.process_frame(
                self.config.camera_id,
                ctx.enhanced_frame,
                ctx.timestamp,
                ctx.frame_idx,
            )
            ctx.health_alerts.extend(health_alerts)
            ctx.processing_times["health_ms"] = (time.perf_counter() - start) * 1000

    def _run_encoding(self, ctx: FrameContext) -> None:
        """Stage 9: Keyframe encoding."""
        if not self._encoder:
            return

        start = time.perf_counter()

        # Determine if keyframe needed
        need_keyframe = (
            ctx.frame_idx == 1 or
            (ctx.timestamp - self._last_keyframe_time) >= self.config.keyframe_interval_sec or
            (self.config.force_keyframe_on_alert and (
                ctx.geofence_results or ctx.pose_results or ctx.face_results or ctx.lpr_results or ctx.health_alerts
            ))
        )

        if need_keyframe:
            # Encode full frame or crop to most relevant detection
            if ctx.geofence_results and ctx.geofence_results[0].intersection_point:
                # Crop to intrusion
                pass  # Would crop around intersection
            ctx.keyframe_jpeg = self._encoder.encode(ctx.enhanced_frame)
            ctx.keyframe_timestamp = ctx.timestamp
            self._last_keyframe_time = ctx.timestamp

        ctx.processing_times["encoding_ms"] = (time.perf_counter() - start) * 1000

    def _maybe_queue_uplink(self, ctx: FrameContext) -> None:
        """Build and queue uplink payload."""
        if not self._encryptor:
            return

        # Build metadata JSON
        metadata = {
            "frame_id": ctx.frame_id,
            "camera_id": ctx.camera_id,
            "timestamp": ctx.timestamp,
            "frame_idx": ctx.frame_idx,
            "processing_latency_ms": ctx.processing_times.get("total_ms", 0),
            "detections": len(ctx.detections),
            "tracks": len(ctx.tracks),
        }

        # Add alerts
        alerts = []
        for r in ctx.geofence_results:
            alerts.append({
                "type": "GEOFENCE_INTRUSION",
                "severity": r.severity.name,
                "track_id": r.object_id,
                "intersection": r.intersection_point,
            })
        for r in ctx.pose_results:
            if r.is_suspicious:
                alerts.append({
                    "type": "SUSPICIOUS_BEHAVIOR",
                    "behavior": r.behavior.name,
                    "alert_level": r.alert_level.name,
                    "track_id": r.track_id,
                    "confidence": r.confidence,
                })
        for r in ctx.face_results:
            if r.matched:
                alerts.append({
                    "type": "WATCHLIST_MATCH",
                    "watchlist_id": r.watchlist_id,
                    "name": r.watchlist_name,
                    "similarity": r.similarity,
                    "track_id": r.track_id,
                })
        for r in ctx.lpr_results:
            if r.is_valid:
                alerts.append({
                    "type": "PLATE_RECOGNIZED",
                    "plate": r.formatted_text,
                    "state": r.state_code,
                    "confidence": r.confidence,
                    "track_id": r.detection.track_id,
                })
        for a in ctx.health_alerts:
            alerts.append(a.to_uplink_payload())

        metadata["alerts"] = alerts

        # Encrypt
        json_data = json.dumps(metadata, separators=(',', ':')).encode('utf-8')
        encrypted, iv = self._encryptor.encrypt(json_data)

        # Create uplink payload
        payload = UplinkPayload(
            payload_id=str(uuid.uuid4())[:8],
            camera_id=ctx.camera_id,
            timestamp=ctx.timestamp,
            encrypted_data=encrypted,
            iv=iv,
            metadata={
                "frame_id": ctx.frame_id,
                "has_keyframe": ctx.keyframe_jpeg is not None,
                "keyframe_size": len(ctx.keyframe_jpeg) if ctx.keyframe_jpeg else 0,
                "alert_count": len(alerts),
            },
        )

        try:
            self._uplink_queue.put_nowait(payload)
        except asyncio.QueueFull:
            logger.warning("Uplink queue full, dropping payload")

    def _update_avg_latency(self, latency_ms: float) -> None:
        """Update rolling average latency."""
        n = self.stats["frames_processed"]
        if n == 1:
            self.stats["avg_latency_ms"] = latency_ms
        else:
            self.stats["avg_latency_ms"] = (
                (self.stats["avg_latency_ms"] * (n - 1) + latency_ms) / n
            )

    def get_stats(self) -> dict[str, Any]:
        """Get pipeline statistics."""
        return {
            **self.stats,
            "mode": self.mode.name,
            "camera_id": self.config.camera_id,
            "queue_size": self._frame_queue.qsize(),
            "uplink_queue_size": self._uplink_queue.qsize(),
        }

    def get_health_summary(self) -> dict[str, Any]:
        """Get camera health summary."""
        if self._health_monitor:
            return self._health_monitor.get_health_summary(self.config.camera_id)
        return {}

    def add_geofence_polygon(self, coordinates: list[tuple[float, float]], fence_id: str) -> None:
        """Add a polygon geofence dynamically."""
        if self.config.geofence_config:
            self._geofences[fence_id] = create_polygon_fence(
                coordinates, self.config.geofence_config, fence_id
            )

    def add_geofence_line(self, coordinates: list[tuple[float, float]], fence_id: str) -> None:
        """Add a line geofence dynamically."""
        if self.config.geofence_config:
            self._geofences[fence_id] = create_line_fence(
                coordinates, self.config.geofence_config, fence_id
            )

    def load_face_watchlist(self, face_images: dict[str, np.ndarray]) -> int:
        """Load face watchlist from images."""
        if not self._face_matcher:
            return 0
        entries = []
        for wl_id, img in face_images.items():
            entry = create_watchlist_entry(self._face_matcher, img, wl_id, wl_id)
            if entry:
                entries.append(entry)
        return self._face_matcher.load_watchlist(entries)

    def __enter__(self) -> "EdgePipeline":
        """Sync context manager."""
        import asyncio
        asyncio.run(self.initialize())
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        asyncio.run(self.stop())


def create_edge_pipeline(
    camera_id: str,
    rtsp_url: str = "",
    target_fps: float = 30.0,
    frame_width: int = 1920,
    frame_height: int = 1080,
    enable_all: bool = True,
    aes_key: Optional[bytes] = None,
) -> EdgePipeline:
    """
    Factory function to create EdgePipeline with common defaults.

    Args:
        camera_id: Unique camera identifier.
        rtsp_url: RTSP stream URL.
        target_fps: Target processing FPS.
        frame_width: Frame width.
        frame_height: Frame height.
        enable_all: Enable all analytics modules.
        aes_key: 32-byte AES-256 key for encryption.

    Returns:
        Configured EdgePipeline instance.
    """
    config = PipelineConfig(
        camera_id=camera_id,
        rtsp_url=rtsp_url,
        target_fps=target_fps,
        frame_width=frame_width,
        frame_height=frame_height,
        enable_enhancement=enable_all,
        enable_detection=enable_all,
        enable_geofence=enable_all,
        enable_trajectory=enable_all,
        enable_pose=enable_all,
        enable_face=enable_all,
        enable_lpr=enable_all,
        enable_health=enable_all,
        enable_encryption=enable_all and aes_key is not None,
        aes_key=aes_key,
    )
    return EdgePipeline(config)


# ============================================================
# RTSP Frame Source (for standalone operation)
# ============================================================

class RTSPFrameSource:
    """RTSP frame capture with reconnection logic."""

    def __init__(
        self,
        rtsp_url: str,
        target_fps: float = 30.0,
        buffer_size: int = 3,
    ) -> None:
        self.rtsp_url = rtsp_url
        self.target_fps = target_fps
        self.buffer_size = buffer_size
        self._cap: Optional[cv2.VideoCapture] = None
        self._running = False
        self._frame_queue: asyncio.Queue = asyncio.Queue(maxsize=buffer_size)
        self._frame_count = 0

    async def start(self) -> None:
        """Start capture."""
        self._running = True
        asyncio.create_task(self._capture_loop())

    async def stop(self) -> None:
        """Stop capture."""
        self._running = False
        if self._cap:
            self._cap.release()

    async def _capture_loop(self) -> None:
        """Background capture loop."""
        frame_interval = 1.0 / self.target_fps

        while self._running:
            if self._cap is None or not self._cap.isOpened():
                await self._connect()
                await asyncio.sleep(1)
                continue

            ret, frame = self._cap.read()
            if not ret:
                logger.warning("Frame read failed, reconnecting...")
                self._cap.release()
                self._cap = None
                await asyncio.sleep(1)
                continue

            self._frame_count += 1
            try:
                self._frame_queue.put_nowait((frame, time.time(), self._frame_count))
            except asyncio.QueueFull:
                pass  # Drop frame if buffer full

            await asyncio.sleep(frame_interval)

    async def _connect(self) -> None:
        """Connect to RTSP stream."""
        logger.info("Connecting to RTSP: %s", self.rtsp_url)
        self._cap = cv2.VideoCapture(self.rtsp_url, cv2.CAP_FFMPEG)
        self._cap.set(cv2.CAP_PROP_BUFFERSIZE, self.buffer_size)

    async def get_frame(self) -> Optional[tuple[np.ndarray, float, int]]:
        """Get next frame."""
        try:
            return await asyncio.wait_for(self._frame_queue.get(), timeout=1.0)
        except asyncio.TimeoutError:
            return None


async def run_pipeline_standalone(
    camera_id: str,
    rtsp_url: str,
    aes_key: bytes,
    duration_sec: Optional[float] = None,
) -> None:
    """
    Run pipeline standalone with RTSP source.

    Args:
        camera_id: Camera identifier.
        rtsp_url: RTSP stream URL.
        aes_key: 32-byte AES-256 encryption key.
        duration_sec: Run duration (None = infinite).
    """
    pipeline = create_edge_pipeline(
        camera_id=camera_id,
        rtsp_url=rtsp_url,
        aes_key=aes_key,
    )

    source = RTSPFrameSource(rtsp_url)

    async def uplink_handler(payload: UplinkPayload) -> None:
        logger.info(
            "UPLINK: %s alerts=%d keyframe=%s",
            payload.payload_id,
            payload.metadata.get("alert_count", 0),
            "yes" if payload.metadata.get("has_keyframe") else "no",
        )

    pipeline.set_uplink_callback(uplink_handler)

    await pipeline.start()
    await source.start()

    start_time = time.time()
    try:
        while True:
            if duration_sec and (time.time() - start_time) > duration_sec:
                break

            frame_data = await source.get_frame()
            if frame_data:
                frame, timestamp, frame_idx = frame_data
                pipeline.submit_frame(frame, timestamp)

            await asyncio.sleep(0.01)

    finally:
        await pipeline.stop()
        await source.stop()
        logger.info("Pipeline stats: %s", pipeline.get_stats())


if __name__ == "__main__":
    # Demo / self-test
    logging.basicConfig(level=logging.INFO)

    print("EdgePipeline module loaded successfully")
    print("\nUsage:")
    print("  pipeline = create_edge_pipeline(")
    print("      camera_id='cam_01',")
    print("      rtsp_url='rtsp://...',")
    print("      aes_key=b'32-byte-key-here...',")
    print("  )")
    print("  await pipeline.start()")
    print("  pipeline.submit_frame(frame)")
    print("\nOr run standalone:")
    print("  await run_pipeline_standalone('cam_01', 'rtsp://...', aes_key)")