"""
Alert Management REST API for Optic Shield

Endpoints:
- POST /api/v1/alerts: Ingest encrypted alert payloads from edge units
- GET /api/v1/alerts: Query historical alerts with filtering
- PATCH /api/v1/alerts/{alert_id}: Acknowledge/resolve alerts
- GET /api/v1/alerts/stats: Alert statistics dashboard
"""

from __future__ import annotations

import base64
import logging
import time
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import and_, desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.core.security import (
    AES256GCMCipher,
    EncryptedPayload,
    SHA256Hasher,
    get_key_manager,
    get_payload_cipher,
    get_settings,
)
from backend.app.db.database import get_db_session
from backend.app.db.models import (
    Alert,
    AlertSeverity,
    AlertStatus,
    AlertType,
    AuditEventCategory,
    AuditEventType,
    AuditLedger,
    Camera,
    ConsensusStatus,
    LedgerBlock,
)
from backend.app.api.websocket import broadcast_alert

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/alerts", tags=["alerts"])


# ============================================================
# Request/Response Models
# ============================================================

class AlertIngestRequest(BaseModel):
    """Request model for encrypted alert ingestion."""

    payload: str = Field(..., description="Base64-encoded EncryptedPayload")
    keyframe: Optional[UploadFile] = Field(None, description="Optional cropped keyframe JPEG (<100KB)")
    keyframe_b64: Optional[str] = Field(None, description="Base64-encoded keyframe JPEG")

    @field_validator("payload")
    @classmethod
    def validate_payload(cls, v: str) -> str:
        try:
            base64.b64decode(v)
        except Exception as e:
            raise ValueError(f"Invalid base64 payload: {e}")
        return v


class AlertResponse(BaseModel):
    """Response model for alert data."""

    id: int
    uuid: str
    camera_id: int
    camera_name: Optional[str] = None
    alert_type: str
    severity: int
    status: str
    confidence: float
    track_id: Optional[int] = None
    object_class: Optional[str] = None
    object_id: Optional[str] = None
    geofence_id: Optional[str] = None
    intersection_point: Optional[dict[str, float]] = None
    penetration_depth: Optional[float] = None
    distance_to_boundary: Optional[float] = None
    predicted_trajectory: Optional[list[dict[str, float]]] = None
    prediction_horizon_seconds: Optional[int] = None
    behavior_type: Optional[str] = None
    behavior_metrics: Optional[dict[str, float]] = None
    watchlist_match_id: Optional[str] = None
    watchlist_name: Optional[str] = None
    face_similarity: Optional[float] = None
    plate_text: Optional[str] = None
    plate_state: Optional[str] = None
    plate_confidence: Optional[float] = None
    health_alert_type: Optional[str] = None
    health_metrics: Optional[dict[str, float]] = None
    keyframe_url: Optional[str] = None
    keyframe_thumbnail_url: Optional[str] = None
    consensus_status: str
    consensus_sources: Optional[list[str]] = None
    detected_at: datetime
    received_at: datetime
    acknowledged_at: Optional[datetime] = None
    acknowledged_by: Optional[str] = None
    resolved_at: Optional[datetime] = None
    resolved_by: Optional[str] = None

    class Config:
        from_attributes = True


class AlertListResponse(BaseModel):
    """Paginated alert list response."""

    success: bool = True
    data: list[AlertResponse]
    total: int
    page: int
    page_size: int
    timestamp: str


class AlertStatsResponse(BaseModel):
    """Alert statistics for dashboard."""

    success: bool = True
    data: dict[str, Any]
    timestamp: str


class AlertUpdateRequest(BaseModel):
    """Request to update alert status."""

    status: AlertStatus
    acknowledged_by: Optional[str] = None
    resolved_by: Optional[str] = None


class StandardErrorResponse(BaseModel):
    """Standard error response per rules.md."""

    success: bool = False
    error: dict[str, Any]
    timestamp: str


# ============================================================
# Helper Functions
# ============================================================

async def _decrypt_and_validate_payload(
    payload_b64: str,
    key_version: int = 1,
) -> dict[str, Any]:
    """
    Decrypt and validate incoming alert payload.

    Args:
        payload_b64: Base64-encoded EncryptedPayload
        key_version: Encryption key version

    Returns:
        Decrypted alert metadata dict
    """
    try:
        encrypted = EncryptedPayload.from_base64(payload_b64)
        cipher = get_payload_cipher(encrypted.key_version)
        plaintext = cipher.decrypt(encrypted)
        metadata = plaintext.decode("utf-8")
        import json
        return json.loads(metadata)
    except Exception as e:
        logger.error("Payload decryption failed: %s", e)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid or corrupted payload: {e}",
        )


async def _save_keyframe(
    keyframe_data: bytes,
    alert_uuid: str,
) -> str:
    """
    Save keyframe to storage and return URL.

    In production, this would upload to S3/MinIO/CDN.
    For now, returns a placeholder URL.
    """
    # TODO: Implement actual storage (S3, MinIO, local filesystem)
    # For now, return a placeholder
    return f"/storage/keyframes/{alert_uuid}.jpg"


async def _append_audit_log(
    session: AsyncSession,
    event_type: str,
    event_category: str,
    event_data: dict[str, Any],
    camera_id: Optional[int] = None,
    alert_id: Optional[int] = None,
) -> AuditLedger:
    """
    Append event to audit ledger with SHA-256 chaining.

    Args:
        session: Database session
        event_type: Type of event
        event_category: Category of event
        event_data: Event payload
        camera_id: Optional camera reference
        alert_id: Optional alert reference

    Returns:
        Created AuditLedger block
    """
    # Get latest block
    result = await session.execute(
        select(AuditLedger).order_by(desc(AuditLedger.block_index)).limit(1)
    )
    last_block = result.scalar_one_or_none()

    previous_hash = last_block.current_hash if last_block else "0" * 64
    block_index = (last_block.block_index + 1) if last_block else 1

    block = LedgerBlock(
        block_index=block_index,
        previous_hash=previous_hash,
        event_type=event_type,
        event_category=event_category,
        event_data=event_data,
        timestamp=datetime.now(timezone.utc),
        camera_id=camera_id,
        alert_id=alert_id,
    )

    orm_block = block.to_orm()
    session.add(orm_block)
    return orm_block


def _alert_to_response(alert: Alert, camera_name: Optional[str] = None) -> AlertResponse:
    """Convert Alert ORM to response model."""
    return AlertResponse(
        id=alert.id,
        uuid=alert.uuid,
        camera_id=alert.camera_id,
        camera_name=camera_name,
        alert_type=alert.alert_type.value,
        severity=alert.severity.value,
        status=alert.status.value,
        confidence=alert.confidence,
        track_id=alert.track_id,
        object_class=alert.object_class,
        object_id=alert.object_id,
        geofence_id=alert.geofence_id,
        intersection_point=alert.intersection_point,
        penetration_depth=alert.penetration_depth,
        distance_to_boundary=alert.distance_to_boundary,
        predicted_trajectory=alert.predicted_trajectory,
        prediction_horizon_seconds=alert.prediction_horizon_seconds,
        behavior_type=alert.behavior_type,
        behavior_metrics=alert.behavior_metrics,
        watchlist_match_id=alert.watchlist_match_id,
        watchlist_name=alert.watchlist_name,
        face_similarity=alert.face_similarity,
        plate_text=alert.plate_text,
        plate_state=alert.plate_state,
        plate_confidence=alert.plate_confidence,
        health_alert_type=alert.health_alert_type,
        health_metrics=alert.health_metrics,
        keyframe_url=alert.keyframe_url,
        keyframe_thumbnail_url=alert.keyframe_thumbnail_url,
        consensus_status=alert.consensus_status.value,
        consensus_sources=alert.consensus_sources,
        detected_at=alert.detected_at,
        received_at=alert.received_at,
        acknowledged_at=alert.acknowledged_at,
        acknowledged_by=alert.acknowledged_by,
        resolved_at=alert.resolved_at,
        resolved_by=alert.resolved_by,
    )


# ============================================================
# API Endpoints
# ============================================================

@router.post(
    "",
    response_model=dict[str, Any],
    status_code=status.HTTP_201_CREATED,
    summary="Ingest alert from edge unit",
    description="Decrypts AES-256-GCM payload, saves alert to DB, appends to audit ledger, broadcasts via WebSocket",
)
async def ingest_alert(
    request: AlertIngestRequest,
    session: AsyncSession = Depends(get_db_session),
) -> dict[str, Any]:
    """
    Ingest encrypted alert payload from edge pipeline.

    Edge units send AES-256-GCM encrypted JSON metadata with optional cropped keyframe.
    This endpoint decrypts, validates, persists, and broadcasts the alert.
    """
    start_time = time.time()

    try:
        # Decrypt payload
        metadata = await _decrypt_and_validate_payload(request.payload)

        # Validate required fields
        required_fields = ["camera_id", "alert_type", "severity", "confidence", "detected_at"]
        for field in required_fields:
            if field not in metadata:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Missing required field: {field}",
                )

        # Verify camera exists
        camera_result = await session.execute(
            select(Camera).where(Camera.id == metadata["camera_id"])
        )
        camera = camera_result.scalar_one_or_none()
        if not camera:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Camera {metadata['camera_id']} not registered",
            )

        # Handle keyframe
        keyframe_url = None
        keyframe_thumbnail_url = None
        keyframe_size = None

        if request.keyframe:
            keyframe_bytes = await request.keyframe.read()
            keyframe_size = len(keyframe_bytes)
            if keyframe_size > 100 * 1024:  # 100KB limit
                raise HTTPException(
                    status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    detail="Keyframe exceeds 100KB limit",
                )
            keyframe_url = await _save_keyframe(keyframe_bytes, metadata.get("frame_id", "unknown"))
        elif request.keyframe_b64:
            try:
                keyframe_bytes = base64.b64decode(request.keyframe_b64)
                keyframe_size = len(keyframe_bytes)
                if keyframe_size > 100 * 1024:
                    raise HTTPException(
                        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        detail="Keyframe exceeds 100KB limit",
                    )
                keyframe_url = await _save_keyframe(keyframe_bytes, metadata.get("frame_id", "unknown"))
            except Exception as e:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Invalid keyframe base64: {e}",
                )

        # Create alert
        alert = Alert(
            uuid=metadata.get("frame_id", f"alert-{int(time.time() * 1000)}"),
            camera_id=metadata["camera_id"],
            alert_type=AlertType(metadata["alert_type"]),
            severity=AlertSeverity(metadata["severity"]),
            status=AlertStatus.PENDING,
            confidence=metadata["confidence"],
            track_id=metadata.get("track_id"),
            object_class=metadata.get("object_class"),
            object_id=metadata.get("object_id"),
            geofence_id=metadata.get("geofence_id"),
            intersection_point=metadata.get("intersection_point"),
            penetration_depth=metadata.get("penetration_depth"),
            distance_to_boundary=metadata.get("distance_to_boundary"),
            predicted_trajectory=metadata.get("predicted_trajectory"),
            prediction_horizon_seconds=metadata.get("prediction_horizon_seconds"),
            behavior_type=metadata.get("behavior_type"),
            behavior_metrics=metadata.get("behavior_metrics"),
            watchlist_match_id=metadata.get("watchlist_match_id"),
            watchlist_name=metadata.get("watchlist_name"),
            face_similarity=metadata.get("face_similarity"),
            plate_text=metadata.get("plate_text"),
            plate_state=metadata.get("plate_state"),
            plate_confidence=metadata.get("plate_confidence"),
            health_alert_type=metadata.get("health_alert_type"),
            health_metrics=metadata.get("health_metrics"),
            keyframe_url=keyframe_url,
            keyframe_size_bytes=keyframe_size,
            keyframe_timestamp=datetime.fromisoformat(metadata["detected_at"].replace("Z", "+00:00"))
            if "detected_at" in metadata else None,
            metadata=metadata.get("metadata", {}),
            consensus_status=ConsensusStatus.NONE,
            detected_at=datetime.fromisoformat(metadata["detected_at"].replace("Z", "+00:00")),
        )

        session.add(alert)
        await session.flush()  # Get alert ID

        # Append to audit ledger
        await _append_audit_log(
            session=session,
            event_type=AuditEventType.ALERT_CREATED.value,
            event_category=AuditEventCategory.ALERT.value,
            event_data={
                "alert_id": alert.id,
                "alert_uuid": alert.uuid,
                "camera_id": alert.camera_id,
                "alert_type": alert.alert_type.value,
                "severity": alert.severity.value,
            },
            camera_id=alert.camera_id,
            alert_id=alert.id,
        )

        await session.commit()
        await session.refresh(alert)

        # Broadcast via WebSocket (high priority alerts only)
        if alert.severity in (AlertSeverity.WARNING, AlertSeverity.CRITICAL):
            try:
                await broadcast_alert({
                    "type": "alert",
                    "alert": _alert_to_response(alert, camera.name).model_dump(),
                })
            except Exception as e:
                logger.warning("WebSocket broadcast failed: %s", e)

        processing_time = time.time() - start_time
        logger.info(
            "Alert ingested: id=%d, type=%s, severity=%s, latency=%.2fms",
            alert.id, alert.alert_type.value, alert.severity.value, processing_time * 1000
        )

        return {
            "success": True,
            "data": {
                "alert_id": alert.id,
                "alert_uuid": alert.uuid,
                "status": "ingested",
            },
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "processing_time_ms": round(processing_time * 1000, 2),
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Alert ingestion failed: %s", e, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Internal server error: {e}",
        )


@router.get(
    "",
    response_model=AlertListResponse,
    summary="Query historical alerts",
    description="Fetch alerts with filtering by camera, severity, type, time range, and status",
)
async def list_alerts(
    camera_id: Optional[int] = Query(None, description="Filter by camera ID"),
    alert_type: Optional[AlertType] = Query(None, description="Filter by alert type"),
    severity: Optional[AlertSeverity] = Query(None, description="Filter by severity"),
    status_filter: Optional[AlertStatus] = Query(None, alias="status", description="Filter by status"),
    start_time: Optional[datetime] = Query(None, description="Start time (ISO 8601)"),
    end_time: Optional[datetime] = Query(None, description="End time (ISO 8601)"),
    track_id: Optional[int] = Query(None, description="Filter by track ID"),
    consensus_status: Optional[ConsensusStatus] = Query(None, description="Filter by consensus status"),
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(20, ge=1, le=100, description="Items per page"),
    sort_by: str = Query("detected_at", description="Sort field"),
    sort_order: str = Query("desc", pattern="^(asc|desc)$", description="Sort order"),
    session: AsyncSession = Depends(get_db_session),
) -> AlertListResponse:
    """
    Query historical alerts with comprehensive filtering.

    Supports pagination, sorting, and multiple filter criteria.
    """
    # Build query
    query = select(Alert).join(Camera, Alert.camera_id == Camera.id, isouter=True)

    # Apply filters
    conditions = []
    if camera_id:
        conditions.append(Alert.camera_id == camera_id)
    if alert_type:
        conditions.append(Alert.alert_type == alert_type)
    if severity:
        conditions.append(Alert.severity == severity)
    if status_filter:
        conditions.append(Alert.status == status_filter)
    if start_time:
        conditions.append(Alert.detected_at >= start_time)
    if end_time:
        conditions.append(Alert.detected_at <= end_time)
    if track_id:
        conditions.append(Alert.track_id == track_id)
    if consensus_status:
        conditions.append(Alert.consensus_status == consensus_status)

    if conditions:
        query = query.where(and_(*conditions))

    # Count total
    count_query = select(func.count()).select_from(query.subquery())
    total_result = await session.execute(count_query)
    total = total_result.scalar() or 0

    # Apply sorting
    sort_column = getattr(Alert, sort_by, Alert.detected_at)
    if sort_order == "desc":
        query = query.order_by(desc(sort_column))
    else:
        query = query.order_by(sort_column)

    # Apply pagination
    offset = (page - 1) * page_size
    query = query.offset(offset).limit(page_size)

    # Execute
    result = await session.execute(query)
    alerts = result.scalars().all()

    # Convert to response
    alert_responses = [
        _alert_to_response(alert, alert.camera.name if alert.camera else None)
        for alert in alerts
    ]

    return AlertListResponse(
        success=True,
        data=alert_responses,
        total=total,
        page=page,
        page_size=page_size,
        timestamp=datetime.now(timezone.utc).isoformat(),
    )


@router.get(
    "/stats",
    response_model=AlertStatsResponse,
    summary="Alert statistics",
    description="Get aggregated alert statistics for dashboard",
)
async def get_alert_stats(
    camera_id: Optional[int] = Query(None, description="Filter by camera ID"),
    start_time: Optional[datetime] = Query(None, description="Start time (ISO 8601)"),
    end_time: Optional[datetime] = Query(None, description="End time (ISO 8601)"),
    session: AsyncSession = Depends(get_db_session),
) -> AlertStatsResponse:
    """Get alert statistics for dashboard."""
    conditions = []
    if camera_id:
        conditions.append(Alert.camera_id == camera_id)
    if start_time:
        conditions.append(Alert.detected_at >= start_time)
    if end_time:
        conditions.append(Alert.detected_at <= end_time)

    # Total count
    total_query = select(func.count(Alert.id))
    if conditions:
        total_query = total_query.where(and_(*conditions))
    total_result = await session.execute(total_query)
    total = total_result.scalar() or 0

    # By severity
    severity_query = (
        select(Alert.severity, func.count(Alert.id))
        .group_by(Alert.severity)
    )
    if conditions:
        severity_query = severity_query.where(and_(*conditions))
    severity_result = await session.execute(severity_query)
    by_severity = {s.value: c for s, c in severity_result.all()}

    # By type
    type_query = (
        select(Alert.alert_type, func.count(Alert.id))
        .group_by(Alert.alert_type)
    )
    if conditions:
        type_query = type_query.where(and_(*conditions))
    type_result = await session.execute(type_query)
    by_type = {t.value: c for t, c in type_result.all()}

    # By status
    status_query = (
        select(Alert.status, func.count(Alert.id))
        .group_by(Alert.status)
    )
    if conditions:
        status_query = status_query.where(and_(*conditions))
    status_result = await session.execute(status_query)
    by_status = {s.value: c for s, c in status_result.all()}

    # By camera (top 10)
    camera_query = (
        select(Alert.camera_id, Camera.name, func.count(Alert.id))
        .join(Camera, Alert.camera_id == Camera.id)
        .group_by(Alert.camera_id, Camera.name)
        .order_by(desc(func.count(Alert.id)))
        .limit(10)
    )
    if conditions:
        camera_query = camera_query.where(and_(*conditions))
    camera_result = await session.execute(camera_query)
    by_camera = [
        {"camera_id": cid, "camera_name": name, "count": count}
        for cid, name, count in camera_result.all()
    ]

    # Recent 24h trend (hourly)
    from datetime import timedelta
    day_ago = datetime.now(timezone.utc) - timedelta(hours=24)
    trend_query = (
        select(
            func.date_trunc("hour", Alert.detected_at).label("hour"),
            func.count(Alert.id).label("count")
        )
        .where(Alert.detected_at >= day_ago)
        .group_by("hour")
        .order_by("hour")
    )
    if camera_id:
        trend_query = trend_query.where(Alert.camera_id == camera_id)
    trend_result = await session.execute(trend_query)
    trend = [
        {"hour": h.isoformat(), "count": c}
        for h, c in trend_result.all()
    ]

    return AlertStatsResponse(
        success=True,
        data={
            "total": total,
            "by_severity": by_severity,
            "by_type": by_type,
            "by_status": by_status,
            "by_camera": by_camera,
            "trend_24h": trend,
        },
        timestamp=datetime.now(timezone.utc).isoformat(),
    )


@router.patch(
    "/{alert_id}",
    response_model=dict[str, Any],
    summary="Update alert status",
    description="Acknowledge, resolve, or escalate an alert",
)
async def update_alert(
    alert_id: int,
    request: AlertUpdateRequest,
    session: AsyncSession = Depends(get_db_session),
) -> dict[str, Any]:
    """Update alert status (acknowledge, resolve, escalate)."""
    result = await session.execute(
        select(Alert).where(Alert.id == alert_id)
    )
    alert = result.scalar_one_or_none()
    if not alert:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Alert {alert_id} not found",
        )

    now = datetime.now(timezone.utc)
    old_status = alert.status

    alert.status = request.status

    if request.status == AlertStatus.ACKNOWLEDGED:
        alert.acknowledged_at = now
        alert.acknowledged_by = request.acknowledged_by
    elif request.status in (AlertStatus.RESOLVED, AlertStatus.FALSE_POSITIVE):
        alert.resolved_at = now
        alert.resolved_by = request.resolved_by
    elif request.status == AlertStatus.ESCALATED:
        alert.metadata = alert.metadata or {}
        alert.metadata["escalated_at"] = now.isoformat()
        alert.metadata["escalated_by"] = request.resolved_by or request.acknowledged_by

    # Append to audit ledger
    await _append_audit_log(
        session=session,
        event_type=f"ALERT_{request.status.value.upper()}".replace("-", "_"),
        event_category=AuditEventCategory.ALERT.value,
        event_data={
            "alert_id": alert.id,
            "old_status": old_status.value,
            "new_status": request.status.value,
            "updated_by": request.acknowledged_by or request.resolved_by,
        },
        alert_id=alert.id,
    )

    await session.commit()

    # Broadcast status change
    try:
        await broadcast_alert({
            "type": "alert_status",
            "alert_id": alert.id,
            "alert_uuid": alert.uuid,
            "old_status": old_status.value,
            "new_status": request.status.value,
        })
    except Exception as e:
        logger.warning("WebSocket broadcast failed: %s", e)

    return {
        "success": True,
        "data": {
            "alert_id": alert.id,
            "status": request.status.value,
        },
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@router.get(
    "/{alert_id}",
    response_model=AlertResponse,
    summary="Get alert by ID",
    description="Retrieve full alert details",
)
async def get_alert(
    alert_id: int,
    session: AsyncSession = Depends(get_db_session),
) -> AlertResponse:
    """Get single alert by ID."""
    result = await session.execute(
        select(Alert).join(Camera, Alert.camera_id == Camera.id, isouter=True)
        .where(Alert.id == alert_id)
    )
    row = result.first()
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Alert {alert_id} not found",
        )

    alert, camera = row
    return _alert_to_response(alert, camera.name if camera else None)


@router.delete(
    "/{alert_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete alert (admin only)",
    description="Soft delete alert - marks as resolved with note",
)
async def delete_alert(
    alert_id: int,
    session: AsyncSession = Depends(get_db_session),
) -> None:
    """Delete alert (soft delete via status change)."""
    result = await session.execute(
        select(Alert).where(Alert.id == alert_id)
    )
    alert = result.scalar_one_or_none()
    if not alert:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Alert {alert_id} not found",
        )

    alert.status = AlertStatus.RESOLVED
    alert.resolved_at = datetime.now(timezone.utc)
    alert.metadata = alert.metadata or {}
    alert.metadata["deleted"] = True

    await _append_audit_log(
        session=session,
        event_type="ALERT_DELETED",
        event_category=AuditEventCategory.ALERT.value,
        event_data={"alert_id": alert.id, "alert_uuid": alert.uuid},
        alert_id=alert.id,
    )

    await session.commit()


# ============================================================
# Batch Ingest (for high-throughput edge units)
# ============================================================

class BatchAlertIngestRequest(BaseModel):
    """Batch alert ingestion request."""

    payloads: list[str] = Field(..., min_length=1, max_length=100)
    keyframes_b64: Optional[list[Optional[str]]] = None


@router.post(
    "/batch",
    response_model=dict[str, Any],
    status_code=status.HTTP_201_CREATED,
    summary="Batch ingest alerts",
    description="Ingest multiple alerts in single request for high-throughput edge units",
)
async def batch_ingest_alerts(
    request: BatchAlertIngestRequest,
    session: AsyncSession = Depends(get_db_session),
) -> dict[str, Any]:
    """Batch ingest multiple alerts."""
    results = []
    errors = []

    keyframes = request.keyframes_b64 or [None] * len(request.payloads)

    for i, (payload_b64, keyframe_b64) in enumerate(zip(request.payloads, keyframes)):
        try:
            metadata = await _decrypt_and_validate_payload(payload_b64)

            # Quick validation
            if "camera_id" not in metadata:
                errors.append({"index": i, "error": "Missing camera_id"})
                continue

            # Create minimal alert for batch
            alert = Alert(
                uuid=metadata.get("frame_id", f"batch-{int(time.time() * 1000)}-{i}"),
                camera_id=metadata["camera_id"],
                alert_type=AlertType(metadata["alert_type"]),
                severity=AlertSeverity(metadata["severity"]),
                status=AlertStatus.PENDING,
                confidence=metadata["confidence"],
                detected_at=datetime.fromisoformat(metadata["detected_at"].replace("Z", "+00:00")),
                metadata=metadata.get("metadata", {}),
            )
            session.add(alert)

            results.append({"index": i, "status": "queued"})
        except Exception as e:
            errors.append({"index": i, "error": str(e)})

    if results:
        await session.flush()

        # Audit log for batch
        await _append_audit_log(
            session=session,
            event_type=AuditEventType.ALERT_CREATED.value,
            event_category=AuditEventCategory.ALERT.value,
            event_data={
                "batch_count": len(results),
                "success_count": len([r for r in results if r["status"] == "queued"]),
                "error_count": len(errors),
            },
        )

        await session.commit()

    return {
        "success": len(errors) == 0,
        "data": {
            "processed": len(results),
            "errors": errors,
        },
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


if __name__ == "__main__":
    # Module validation
    print("Alerts API module loaded successfully")
    print("Endpoints:")
    print("  POST   /api/v1/alerts          - Ingest single alert")
    print("  POST   /api/v1/alerts/batch    - Batch ingest alerts")
    print("  GET    /api/v1/alerts          - Query alerts with filters")
    print("  GET    /api/v1/alerts/stats    - Alert statistics")
    print("  GET    /api/v1/alerts/{id}     - Get alert by ID")
    print("  PATCH  /api/v1/alerts/{id}     - Update alert status")
    print("  DELETE /api/v1/alerts/{id}     - Soft delete alert")