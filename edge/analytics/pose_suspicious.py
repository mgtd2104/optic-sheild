"""
Suspicious Pose/Behavior Detection Engine for Border Surveillance

Processes skeletal keypoint arrays (MoveNet/OpenPose/YOLOv8-pose format)
to detect suspicious behaviors: crawling, loitering, erratic movement,
group clustering anomalies.
"""

from __future__ import annotations

import logging
import math
import time
from collections import deque
from dataclasses import dataclass, field
from enum import IntEnum
from typing import Any, Optional

import numpy as np

logger = logging.getLogger(__name__)


class BehaviorType(IntEnum):
    """Suspicious behavior types."""

    NONE = 0
    CRAWLING = 1
    LOITERING = 2
    ERRATIC_MOVEMENT = 3
    GROUP_CLUSTERING = 4
    FENCE_APPROACH = 5
    PRONE_POSITION = 6
    SUDDEN_SPRINT = 7


class AlertLevel(IntEnum):
    """Alert severity levels."""

    NONE = 0
    LOW = 1      # INFO
    MEDIUM = 2   # WARNING
    HIGH = 3     # CRITICAL


@dataclass(frozen=True, slots=True)
class KeypointConfig:
    """Keypoint indexing configuration (COCO 17-point format)."""

    # COCO keypoint indices
    NOSE = 0
    LEFT_EYE = 1
    RIGHT_EYE = 2
    LEFT_EAR = 3
    RIGHT_EAR = 4
    LEFT_SHOULDER = 5
    RIGHT_SHOULDER = 6
    LEFT_ELBOW = 7
    RIGHT_ELBOW = 8
    LEFT_WRIST = 9
    RIGHT_WRIST = 10
    LEFT_HIP = 11
    RIGHT_HIP = 12
    LEFT_KNEE = 13
    RIGHT_KNEE = 14
    LEFT_ANKLE = 15
    RIGHT_ANKLE = 16

    # Derived keypoint groups
    UPPER_BODY = [5, 6, 7, 8, 9, 10]  # shoulders, elbows, wrists
    LOWER_BODY = [11, 12, 13, 14, 15, 16]  # hips, knees, ankles
    TORSO = [5, 6, 11, 12]  # shoulders, hips
    LIMBS = [7, 8, 9, 10, 13, 14, 15, 16]  # all limbs


@dataclass(frozen=True, slots=True)
class SuspiciousConfig:
    """Configuration for suspicious behavior detection."""

    # Temporal window (seconds)
    window_duration: float = 10.0
    min_frames: int = 5

    # Crawling detection
    crawl_torso_angle_thresh: float = 45.0  # Degrees from vertical
    crawl_limb_extension_thresh: float = 0.3  # Ratio of limb length to torso
    crawl_speed_thresh: float = 0.5  # m/s (slow movement)

    # Loitering detection
    loiter_radius: float = 3.0  # meters
    loiter_min_duration: float = 30.0  # seconds
    loiter_max_displacement: float = 2.0  # meters

    # Erratic movement
    erratic_accel_thresh: float = 5.0  # m/s^2
    erratic_jerk_thresh: float = 10.0  # m/s^3
    erratic_direction_changes: int = 3  # per window

    # Group clustering
    cluster_min_group_size: int = 3
    cluster_max_distance: float = 5.0  # meters between individuals
    cluster_formation_angle: float = 60.0  # degrees (wedge formation)

    # Prone position
    prone_torso_horizontal_thresh: float = 30.0  # Degrees from horizontal
    prone_height_ratio_thresh: float = 0.4  # Height/width ratio

    # Sudden sprint
    sprint_speed_thresh: float = 5.0  # m/s
    sprint_accel_thresh: float = 3.0  # m/s^2

    # Coordinate system scale
    pixels_per_meter: float = 100.0

    # Confidence threshold for keypoints
    kpt_confidence_thresh: float = 0.3


@dataclass(frozen=True, slots=True)
class KeypointFrame:
    """Single frame of keypoint data for one person."""

    track_id: int
    keypoints: np.ndarray  # Shape (17, 3) - x, y, confidence
    bbox: tuple[float, float, float, float]  # x, y, w, h
    timestamp: float
    confidence: float

    @property
    def valid_keypoints(self) -> np.ndarray:
        """Get keypoints above confidence threshold."""
        return self.keypoints[self.keypoints[:, 2] > 0.3]

    def get_kpt(self, idx: int) -> Optional[tuple[float, float, float]]:
        """Get specific keypoint if valid."""
        if idx < len(self.keypoints) and self.keypoints[idx, 2] > 0.3:
            return (float(self.keypoints[idx, 0]), float(self.keypoints[idx, 1]), float(self.keypoints[idx, 2]))
        return None

    def get_center(self) -> tuple[float, float]:
        """Get body center (mid-hip)."""
        lh = self.get_kpt(KeypointConfig.LEFT_HIP)
        rh = self.get_kpt(KeypointConfig.RIGHT_HIP)
        if lh and rh:
            return ((lh[0] + rh[0]) / 2.0, (lh[1] + rh[1]) / 2.0)
        # Fallback to bbox center
        return (self.bbox[0] + self.bbox[2] / 2.0, self.bbox[1] + self.bbox[3] / 2.0)


@dataclass(frozen=True, slots=True)
class BehaviorResult:
    """Result of behavior analysis for one track."""

    track_id: int
    behavior: BehaviorType
    alert_level: AlertLevel
    confidence: float
    timestamp: float
    details: dict[str, Any]
    metrics: dict[str, float]

    @property
    def is_suspicious(self) -> bool:
        return self.behavior != BehaviorType.NONE and self.alert_level >= AlertLevel.MEDIUM


@dataclass(slots=True)
class TrackBuffer:
    """Sliding window buffer for a single track."""

    track_id: int
    frames: deque = field(default_factory=lambda: deque(maxlen=300))  # 10s at 30fps
    last_behavior: BehaviorType = BehaviorType.NONE
    behavior_start_time: float = 0.0
    consecutive_frames: int = 0

    def add_frame(self, frame: KeypointFrame) -> None:
        self.frames.append(frame)

    def get_window(self, duration: float, current_time: float) -> list[KeypointFrame]:
        """Get frames within time window."""
        cutoff = current_time - duration
        return [f for f in self.frames if f.timestamp >= cutoff]

    def clear(self) -> None:
        self.frames.clear()


class SuspiciousPoseEngine:
    """
    Analyzes skeletal keypoint sequences to detect suspicious behaviors.

    Supports COCO 17-point format (MoveNet, OpenPose, YOLOv8-pose).
    Uses sliding temporal window for behavior classification.
    """

    def __init__(self, config: Optional[SuspiciousConfig] = None) -> None:
        """
        Initialize the suspicious pose engine.

        Args:
            config: SuspiciousConfig with detection thresholds.
        """
        self.config = config or SuspiciousConfig()
        self.tracks: dict[int, TrackBuffer] = {}
        self._kpt_config = KeypointConfig()

        logger.info(
            "SuspiciousPoseEngine initialized: window=%.1fs, "
            "crawl_angle=%.1f°, loiter_radius=%.1fm, cluster_dist=%.1fm",
            self.config.window_duration,
            self.config.crawl_torso_angle_thresh,
            self.config.loiter_radius,
            self.config.cluster_max_distance,
        )

    def process_frame(
        self,
        keypoint_frames: list[KeypointFrame],
        current_time: Optional[float] = None,
    ) -> list[BehaviorResult]:
        """
        Process a batch of keypoint frames and detect behaviors.

        Args:
            keypoint_frames: List of KeypointFrame for all detected persons.
            current_time: Current timestamp (defaults to time.time()).

        Returns:
            List of BehaviorResult for tracks with suspicious behavior.
        """
        if current_time is None:
            current_time = time.time()

        results = []

        # Update track buffers
        for kf in keypoint_frames:
            if kf.track_id not in self.tracks:
                self.tracks[kf.track_id] = TrackBuffer(kf.track_id)
            self.tracks[kf.track_id].add_frame(kf)

        # Analyze each track
        for track_id, buffer in list(self.tracks.items()):
            # Clean old frames
            window = buffer.get_window(self.config.window_duration, current_time)
            if len(window) < self.config.min_frames:
                continue

            # Run behavior detectors
            behaviors = []

            # 1. Crawling / Prone detection
            crawl_result = self._detect_crawling_prone(track_id, window, current_time)
            if crawl_result:
                behaviors.append(crawl_result)

            # 2. Loitering detection
            loiter_result = self._detect_loitering(track_id, window, current_time)
            if loiter_result:
                behaviors.append(loiter_result)

            # 3. Erratic movement
            erratic_result = self._detect_erratic_movement(track_id, window, current_time)
            if erratic_result:
                behaviors.append(erratic_result)

            # 4. Sudden sprint
            sprint_result = self._detect_sudden_sprint(track_id, window, current_time)
            if sprint_result:
                behaviors.append(sprint_result)

            # Keep highest priority behavior
            if behaviors:
                # Priority: CRAWLING > ERRATIC > SPRINT > LOITERING > PRONE
                priority_order = [
                    BehaviorType.CRAWLING,
                    BehaviorType.ERRATIC_MOVEMENT,
                    BehaviorType.SUDDEN_SPRINT,
                    BehaviorType.LOITERING,
                    BehaviorType.PRONE_POSITION,
                    BehaviorType.FENCE_APPROACH,
                ]
                best = min(behaviors, key=lambda b: priority_order.index(b.behavior) if b.behavior in priority_order else 99)
                results.append(best)

        # 5. Group clustering (cross-track analysis)
        cluster_results = self._detect_group_clustering(keypoint_frames, current_time)
        results.extend(cluster_results)

        return results

    def _detect_crawling_prone(
        self,
        track_id: int,
        window: list[KeypointFrame],
        current_time: float,
    ) -> Optional[BehaviorResult]:
        """Detect crawling or prone position."""
        # Analyze torso angle and limb positions across window
        torso_angles = []
        limb_extensions = []
        heights = []
        speeds = []

        for frame in window:
            # Torso angle (shoulder-to-hip line vs vertical)
            ls = frame.get_kpt(self._kpt_config.LEFT_SHOULDER)
            rs = frame.get_kpt(self._kpt_config.RIGHT_SHOULDER)
            lh = frame.get_kpt(self._kpt_config.LEFT_HIP)
            rh = frame.get_kpt(self._kpt_config.RIGHT_HIP)

            if ls and rs and lh and rh:
                shoulder_mid = ((ls[0] + rs[0]) / 2, (ls[1] + rs[1]) / 2)
                hip_mid = ((lh[0] + rh[0]) / 2, (lh[1] + rh[1]) / 2)

                dx = shoulder_mid[0] - hip_mid[0]
                dy = shoulder_mid[1] - hip_mid[1]
                angle = abs(math.degrees(math.atan2(dx, -dy)))  # Angle from vertical
                torso_angles.append(angle)

                # Torso length
                torso_len = math.hypot(dx, dy)

                # Limb extension (average limb length / torso length)
                limbs = []
                for kpt_idx in [7, 8, 9, 10, 13, 14, 15, 16]:  # elbows, wrists, knees, ankles
                    kpt = frame.get_kpt(kpt_idx)
                    if kpt:
                        # Distance from nearest joint
                        if kpt_idx in [7, 8]:  # elbows -> shoulders
                            ref = ls if kpt_idx == 7 else rs
                        elif kpt_idx in [9, 10]:  # wrists -> elbows
                            ref = frame.get_kpt(7) if kpt_idx == 9 else frame.get_kpt(8)
                        elif kpt_idx in [13, 14]:  # knees -> hips
                            ref = lh if kpt_idx == 13 else rh
                        else:  # ankles -> knees
                            ref = frame.get_kpt(13) if kpt_idx == 15 else frame.get_kpt(14)
                        if ref:
                            limbs.append(math.hypot(kpt[0] - ref[0], kpt[1] - ref[1]))

                if limbs and torso_len > 0:
                    limb_extensions.append(np.mean(limbs) / torso_len)

                # Bbox height for prone detection
                heights.append(frame.bbox[3])

        if not torso_angles:
            return None

        avg_torso_angle = np.mean(torso_angles)
        avg_limb_ext = np.mean(limb_extensions) if limb_extensions else 0
        avg_height = np.mean(heights) if heights else 0
        bbox_width = np.mean([f.bbox[2] for f in window])

        # Speed estimation
        centers = [f.get_center() for f in window]
        if len(centers) >= 2:
            displacements = [math.hypot(centers[i][0]-centers[i-1][0], centers[i][1]-centers[i-1][1])
                           for i in range(1, len(centers))]
            time_diffs = [window[i].timestamp - window[i-1].timestamp for i in range(1, len(window))]
            speeds = [d / t * self.config.pixels_per_meter for d, t in zip(displacements, time_diffs) if t > 0]
        avg_speed = np.mean(speeds) if speeds else 0

        # Prone: torso nearly horizontal, low height/width ratio
        is_prone = (
            avg_torso_angle > (90 - self.config.prone_torso_horizontal_thresh)
            and avg_height / max(bbox_width, 1) < self.config.prone_height_ratio_thresh
        )

        # Crawling: torso angled, limbs extended, slow speed
        is_crawling = (
            avg_torso_angle > self.config.crawl_torso_angle_thresh
            and avg_limb_ext > self.config.crawl_limb_extension_thresh
            and avg_speed < self.config.crawl_speed_thresh
        )

        if is_crawling:
            return BehaviorResult(
                track_id=track_id,
                behavior=BehaviorType.CRAWLING,
                alert_level=AlertLevel.HIGH,
                confidence=min(1.0, (avg_torso_angle / 90.0) * (avg_limb_ext / 0.5)),
                timestamp=current_time,
                details={
                    "avg_torso_angle": avg_torso_angle,
                    "avg_limb_extension": avg_limb_ext,
                    "avg_speed_mps": avg_speed,
                },
                metrics={
                    "torso_angle_deg": avg_torso_angle,
                    "limb_extension_ratio": avg_limb_ext,
                    "speed_mps": avg_speed,
                },
            )

        if is_prone:
            return BehaviorResult(
                track_id=track_id,
                behavior=BehaviorType.PRONE_POSITION,
                alert_level=AlertLevel.MEDIUM,
                confidence=min(1.0, avg_torso_angle / 90.0),
                timestamp=current_time,
                details={
                    "avg_torso_angle": avg_torso_angle,
                    "height_width_ratio": avg_height / max(bbox_width, 1),
                },
                metrics={
                    "torso_angle_deg": avg_torso_angle,
                    "height_width_ratio": avg_height / max(bbox_width, 1),
                },
            )

        return None

    def _detect_loitering(
        self,
        track_id: int,
        window: list[KeypointFrame],
        current_time: float,
    ) -> Optional[BehaviorResult]:
        """Detect prolonged loitering in restricted zone."""
        centers = [f.get_center() for f in window]

        if len(centers) < 2:
            return None

        # Convert to meters
        centers_m = [(c[0] / self.config.pixels_per_meter, c[1] / self.config.pixels_per_meter) for c in centers]

        # Check if staying within radius
        first_pos = centers_m[0]
        max_disp = max(math.hypot(c[0] - first_pos[0], c[1] - first_pos[1]) for c in centers_m)

        # Duration
        duration = window[-1].timestamp - window[0].timestamp

        is_loitering = (
            max_disp < self.config.loiter_max_displacement
            and duration >= self.config.loiter_min_duration
        )

        if is_loitering:
            # Calculate radius of gyration
            cx = np.mean([c[0] for c in centers_m])
            cy = np.mean([c[1] for c in centers_m])
            radius = np.mean([math.hypot(c[0] - cx, c[1] - cy) for c in centers_m])

            return BehaviorResult(
                track_id=track_id,
                behavior=BehaviorType.LOITERING,
                alert_level=AlertLevel.MEDIUM,
                confidence=min(1.0, duration / 60.0),  # Increases with duration
                timestamp=current_time,
                details={
                    "duration_sec": duration,
                    "max_displacement_m": max_disp,
                    "radius_of_gyration_m": radius,
                    "position": (cx, cy),
                },
                metrics={
                    "duration_sec": duration,
                    "max_displacement_m": max_disp,
                    "radius_m": radius,
                },
            )

        return None

    def _detect_erratic_movement(
        self,
        track_id: int,
        window: list[KeypointFrame],
        current_time: float,
    ) -> Optional[BehaviorResult]:
        """Detect sudden direction changes, high acceleration/jerk."""
        centers = [f.get_center() for f in window]

        if len(centers) < 5:
            return None

        # Convert to meters and compute velocities
        centers_m = np.array([(c[0] / self.config.pixels_per_meter, c[1] / self.config.pixels_per_meter)
                              for c in centers])
        times = np.array([f.timestamp for f in window])

        dt = np.diff(times)
        dt = np.maximum(dt, 1e-3)

        velocities = np.diff(centers_m, axis=0) / dt[:, np.newaxis]
        speeds = np.linalg.norm(velocities, axis=1)

        if len(velocities) < 3:
            return None

        # Acceleration
        dv = np.diff(velocities, axis=0)
        dt2 = np.diff(times[:-1])
        dt2 = np.maximum(dt2, 1e-3)
        accelerations = dv / dt2[:, np.newaxis]
        accel_mags = np.linalg.norm(accelerations, axis=1)

        # Jerk
        if len(accelerations) >= 2:
            da = np.diff(accelerations, axis=0)
            dt3 = np.diff(times[:-2])
            dt3 = np.maximum(dt3, 1e-3)
            jerks = da / dt3[:, np.newaxis]
            jerk_mags = np.linalg.norm(jerks, axis=1)
            max_jerk = float(np.max(jerk_mags))
        else:
            max_jerk = 0.0

        max_accel = float(np.max(accel_mags)) if len(accel_mags) > 0 else 0.0

        # Direction changes
        if len(velocities) >= 2:
            dirs = velocities / (speeds[:, np.newaxis] + 1e-6)
            dot_products = np.sum(dirs[1:] * dirs[:-1], axis=1)
            angles = np.arccos(np.clip(dot_products, -1, 1))
            direction_changes = int(np.sum(angles > math.radians(45)))
        else:
            direction_changes = 0

        is_erratic = (
            max_accel > self.config.erratic_accel_thresh
            or max_jerk > self.config.erratic_jerk_thresh
            or direction_changes >= self.config.erratic_direction_changes
        )

        if is_erratic:
            return BehaviorResult(
                track_id=track_id,
                behavior=BehaviorType.ERRATIC_MOVEMENT,
                alert_level=AlertLevel.HIGH,
                confidence=min(1.0, (max_accel / 10.0 + max_jerk / 20.0 + direction_changes / 5.0) / 3.0),
                timestamp=current_time,
                details={
                    "max_accel_mps2": max_accel,
                    "max_jerk_mps3": max_jerk,
                    "direction_changes": direction_changes,
                    "max_speed_mps": float(np.max(speeds)) if len(speeds) > 0 else 0.0,
                },
                metrics={
                    "max_accel": max_accel,
                    "max_jerk": max_jerk,
                    "direction_changes": float(direction_changes),
                },
            )

        return None

    def _detect_sudden_sprint(
        self,
        track_id: int,
        window: list[KeypointFrame],
        current_time: float,
    ) -> Optional[BehaviorResult]:
        """Detect sudden high-speed movement (sprint)."""
        centers = [f.get_center() for f in window]

        if len(centers) < 3:
            return None

        centers_m = np.array([(c[0] / self.config.pixels_per_meter, c[1] / self.config.pixels_per_meter)
                              for c in centers])
        times = np.array([f.timestamp for f in window])

        dt = np.diff(times)
        dt = np.maximum(dt, 1e-3)

        velocities = np.diff(centers_m, axis=0) / dt[:, np.newaxis]
        speeds = np.linalg.norm(velocities, axis=1)

        if len(speeds) < 2:
            return None

        max_speed = float(np.max(speeds))

        # Acceleration
        dv = np.diff(velocities, axis=0)
        dt2 = np.diff(times[:-1])
        dt2 = np.maximum(dt2, 1e-3)
        accelerations = dv / dt2[:, np.newaxis]
        accel_mags = np.linalg.norm(accelerations, axis=1)
        max_accel = float(np.max(accel_mags)) if len(accel_mags) > 0 else 0.0

        is_sprint = (
            max_speed > self.config.sprint_speed_thresh
            and max_accel > self.config.sprint_accel_thresh
        )

        if is_sprint:
            return BehaviorResult(
                track_id=track_id,
                behavior=BehaviorType.SUDDEN_SPRINT,
                alert_level=AlertLevel.MEDIUM,
                confidence=min(1.0, max_speed / 10.0),
                timestamp=current_time,
                details={
                    "max_speed_mps": max_speed,
                    "max_accel_mps2": max_accel,
                },
                metrics={
                    "max_speed": max_speed,
                    "max_accel": max_accel,
                },
            )

        return None

    def _detect_group_clustering(
        self,
        keypoint_frames: list[KeypointFrame],
        current_time: float,
    ) -> list[BehaviorResult]:
        """Detect group clustering / formation anomalies."""
        if len(keypoint_frames) < self.config.cluster_min_group_size:
            return []

        # Get current positions
        positions = []
        for kf in keypoint_frames:
            center = kf.get_center()
            pos_m = (center[0] / self.config.pixels_per_meter, center[1] / self.config.pixels_per_meter)
            positions.append((kf.track_id, pos_m))

        # Find clusters using simple distance-based grouping
        clusters = []
        used = set()

        for i, (tid_i, pos_i) in enumerate(positions):
            if tid_i in used:
                continue
            cluster = [(tid_i, pos_i)]
            used.add(tid_i)

            for j, (tid_j, pos_j) in enumerate(positions[i+1:], i+1):
                if tid_j in used:
                    continue
                dist = math.hypot(pos_i[0] - pos_j[0], pos_i[1] - pos_j[1])
                if dist <= self.config.cluster_max_distance:
                    cluster.append((tid_j, pos_j))
                    used.add(tid_j)

            if len(cluster) >= self.config.cluster_min_group_size:
                clusters.append(cluster)

        results = []
        for cluster in clusters:
            # Check for formation (wedge/line)
            cluster_positions = [p for _, p in cluster]
            cx = np.mean([p[0] for p in cluster_positions])
            cy = np.mean([p[1] for p in cluster_positions])

            # Angles from centroid
            angles = [math.degrees(math.atan2(p[1] - cy, p[0] - cx)) for p in cluster_positions]
            angles.sort()
            # Check angular spread
            angular_spread = max(angles) - min(angles) if angles else 0
            if angular_spread > 180:
                angular_spread = 360 - angular_spread

            is_formation = angular_spread < self.config.cluster_formation_angle

            alert_level = AlertLevel.HIGH if is_formation else AlertLevel.MEDIUM

            results.append(BehaviorResult(
                track_id=cluster[0][0],  # Representative track ID
                behavior=BehaviorType.GROUP_CLUSTERING,
                alert_level=alert_level,
                confidence=min(1.0, len(cluster) / 10.0),
                timestamp=current_time,
                details={
                    "group_size": len(cluster),
                    "track_ids": [tid for tid, _ in cluster],
                    "centroid": (cx, cy),
                    "angular_spread_deg": angular_spread,
                    "is_formation": is_formation,
                    "max_inter_distance": max(
                        math.hypot(p1[0]-p2[0], p1[1]-p2[1])
                        for i, p1 in enumerate(cluster_positions)
                        for p2 in cluster_positions[i+1:]
                    ) if len(cluster_positions) > 1 else 0,
                },
                metrics={
                    "group_size": float(len(cluster)),
                    "angular_spread": angular_spread,
                    "is_formation": float(is_formation),
                },
            ))

        return results

    def remove_track(self, track_id: int) -> bool:
        """Remove a track buffer."""
        if track_id in self.tracks:
            del self.tracks[track_id]
            return True
        return False

    def cleanup_stale_tracks(self, max_age: float = 10.0, current_time: Optional[float] = None) -> int:
        """Remove tracks with no recent updates."""
        if current_time is None:
            current_time = time.time()

        stale = [
            tid for tid, buffer in self.tracks.items()
            if buffer.frames and current_time - buffer.frames[-1].timestamp > max_age
        ]

        for tid in stale:
            del self.tracks[tid]

        return len(stale)


def create_suspicious_pose_engine(
    window_duration: float = 10.0,
    crawl_angle_thresh: float = 45.0,
    loiter_radius: float = 3.0,
    loiter_duration: float = 30.0,
    erratic_accel_thresh: float = 5.0,
    cluster_distance: float = 5.0,
    pixels_per_meter: float = 100.0,
) -> SuspiciousPoseEngine:
    """
    Factory function to create a configured SuspiciousPoseEngine.

    Args:
        window_duration: Temporal analysis window (seconds).
        crawl_angle_thresh: Torso angle threshold for crawling (degrees).
        loiter_radius: Maximum displacement for loitering (meters).
        loiter_duration: Minimum loitering duration (seconds).
        erratic_accel_thresh: Acceleration threshold for erratic movement (m/s^2).
        cluster_distance: Maximum distance for group clustering (meters).
        pixels_per_meter: Image scale calibration.

    Returns:
        Configured SuspiciousPoseEngine instance.
    """
    config = SuspiciousConfig(
        window_duration=window_duration,
        crawl_torso_angle_thresh=crawl_angle_thresh,
        loiter_radius=loiter_radius,
        loiter_min_duration=loiter_duration,
        erratic_accel_thresh=erratic_accel_thresh,
        cluster_max_distance=cluster_distance,
        pixels_per_meter=pixels_per_meter,
    )
    return SuspiciousPoseEngine(config)


def keypoints_from_yolo(
    keypoints_xy: np.ndarray,
    keypoints_conf: np.ndarray,
    bbox: tuple[float, float, float, float],
    track_id: int,
    timestamp: float,
    confidence: float,
) -> KeypointFrame:
    """
    Create KeypointFrame from YOLOv8-pose output.

    Args:
        keypoints_xy: Keypoints (17, 2) in image coordinates.
        keypoints_conf: Keypoint confidences (17,).
        bbox: Bounding box (x, y, w, h).
        track_id: ByteTrack track ID.
        timestamp: Frame timestamp.
        confidence: Detection confidence.

    Returns:
        KeypointFrame object.
    """
    kpts = np.column_stack([keypoints_xy, keypoints_conf]).astype(np.float32)
    return KeypointFrame(
        track_id=track_id,
        keypoints=kpts,
        bbox=bbox,
        timestamp=timestamp,
        confidence=confidence,
    )


def keypoints_from_openpose(
    keypoints: np.ndarray,  # (18, 3) or (25, 3) BODY_25 format
    bbox: tuple[float, float, float, float],
    track_id: int,
    timestamp: float,
    confidence: float,
) -> KeypointFrame:
    """
    Create KeypointFrame from OpenPose output (converts to COCO 17-point).

    Args:
        keypoints: OpenPose keypoints (N, 3) - x, y, confidence.
        bbox: Bounding box (x, y, w, h).
        track_id: ByteTrack track ID.
        timestamp: Frame timestamp.
        confidence: Detection confidence.

    Returns:
        KeypointFrame with COCO 17-point format.
    """
    # OpenPose BODY_25 to COCO 17 mapping
    # This is a simplified mapping; adjust based on actual OpenPose format
    coco_kpts = np.zeros((17, 3), dtype=np.float32)

    # Map common points (indices may vary)
    mapping = {
        0: 0,    # Nose
        1: 16,   # Left eye (approx)
        2: 15,   # Right eye (approx)
        3: 18,   # Left ear (approx)
        4: 17,   # Right ear (approx)
        5: 5,    # Left shoulder
        6: 2,    # Right shoulder
        7: 6,    # Left elbow
        8: 3,    # Right elbow
        9: 7,    # Left wrist
        10: 4,   # Right wrist
        11: 12,  # Left hip
        12: 9,   # Right hip
        13: 13,  # Left knee
        14: 10,  # Right knee
        15: 14,  # Left ankle
        16: 11,  # Right ankle
    }

    for coco_idx, op_idx in mapping.items():
        if op_idx < len(keypoints):
            coco_kpts[coco_idx] = keypoints[op_idx]

    return KeypointFrame(
        track_id=track_id,
        keypoints=coco_kpts,
        bbox=bbox,
        timestamp=timestamp,
        confidence=confidence,
    )


if __name__ == "__main__":
    # Demo / self-test
    logging.basicConfig(level=logging.INFO)

    engine = create_suspicious_pose_engine()

    # Simulate crawling person
    track_id = 1
    base_time = time.time()

    for i in range(50):
        t = base_time + i * 0.1  # 10 FPS
        # Crawling: low torso, horizontal movement
        cx = 500 + i * 2
        cy = 500 + i * 1
        # Simulate keypoints for crawling pose (torso horizontal)
        kpts = np.zeros((17, 3), dtype=np.float32)
        # Shoulders and hips wide (horizontal torso)
        kpts[5] = [cx - 30, cy, 0.9]  # Left shoulder
        kpts[6] = [cx + 30, cy, 0.9]  # Right shoulder
        kpts[11] = [cx - 25, cy + 10, 0.9]  # Left hip
        kpts[12] = [cx + 25, cy + 10, 0.9]  # Right hip
        # Limbs extended
        kpts[7] = [cx - 50, cy, 0.8]  # Left elbow
        kpts[8] = [cx + 50, cy, 0.8]  # Right elbow
        kpts[13] = [cx - 30, cy + 30, 0.8]  # Left knee
        kpts[14] = [cx + 30, cy + 30, 0.8]  # Right knee

        frame = KeypointFrame(
            track_id=track_id,
            keypoints=kpts,
            bbox=(cx - 50, cy - 10, 100, 50),
            timestamp=t,
            confidence=0.9,
        )

        results = engine.process_frame([frame], t)
        if results:
            for r in results:
                print(f"Frame {i}: {r.behavior.name} - {r.alert_level.name} (conf={r.confidence:.2f})")

    print("\n--- Test Loitering ---")
    # Simulate loitering
    for i in range(100):
        t = base_time + 100 + i * 0.5
        cx = 1000 + np.random.normal(0, 5)
        cy = 500 + np.random.normal(0, 5)
        kpts = np.zeros((17, 3), dtype=np.float32)
        kpts[5] = [cx - 20, cy - 30, 0.9]
        kpts[6] = [cx + 20, cy - 30, 0.9]
        kpts[11] = [cx - 15, cy + 10, 0.9]
        kpts[12] = [cx + 15, cy + 10, 0.9]

        frame = KeypointFrame(
            track_id=2,
            keypoints=kpts,
            bbox=(cx - 30, cy - 40, 60, 80),
            timestamp=t,
            confidence=0.9,
        )

        results = engine.process_frame([frame], t)
        if results:
            for r in results:
                print(f"Loiter Frame {i}: {r.behavior.name} - {r.alert_level.name} (dur={r.details.get('duration_sec', 0):.1f}s)")

    print("\n--- Test Group Clustering ---")
    # Simulate 4 people clustering
    for i in range(10):
        t = base_time + 200 + i
        frames = []
        for j in range(4):
            cx = 1500 + j * 30 + np.random.normal(0, 2)
            cy = 800 + np.random.normal(0, 2)
            kpts = np.zeros((17, 3), dtype=np.float32)
            kpts[5] = [cx - 15, cy - 25, 0.9]
            kpts[6] = [cx + 15, cy - 25, 0.9]
            kpts[11] = [cx - 10, cy + 15, 0.9]
            kpts[12] = [cx + 10, cy + 15, 0.9]

            frames.append(KeypointFrame(
                track_id=10 + j,
                keypoints=kpts,
                bbox=(cx - 20, cy - 30, 40, 60),
                timestamp=t,
                confidence=0.9,
            ))

        results = engine.process_frame(frames, t)
        if results:
            for r in results:
                print(f"Cluster Frame {i}: {r.behavior.name} - {r.alert_level.name} "
                      f"(size={r.details['group_size']}, formation={r.details['is_formation']})")