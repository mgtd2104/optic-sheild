"""
Kalman Filter Trajectory Predictor for PTZ Camera Slew-to-Cue Automation

Provides 5-10 second predictive target trajectory estimation using OpenCV Kalman filter.
Integrates with ByteTrack track IDs for persistent object tracking.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Any, Optional

import cv2
import numpy as np

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class KalmanConfig:
    """Configuration for Kalman filter parameters."""

    # State: [x, y, vx, vy, ax, ay] - position, velocity, acceleration
    # Measurement: [x, y] - center point from detection
    dt: float = 1.0 / 30.0  # Time step (assuming 30 FPS)
    process_noise_pos: float = 1e-2  # Process noise for position
    process_noise_vel: float = 1e-1  # Process noise for velocity
    process_noise_acc: float = 1.0  # Process noise for acceleration
    measurement_noise: float = 1e-1  # Measurement noise (detection uncertainty)
    initial_covariance: float = 1.0  # Initial state covariance

    # Prediction horizons (seconds)
    horizon_5s: float = 5.0
    horizon_10s: float = 10.0

    # Maximum track history length (frames)
    max_history: int = 30

    # Minimum detections before prediction is reliable
    min_detections: int = 5

    # PTZ camera parameters
    ptz_fov_horizontal: float = 60.0  # Horizontal FOV in degrees
    ptz_fov_vertical: float = 35.0  # Vertical FOV in degrees
    image_width: int = 1920
    image_height: int = 1080

    # Maximum pan/tilt rates (degrees/second)
    max_pan_rate: float = 60.0
    max_tilt_rate: float = 30.0


@dataclass(frozen=True, slots=True)
class TrackState:
    """Current state of a tracked object."""

    track_id: int
    bbox: tuple[float, float, float, float]  # x, y, w, h (top-left, width, height)
    center: tuple[float, float]  # cx, cy
    timestamp: float
    confidence: float
    class_id: int
    class_name: str


@dataclass(frozen=True, slots=True)
class PredictionResult:
    """Kalman filter prediction output."""

    track_id: int
    current_state: TrackState

    # Predicted positions at horizons
    pred_5s: tuple[float, float]  # (cx, cy)
    pred_10s: tuple[float, float]  # (cx, cy)

    # Predicted velocities at horizons
    vel_5s: tuple[float, float]  # (vx, vy)
    vel_10s: tuple[float, float]  # (vx, vy)

    # Uncertainty (covariance trace)
    uncertainty_5s: float
    uncertainty_10s: float

    # PTZ offset vectors (degrees)
    pan_offset_5s: float
    tilt_offset_5s: float
    zoom_factor_5s: float
    pan_offset_10s: float
    tilt_offset_10s: float
    zoom_factor_10s: float

    # Quality metrics
    is_reliable: bool
    num_detections: int
    time_since_update: float
    prediction_timestamp: float


@dataclass(slots=True)
class KalmanTrack:
    """Internal Kalman filter state for a single track."""

    track_id: int
    kf: cv2.KalmanFilter
    config: KalmanConfig
    history: list[TrackState] = field(default_factory=list)
    last_update_time: float = 0.0
    detection_count: int = 0
    is_initialized: bool = False

    def __post_init__(self) -> None:
        # Initialize Kalman filter: 6 state vars, 2 measurement vars
        self.kf = cv2.KalmanFilter(6, 2, 0)

        dt = self.config.dt

        # State transition matrix (constant acceleration model)
        # [x, y, vx, vy, ax, ay]
        self.kf.transitionMatrix = np.array([
            [1, 0, dt, 0, 0.5*dt*dt, 0],
            [0, 1, 0, dt, 0, 0.5*dt*dt],
            [0, 0, 1, 0, dt, 0],
            [0, 0, 0, 1, 0, dt],
            [0, 0, 0, 0, 1, 0],
            [0, 0, 0, 0, 0, 1],
        ], dtype=np.float32)

        # Measurement matrix (we measure position only)
        self.kf.measurementMatrix = np.array([
            [1, 0, 0, 0, 0, 0],
            [0, 1, 0, 0, 0, 0],
        ], dtype=np.float32)

        # Process noise covariance
        q_pos = self.config.process_noise_pos
        q_vel = self.config.process_noise_vel
        q_acc = self.config.process_noise_acc
        self.kf.processNoiseCov = np.diag([
            q_pos, q_pos, q_vel, q_vel, q_acc, q_acc
        ]).astype(np.float32)

        # Measurement noise covariance
        r = self.config.measurement_noise
        self.kf.measurementNoiseCov = np.diag([r, r]).astype(np.float32)

        # Initial state covariance
        p = self.config.initial_covariance
        self.kf.errorCovPost = np.eye(6, dtype=np.float32) * p

        # Initial state
        self.kf.statePost = np.zeros((6, 1), dtype=np.float32)

    def update(self, state: TrackState) -> None:
        """Update filter with new measurement."""
        measurement = np.array([[state.center[0]], [state.center[1]]], dtype=np.float32)

        if not self.is_initialized:
            # Initialize with first measurement
            self.kf.statePost[0, 0] = state.center[0]
            self.kf.statePost[1, 0] = state.center[1]
            self.kf.statePost[2, 0] = 0.0  # vx
            self.kf.statePost[3, 0] = 0.0  # vy
            self.kf.statePost[4, 0] = 0.0  # ax
            self.kf.statePost[5, 0] = 0.0  # ay
            self.is_initialized = True
        else:
            # Correct with measurement
            self.kf.correct(measurement)

        self.history.append(state)
        if len(self.history) > self.config.max_history:
            self.history.pop(0)

        self.last_update_time = state.timestamp
        self.detection_count += 1

    def predict(self, dt: float) -> tuple[np.ndarray, np.ndarray]:
        """
        Predict state at given time delta.

        Returns:
            Tuple of (predicted_state, predicted_covariance)
        """
        # Create a copy of the filter for prediction
        kf_pred = cv2.KalmanFilter(6, 2, 0)
        kf_pred.transitionMatrix = self.kf.transitionMatrix.copy()
        kf_pred.measurementMatrix = self.kf.measurementMatrix.copy()
        kf_pred.processNoiseCov = self.kf.processNoiseCov.copy()
        kf_pred.measurementNoiseCov = self.kf.measurementNoiseCov.copy()
        kf_pred.errorCovPost = self.kf.errorCovPost.copy()
        kf_pred.statePost = self.kf.statePost.copy()

        # Predict forward by dt seconds (multiple steps)
        steps = int(dt / self.config.dt)
        for _ in range(steps):
            kf_pred.predict()

        return kf_pred.statePost.copy(), kf_pred.errorCovPost.copy()

    def get_current_estimate(self) -> tuple[tuple[float, float], tuple[float, float]]:
        """Get current position and velocity estimates."""
        state = self.kf.statePost.flatten()
        pos = (float(state[0]), float(state[1]))
        vel = (float(state[2]), float(state[3]))
        return pos, vel


class KalmanTrajectoryPredictor:
    """
    Manages Kalman filters for multiple tracked objects.
    Provides trajectory predictions for PTZ camera slew-to-cue automation.
    """

    def __init__(self, config: Optional[KalmanConfig] = None) -> None:
        """
        Initialize the trajectory predictor.

        Args:
            config: KalmanConfig with filter parameters.
        """
        self.config = config or KalmanConfig()
        self.tracks: dict[int, KalmanTrack] = {}
        self._ptz_center_pan = 0.0
        self._ptz_center_tilt = 0.0
        self._current_zoom = 1.0

        logger.info(
            "KalmanTrajectoryPredictor initialized: dt=%.4f, "
            "horizons=(%.1fs, %.1fs), max_history=%d",
            self.config.dt,
            self.config.horizon_5s,
            self.config.horizon_10s,
            self.config.max_history,
        )

    def set_ptz_state(self, pan: float, tilt: float, zoom: float = 1.0) -> None:
        """Set current PTZ camera state for offset calculations."""
        self._ptz_center_pan = pan
        self._ptz_center_tilt = tilt
        self._current_zoom = zoom

    def update_track(self, track_state: TrackState) -> None:
        """
        Update or create a track with new detection.

        Args:
            track_state: TrackState from detector/tracker (e.g., ByteTrack).
        """
        track_id = track_state.track_id

        if track_id not in self.tracks:
            self.tracks[track_id] = KalmanTrack(track_id, None, self.config)

        self.tracks[track_id].update(track_state)

    def predict(self, track_id: int, current_time: Optional[float] = None) -> Optional[PredictionResult]:
        """
        Predict future trajectory for a track.

        Args:
            track_id: ByteTrack track ID.
            current_time: Current timestamp (defaults to time.time()).

        Returns:
            PredictionResult or None if track not found or insufficient data.
        """
        if current_time is None:
            current_time = time.time()

        if track_id not in self.tracks:
            return None

        track = self.tracks[track_id]

        if not track.is_initialized or track.detection_count < self.config.min_detections:
            return None

        # Current estimate
        curr_pos, curr_vel = track.get_current_estimate()
        last_state = track.history[-1]

        # Predict at 5s and 10s horizons
        pred_5s_state, pred_5s_cov = track.predict(self.config.horizon_5s)
        pred_10s_state, pred_10s_cov = track.predict(self.config.horizon_10s)

        pred_5s_pos = (float(pred_5s_state[0, 0]), float(pred_5s_state[1, 0]))
        pred_5s_vel = (float(pred_5s_state[2, 0]), float(pred_5s_state[3, 0]))
        pred_10s_pos = (float(pred_10s_state[0, 0]), float(pred_10s_state[1, 0]))
        pred_10s_vel = (float(pred_10s_state[2, 0]), float(pred_10s_state[3, 0]))

        # Uncertainty (trace of position covariance)
        unc_5s = float(np.trace(pred_5s_cov[:2, :2]))
        unc_10s = float(np.trace(pred_10s_cov[:2, :2]))

        # Calculate PTZ offsets
        pan_5s, tilt_5s, zoom_5s = self._calculate_ptz_offset(
            pred_5s_pos, last_state.bbox
        )
        pan_10s, tilt_10s, zoom_10s = self._calculate_ptz_offset(
            pred_10s_pos, last_state.bbox
        )

        # Time since last update
        time_since_update = current_time - track.last_update_time

        # Reliability check
        is_reliable = (
            track.detection_count >= self.config.min_detections
            and time_since_update < 1.0  # Updated within last second
            and unc_5s < 10000.0  # Reasonable uncertainty
        )

        return PredictionResult(
            track_id=track_id,
            current_state=last_state,
            pred_5s=pred_5s_pos,
            pred_10s=pred_10s_pos,
            vel_5s=pred_5s_vel,
            vel_10s=pred_10s_vel,
            uncertainty_5s=unc_5s,
            uncertainty_10s=unc_10s,
            pan_offset_5s=pan_5s,
            tilt_offset_5s=tilt_5s,
            zoom_factor_5s=zoom_5s,
            pan_offset_10s=pan_10s,
            tilt_offset_10s=tilt_10s,
            zoom_factor_10s=zoom_10s,
            is_reliable=is_reliable,
            num_detections=track.detection_count,
            time_since_update=time_since_update,
            prediction_timestamp=current_time,
        )

    def predict_all(self, current_time: Optional[float] = None) -> dict[int, PredictionResult]:
        """
        Predict trajectories for all active tracks.

        Args:
            current_time: Current timestamp.

        Returns:
            Dict mapping track_id to PredictionResult (only reliable predictions).
        """
        results = {}
        for track_id in list(self.tracks.keys()):
            pred = self.predict(track_id, current_time)
            if pred and pred.is_reliable:
                results[track_id] = pred
        return results

    def _calculate_ptz_offset(
        self,
        target_pos: tuple[float, float],
        bbox: tuple[float, float, float, float],
    ) -> tuple[float, float, float]:
        """
        Calculate PTZ pan/tilt/zoom offsets to center target.

        Args:
            target_pos: Predicted center position (cx, cy) in image coordinates.
            bbox: Current bounding box (x, y, w, h).

        Returns:
            Tuple of (pan_offset_deg, tilt_offset_deg, zoom_factor).
        """
        cx, cy = target_pos
        img_w, img_h = self.config.image_width, self.config.image_height

        # Normalized offset from image center (-1 to 1)
        norm_x = (cx - img_w / 2.0) / (img_w / 2.0)
        norm_y = (cy - img_h / 2.0) / (img_h / 2.0)

        # Convert to degrees
        pan_offset = norm_x * (self.config.ptz_fov_horizontal / 2.0)
        tilt_offset = -norm_y * (self.config.ptz_fov_vertical / 2.0)  # Negative: image Y down

        # Zoom factor based on bbox size relative to image
        bbox_area = bbox[2] * bbox[3]
        img_area = img_w * img_h
        target_area_ratio = bbox_area / img_area

        # Desired: target occupies ~10-20% of frame
        desired_ratio = 0.15
        if target_area_ratio > 0:
            zoom_factor = desired_ratio / target_area_ratio
            zoom_factor = np.clip(zoom_factor, 0.5, 20.0)
        else:
            zoom_factor = self._current_zoom

        return pan_offset, tilt_offset, zoom_factor

    def remove_track(self, track_id: int) -> bool:
        """Remove a track (e.g., when object leaves scene)."""
        if track_id in self.tracks:
            del self.tracks[track_id]
            return True
        return False

    def cleanup_stale_tracks(self, max_age: float = 5.0, current_time: Optional[float] = None) -> int:
        """
        Remove tracks that haven't been updated recently.

        Args:
            max_age: Maximum age in seconds before removal.
            current_time: Current timestamp.

        Returns:
            Number of tracks removed.
        """
        if current_time is None:
            current_time = time.time()

        stale_ids = [
            tid for tid, track in self.tracks.items()
            if current_time - track.last_update_time > max_age
        ]

        for tid in stale_ids:
            del self.tracks[tid]

        if stale_ids:
            logger.info("Cleaned up %d stale tracks", len(stale_ids))

        return len(stale_ids)

    def get_track_count(self) -> int:
        """Get number of active tracks."""
        return len(self.tracks)

    def get_reliable_track_count(self, current_time: Optional[float] = None) -> int:
        """Get number of tracks with reliable predictions."""
        if current_time is None:
            current_time = time.time()
        return sum(1 for tid in self.tracks if self.predict(tid, current_time) is not None)


def create_kalman_predictor(
    fps: float = 30.0,
    process_noise_pos: float = 1e-2,
    process_noise_vel: float = 1e-1,
    process_noise_acc: float = 1.0,
    measurement_noise: float = 1e-1,
    image_width: int = 1920,
    image_height: int = 1080,
    ptz_fov_h: float = 60.0,
    ptz_fov_v: float = 35.0,
) -> KalmanTrajectoryPredictor:
    """
    Factory function to create a configured KalmanTrajectoryPredictor.

    Args:
        fps: Camera frame rate.
        process_noise_pos: Process noise for position.
        process_noise_vel: Process noise for velocity.
        process_noise_acc: Process noise for acceleration.
        measurement_noise: Measurement noise.
        image_width: Camera image width.
        image_height: Camera image height.
        ptz_fov_h: PTZ horizontal FOV (degrees).
        ptz_fov_v: PTZ vertical FOV (degrees).

    Returns:
        Configured KalmanTrajectoryPredictor instance.
    """
    config = KalmanConfig(
        dt=1.0 / fps,
        process_noise_pos=process_noise_pos,
        process_noise_vel=process_noise_vel,
        process_noise_acc=process_noise_acc,
        measurement_noise=measurement_noise,
        image_width=image_width,
        image_height=image_height,
        ptz_fov_horizontal=ptz_fov_h,
        ptz_fov_vertical=ptz_fov_v,
    )
    return KalmanTrajectoryPredictor(config)


if __name__ == "__main__":
    # Demo / self-test
    logging.basicConfig(level=logging.INFO)

    predictor = create_kalman_predictor()
    predictor.set_ptz_state(pan=0.0, tilt=0.0, zoom=1.0)

    # Simulate a track moving diagonally
    track_id = 1
    base_time = time.time()

    for i in range(20):
        t = base_time + i * (1/30.0)
        # Object moving from left to right, top to bottom
        cx = 100 + i * 5
        cy = 100 + i * 3

        state = TrackState(
            track_id=track_id,
            bbox=(cx - 25, cy - 25, 50, 50),
            center=(cx, cy),
            timestamp=t,
            confidence=0.9,
            class_id=0,
            class_name="person",
        )

        predictor.update_track(state)

        if i >= 5:  # After min_detections
            pred = predictor.predict(track_id, t)
            if pred:
                print(
                    f"Frame {i}: pos=({cx:.0f},{cy:.0f}) -> "
                    f"5s=({pred.pred_5s[0]:.0f},{pred.pred_5s[1]:.0f}) "
                    f"10s=({pred.pred_10s[0]:.0f},{pred.pred_10s[1]:.0f}) "
                    f"pan5s={pred.pan_offset_5s:.2f}° tilt5s={pred.tilt_offset_5s:.2f}° "
                    f"reliable={pred.is_reliable}"
                )

    print(f"\nActive tracks: {predictor.get_track_count()}")
    print(f"Reliable tracks: {predictor.get_reliable_track_count()}")