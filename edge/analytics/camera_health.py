"""
Camera Health Monitor — Automated Tampering, Occlusion & Geo-Drift Detection

Analyzes RTSP stream frames for:
- Sudden lens covering/blindness (CAMERA_BLINDED)
- Drastic frame orientation shift/redirection (CAMERA_TAMPERED)
- Video freeze/loss (CAMERA_FROZEN)
- Optical blur/defocus (CAMERA_BLURRED)
- IR illuminator failure (IR_FAILURE)
- Bitrate/frame drop anomalies (STREAM_DEGRADED)

Generates standardized alert payloads for uplink.
"""

from __future__ import annotations

import logging
import time
from collections import deque
from dataclasses import dataclass, field
from enum import IntEnum
from typing import Any, Optional

import cv2
import numpy as np

logger = logging.getLogger(__name__)


class HealthAlertType(IntEnum):
    """Camera health alert types."""

    NONE = 0
    CAMERA_BLINDED = 1          # Lens covered/blocked
    CAMERA_TAMPERED = 2         # Physical redirection/movement
    CAMERA_FROZEN = 3           # Video freeze/loss
    CAMERA_BLURRED = 4          # Optical blur/defocus
    IR_FAILURE = 5              # IR illuminator failure
    STREAM_DEGRADED = 6         # Bitrate/frame drop anomalies
    GEO_DRIFT = 7               # Camera position/orientation drift


class HealthStatus(IntEnum):
    """Overall camera health status."""

    HEALTHY = 100
    DEGRADED = 75
    WARNING = 50
    CRITICAL = 25
    FAILED = 0


@dataclass(frozen=True, slots=True)
class CameraHealthConfig:
    """Configuration for camera health monitoring."""

    # Analysis window
    history_size: int = 30  # Frames to keep in sliding window
    min_frames_for_analysis: int = 10

    # Blur detection (Laplacian variance)
    blur_threshold: float = 100.0  # Variance below = blurred
    blur_history_weight: float = 0.7

    # Blindness detection (mean intensity + entropy)
    blindness_mean_threshold: float = 10.0  # Very dark
    blindness_entropy_threshold: float = 0.5  # Low entropy = covered
    blindness_history_weight: float = 0.8

    # Freeze detection (frame difference)
    freeze_mse_threshold: float = 1.0  # MSE below = frozen
    freeze_consecutive_frames: int = 5

    # Tampering detection (feature matching / optical flow)
    tamper_feature_threshold: int = 50  # Min good features
    tamper_flow_magnitude_threshold: float = 5.0  # Pixel displacement
    tamper_angle_threshold: float = 10.0  # Degrees rotation
    tamper_scale_threshold: float = 0.15  # Scale change ratio

    # Geo-drift detection (horizon line / vanishing point)
    drift_check_interval: int = 300  # Frames between drift checks
    drift_angle_threshold: float = 2.0  # Degrees
    drift_shift_threshold: float = 0.05  # Fraction of frame

    # IR failure detection (night mode)
    ir_check_interval: int = 60  # Frames
    ir_brightness_threshold: float = 30.0  # Expected IR brightness
    ir_uniformity_threshold: float = 0.3  # Uniformity of illumination

    # Stream quality
    max_frame_interval_ms: float = 200.0  # Max time between frames
    min_bitrate_kbps: float = 500.0  # Minimum expected bitrate

    # Alert cooldown
    alert_cooldown_sec: float = 30.0

    # Health score weights
    weight_blur: float = 0.2
    weight_blindness: float = 0.2
    weight_freeze: float = 0.2
    weight_tamper: float = 0.2
    weight_stream: float = 0.1
    weight_ir: float = 0.1


@dataclass(frozen=True, slots=True)
class FrameMetrics:
    """Per-frame health metrics."""

    timestamp: float
    frame_idx: int

    # Blur metrics
    laplacian_var: float
    tenengrad: float

    # Brightness/entropy
    mean_intensity: float
    std_intensity: float
    entropy: float

    # Motion metrics
    mse_prev: float
    optical_flow_mag: float
    optical_flow_angle: float

    # Feature metrics
    num_features: int
    feature_match_ratio: float

    # Stream metrics
    frame_interval_ms: float
    estimated_bitrate_kbps: float


@dataclass(frozen=True, slots=True)
class HealthAlert:
    """Camera health alert payload."""

    camera_id: str
    alert_type: HealthAlertType
    severity: HealthStatus
    message: str
    timestamp: float
    metrics: dict[str, float]
    details: dict[str, Any]

    def to_uplink_payload(self) -> dict[str, Any]:
        """Convert to standardized uplink JSON payload."""
        return {
            "alert_type": "CAMERA_HEALTH",
            "camera_id": self.camera_id,
            "health_alert": self.alert_type.name,
            "severity": self.severity.name,
            "severity_value": int(self.severity),
            "message": self.message,
            "timestamp": self.timestamp,
            "metrics": self.metrics,
            "details": self.details,
        }


@dataclass(slots=True)
class CameraHealthState:
    """Internal state for a single camera."""

    camera_id: str
    config: CameraHealthConfig

    # Frame history
    frames: deque = field(default_factory=lambda: deque(maxlen=30))
    metrics_history: deque = field(default_factory=lambda: deque(maxlen=30))

    # Previous frame for comparison
    prev_frame: Optional[np.ndarray] = None
    prev_gray: Optional[np.ndarray] = None
    prev_timestamp: float = 0.0
    prev_frame_idx: int = -1

    # Feature tracking for tamper detection
    prev_keypoints: Optional[list] = None
    prev_descriptors: Optional[np.ndarray] = None

    # Drift detection
    reference_frame: Optional[np.ndarray] = None
    reference_keypoints: Optional[list] = None
    reference_descriptors: Optional[np.ndarray] = None
    frames_since_drift_check: int = 0

    # IR monitoring
    frames_since_ir_check: int = 0
    is_night_mode: bool = False

    # Alert tracking
    last_alert_time: dict[HealthAlertType, float] = field(default_factory=dict)
    active_alerts: set[HealthAlertType] = field(default_factory=set)

    # Health scoring
    blur_score: float = 100.0
    blindness_score: float = 100.0
    freeze_score: float = 100.0
    tamper_score: float = 100.0
    stream_score: float = 100.0
    ir_score: float = 100.0
    overall_score: float = 100.0

    # ORB detector for feature matching
    orb: cv2.ORB = field(default_factory=lambda: cv2.ORB_create(nfeatures=500))
    bf_matcher: cv2.BFMatcher = field(default_factory=lambda: cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True))

    def __post_init__(self):
        self.frames = deque(maxlen=self.config.history_size)
        self.metrics_history = deque(maxlen=self.config.history_size)


class CameraHealthMonitor:
    """
    Monitors camera health for tampering, occlusion, freeze, blur, and drift.

    Designed for RTSP stream processing on edge devices (Jetson, Mini-PC).
    Stateless per-frame analysis with sliding window history.
    """

    def __init__(self, config: Optional[CameraHealthConfig] = None) -> None:
        """
        Initialize camera health monitor.

        Args:
            config: CameraHealthConfig with detection thresholds.
        """
        self.config = config or CameraHealthConfig()
        self.cameras: dict[str, CameraHealthState] = {}

        # Feature detector for tamper/drift
        self.orb = cv2.ORB_create(nfeatures=500)
        self.bf_matcher = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)

        logger.info("CameraHealthMonitor initialized")

    def register_camera(self, camera_id: str, config: Optional[CameraHealthConfig] = None) -> CameraHealthState:
        """Register a new camera for monitoring."""
        cam_config = config or self.config
        state = CameraHealthState(camera_id=camera_id, config=cam_config)
        self.cameras[camera_id] = state
        logger.info("Registered camera: %s", camera_id)
        return state

    def unregister_camera(self, camera_id: str) -> bool:
        """Unregister a camera."""
        if camera_id in self.cameras:
            del self.cameras[camera_id]
            logger.info("Unregistered camera: %s", camera_id)
            return True
        return False

    def process_frame(
        self,
        camera_id: str,
        frame: np.ndarray,
        timestamp: Optional[float] = None,
        frame_idx: Optional[int] = None,
    ) -> list[HealthAlert]:
        """
        Process a frame and return any health alerts.

        Args:
            camera_id: Camera identifier.
            frame: Current frame (BGR).
            timestamp: Frame timestamp (defaults to time.time()).
            frame_idx: Frame sequence number.

        Returns:
            List of HealthAlert objects (empty if healthy).
        """
        if camera_id not in self.cameras:
            self.register_camera(camera_id)

        state = self.cameras[camera_id]
        if timestamp is None:
            timestamp = time.time()
        if frame_idx is None:
            frame_idx = state.prev_frame_idx + 1

        alerts = []

        # Convert to grayscale
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

        # Compute metrics
        metrics = self._compute_metrics(frame, gray, state, timestamp, frame_idx)

        # Store metrics
        state.metrics_history.append(metrics)
        state.frames.append(frame.copy())

        # Run health checks
        alerts.extend(self._check_blindness(state, metrics))
        alerts.extend(self._check_blur(state, metrics))
        alerts.extend(self._check_freeze(state, metrics))
        alerts.extend(self._check_tampering(state, metrics))
        alerts.extend(self._check_stream_quality(state, metrics))
        alerts.extend(self._check_ir_failure(state, metrics))

        # Periodic drift check
        state.frames_since_drift_check += 1
        if state.frames_since_drift_check >= state.config.drift_check_interval:
            alerts.extend(self._check_geo_drift(state, gray))
            state.frames_since_drift_check = 0

        # Update overall health score
        self._update_health_score(state)

        # Update state
        state.prev_frame = frame.copy()
        state.prev_gray = gray.copy()
        state.prev_timestamp = timestamp
        state.prev_frame_idx = frame_idx

        # Update feature tracking
        self._update_features(state, gray)

        return alerts

    def _compute_metrics(
        self,
        frame: np.ndarray,
        gray: np.ndarray,
        state: CameraHealthState,
        timestamp: float,
        frame_idx: int,
    ) -> FrameMetrics:
        """Compute per-frame health metrics."""

        # Blur: Laplacian variance
        laplacian = cv2.Laplacian(gray, cv2.CV_64F)
        laplacian_var = float(laplacian.var())

        # Blur: Tenengrad (Sobel gradient magnitude)
        sobelx = cv2.Sobel(gray, cv2.CV_64F, 1, 0, ksize=3)
        sobely = cv2.Sobel(gray, cv2.CV_64F, 0, 1, ksize=3)
        tenengrad = float(np.mean(sobelx**2 + sobely**2))

        # Brightness & entropy
        mean_intensity = float(np.mean(gray))
        std_intensity = float(np.std(gray))

        # Entropy
        hist = cv2.calcHist([gray], [0], None, [256], [0, 256])
        hist = hist / (hist.sum() + 1e-10)
        entropy = float(-np.sum(hist * np.log2(hist + 1e-10)))

        # Frame difference (freeze detection)
        mse_prev = 0.0
        optical_flow_mag = 0.0
        optical_flow_angle = 0.0

        if state.prev_gray is not None and state.prev_gray.shape == gray.shape:
            # MSE
            diff = cv2.absdiff(gray, state.prev_gray)
            mse_prev = float(np.mean(diff**2))

            # Optical flow (sparse)
            if state.prev_keypoints is not None and len(state.prev_keypoints) > 0:
                prev_pts = np.array([kp.pt for kp in state.prev_keypoints], dtype=np.float32).reshape(-1, 1, 2)
                next_pts, status, _ = cv2.calcOpticalFlowPyrLK(
                    state.prev_gray, gray, prev_pts, None,
                    winSize=(15, 15), maxLevel=2,
                    criteria=(cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 10, 0.03)
                )
                if next_pts is not None:
                    good_mask = status.ravel() == 1
                    if np.any(good_mask):
                        displacements = next_pts[good_mask] - prev_pts[good_mask]
                        mags = np.linalg.norm(displacements, axis=2).ravel()
                        optical_flow_mag = float(np.median(mags))
                        angles = np.arctan2(displacements[:, :, 1], displacements[:, :, 0])
                        optical_flow_angle = float(np.median(np.abs(angles)) * 180 / np.pi)

        # Feature detection
        keypoints = self.orb.detect(gray, None)
        num_features = len(keypoints)

        # Feature match ratio (for tamper detection)
        feature_match_ratio = 0.0
        if state.prev_descriptors is not None and len(keypoints) > 0:
            _, descriptors = self.orb.compute(gray, keypoints)
            if descriptors is not None and len(descriptors) > 0:
                matches = self.bf_matcher.match(state.prev_descriptors, descriptors)
                good_matches = [m for m in matches if m.distance < 50]
                feature_match_ratio = len(good_matches) / max(len(descriptors), 1)

        # Stream metrics
        frame_interval_ms = 0.0
        if state.prev_timestamp > 0:
            frame_interval_ms = (timestamp - state.prev_timestamp) * 1000

        # Estimated bitrate (rough approximation)
        estimated_bitrate_kbps = 0.0
        if frame_interval_ms > 0:
            frame_size_kb = frame.nbytes / 1024
            estimated_bitrate_kbps = (frame_size_kb * 8) / (frame_interval_ms / 1000)

        return FrameMetrics(
            timestamp=timestamp,
            frame_idx=frame_idx,
            laplacian_var=laplacian_var,
            tenengrad=tenengrad,
            mean_intensity=mean_intensity,
            std_intensity=std_intensity,
            entropy=entropy,
            mse_prev=mse_prev,
            optical_flow_mag=optical_flow_mag,
            optical_flow_angle=optical_flow_angle,
            num_features=num_features,
            feature_match_ratio=feature_match_ratio,
            frame_interval_ms=frame_interval_ms,
            estimated_bitrate_kbps=estimated_bitrate_kbps,
        )

    def _check_blindness(self, state: CameraHealthState, metrics: FrameMetrics) -> list[HealthAlert]:
        """Check for lens covering/blindness."""
        alerts = []

        is_blind = (
            metrics.mean_intensity < state.config.blindness_mean_threshold
            and metrics.entropy < state.config.blindness_entropy_threshold
        )

        # Exponential moving average for score
        if is_blind:
            state.blindness_score = max(0, state.blindness_score - 20)
        else:
            state.blindness_score = min(100, state.blindness_score + 5)

        # Trigger alert
        if state.blindness_score <= 50 and HealthAlertType.CAMERA_BLINDED not in state.active_alerts:
            if self._can_alert(state, HealthAlertType.CAMERA_BLINDED):
                alerts.append(HealthAlert(
                    camera_id=state.camera_id,
                    alert_type=HealthAlertType.CAMERA_BLINDED,
                    severity=HealthStatus.CRITICAL if state.blindness_score < 25 else HealthStatus.WARNING,
                    message=f"Camera lens appears covered (mean={metrics.mean_intensity:.1f}, entropy={metrics.entropy:.2f})",
                    timestamp=metrics.timestamp,
                    metrics={
                        "mean_intensity": metrics.mean_intensity,
                        "entropy": metrics.entropy,
                        "blindness_score": state.blindness_score,
                    },
                    details={
                        "threshold_mean": state.config.blindness_mean_threshold,
                        "threshold_entropy": state.config.blindness_entropy_threshold,
                    },
                ))
                state.active_alerts.add(HealthAlertType.CAMERA_BLINDED)
                state.last_alert_time[HealthAlertType.CAMERA_BLINDED] = metrics.timestamp

        # Clear alert if recovered
        elif state.blindness_score > 75 and HealthAlertType.CAMERA_BLINDED in state.active_alerts:
            state.active_alerts.discard(HealthAlertType.CAMERA_BLINDED)
            alerts.append(HealthAlert(
                camera_id=state.camera_id,
                alert_type=HealthAlertType.CAMERA_BLINDED,
                severity=HealthStatus.HEALTHY,
                message="Camera lens cover cleared",
                timestamp=metrics.timestamp,
                metrics={"blindness_score": state.blindness_score},
                details={"recovery": True},
            ))

        return alerts

    def _check_blur(self, state: CameraHealthState, metrics: FrameMetrics) -> list[HealthAlert]:
        """Check for optical blur/defocus."""
        alerts = []

        is_blurred = metrics.laplacian_var < state.config.blur_threshold

        # EMA for score
        if is_blurred:
            state.blur_score = max(0, state.blur_score - 15)
        else:
            state.blur_score = min(100, state.blur_score + 3)

        if state.blur_score <= 50 and HealthAlertType.CAMERA_BLURRED not in state.active_alerts:
            if self._can_alert(state, HealthAlertType.CAMERA_BLURRED):
                alerts.append(HealthAlert(
                    camera_id=state.camera_id,
                    alert_type=HealthAlertType.CAMERA_BLURRED,
                    severity=HealthStatus.WARNING,
                    message=f"Camera image blurred (laplacian_var={metrics.laplacian_var:.1f})",
                    timestamp=metrics.timestamp,
                    metrics={
                        "laplacian_var": metrics.laplacian_var,
                        "tenengrad": metrics.tenengrad,
                        "blur_score": state.blur_score,
                    },
                    details={"threshold": state.config.blur_threshold},
                ))
                state.active_alerts.add(HealthAlertType.CAMERA_BLURRED)
                state.last_alert_time[HealthAlertType.CAMERA_BLURRED] = metrics.timestamp

        elif state.blur_score > 75 and HealthAlertType.CAMERA_BLURRED in state.active_alerts:
            state.active_alerts.discard(HealthAlertType.CAMERA_BLURRED)
            alerts.append(HealthAlert(
                camera_id=state.camera_id,
                alert_type=HealthAlertType.CAMERA_BLURRED,
                severity=HealthStatus.HEALTHY,
                message="Camera focus restored",
                timestamp=metrics.timestamp,
                metrics={"blur_score": state.blur_score},
                details={"recovery": True},
            ))

        return alerts

    def _check_freeze(self, state: CameraHealthState, metrics: FrameMetrics) -> list[HealthAlert]:
        """Check for video freeze/loss."""
        alerts = []

        is_frozen = metrics.mse_prev < state.config.freeze_mse_threshold

        # Track consecutive frozen frames
        if not hasattr(state, '_freeze_count'):
            state._freeze_count = 0

        if is_frozen:
            state._freeze_count += 1
        else:
            state._freeze_count = 0

        state.freeze_score = max(0, 100 - state._freeze_count * 20)

        if state._freeze_count >= state.config.freeze_consecutive_frames:
            if HealthAlertType.CAMERA_FROZEN not in state.active_alerts:
                if self._can_alert(state, HealthAlertType.CAMERA_FROZEN):
                    alerts.append(HealthAlert(
                        camera_id=state.camera_id,
                        alert_type=HealthAlertType.CAMERA_FROZEN,
                        severity=HealthStatus.CRITICAL,
                        message=f"Video stream frozen for {state._freeze_count} frames (MSE={metrics.mse_prev:.2f})",
                        timestamp=metrics.timestamp,
                        metrics={
                            "mse_prev": metrics.mse_prev,
                            "freeze_count": state._freeze_count,
                            "freeze_score": state.freeze_score,
                        },
                        details={"threshold": state.config.freeze_mse_threshold},
                    ))
                    state.active_alerts.add(HealthAlertType.CAMERA_FROZEN)
                    state.last_alert_time[HealthAlertType.CAMERA_FROZEN] = metrics.timestamp
        else:
            if HealthAlertType.CAMERA_FROZEN in state.active_alerts:
                state.active_alerts.discard(HealthAlertType.CAMERA_FROZEN)
                alerts.append(HealthAlert(
                    camera_id=state.camera_id,
                    alert_type=HealthAlertType.CAMERA_FROZEN,
                    severity=HealthStatus.HEALTHY,
                    message="Video stream recovered",
                    timestamp=metrics.timestamp,
                    metrics={"freeze_score": state.freeze_score},
                    details={"recovery": True},
                ))

        return alerts

    def _check_tampering(self, state: CameraHealthState, metrics: FrameMetrics) -> list[HealthAlert]:
        """Check for camera tampering (physical redirection)."""
        alerts = []

        # Check feature match ratio drop
        tamper_detected = (
            metrics.num_features >= state.config.tamper_feature_threshold
            and metrics.feature_match_ratio < 0.3  # Significant feature mismatch
        )

        # Check optical flow for large displacement
        if metrics.optical_flow_mag > state.config.tamper_flow_magnitude_threshold:
            tamper_detected = True

        # Check rotation
        if metrics.optical_flow_angle > state.config.tamper_angle_threshold:
            tamper_detected = True

        if tamper_detected:
            state.tamper_score = max(0, state.tamper_score - 25)
        else:
            state.tamper_score = min(100, state.tamper_score + 5)

        if state.tamper_score <= 50 and HealthAlertType.CAMERA_TAMPERED not in state.active_alerts:
            if self._can_alert(state, HealthAlertType.CAMERA_TAMPERED):
                alerts.append(HealthAlert(
                    camera_id=state.camera_id,
                    alert_type=HealthAlertType.CAMERA_TAMPERED,
                    severity=HealthStatus.CRITICAL,
                    message=(
                        f"Camera tampering detected: "
                        f"flow_mag={metrics.optical_flow_mag:.1f}px, "
                        f"angle={metrics.optical_flow_angle:.1f}°, "
                        f"match_ratio={metrics.feature_match_ratio:.2f}"
                    ),
                    timestamp=metrics.timestamp,
                    metrics={
                        "optical_flow_mag": metrics.optical_flow_mag,
                        "optical_flow_angle": metrics.optical_flow_angle,
                        "feature_match_ratio": metrics.feature_match_ratio,
                        "num_features": metrics.num_features,
                        "tamper_score": state.tamper_score,
                    },
                    details={
                        "flow_threshold": state.config.tamper_flow_magnitude_threshold,
                        "angle_threshold": state.config.tamper_angle_threshold,
                    },
                ))
                state.active_alerts.add(HealthAlertType.CAMERA_TAMPERED)
                state.last_alert_time[HealthAlertType.CAMERA_TAMPERED] = metrics.timestamp

        elif state.tamper_score > 75 and HealthAlertType.CAMERA_TAMPERED in state.active_alerts:
            state.active_alerts.discard(HealthAlertType.CAMERA_TAMPERED)
            alerts.append(HealthAlert(
                camera_id=state.camera_id,
                alert_type=HealthAlertType.CAMERA_TAMPERED,
                severity=HealthStatus.HEALTHY,
                message="Camera position stabilized",
                timestamp=metrics.timestamp,
                metrics={"tamper_score": state.tamper_score},
                details={"recovery": True},
            ))

        return alerts

    def _check_stream_quality(self, state: CameraHealthState, metrics: FrameMetrics) -> list[HealthAlert]:
        """Check for stream degradation (frame drops, low bitrate)."""
        alerts = []

        stream_issues = 0

        # Frame interval check
        if metrics.frame_interval_ms > state.config.max_frame_interval_ms:
            stream_issues += 1

        # Bitrate check
        if metrics.estimated_bitrate_kbps > 0 and metrics.estimated_bitrate_kbps < state.config.min_bitrate_kbps:
            stream_issues += 1

        if stream_issues > 0:
            state.stream_score = max(0, state.stream_score - 10 * stream_issues)
        else:
            state.stream_score = min(100, state.stream_score + 2)

        if state.stream_score <= 50 and HealthAlertType.STREAM_DEGRADED not in state.active_alerts:
            if self._can_alert(state, HealthAlertType.STREAM_DEGRADED):
                alerts.append(HealthAlert(
                    camera_id=state.camera_id,
                    alert_type=HealthAlertType.STREAM_DEGRADED,
                    severity=HealthStatus.WARNING,
                    message=(
                        f"Stream quality degraded: "
                        f"interval={metrics.frame_interval_ms:.0f}ms, "
                        f"bitrate={metrics.estimated_bitrate_kbps:.0f}kbps"
                    ),
                    timestamp=metrics.timestamp,
                    metrics={
                        "frame_interval_ms": metrics.frame_interval_ms,
                        "estimated_bitrate_kbps": metrics.estimated_bitrate_kbps,
                        "stream_score": state.stream_score,
                    },
                    details={
                        "max_interval_ms": state.config.max_frame_interval_ms,
                        "min_bitrate_kbps": state.config.min_bitrate_kbps,
                    },
                ))
                state.active_alerts.add(HealthAlertType.STREAM_DEGRADED)
                state.last_alert_time[HealthAlertType.STREAM_DEGRADED] = metrics.timestamp

        elif state.stream_score > 75 and HealthAlertType.STREAM_DEGRADED in state.active_alerts:
            state.active_alerts.discard(HealthAlertType.STREAM_DEGRADED)
            alerts.append(HealthAlert(
                camera_id=state.camera_id,
                alert_type=HealthAlertType.STREAM_DEGRADED,
                severity=HealthStatus.HEALTHY,
                message="Stream quality restored",
                timestamp=metrics.timestamp,
                metrics={"stream_score": state.stream_score},
                details={"recovery": True},
            ))

        return alerts

    def _check_ir_failure(self, state: CameraHealthState, metrics: FrameMetrics) -> list[HealthAlert]:
        """Check for IR illuminator failure (night mode)."""
        alerts = []

        state.frames_since_ir_check += 1

        # Detect night mode (low overall brightness)
        is_night = metrics.mean_intensity < 50
        state.is_night_mode = is_night

        if is_night and state.frames_since_ir_check >= state.config.ir_check_interval:
            state.frames_since_ir_check = 0

            # In night mode with IR, expect some illumination uniformity
            # Check if image is too dark or too uniform (IR off)
            ir_failed = (
                metrics.mean_intensity < state.config.ir_brightness_threshold
                or metrics.std_intensity / max(metrics.mean_intensity, 1) < state.config.ir_uniformity_threshold
            )

            if ir_failed:
                state.ir_score = max(0, state.ir_score - 30)
            else:
                state.ir_score = min(100, state.ir_score + 10)

            if state.ir_score <= 50 and HealthAlertType.IR_FAILURE not in state.active_alerts:
                if self._can_alert(state, HealthAlertType.IR_FAILURE):
                    alerts.append(HealthAlert(
                        camera_id=state.camera_id,
                        alert_type=HealthAlertType.IR_FAILURE,
                        severity=HealthStatus.WARNING,
                        message=f"IR illuminator failure suspected (mean={metrics.mean_intensity:.1f}, uniformity={metrics.std_intensity/max(metrics.mean_intensity,1):.2f})",
                        timestamp=metrics.timestamp,
                        metrics={
                            "mean_intensity": metrics.mean_intensity,
                            "std_intensity": metrics.std_intensity,
                            "ir_score": state.ir_score,
                        },
                        details={
                            "brightness_threshold": state.config.ir_brightness_threshold,
                            "uniformity_threshold": state.config.ir_uniformity_threshold,
                        },
                    ))
                    state.active_alerts.add(HealthAlertType.IR_FAILURE)
                    state.last_alert_time[HealthAlertType.IR_FAILURE] = metrics.timestamp

            elif state.ir_score > 75 and HealthAlertType.IR_FAILURE in state.active_alerts:
                state.active_alerts.discard(HealthAlertType.IR_FAILURE)
                alerts.append(HealthAlert(
                    camera_id=state.camera_id,
                    alert_type=HealthAlertType.IR_FAILURE,
                    severity=HealthStatus.HEALTHY,
                    message="IR illuminator functioning",
                    timestamp=metrics.timestamp,
                    metrics={"ir_score": state.ir_score},
                    details={"recovery": True},
                ))

        return alerts

    def _check_geo_drift(self, state: CameraHealthState, gray: np.ndarray) -> list[HealthAlert]:
        """Check for camera geo-drift (position/orientation change)."""
        alerts = []

        # Initialize reference on first check
        if state.reference_frame is None:
            state.reference_frame = gray.copy()
            kp, desc = self.orb.detectAndCompute(gray, None)
            state.reference_keypoints = kp
            state.reference_descriptors = desc
            return alerts

        # Match current frame to reference
        kp, desc = self.orb.detectAndCompute(gray, None)
        if desc is None or state.reference_descriptors is None or len(desc) < 10:
            return alerts

        matches = self.bf_matcher.match(state.reference_descriptors, desc)
        good_matches = [m for m in matches if m.distance < 50]

        if len(good_matches) < 20:
            # Significant drift - not enough matches
            drift_detected = True
            angle = 0
            shift = 0
        else:
            # Estimate homography
            src_pts = np.float32([state.reference_keypoints[m.queryIdx].pt for m in good_matches]).reshape(-1, 1, 2)
            dst_pts = np.float32([kp[m.trainIdx].pt for m in good_matches]).reshape(-1, 1, 2)

            H, mask = cv2.findHomography(src_pts, dst_pts, cv2.RANSAC, 5.0)
            if H is not None:
                # Extract rotation and translation from homography
                # Simplified: check scale and rotation
                scale = np.sqrt(H[0, 0]**2 + H[0, 1]**2)
                angle = np.arctan2(H[1, 0], H[0, 0]) * 180 / np.pi
                tx, ty = H[0, 2], H[1, 2]
                shift = np.sqrt(tx**2 + ty**2) / max(gray.shape[0], gray.shape[1])

                drift_detected = (
                    abs(angle) > state.config.drift_angle_threshold
                    or shift > state.config.drift_shift_threshold
                    or abs(scale - 1.0) > state.config.drift_scale_threshold
                )
            else:
                drift_detected = True
                angle = 0
                shift = 0

        if drift_detected:
            if HealthAlertType.GEO_DRIFT not in state.active_alerts:
                if self._can_alert(state, HealthAlertType.GEO_DRIFT):
                    alerts.append(HealthAlert(
                        camera_id=state.camera_id,
                        alert_type=HealthAlertType.GEO_DRIFT,
                        severity=HealthStatus.WARNING,
                        message=f"Camera geo-drift detected: rotation={angle:.1f}°, shift={shift:.3f}",
                        timestamp=time.time(),
                        metrics={
                            "rotation_deg": angle,
                            "shift_ratio": shift,
                            "matches": len(good_matches),
                        },
                        details={
                            "angle_threshold": state.config.drift_angle_threshold,
                            "shift_threshold": state.config.drift_shift_threshold,
                        },
                    ))
                    state.active_alerts.add(HealthAlertType.GEO_DRIFT)
                    state.last_alert_time[HealthAlertType.GEO_DRIFT] = time.time()

                    # Update reference to new position
                    state.reference_frame = gray.copy()
                    state.reference_keypoints = kp
                    state.reference_descriptors = desc

        return alerts

    def _update_features(self, state: CameraHealthState, gray: np.ndarray) -> None:
        """Update feature tracking state."""
        keypoints, descriptors = self.orb.detectAndCompute(gray, None)
        state.prev_keypoints = keypoints
        state.prev_descriptors = descriptors

    def _update_health_score(self, state: CameraHealthState) -> None:
        """Compute overall health score."""
        w = state.config
        state.overall_score = (
            w.weight_blur * state.blur_score +
            w.weight_blindness * state.blindness_score +
            w.weight_freeze * state.freeze_score +
            w.weight_tamper * state.tamper_score +
            w.weight_stream * state.stream_score +
            w.weight_ir * state.ir_score
        )

    def _can_alert(self, state: CameraHealthState, alert_type: HealthAlertType) -> bool:
        """Check if alert can be fired (cooldown)."""
        last_time = state.last_alert_time.get(alert_type, 0)
        return (time.time() - last_time) >= state.config.alert_cooldown_sec

    def get_health_summary(self, camera_id: str) -> Optional[dict[str, Any]]:
        """Get current health summary for a camera."""
        if camera_id not in self.cameras:
            return None

        state = self.cameras[camera_id]
        return {
            "camera_id": camera_id,
            "overall_score": state.overall_score,
            "status": HealthStatus(max(0, min(100, int(state.overall_score)))).name,
            "subscores": {
                "blur": state.blur_score,
                "blindness": state.blindness_score,
                "freeze": state.freeze_score,
                "tamper": state.tamper_score,
                "stream": state.stream_score,
                "ir": state.ir_score,
            },
            "active_alerts": [a.name for a in state.active_alerts],
            "last_frame_time": state.prev_timestamp,
            "frames_processed": state.prev_frame_idx,
        }

    def get_all_health_summaries(self) -> dict[str, dict[str, Any]]:
        """Get health summaries for all cameras."""
        return {cid: self.get_health_summary(cid) for cid in self.cameras}

    def reset_camera(self, camera_id: str) -> bool:
        """Reset camera state (e.g., after maintenance)."""
        if camera_id in self.cameras:
            state = self.cameras[camera_id]
            state.blur_score = 100.0
            state.blindness_score = 100.0
            state.freeze_score = 100.0
            state.tamper_score = 100.0
            state.stream_score = 100.0
            state.ir_score = 100.0
            state.overall_score = 100.0
            state.active_alerts.clear()
            state.last_alert_time.clear()
            state.reference_frame = None
            state.reference_keypoints = None
            state.reference_descriptors = None
            state.frames_since_drift_check = 0
            state.frames_since_ir_check = 0
            state.prev_frame = None
            state.prev_gray = None
            state.prev_keypoints = None
            state.prev_descriptors = None
            state.prev_timestamp = 0
            state.prev_frame_idx = -1
            state._freeze_count = 0
            logger.info("Reset camera health state: %s", camera_id)
            return True
        return False


def create_camera_health_monitor(
    blur_threshold: float = 100.0,
    blindness_mean_threshold: float = 10.0,
    freeze_mse_threshold: float = 1.0,
    tamper_flow_threshold: float = 5.0,
    alert_cooldown: float = 30.0,
) -> CameraHealthMonitor:
    """Factory function to create CameraHealthMonitor with custom config."""
    config = CameraHealthConfig(
        blur_threshold=blur_threshold,
        blindness_mean_threshold=blindness_mean_threshold,
        freeze_mse_threshold=freeze_mse_threshold,
        tamper_flow_magnitude_threshold=tamper_flow_threshold,
        alert_cooldown_sec=alert_cooldown,
    )
    return CameraHealthMonitor(config)


if __name__ == "__main__":
    # Demo / self-test
    logging.basicConfig(level=logging.INFO)

    monitor = create_camera_health_monitor()
    monitor.register_camera("cam_01")

    # Simulate healthy frames
    print("Testing healthy frames...")
    for i in range(10):
        frame = np.random.randint(50, 200, (480, 640, 3), dtype=np.uint8)
        # Add some texture
        cv2.putText(frame, f"Frame {i}", (50, 50), cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 255, 255), 2)
        alerts = monitor.process_frame("cam_01", frame, timestamp=time.time() + i * 0.033, frame_idx=i)
        if alerts:
            for a in alerts:
                print(f"  Alert: {a.alert_type.name} - {a.message}")

    print("\nTesting blur...")
    for i in range(5):
        frame = np.ones((480, 640, 3), dtype=np.uint8) * 128  # Uniform gray = blurred
        alerts = monitor.process_frame("cam_01", frame, timestamp=time.time() + (10+i) * 0.033, frame_idx=10+i)
        if alerts:
            for a in alerts:
                print(f"  Alert: {a.alert_type.name} - {a.message}")

    print("\nTesting blindness...")
    for i in range(5):
        frame = np.zeros((480, 640, 3), dtype=np.uint8)  # Black = covered
        alerts = monitor.process_frame("cam_01", frame, timestamp=time.time() + (15+i) * 0.033, frame_idx=15+i)
        if alerts:
            for a in alerts:
                print(f"  Alert: {a.alert_type.name} - {a.message}")

    print("\nHealth summary:", monitor.get_health_summary("cam_01"))