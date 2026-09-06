"""
LPRNet License Plate Recognition for Indian Vehicle Registration Formats

Automatic Number Plate Recognition (ANPR) optimized for Indian license plates:
- State codes (2 letters): MH, DL, KA, TN, etc.
- Series (1-2 letters): A, AB, etc.
- Numbers (1-4 digits): 1-9999
- Formats: MH12AB1234, DL01A1234, KA03AB1234, etc.
- Supports both old and new (Bharat series) formats
"""

from __future__ import annotations

import logging
import re
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Optional

import cv2
import numpy as np
import onnxruntime as ort

logger = logging.getLogger(__name__)


class PlateFormat(Enum):
    """Indian license plate format types."""

    STANDARD = "standard"           # MH12AB1234 (pre-2019)
    BHARAT_SERIES = "bharat"        # 22BH1234AB (Bharat series)
    NEW_STANDARD = "new_standard"   # MH12AB1234 (post-2019 with IND)
    DIPLOMATIC = "diplomatic"       # 12CD1234
    MILITARY = "military"           # ↑12345AB
    TEMPORARY = "temporary"         # TR1234
    EV_GREEN = "ev_green"           # Green background plates


@dataclass(frozen=True, slots=True)
class LPRConfig:
    """Configuration for LPRNet OCR."""

    # Model paths
    detector_model_path: str = "models/lpr_detector.onnx"
    recognizer_model_path: str = "models/lprnet.onnx"

    # Detection parameters
    det_input_size: tuple[int, int] = (320, 320)
    det_conf_threshold: float = 0.4
    det_nms_threshold: float = 0.45
    det_max_plates: int = 5

    # Recognition parameters
    rec_input_size: tuple[int, int] = (94, 24)  # W, H for LPRNet
    max_plate_length: int = 10

    # Character set for Indian plates
    charset: str = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"

    # CTC blank index (usually 0 or len(charset))
    ctc_blank: int = 0

    # Post-processing
    min_plate_confidence: float = 0.6
    min_char_confidence: float = 0.5

    # Indian state codes (28 states + 8 UTs)
    state_codes: set[str] = field(default_factory=lambda: {
        "AN", "AP", "AR", "AS", "BR", "CH", "CG", "DD", "DL", "DN",
        "GA", "GJ", "HR", "HP", "JH", "JK", "KA", "KL", "LD", "MH",
        "ML", "MN", "MP", "MZ", "NL", "OD", "PB", "PY", "RJ", "SK",
        "TN", "TS", "TR", "UK", "UP", "WB",
    })

    # RTO series codes (common patterns)
    series_patterns: set[str] = field(default_factory=lambda: {
        "A", "B", "C", "D", "E", "F", "G", "H", "J", "K", "L", "M",
        "N", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z",
        "AA", "AB", "AC", "AD", "AE", "AF", "AG", "AH", "AJ", "AK",
        "AL", "AM", "AN", "AP", "AQ", "AR", "AS", "AT", "AU", "AV",
        "AW", "AX", "AY", "AZ",
    })

    # Execution providers
    providers: list[str] = field(default_factory=lambda: ["CPUExecutionProvider"])


@dataclass(frozen=True, slots=True)
class PlateDetection:
    """License plate detection result."""

    bbox: tuple[float, float, float, float]  # x1, y1, x2, y2
    confidence: float
    plate_type: PlateFormat = PlateFormat.STANDARD
    track_id: Optional[int] = None


@dataclass(frozen=True, slots=True)
class PlateRecognitionResult:
    """Complete plate recognition result."""

    detection: PlateDetection
    raw_text: str  # Raw OCR output
    formatted_text: str  # Validated/formatted plate
    confidence: float  # Overall confidence
    char_confidences: list[float]  # Per-character confidence
    format_type: PlateFormat
    is_valid: bool
    validation_errors: list[str]
    timestamp: float
    processing_time_ms: float

    @property
    def state_code(self) -> Optional[str]:
        """Extract state code if valid."""
        if not self.is_valid:
            return None
        # First 2 chars for standard format
        if self.format_type in (PlateFormat.STANDARD, PlateFormat.NEW_STANDARD):
            return self.formatted_text[:2] if len(self.formatted_text) >= 2 else None
        elif self.format_type == PlateFormat.BHARAT_SERIES:
            return self.formatted_text[2:4] if len(self.formatted_text) >= 4 else None
        return None

    @property
    def district_code(self) -> Optional[str]:
        """Extract district/RTO code."""
        if not self.is_valid:
            return None
        if self.format_type in (PlateFormat.STANDARD, PlateFormat.NEW_STANDARD):
            return self.formatted_text[2:4] if len(self.formatted_text) >= 4 else None
        return None


@dataclass(frozen=True, slots=True)
class VehiclePlateRecord:
    """Vehicle plate record for tracking."""

    track_id: int
    plate_text: str
    format_type: PlateFormat
    confidence: float
    first_seen: float
    last_seen: float
    detection_count: int = 1
    best_result: Optional[PlateRecognitionResult] = None

    def update(self, result: PlateRecognitionResult) -> None:
        """Update with new recognition result."""
        self.last_seen = result.timestamp
        self.detection_count += 1
        if result.confidence > self.confidence:
            self.confidence = result.confidence
            self.plate_text = result.formatted_text
            self.best_result = result


class LPRNetOCR:
    """
    LPRNet-based License Plate Recognition for Indian formats.

    Pipeline:
    1. Plate detection (YOLO-based or custom detector)
    2. Perspective correction / rectification
    3. LPRNet character recognition (CTC decoding)
    4. Indian format validation & correction
    5. Confidence scoring per character
    """

    def __init__(self, config: Optional[LPRConfig] = None) -> None:
        """
        Initialize LPRNet OCR.

        Args:
            config: LPRConfig with model paths and parameters.
        """
        self.config = config or LPRConfig()
        self._detector: Optional[ort.InferenceSession] = None
        self._recognizer: Optional[ort.InferenceSession] = None
        self._initialized = False
        self._char_to_idx = {c: i for i, c in enumerate(self.config.charset)}
        self._idx_to_char = {i: c for i, c in enumerate(self.config.charset)}

        # Compile validation regex patterns
        self._compile_patterns()

        logger.info("LPRNetOCR initialized with config: %s", self.config)

    def _compile_patterns(self) -> None:
        """Compile regex patterns for Indian plate validation."""
        # Standard format: STATE(2) + DISTRICT(2) + SERIES(1-2) + NUMBER(1-4)
        # Examples: MH12AB1234, DL01A1234, KA03AB1234
        self._pattern_standard = re.compile(
            r'^([A-Z]{2})(\d{2})([A-Z]{1,2})(\d{1,4})$'
        )

        # Bharat series: YY + BH + NUMBER(4) + SERIES(2)
        # Example: 22BH1234AB
        self._pattern_bharat = re.compile(
            r'^(\d{2})(BH)(\d{4})([A-Z]{2})$'
        )

        # Diplomatic: NUMBER(2) + CD/CC + NUMBER(4)
        self._pattern_diplomatic = re.compile(
            r'^(\d{2})(CD|CC)(\d{4})$'
        )

        # Military: ↑ + NUMBER(5) + SERIES(2) (arrow often not detected)
        self._pattern_military = re.compile(
            r'^(\d{5})([A-Z]{2})$'
        )

        # Temporary: TR + NUMBER(4)
        self._pattern_temp = re.compile(
            r'^(TR)(\d{4})$'
        )

        # Green plate (EV): Same as standard but with green background indicator
        # Format is same, just color different

    def initialize(self) -> None:
        """Load ONNX models."""
        if self._initialized:
            return

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
            logger.error("Failed to load LPRNet models: %s", e)
            raise RuntimeError(f"LPRNet model loading failed: {e}") from e

        self._initialized = True
        logger.info("LPRNetOCR initialization complete")

    def _preprocess_detector(self, image: np.ndarray) -> tuple[np.ndarray, float]:
        """Preprocess for plate detector."""
        h, w = image.shape[:2]
        target_h, target_w = self.config.det_input_size

        scale = min(target_h / h, target_w / w)
        new_h, new_w = int(h * scale), int(w * scale)
        resized = cv2.resize(image, (new_w, new_h), interpolation=cv2.INTER_LINEAR)

        padded = np.full((target_h, target_w, 3), 114, dtype=np.uint8)
        padded[:new_h, :new_w] = resized

        # Normalize
        input_tensor = padded[:, :, ::-1].transpose(2, 0, 1).astype(np.float32) / 255.0
        input_tensor = np.expand_dims(input_tensor, 0)

        return input_tensor, scale

    def _preprocess_recognizer(self, plate_crop: np.ndarray) -> np.ndarray:
        """Preprocess plate crop for LPRNet recognizer."""
        w, h = self.config.rec_input_size

        # Resize maintaining aspect ratio with padding
        crop_h, crop_w = plate_crop.shape[:2]
        scale = min(w / crop_w, h / crop_h)
        new_w, new_h = int(crop_w * scale), int(crop_h * scale)

        resized = cv2.resize(plate_crop, (new_w, new_h), interpolation=cv2.INTER_LINEAR)

        # Pad to target size (center)
        padded = np.zeros((h, w, 3), dtype=np.uint8)
        x_offset = (w - new_w) // 2
        y_offset = (h - new_h) // 2
        padded[y_offset:y_offset+new_h, x_offset:x_offset+new_w] = resized

        # Normalize: [-1, 1]
        input_tensor = (padded.astype(np.float32) / 127.5) - 1.0
        input_tensor = input_tensor.transpose(2, 0, 1)
        input_tensor = np.expand_dims(input_tensor, 0)

        return input_tensor

    def _rectify_plate(self, image: np.ndarray, bbox: tuple[float, float, float, float]) -> np.ndarray:
        """
        Rectify plate using perspective transform.
        For simplicity, just crops; full implementation would use corner detection.
        """
        x1, y1, x2, y2 = map(int, bbox)
        h, w = image.shape[:2]
        x1, y1 = max(0, x1), max(0, y1)
        x2, y2 = min(w, x2), min(h, y2)

        if x2 <= x1 or y2 <= y1:
            return np.zeros((24, 94, 3), dtype=np.uint8)

        return image[y1:y2, x1:x2]

    def _ctc_decode(self, logits: np.ndarray) -> tuple[str, list[float]]:
        """
        CTC greedy decoding with confidence scores.

        Args:
            logits: Shape (T, C) where T=time steps, C=classes+blank

        Returns:
            Tuple of (decoded_text, char_confidences)
        """
        # logits: (1, T, C) or (T, C)
        if logits.ndim == 3:
            logits = logits.squeeze(0)

        T, C = logits.shape
        blank = self.config.ctc_blank

        # Softmax
        probs = self._softmax(logits, axis=1)

        # Greedy decode
        decoded = []
        confidences = []
        prev_idx = blank

        for t in range(T):
            idx = int(np.argmax(probs[t]))
            conf = float(probs[t, idx])

            if idx != blank and idx != prev_idx:
                if idx in self._idx_to_char:
                    decoded.append(self._idx_to_char[idx])
                    confidences.append(conf)
            prev_idx = idx

        return ''.join(decoded), confidences

    def _softmax(self, x: np.ndarray, axis: int = -1) -> np.ndarray:
        """Numerically stable softmax."""
        e_x = np.exp(x - np.max(x, axis=axis, keepdims=True))
        return e_x / np.sum(e_x, axis=axis, keepdims=True)

    def _beam_search_decode(self, logits: np.ndarray, beam_width: int = 5) -> tuple[str, list[float]]:
        """
        CTC beam search decoding for better accuracy.

        Args:
            logits: Shape (T, C)
            beam_width: Beam width for search.

        Returns:
            Tuple of (decoded_text, char_confidences)
        """
        if logits.ndim == 3:
            logits = logits.squeeze(0)

        T, C = logits.shape
        blank = self.config.ctc_blank
        probs = self._softmax(logits, axis=1)

        # Initialize beams: (prefix, last_char, log_prob)
        beams = [("", blank, 0.0)]

        for t in range(T):
            new_beams = {}
            for prefix, last_char, log_prob in beams:
                for c in range(C):
                    p = probs[t, c]
                    if p <= 0:
                        continue
                    new_log_prob = log_prob + np.log(p)

                    if c == blank:
                        new_prefix = prefix
                        new_last = blank
                    elif c == last_char:
                        new_prefix = prefix
                        new_last = c
                    else:
                        char = self._idx_to_char.get(c, '')
                        new_prefix = prefix + char
                        new_last = c

                    key = (new_prefix, new_last)
                    if key not in new_beams or new_log_prob > new_beams[key]:
                        new_beams[key] = new_log_prob

            # Keep top beams
            beams = sorted(new_beams.items(), key=lambda x: x[1], reverse=True)[:beam_width]
            beams = [(p, l, lp) for (p, l), lp in beams]

        # Best beam
        best_prefix, _, _ = beams[0]

        # Approximate char confidences (use greedy for confidence)
        _, greedy_conf = self._ctc_decode(logits)
        return best_prefix, greedy_conf

    def _validate_indian_plate(self, text: str) -> tuple[PlateFormat, str, bool, list[str]]:
        """
        Validate and format Indian license plate.

        Returns:
            Tuple of (format_type, formatted_text, is_valid, errors)
        """
        errors = []
        text = text.upper().replace(" ", "").replace("-", "")

        # Try each format
        # 1. Standard format
        m = self._pattern_standard.match(text)
        if m:
            state, district, series, number = m.groups()
            if state in self.config.state_codes:
                # Validate district (01-99)
                if 1 <= int(district) <= 99:
                    # Validate series
                    if series in self.config.series_patterns or len(series) == 1:
                        # Validate number (1-9999)
                        if 1 <= int(number) <= 9999:
                            formatted = f"{state}{district}{series}{int(number):04d}"[-10:]
                            return PlateFormat.STANDARD, formatted, True, []

        # 2. Bharat series
        m = self._pattern_bharat.match(text)
        if m:
            year, bh, number, series = m.groups()
            if 20 <= int(year) <= 99:  # 2020 onwards
                if series in self.config.series_patterns or len(series) == 2:
                    formatted = f"{year}{bh}{int(number):04d}{series}"
                    return PlateFormat.BHARAT_SERIES, formatted, True, []

        # 3. Diplomatic
        m = self._pattern_diplomatic.match(text)
        if m:
            num, cdcc, number = m.groups()
            formatted = f"{num}{cdcc}{int(number):04d}"
            return PlateFormat.DIPLOMATIC, formatted, True, []

        # 4. Military
        m = self._pattern_military.match(text)
        if m:
            number, series = m.groups()
            formatted = f"↑{number}{series}"
            return PlateFormat.MILITARY, formatted, True, []

        # 5. Temporary
        m = self._pattern_temp.match(text)
        if m:
            tr, number = m.groups()
            formatted = f"{tr}{int(number):04d}"
            return PlateFormat.TEMPORARY, formatted, True, []

        # If no exact match, try fuzzy correction
        corrected, fmt = self._fuzzy_correct(text)
        if corrected:
            return fmt, corrected, True, ["fuzzy_corrected"]

        errors.append("No valid Indian plate format matched")
        return PlateFormat.STANDARD, text, False, errors

    def _fuzzy_correct(self, text: str) -> tuple[Optional[str], PlateFormat]:
        """
        Attempt fuzzy correction for common OCR errors.

        Common confusions:
        - 0 <-> O, D
        - 1 <-> I, L
        - 2 <-> Z
        - 5 <-> S
        - 8 <-> B
        - 6 <-> G
        """
        # Character confusion map
        confusion = {
            'O': '0', 'D': '0', 'Q': '0',
            'I': '1', 'L': '1',
            'Z': '2',
            'S': '5',
            'B': '8',
            'G': '6',
            'A': '4',  # Sometimes
        }

        # Try digit/letter corrections in specific positions
        if len(text) >= 8:
            # Standard format positions:
            # 0-1: State (letters)
            # 2-3: District (digits)
            # 4-5: Series (letters)
            # 6-9: Number (digits)

            chars = list(text)

            # Fix district (pos 2,3) - should be digits
            for i in [2, 3]:
                if i < len(chars) and chars[i] in confusion:
                    chars[i] = confusion[chars[i]]

            # Fix number (pos 6+) - should be digits
            for i in range(6, min(len(chars), 10)):
                if chars[i] in confusion:
                    chars[i] = confusion[chars[i]]

            # Fix state/series - should be letters
            for i in [0, 1, 4, 5]:
                if i < len(chars) and chars[i].isdigit():
                    # Reverse confusion
                    rev_conf = {v: k for k, v in confusion.items()}
                    if chars[i] in rev_conf:
                        chars[i] = rev_conf[chars[i]]

            corrected = ''.join(chars)
            m = self._pattern_standard.match(corrected)
            if m:
                state, district, series, number = m.groups()
                if state in self.config.state_codes and 1 <= int(district) <= 99:
                    formatted = f"{state}{district}{series}{int(number):04d}"
                    return formatted, PlateFormat.STANDARD

        return None, PlateFormat.STANDARD

    def _detect_plate_type(self, plate_crop: np.ndarray) -> PlateFormat:
        """
        Detect plate type from visual characteristics (color, etc.).

        Simplified: uses color analysis for green (EV) plates.
        """
        if plate_crop.size == 0:
            return PlateFormat.STANDARD

        # Convert to HSV for color analysis
        hsv = cv2.cvtColor(plate_crop, cv2.COLOR_BGR2HSV)

        # Green range for EV plates
        green_lower = np.array([40, 40, 40])
        green_upper = np.array([80, 255, 255])
        green_mask = cv2.inRange(hsv, green_lower, green_upper)
        green_ratio = np.sum(green_mask > 0) / (plate_crop.shape[0] * plate_crop.shape[1])

        if green_ratio > 0.3:
            return PlateFormat.EV_GREEN

        # Could add more detection logic here (yellow for commercial, etc.)

        return PlateFormat.STANDARD

    def detect_plates(self, image: np.ndarray) -> list[PlateDetection]:
        """
        Detect license plates in image.

        Args:
            image: Input image (H, W, 3) BGR.

        Returns:
            List of PlateDetection objects.
        """
        if not self._initialized:
            self.initialize()

        input_tensor, scale = self._preprocess_detector(image)

        # Run detector
        outputs = self._detector.run(None, {self._detector.get_inputs()[0].name: input_tensor})

        # Parse outputs (assuming YOLO-style: [batch, num_boxes, 5+classes])
        detections = []
        preds = outputs[0].squeeze(0)  # (N, 5+classes)

        # Filter by confidence
        conf_mask = preds[:, 4] > self.config.det_conf_threshold
        if not np.any(conf_mask):
            return detections

        preds = preds[conf_mask]

        # NMS
        boxes = preds[:, :4].copy()
        scores = preds[:, 4].copy()

        # Convert to xywh
        boxes[:, 0] = (boxes[:, 0] - boxes[:, 2] / 2) / scale  # x1
        boxes[:, 1] = (boxes[:, 1] - boxes[:, 3] / 2) / scale  # y1
        boxes[:, 2] = (boxes[:, 0] + boxes[:, 2]) / scale       # x2
        boxes[:, 3] = (boxes[:, 1] + boxes[:, 3]) / scale       # y2

        indices = cv2.dnn.NMSBoxes(
            boxes[:, :4].tolist(),
            scores.tolist(),
            self.config.det_conf_threshold,
            self.config.det_nms_threshold,
        )

        if len(indices) > 0:
            indices = indices.flatten()[:self.config.det_max_plates]
            for idx in indices:
                x1, y1, x2, y2 = boxes[idx]
                detections.append(PlateDetection(
                    bbox=(float(x1), float(y1), float(x2), float(y2)),
                    confidence=float(scores[idx]),
                ))

        return detections

    def recognize_plate(self, plate_crop: np.ndarray) -> tuple[str, list[float], float]:
        """
        Recognize characters from plate crop using LPRNet.

        Args:
            plate_crop: Cropped plate image (H, W, 3) BGR.

        Returns:
            Tuple of (raw_text, char_confidences, overall_confidence).
        """
        if not self._initialized:
            self.initialize()

        input_tensor = self._preprocess_recognizer(plate_crop)

        # Run recognizer
        outputs = self._recognizer.run(None, {self._recognizer.get_inputs()[0].name: input_tensor})

        logits = outputs[0]  # (1, T, C)

        # Decode
        raw_text, char_confidences = self._beam_search_decode(logits)

        # Overall confidence
        overall_conf = np.mean(char_confidences) if char_confidences else 0.0

        return raw_text, char_confidences, float(overall_conf)

    def process_frame(
        self,
        image: np.ndarray,
        track_ids: Optional[list[int]] = None,
    ) -> list[PlateRecognitionResult]:
        """
        Process frame: detect plates, recognize characters, validate format.

        Args:
            image: Input frame (H, W, 3) BGR.
            track_ids: Optional track IDs for detections.

        Returns:
            List of PlateRecognitionResult.
        """
        start_time = time.perf_counter()

        if not self._initialized:
            self.initialize()

        timestamp = time.time()
        detections = self.detect_plates(image)

        # Associate track IDs
        if track_ids:
            for i, det in enumerate(detections):
                if i < len(track_ids):
                    detections[i] = PlateDetection(
                        bbox=det.bbox,
                        confidence=det.confidence,
                        plate_type=det.plate_type,
                        track_id=track_ids[i],
                    )

        results = []

        for det in detections:
            # Rectify plate
            plate_crop = self._rectify_plate(image, det.bbox)

            if plate_crop.size == 0:
                continue

            # Detect plate type (color-based)
            plate_type = self._detect_plate_type(plate_crop)

            # Recognize
            raw_text, char_confs, overall_conf = self.recognize_plate(plate_crop)

            if overall_conf < self.config.min_plate_confidence:
                continue

            # Validate format
            fmt, formatted, is_valid, errors = self._validate_indian_plate(raw_text)

            # Override format if detected visually
            if plate_type == PlateFormat.EV_GREEN and fmt != PlateFormat.EV_GREEN:
                fmt = PlateFormat.EV_GREEN

            result = PlateRecognitionResult(
                detection=det,
                raw_text=raw_text,
                formatted_text=formatted,
                confidence=overall_conf,
                char_confidences=char_confs,
                format_type=fmt,
                is_valid=is_valid,
                validation_errors=errors,
                timestamp=timestamp,
                processing_time_ms=(time.perf_counter() - start_time) * 1000,
            )

            results.append(result)

            if is_valid:
                logger.info(
                    "PLATE RECOGNIZED: %s (%s) conf=%.3f track_id=%s",
                    formatted, fmt.value, overall_conf, det.track_id
                )
            else:
                logger.debug(
                    "Plate rejected: %s -> %s (errors: %s)",
                    raw_text, formatted, errors
                )

        return results

    def process_frame_batch(
        self,
        images: list[np.ndarray],
        track_ids_list: Optional[list[list[int]]] = None,
    ) -> list[list[PlateRecognitionResult]]:
        """Process multiple frames."""
        return [self.process_frame(img, tids) for img, tids in zip(images, track_ids_list or [None]*len(images))]

    def __enter__(self) -> "LPRNetOCR":
        self.initialize()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        pass


class VehiclePlateTracker:
    """
    Tracks recognized plates across frames for a vehicle track.

    Maintains best recognition per track ID.
    """

    def __init__(self, max_age: float = 30.0) -> None:
        self.tracks: dict[int, VehiclePlateRecord] = {}
        self.max_age = max_age

    def update(self, results: list[PlateRecognitionResult], current_time: Optional[float] = None) -> None:
        """Update tracker with new recognition results."""
        if current_time is None:
            current_time = time.time()

        for result in results:
            if result.detection.track_id is None:
                continue

            tid = result.detection.track_id

            if tid not in self.tracks:
                self.tracks[tid] = VehiclePlateRecord(
                    track_id=tid,
                    plate_text=result.formatted_text,
                    format_type=result.format_type,
                    confidence=result.confidence,
                    first_seen=current_time,
                    last_seen=current_time,
                    best_result=result if result.is_valid else None,
                )
            else:
                self.tracks[tid].update(result)

        # Cleanup old tracks
        self._cleanup(current_time)

    def _cleanup(self, current_time: float) -> None:
        """Remove stale tracks."""
        stale = [
            tid for tid, record in self.tracks.items()
            if current_time - record.last_seen > self.max_age
        ]
        for tid in stale:
            del self.tracks[tid]

    def get_plate(self, track_id: int) -> Optional[VehiclePlateRecord]:
        """Get plate record for track."""
        return self.tracks.get(track_id)

    def get_all_plates(self) -> dict[int, VehiclePlateRecord]:
        """Get all tracked plates."""
        return self.tracks.copy()


def create_lprnet_ocr(
    detector_path: str = "models/lpr_detector.onnx",
    recognizer_path: str = "models/lprnet.onnx",
    min_confidence: float = 0.6,
    providers: Optional[list[str]] = None,
) -> LPRNetOCR:
    """
    Factory function to create LPRNetOCR with custom config.

    Args:
        detector_path: Path to plate detector ONNX model.
        recognizer_path: Path to LPRNet recognizer ONNX model.
        min_confidence: Minimum plate confidence threshold.
        providers: ONNX Runtime execution providers.

    Returns:
        Configured LPRNetOCR instance.
    """
    config = LPRConfig(
        detector_model_path=detector_path,
        recognizer_model_path=recognizer_path,
        min_plate_confidence=min_confidence,
        providers=providers or ["CPUExecutionProvider"],
    )
    return LPRNetOCR(config)


# Utility: Create plate crop from detection for visualization
def draw_plate_detection(
    image: np.ndarray,
    result: PlateRecognitionResult,
    color: tuple[int, int, int] = (0, 255, 0),
    thickness: int = 2,
) -> np.ndarray:
    """Draw plate detection and recognition on image."""
    vis = image.copy()
    x1, y1, x2, y2 = map(int, result.detection.bbox)

    # Draw bbox
    cv2.rectangle(vis, (x1, y1), (x2, y2), color, thickness)

    # Draw text
    label = f"{result.formatted_text} ({result.confidence:.2f})"
    (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.6, 2)
    cv2.rectangle(vis, (x1, y1 - th - 10), (x1 + tw, y1), color, -1)
    cv2.putText(vis, label, (x1, y1 - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 0), 2)

    return vis


if __name__ == "__main__":
    # Demo / self-test
    logging.basicConfig(level=logging.INFO)

    print("LPRNetOCR module loaded successfully")
    print("Requires ONNX models at:")
    print("  - models/lpr_detector.onnx (plate detector)")
    print("  - models/lprnet.onnx (LPRNet recognizer)")
    print("\nSupported Indian plate formats:")
    print("  - Standard: MH12AB1234, DL01A1234, KA03AB1234")
    print("  - Bharat Series: 22BH1234AB, 23BH5678CD")
    print("  - Diplomatic: 12CD1234, 56CC7890")
    print("  - Military: ↑12345AB")
    print("  - Temporary: TR1234")
    print("  - EV Green: Same format, green background")
    print("\nUsage:")
    print("  ocr = create_lprnet_ocr()")
    print("  ocr.initialize()")
    print("  results = ocr.process_frame(frame)")
    print("  for r in results:")
    print("      if r.is_valid: print(f'PLATE: {r.formatted_text}')")
    print("      print(f'  State: {r.state_code}, District: {r.district_code}')")