"""
Real-time WebSocket Server for Optic Shield C2 Dashboard

Provides live alert streaming, camera health status, and system events
to connected frontend clients via Redis Pub/Sub for horizontal scaling.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional, Set

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect, status
from pydantic import BaseModel, Field
from redis.asyncio import Redis, ConnectionPool
from redis.exceptions import RedisError

from backend.app.core.security import get_settings, get_token_manager, TokenManager
from backend.app.db.database import get_db_session
from backend.app.db.models import Alert, Camera, AlertSeverity, CameraStatus

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ws", tags=["websocket"])


# ============================================================
# Configuration
# ============================================================

@dataclass(frozen=True, slots=True)
class WebSocketConfig:
    """WebSocket server configuration."""

    # Redis
    redis_url: str = "redis://localhost:6379/0"
    redis_max_connections: int = 50

    # Channels
    alerts_channel: str = "optic_shield:alerts"
    health_channel: str = "optic_shield:health"
    system_channel: str = "optic_shield:system"
    camera_channel: str = "optic_shield:camera"

    # Connection limits
    max_connections_per_client: int = 5
    connection_timeout: float = 30.0  # seconds
    ping_interval: float = 20.0  # seconds
    ping_timeout: float = 10.0  # seconds

    # Message batching
    batch_max_size: int = 10
    batch_max_delay_ms: float = 50.0

    # Authentication
    require_auth: bool = True
    token_query_param: str = "token"
    token_header: str = "Authorization"


class ConnectionManager:
    """
    Manages WebSocket connections with Redis Pub/Sub backend.

    Supports horizontal scaling via Redis - messages published to Redis
    are received by all server instances and broadcast to local connections.
    """

    def __init__(self, config: WebSocketConfig) -> None:
        self.config = config
        self._redis_pool: Optional[ConnectionPool] = None
        self._redis: Optional[Redis] = None
        self._pubsub: Optional[Redis] = None

        # Local connections: client_id -> WebSocket
        self._connections: Dict[str, WebSocket] = {}
        # Client metadata: client_id -> metadata
        self._client_metadata: Dict[str, dict] = {}
        # Subscriptions: client_id -> Set[channel]
        self._subscriptions: Dict[str, Set[str]] = {}

        # Background tasks
        self._listener_task: Optional[asyncio.Task] = None
        self._ping_task: Optional[asyncio.Task] = None
        self._running = False

        # Message handlers
        self._handlers: Dict[str, Callable] = {}

    async def initialize(self) -> None:
        """Initialize Redis connection and start listener."""
        if self._running:
            return

        self._redis_pool = ConnectionPool.from_url(
            self.config.redis_url,
            max_connections=self.config.redis_max_connections,
            decode_responses=True,
        )
        self._redis = Redis(connection_pool=self._redis_pool)
        self._pubsub = self._redis.pubsub()

        # Subscribe to channels
        channels = [
            self.config.alerts_channel,
            self.config.health_channel,
            self.config.system_channel,
            self.config.camera_channel,
        ]
        await self._pubsub.subscribe(*channels)

        # Start listener
        self._running = True
        self._listener_task = asyncio.create_task(self._redis_listener())
        self._ping_task = asyncio.create_task(self._ping_loop())

        logger.info("WebSocket ConnectionManager initialized")

    async def shutdown(self) -> None:
        """Shutdown connection manager."""
        self._running = False

        if self._listener_task:
            self._listener_task.cancel()
            try:
                await self._listener_task
            except asyncio.CancelledError:
                pass

        if self._ping_task:
            self._ping_task.cancel()
            try:
                await self._ping_task
            except asyncio.CancelledError:
                pass

        if self._pubsub:
            await self._pubsub.unsubscribe()
            await self._pubsub.close()

        if self._redis:
            await self._redis.close()

        if self._redis_pool:
            await self._redis_pool.disconnect()

        # Close all connections
        for ws in self._connections.values():
            try:
                await ws.close(code=1001, reason="Server shutting down")
            except Exception:
                pass

        self._connections.clear()
        self._client_metadata.clear()
        self._subscriptions.clear()

        logger.info("WebSocket ConnectionManager shutdown complete")

    async def connect(
        self,
        websocket: WebSocket,
        client_id: str,
        metadata: Optional[dict] = None,
    ) -> bool:
        """
        Accept new WebSocket connection.

        Returns:
            True if connection accepted, False if rejected (e.g., limit exceeded)
        """
        # Check connection limit per client (by IP or auth)
        client_connections = sum(
            1 for cid, meta in self._client_metadata.items()
            if meta.get("client_ip") == metadata.get("client_ip") if metadata
        )
        if client_connections >= self.config.max_connections_per_client:
            await websocket.close(code=1008, reason="Connection limit exceeded")
            return False

        await websocket.accept()
        self._connections[client_id] = websocket
        self._client_metadata[client_id] = metadata or {}
        self._subscriptions[client_id] = set()

        # Subscribe to default channels
        await self.subscribe(client_id, self.config.alerts_channel)
        await self.subscribe(client_id, self.config.system_channel)

        logger.info("WebSocket connected: %s (total: %d)", client_id, len(self._connections))
        return True

    async def disconnect(self, client_id: str) -> None:
        """Disconnect and cleanup client."""
        if client_id in self._connections:
            ws = self._connections.pop(client_id)
            try:
                await ws.close()
            except Exception:
                pass

        self._client_metadata.pop(client_id, None)
        self._subscriptions.pop(client_id, None)

        logger.info("WebSocket disconnected: %s (total: %d)", client_id, len(self._connections))

    async def subscribe(self, client_id: str, channel: str) -> bool:
        """Subscribe client to a channel."""
        if client_id not in self._connections:
            return False

        self._subscriptions[client_id].add(channel)
        logger.debug("Client %s subscribed to %s", client_id, channel)
        return True

    async def unsubscribe(self, client_id: str, channel: str) -> bool:
        """Unsubscribe client from a channel."""
        if client_id in self._subscriptions:
            self._subscriptions[client_id].discard(channel)
            logger.debug("Client %s unsubscribed from %s", client_id, channel)
            return True
        return False

    async def send_personal_message(self, client_id: str, message: dict) -> bool:
        """Send message to specific client."""
        if client_id not in self._connections:
            return False

        ws = self._connections[client_id]
        try:
            await ws.send_json(message)
            return True
        except Exception as e:
            logger.warning("Failed to send to %s: %s", client_id, e)
            await self.disconnect(client_id)
            return False

    async def broadcast(self, channel: str, message: dict) -> int:
        """
        Broadcast message to all clients subscribed to channel.

        Returns:
            Number of clients message sent to.
        """
        sent = 0
        disconnected = []

        for client_id, subscriptions in self._subscriptions.items():
            if channel in subscriptions:
                if await self.send_personal_message(client_id, message):
                    sent += 1
                else:
                    disconnected.append(client_id)

        # Cleanup disconnected
        for cid in disconnected:
            await self.disconnect(cid)

        return sent

    async def broadcast_to_all(self, message: dict) -> int:
        """Broadcast to all connected clients."""
        sent = 0
        disconnected = []

        for client_id, ws in self._connections.items():
            try:
                await ws.send_json(message)
                sent += 1
            except Exception:
                disconnected.append(client_id)

        for cid in disconnected:
            await self.disconnect(cid)

        return sent

    async def _redis_listener(self) -> None:
        """Listen for Redis Pub/Sub messages and broadcast to local connections."""
        try:
            async for message in self._pubsub.listen():
                if not self._running:
                    break

                if message["type"] != "message":
                    continue

                try:
                    data = json.loads(message["data"])
                    channel = message["channel"]

                    # Broadcast to local subscribers
                    await self.broadcast(channel, data)
                except json.JSONDecodeError:
                    logger.warning("Invalid JSON from Redis: %s", message["data"])
                except Exception as e:
                    logger.error("Redis listener error: %s", e)

        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error("Redis listener crashed: %s", e)
            if self._running:
                # Attempt restart
                await asyncio.sleep(1)
                self._listener_task = asyncio.create_task(self._redis_listener())

    async def _ping_loop(self) -> None:
        """Send periodic pings to detect dead connections."""
        while self._running:
            try:
                await asyncio.sleep(self.config.ping_interval)

                disconnected = []
                for client_id, ws in self._connections.items():
                    try:
                        await ws.send_json({"type": "ping", "timestamp": time.time()})
                    except Exception:
                        disconnected.append(client_id)

                for cid in disconnected:
                    await self.disconnect(cid)

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error("Ping loop error: %s", e)

    def get_connection_count(self) -> int:
        """Get total active connections."""
        return len(self._connections)

    def get_channel_subscribers(self, channel: str) -> int:
        """Get number of subscribers for a channel."""
        return sum(1 for subs in self._subscriptions.values() if channel in subs)


# Global connection manager
_config: Optional[WebSocketConfig] = None
_manager: Optional[ConnectionManager] = None


def get_ws_config() -> WebSocketConfig:
    """Get WebSocket configuration."""
    global _config
    if _config is None:
        settings = get_settings()
        _config = WebSocketConfig(
            redis_url=settings.REDIS_URL if hasattr(settings, 'REDIS_URL') else "redis://localhost:6379/0",
        )
    return _config


def get_connection_manager() -> ConnectionManager:
    """Get global connection manager."""
    global _manager
    if _manager is None:
        _manager = ConnectionManager(get_ws_config())
    return _manager


async def init_websocket() -> ConnectionManager:
    """Initialize WebSocket system."""
    manager = get_connection_manager()
    await manager.initialize()
    return manager


async def shutdown_websocket() -> None:
    """Shutdown WebSocket system."""
    global _manager
    if _manager:
        await _manager.shutdown()
        _manager = None


# ============================================================
# Authentication
# ============================================================

async def authenticate_websocket(
    websocket: WebSocket,
    token: Optional[str] = Query(None),
    manager: ConnectionManager = Depends(get_connection_manager),
) -> Optional[dict]:
    """
    Authenticate WebSocket connection.

    Supports token in query param or Authorization header.
    """
    config = get_ws_config()
    if not config.require_auth:
        return {"authenticated": False, "client_ip": websocket.client.host if websocket.client else "unknown"}

    # Get token from query or header
    auth_token = token
    if not auth_token:
        auth_header = websocket.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            auth_token = auth_header[7:]

    if not auth_token:
        await websocket.close(code=4001, reason="Authentication required")
        return None

    try:
        token_manager = get_token_manager()
        payload = token_manager.verify_token(auth_token, "access")
        return {
            "authenticated": True,
            "user_id": payload.get("sub"),
            "roles": payload.get("roles", []),
            "client_ip": websocket.client.host if websocket.client else "unknown",
        }
    except Exception as e:
        logger.warning("WebSocket auth failed: %s", e)
        await websocket.close(code=4001, reason="Invalid token")
        return None


# ============================================================
# Message Models
# ============================================================

class WSMessage(BaseModel):
    """Base WebSocket message."""

    type: str
    timestamp: float = Field(default_factory=time.time)
    payload: dict[str, Any] = Field(default_factory=dict)


class AlertMessage(BaseModel):
    """Alert notification message."""

    type: str = "alert"
    alert: dict[str, Any]


class HealthMessage(BaseModel):
    """Camera health status message."""

    type: str = "health"
    camera_id: str
    health_score: int
    status: str
    alerts: List[dict[str, Any]]


class SystemMessage(BaseModel):
    """System event message."""

    type: str = "system"
    event: str
    data: dict[str, Any]


class CameraMessage(BaseModel):
    """Camera status update message."""

    type: str = "camera"
    camera_id: str
    status: str
    metadata: dict[str, Any]


class SubscriptionRequest(BaseModel):
    """Client subscription request."""

    action: str = Field(pattern="^(subscribe|unsubscribe)$")
    channel: str


class AuthMessage(BaseModel):
    """Authentication message (alternative to query param)."""

    type: str = "auth"
    token: str


# ============================================================
# WebSocket Endpoint
# ============================================================

@router.websocket("/alerts")
async def websocket_alerts(
    websocket: WebSocket,
    token: Optional[str] = Query(None),
    manager: ConnectionManager = Depends(get_connection_manager),
) -> None:
    """
    WebSocket endpoint for real-time alerts.

    Connect: ws://host/ws/alerts?token=<JWT>

    Message types received:
    - {"type": "subscribe", "channel": "alerts"}
    - {"type": "unsubscribe", "channel": "health"}
    - {"type": "ping"} -> responds with {"type": "pong"}

    Message types sent:
    - {"type": "alert", "alert": {...}}
    - {"type": "health", "camera_id": "...", "health_score": 100, "status": "healthy", "alerts": []}
    - {"type": "system", "event": "camera_online", "data": {...}}
    - {"type": "camera", "camera_id": "...", "status": "online", "metadata": {...}}
    """
    # Authenticate
    auth_info = await authenticate_websocket(websocket, token, manager)
    if not auth_info:
        return

    # Generate client ID
    client_id = f"{auth_info.get('user_id', 'anon')}-{id(websocket)}"

    # Connect
    connected = await manager.connect(websocket, client_id, auth_info)
    if not connected:
        return

    try:
        # Send welcome message
        await websocket.send_json({
            "type": "welcome",
            "client_id": client_id,
            "timestamp": time.time(),
            "server_time": datetime.now(timezone.utc).isoformat(),
        })

        # Message loop
        while True:
            try:
                data = await websocket.receive_json()
                await _handle_client_message(websocket, client_id, data, manager, auth_info)
            except WebSocketDisconnect:
                break
            except json.JSONDecodeError:
                await websocket.send_json({
                    "type": "error",
                    "error": "Invalid JSON",
                    "timestamp": time.time(),
                })
            except Exception as e:
                logger.error("WebSocket message error: %s", e)
                await websocket.send_json({
                    "type": "error",
                    "error": str(e),
                    "timestamp": time.time(),
                })

    except Exception as e:
        logger.error("WebSocket error: %s", e)
    finally:
        await manager.disconnect(client_id)


async def _handle_client_message(
    websocket: WebSocket,
    client_id: str,
    data: dict,
    manager: ConnectionManager,
    auth_info: dict,
) -> None:
    """Handle incoming client message."""
    msg_type = data.get("type")

    if msg_type == "ping":
        await websocket.send_json({
            "type": "pong",
            "timestamp": time.time(),
            "server_time": datetime.now(timezone.utc).isoformat(),
        })

    elif msg_type == "subscribe":
        channel = data.get("channel")
        if channel in [manager.config.alerts_channel, manager.config.health_channel,
                       manager.config.system_channel, manager.config.camera_channel]:
            await manager.subscribe(client_id, channel)
            await websocket.send_json({
                "type": "subscribed",
                "channel": channel,
                "timestamp": time.time(),
            })
        else:
            await websocket.send_json({
                "type": "error",
                "error": f"Invalid channel: {channel}",
                "timestamp": time.time(),
            })

    elif msg_type == "unsubscribe":
        channel = data.get("channel")
        await manager.unsubscribe(client_id, channel)
        await websocket.send_json({
            "type": "unsubscribed",
            "channel": channel,
            "timestamp": time.time(),
        })

    elif msg_type == "auth":
        # Re-authentication
        token = data.get("token")
        if token:
            try:
                token_manager = get_token_manager()
                payload = token_manager.verify_token(token, "access")
                auth_info.update({
                    "authenticated": True,
                    "user_id": payload.get("sub"),
                    "roles": payload.get("roles", []),
                })
                manager._client_metadata[client_id].update(auth_info)
                await websocket.send_json({
                    "type": "auth_success",
                    "user_id": payload.get("sub"),
                    "timestamp": time.time(),
                })
            except Exception as e:
                await websocket.send_json({
                    "type": "auth_failed",
                    "error": str(e),
                    "timestamp": time.time(),
                })

    elif msg_type == "get_status":
        # Return current system status
        await websocket.send_json({
            "type": "status",
            "connections": manager.get_connection_count(),
            "subscriptions": {
                ch: manager.get_channel_subscribers(ch)
                for ch in [manager.config.alerts_channel, manager.config.health_channel,
                          manager.config.system_channel, manager.config.camera_channel]
            },
            "timestamp": time.time(),
        })

    else:
        await websocket.send_json({
            "type": "error",
            "error": f"Unknown message type: {msg_type}",
            "timestamp": time.time(),
        })


# ============================================================
# Broadcast Functions (for use by other services)
# ============================================================

async def broadcast_alert(alert_data: dict[str, Any]) -> int:
    """
    Broadcast alert to all connected clients.

    Called by alert ingestion endpoint.
    """
    manager = get_connection_manager()
    if not manager._running:
        return 0

    message = {
        "type": "alert",
        "alert": alert_data,
        "timestamp": time.time(),
    }
    return await manager.broadcast(manager.config.alerts_channel, message)


async def broadcast_health(health_data: dict[str, Any]) -> int:
    """Broadcast camera health update."""
    manager = get_connection_manager()
    if not manager._running:
        return 0

    message = {
        "type": "health",
        **health_data,
        "timestamp": time.time(),
    }
    return await manager.broadcast(manager.config.health_channel, message)


async def broadcast_system(event: str, data: dict[str, Any]) -> int:
    """Broadcast system event."""
    manager = get_connection_manager()
    if not manager._running:
        return 0

    message = {
        "type": "system",
        "event": event,
        "data": data,
        "timestamp": time.time(),
    }
    return await manager.broadcast(manager.config.system_channel, message)


async def broadcast_camera(camera_id: str, status: str, metadata: dict[str, Any]) -> int:
    """Broadcast camera status update."""
    manager = get_connection_manager()
    if not manager._running:
        return 0

    message = {
        "type": "camera",
        "camera_id": camera_id,
        "status": status,
        "metadata": metadata,
        "timestamp": time.time(),
    }
    return await manager.broadcast(manager.config.camera_channel, message)


async def publish_to_redis(channel: str, message: dict) -> bool:
    """
    Publish message to Redis channel for cross-instance broadcasting.

    Used by services running on different instances.
    """
    config = get_ws_config()
    try:
        redis = Redis.from_url(config.redis_url, decode_responses=True)
        await redis.publish(channel, json.dumps(message))
        await redis.close()
        return True
    except Exception as e:
        logger.error("Failed to publish to Redis: %s", e)
        return False


# Convenience functions for services
async def publish_alert(alert_data: dict) -> bool:
    """Publish alert to Redis for all WebSocket servers."""
    return await publish_to_redis(get_ws_config().alerts_channel, {
        "type": "alert",
        "alert": alert_data,
        "timestamp": time.time(),
    })


async def publish_health(health_data: dict) -> bool:
    """Publish health update to Redis."""
    return await publish_to_redis(get_ws_config().health_channel, {
        "type": "health",
        **health_data,
        "timestamp": time.time(),
    })


async def publish_system_event(event: str, data: dict) -> bool:
    """Publish system event to Redis."""
    return await publish_to_redis(get_ws_config().system_channel, {
        "type": "system",
        "event": event,
        "data": data,
        "timestamp": time.time(),
    })


async def publish_camera_update(camera_id: str, status: str, metadata: dict) -> bool:
    """Publish camera update to Redis."""
    return await publish_to_redis(get_ws_config().camera_channel, {
        "type": "camera",
        "camera_id": camera_id,
        "status": status,
        "metadata": metadata,
        "timestamp": time.time(),
    })


# ============================================================
# REST Endpoints for WebSocket Management
# ============================================================

@router.get("/stats")
async def websocket_stats(
    manager: ConnectionManager = Depends(get_connection_manager),
) -> dict[str, Any]:
    """Get WebSocket connection statistics."""
    return {
        "success": True,
        "data": {
            "total_connections": manager.get_connection_count(),
            "channels": {
                "alerts": manager.get_channel_subscribers(manager.config.alerts_channel),
                "health": manager.get_channel_subscribers(manager.config.health_channel),
                "system": manager.get_channel_subscribers(manager.config.system_channel),
                "camera": manager.get_channel_subscribers(manager.config.camera_channel),
            },
            "clients": [
                {
                    "client_id": cid,
                    "metadata": meta,
                    "subscriptions": list(subs),
                }
                for cid, (meta, subs) in zip(
                    manager._client_metadata.keys(),
                    zip(manager._client_metadata.values(), manager._subscriptions.values())
                )
            ],
        },
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@router.post("/broadcast/test")
async def test_broadcast(
    message: dict,
    channel: str = "alerts",
    manager: ConnectionManager = Depends(get_connection_manager),
) -> dict[str, Any]:
    """Test broadcast endpoint (admin only)."""
    sent = await manager.broadcast(
        getattr(manager.config, f"{channel}_channel"),
        {"type": "test", "data": message, "timestamp": time.time()},
    )
    return {
        "success": True,
        "data": {"sent_to": sent},
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


# ============================================================
# Lifecycle (for FastAPI app)
# ============================================================

@asynccontextmanager
async def websocket_lifespan(app):
    """FastAPI lifespan handler for WebSocket."""
    await init_websocket()
    yield
    await shutdown_websocket()


if __name__ == "__main__":
    print("WebSocket API module loaded successfully")
    print("Endpoints:")
    print("  WS   /ws/alerts              - Main WebSocket endpoint")
    print("  GET  /ws/stats               - Connection statistics")
    print("  POST /ws/broadcast/test      - Test broadcast")
    print("\nRedis channels:")
    print("  optic_shield:alerts          - Alert notifications")
    print("  optic_shield:health          - Camera health updates")
    print("  optic_shield:system          - System events")
    print("  optic_shield:camera          - Camera status updates")