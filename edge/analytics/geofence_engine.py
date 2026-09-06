"""
Dynamic Virtual Fence Intrusion Detection Engine

Provides geofence boundary checking for bounding boxes and Kalman-predicted
trajectory vectors with severity grading.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from enum import IntEnum
from typing import Any, Optional

import numpy as np
from shapely.geometry import LineString, Point, Polygon, box
from shapely.prepared import prep

logger = logging.getLogger(__name__)


class SeverityGrade(IntEnum):
    """Intrusion severity levels (higher = more severe)."""

    NONE = 0
    INFO = 1
    WARNING = 2
    CRITICAL = 3


@dataclass(frozen=True, slots=True)
class GeofenceConfig:
    """Configuration for geofence behavior."""

    # Distance thresholds for severity grading (in meters, assuming coordinate system in meters)
    info_distance: float = 50.0  # Outside but approaching
    warning_distance: float = 10.0  # Near boundary
    critical_distance: float = 0.0  # Crossing or inside

    # Buffer distance for boundary "thickness" (meters)
    boundary_buffer: float = 2.0

    # Minimum trajectory segment length to consider (meters)
    min_trajectory_length: float = 1.0

    # Coordinate system: "meters" | "pixels" | "latlon"
    coordinate_system: str = "meters"


@dataclass(frozen=True, slots=True)
class BoundingBox:
    """Axis-aligned bounding box in (x, y, w, h) format."""

    x: float
    y: float
    width: float
    height: float

    @property
    def x1(self) -> float:
        return self.x

    @property
    def y1(self) -> float:
        return self.y

    @property
    def x2(self) -> float:
        return self.x + self.width

    @property
    def y2(self) -> float:
        return self.y + self.height

    @property
    def center(self) -> tuple[float, float]:
        return (self.x + self.width / 2.0, self.y + self.height / 2.0)

    @property
    def corners(self) -> list[tuple[float, float]]:
        return [
            (self.x1, self.y1),
            (self.x2, self.y1),
            (self.x2, self.y2),
            (self.x1, self.y2),
        ]

    def to_shapely_box(self) -> Polygon:
        return box(self.x1, self.y1, self.x2, self.y2)

    def to_polygon(self) -> Polygon:
        return Polygon(self.corners)


@dataclass(frozen=True, slots=True)
class TrajectoryVector:
    """Predicted trajectory as a line segment with metadata."""

    start: tuple[float, float]  # (x, y)
    end: tuple[float, float]  # (x, y)
    timestamp: float  # Unix timestamp
    object_id: int
    confidence: float = 1.0

    @property
    def length(self) -> float:
        dx = self.end[0] - self.start[0]
        dy = self.end[1] - self.start[1]
        return float(np.hypot(dx, dy))

    @property
    def direction(self) -> tuple[float, float]:
        """Unit direction vector."""
        length = self.length
        if length == 0:
            return (0.0, 0.0)
        return ((self.end[0] - self.start[0]) / length, (self.end[1] - self.start[1]) / length)

    def to_shapely_line(self) -> LineString:
        return LineString([self.start, self.end])

    def interpolate(self, t: float) -> tuple[float, float]:
        """Get point at fraction t along trajectory (0 <= t <= 1)."""
        return (
            self.start[0] + t * (self.end[0] - self.start[0]),
            self.start[1] + t * (self.end[1] - self.start[1]),
        )


@dataclass(frozen=True, slots=True)
class IntrusionResult:
    """Result of a geofence intrusion check."""

    intruded: bool
    severity: SeverityGrade
    intersection_point: Optional[tuple[float, float]]
    distance_to_boundary: float
    penetration_depth: float
    object_id: Optional[int]
    timestamp: float
    details: dict[str, Any]

    @property
    def severity_name(self) -> str:
        return self.severity.name


class GeofenceEngine:
    """
    Dynamic virtual fence intrusion detection engine.

    Supports polygon and line-string geofences. Checks bounding boxes and
    Kalman-predicted trajectory vectors for boundary intersection,
    returning intrusion status, intersection point, and severity grade.

    Uses Shapely for robust geometric operations with prepared geometries
    for performance.
    """

    def __init__(
        self,
        coordinates: list[tuple[float, float]],
        config: Optional[GeofenceConfig] = None,
        fence_id: Optional[str] = None,
        fence_type: str = "polygon",
    ) -> None:
        """
        Initialize the geofence engine.

        Args:
            coordinates: List of (x, y) coordinate tuples defining the fence.
                         For polygon: vertices in order (closed automatically).
                         For line: start and end points (or multi-point line).
            config: GeofenceConfig with distance thresholds and parameters.
            fence_id: Optional identifier for this geofence.
            fence_type: "polygon" for closed area, "line" for linear barrier.

        Raises:
            ValueError: If coordinates are invalid for the fence type.
        """
        self.config = config or GeofenceConfig()
        self.fence_id = fence_id or f"fence_{id(self)}"
        self.fence_type = fence_type.lower()

        if self.fence_type == "polygon":
            if len(coordinates) < 3:
                raise ValueError("Polygon fence requires at least 3 coordinates")
            self._geometry = Polygon(coordinates)
            if not self._geometry.is_valid:
                # Attempt to fix self-intersections
                self._geometry = self._geometry.buffer(0)
            self._boundary = self._geometry.boundary
        elif self.fence_type == "line":
            if len(coordinates) < 2:
                raise ValueError("Line fence requires at least 2 coordinates")
            self._geometry = LineString(coordinates)
            self._boundary = self._geometry
        else:
            raise ValueError(f"Unknown fence_type: {fence_type}. Use 'polygon' or 'line'")

        # Prepared geometry for fast repeated operations
        self._prepared_geometry = prep(self._geometry)
        self._prepared_boundary = prep(self._boundary)

        # Buffered boundary for proximity checks
        self._buffered_boundary = self._boundary.buffer(self.config.boundary_buffer)
        self._prepared_buffered = prep(self._buffered_boundary)

        logger.info(
            "GeofenceEngine initialized: id=%s, type=%s, vertices=%d, "
            "area=%.2f, length=%.2f",
            self.fence_id,
            self.fence_type,
            len(coordinates),
            self._geometry.area if self.fence_type == "polygon" else 0.0,
            self._geometry.length,
        )

    def check_bbox(self, bbox: BoundingBox, object_id: Optional[int] = None) -> IntrusionResult:
        """
        Check if a bounding box intrudes the geofence.

        Args:
            bbox: BoundingBox to check.
            object_id: Optional object identifier for tracking.

        Returns:
            IntrusionResult with intrusion status and details.
        """
        bbox_poly = bbox.to_shapely_box()
        bbox_center = Point(bbox.center)

        # Check intersection with geometry
        intersects = self._prepared_geometry.intersects(bbox_poly)

        # Check if center is inside (for polygon) or near boundary (for line)
        if self.fence_type == "polygon":
            center_inside = self._prepared_geometry.contains(bbox_center)
        else:
            center_inside = False

        # Calculate distance to boundary
        distance = self._boundary.distance(bbox_poly)

        # Determine penetration depth (how far inside)
        penetration = 0.0
        intersection_pt = None

        if intersects:
            intersection = self._geometry.intersection(bbox_poly)
            if not intersection.is_empty:
                # Get representative intersection point
                if intersection.geom_type == "Point":
                    intersection_pt = (intersection.x, intersection.y)
                elif intersection.geom_type in ("LineString", "MultiLineString"):
                    # Use centroid of intersection
                    centroid = intersection.centroid
                    intersection_pt = (centroid.x, centroid.y)
                elif intersection.geom_type in ("Polygon", "MultiPolygon"):
                    centroid = intersection.centroid
                    intersection_pt = (centroid.x, centroid.y)
                    # Penetration depth: approximate as sqrt(intersection_area / perimeter)
                    if hasattr(intersection, "area") and intersection.area > 0:
                        penetration = float(np.sqrt(intersection.area / max(self._geometry.length, 1.0)))

        # Determine severity
        severity = self._calculate_severity(
            distance=distance,
            penetration=penetration,
            center_inside=center_inside,
            intersects=intersects,
        )

        intruded = severity >= SeverityGrade.WARNING

        return IntrusionResult(
            intruded=intruded,
            severity=severity,
            intersection_point=intersection_pt,
            distance_to_boundary=distance,
            penetration_depth=penetration,
            object_id=object_id,
            timestamp=0.0,  # Caller should set if needed
            details={
                "fence_id": self.fence_id,
                "fence_type": self.fence_type,
                "bbox_center": bbox.center,
                "bbox_area": bbox.width * bbox.height,
                "center_inside": center_inside,
                "intersects_geometry": intersects,
            },
        )

    def check_trajectory(
        self,
        trajectory: TrajectoryVector,
        predict_steps: int = 10,
    ) -> IntrusionResult:
        """
        Check if a predicted trajectory vector intersects the geofence.

        Performs both immediate intersection check and predictive sampling
        along the trajectory for early warning.

        Args:
            trajectory: TrajectoryVector with start/end points.
            predict_steps: Number of interpolation steps for predictive check.

        Returns:
            IntrusionResult with intrusion status, intersection point, and severity.
        """
        traj_line = trajectory.to_shapely_line()

        # Quick rejection: check if trajectory bbox intersects buffered boundary
        if not self._prepared_buffered.intersects(traj_line):
            # Check distance for INFO severity
            distance = self._boundary.distance(traj_line)
            severity = self._severity_from_distance(distance)
            return IntrusionResult(
                intruded=False,
                severity=severity,
                intersection_point=None,
                distance_to_boundary=distance,
                penetration_depth=0.0,
                object_id=trajectory.object_id,
                timestamp=trajectory.timestamp,
                details={
                    "fence_id": self.fence_id,
                    "fence_type": self.fence_type,
                    "trajectory_length": trajectory.length,
                    "predictive_check": False,
                },
            )

        # Check direct intersection with boundary
        intersects_boundary = self._prepared_boundary.intersects(traj_line)
        intersection_pt = None
        penetration = 0.0

        if intersects_boundary:
            intersection = self._boundary.intersection(traj_line)
            if not intersection.is_empty:
                if intersection.geom_type == "Point":
                    intersection_pt = (intersection.x, intersection.y)
                elif intersection.geom_type == "MultiPoint":
                    # Use first intersection point
                    pt = list(intersection.geoms)[0]
                    intersection_pt = (pt.x, pt.y)
                else:
                    centroid = intersection.centroid
                    intersection_pt = (centroid.x, centroid.y)

        # For polygon fences, check if trajectory enters the interior
        center_inside = False
        if self.fence_type == "polygon":
            start_inside = self._prepared_geometry.contains(Point(trajectory.start))
            end_inside = self._prepared_geometry.contains(Point(trajectory.end))
            center_inside = start_inside or end_inside

            # Predictive sampling along trajectory
            for i in range(1, predict_steps):
                t = i / predict_steps
                pt = trajectory.interpolate(t)
                if self._prepared_geometry.contains(Point(pt)):
                    center_inside = True
                    if intersection_pt is None:
                        intersection_pt = pt
                    break

        # Calculate distance from trajectory to boundary
        distance = self._boundary.distance(traj_line)

        # Penetration depth for polygon: how far trajectory goes inside
        if self.fence_type == "polygon" and center_inside:
            # Sample points inside to estimate penetration
            inside_points = []
            for i in range(predict_steps + 1):
                t = i / predict_steps
                pt = trajectory.interpolate(t)
                if self._prepared_geometry.contains(Point(pt)):
                    inside_points.append(pt)
            if inside_points:
                # Max distance from boundary among inside points
                max_dist = max(self._boundary.distance(Point(p)) for p in inside_points)
                penetration = max_dist

        severity = self._calculate_severity(
            distance=distance,
            penetration=penetration,
            center_inside=center_inside,
            intersects=intersects_boundary,
        )

        intruded = severity >= SeverityGrade.WARNING

        return IntrusionResult(
            intruded=intruded,
            severity=severity,
            intersection_point=intersection_pt,
            distance_to_boundary=distance,
            penetration_depth=penetration,
            object_id=trajectory.object_id,
            timestamp=trajectory.timestamp,
            details={
                "fence_id": self.fence_id,
                "fence_type": self.fence_type,
                "trajectory_length": trajectory.length,
                "trajectory_direction": trajectory.direction,
                "start_inside": self._prepared_geometry.contains(Point(trajectory.start))
                if self.fence_type == "polygon"
                else False,
                "end_inside": self._prepared_geometry.contains(Point(trajectory.end))
                if self.fence_type == "polygon"
                else False,
                "center_inside": center_inside,
                "intersects_boundary": intersects_boundary,
                "predictive_check": True,
                "predict_steps": predict_steps,
            },
        )

    def check_trajectories_batch(
        self, trajectories: list[TrajectoryVector], predict_steps: int = 10
    ) -> list[IntrusionResult]:
        """
        Check multiple trajectories efficiently.

        Args:
            trajectories: List of TrajectoryVector objects.
            predict_steps: Interpolation steps per trajectory.

        Returns:
            List of IntrusionResult objects.
        """
        return [self.check_trajectory(t, predict_steps) for t in trajectories]

    def check_bboxes_batch(
        self, bboxes: list[BoundingBox], object_ids: Optional[list[int]] = None
    ) -> list[IntrusionResult]:
        """
        Check multiple bounding boxes efficiently.

        Args:
            bboxes: List of BoundingBox objects.
            object_ids: Optional list of object IDs (same length as bboxes).

        Returns:
            List of IntrusionResult objects.
        """
        if object_ids is None:
            object_ids = [None] * len(bboxes)
        return [self.check_bbox(bbox, oid) for bbox, oid in zip(bboxes, object_ids, strict=False)]

    def _calculate_severity(
        self,
        distance: float,
        penetration: float,
        center_inside: bool,
        intersects: bool,
    ) -> SeverityGrade:
        """
        Calculate severity grade based on geometric relationship.

        Args:
            distance: Distance to boundary (meters).
            penetration: Penetration depth inside fence (meters).
            center_inside: Whether object center is inside polygon.
            intersects: Whether geometry intersects boundary.

        Returns:
            SeverityGrade enum value.
        """
        # CRITICAL: Inside polygon or crossing boundary with penetration
        if center_inside and self.fence_type == "polygon":
            return SeverityGrade.CRITICAL
        if intersects and penetration > 0:
            return SeverityGrade.CRITICAL

        # WARNING: Very close to boundary or intersecting boundary
        if intersects:
            return SeverityGrade.WARNING
        if distance <= self.config.warning_distance:
            return SeverityGrade.WARNING

        # INFO: Approaching boundary
        if distance <= self.config.info_distance:
            return SeverityGrade.INFO

        # NONE: Far from boundary
        return SeverityGrade.NONE

    def _severity_from_distance(self, distance: float) -> SeverityGrade:
        """Determine severity based solely on distance to boundary."""
        if distance <= self.config.critical_distance:
            return SeverityGrade.CRITICAL
        if distance <= self.config.warning_distance:
            return SeverityGrade.WARNING
        if distance <= self.config.info_distance:
            return SeverityGrade.INFO
        return SeverityGrade.NONE

    def get_boundary_polygon(self) -> Polygon:
        """Get the fence geometry as a Shapely Polygon (for polygon fences)."""
        if self.fence_type != "polygon":
            raise ValueError("Not a polygon fence")
        return self._geometry

    def get_boundary_line(self) -> LineString:
        """Get the fence geometry as a Shapely LineString."""
        return self._boundary

    def contains_point(self, point: tuple[float, float]) -> bool:
        """Check if a point is inside the fence (polygon only)."""
        if self.fence_type != "polygon":
            raise ValueError("Point containment only valid for polygon fences")
        return self._prepared_geometry.contains(Point(point))

    def distance_to_boundary(self, point: tuple[float, float]) -> float:
        """Get distance from a point to the fence boundary."""
        return self._boundary.distance(Point(point))

    def __repr__(self) -> str:
        return (
            f"GeofenceEngine(id={self.fence_id}, type={self.fence_type}, "
            f"vertices={len(list(self._geometry.exterior.coords)) if self.fence_type == 'polygon' else len(list(self._geometry.coords))})"
        )


def create_polygon_fence(
    coordinates: list[tuple[float, float]],
    config: Optional[GeofenceConfig] = None,
    fence_id: Optional[str] = None,
) -> GeofenceEngine:
    """
    Factory to create a polygon (area) geofence.

    Args:
        coordinates: List of (x, y) vertices in order.
        config: Optional GeofenceConfig.
        fence_id: Optional identifier.

    Returns:
        GeofenceEngine configured as polygon fence.
    """
    return GeofenceEngine(coordinates, config, fence_id, fence_type="polygon")


def create_line_fence(
    coordinates: list[tuple[float, float]],
    config: Optional[GeofenceConfig] = None,
    fence_id: Optional[str] = None,
) -> GeofenceEngine:
    """
    Factory to create a line (barrier) geofence.

    Args:
        coordinates: List of (x, y) points defining the line.
        config: Optional GeofenceConfig.
        fence_id: Optional identifier.

    Returns:
        GeofenceEngine configured as line fence.
    """
    return GeofenceEngine(coordinates, config, fence_id, fence_type="line")


if __name__ == "__main__":
    # Demo / self-test
    logging.basicConfig(level=logging.INFO)

    # Create a polygon fence (e.g., restricted area)
    fence_coords = [(0, 0), (100, 0), (100, 100), (0, 100)]
    fence = create_polygon_fence(fence_coords, fence_id="perimeter_1")

    config = GeofenceConfig(info_distance=20.0, warning_distance=5.0)
    fence = create_polygon_fence(fence_coords, config, "perimeter_1")

    # Test 1: BBox outside
    bbox_out = BoundingBox(x=150, y=150, width=20, height=20)
    result = fence.check_bbox(bbox_out, object_id=1)
    print(f"Outside: intruded={result.intruded}, severity={result.severity_name}, dist={result.distance_to_boundary:.1f}")

    # Test 2: BBox near boundary (WARNING)
    bbox_near = BoundingBox(x=95, y=50, width=10, height=10)
    result = fence.check_bbox(bbox_near, object_id=2)
    print(f"Near: intruded={result.intruded}, severity={result.severity_name}, dist={result.distance_to_boundary:.1f}")

    # Test 3: BBox inside (CRITICAL)
    bbox_in = BoundingBox(x=50, y=50, width=10, height=10)
    result = fence.check_bbox(bbox_in, object_id=3)
    print(f"Inside: intruded={result.intruded}, severity={result.severity_name}, dist={result.distance_to_boundary:.1f}")

    # Test 4: Trajectory crossing boundary
    traj = TrajectoryVector(start=(50, 150), end=(50, 50), timestamp=1234567890.0, object_id=4)
    result = fence.check_trajectory(traj)
    print(f"Crossing: intruded={result.intruded}, severity={result.severity_name}, intersect={result.intersection_point}")

    # Test 5: Line fence (barrier)
    line_coords = [(0, 50), (200, 50)]
    line_fence = create_line_fence(line_coords, config, "barrier_1")
    traj2 = TrajectoryVector(start=(100, 30), end=(100, 70), timestamp=1234567891.0, object_id=5)
    result = line_fence.check_trajectory(traj2)
    print(f"Line crossing: intruded={result.intruded}, severity={result.severity_name}, intersect={result.intersection_point}")