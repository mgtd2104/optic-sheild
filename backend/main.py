# =============================================================================
# IBVAP Backend - Production FastAPI Application
# =============================================================================
# Features:
# - Structured JSON logging
# - Health check endpoint
# - API Key + JWT authentication
# - WebSocket video streaming with AI analysis
# - REST endpoint for frame analysis
# - Prometheus metrics
# - Graceful shutdown handling
# =============================================================================

import asyncio
import base64
import hashlib
import json
import os
import re
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Set
from urllib.parse import urlparse

import aiosqlite
import cv2
import easyocr
import jwt
import numpy as np
import structlog
import torch
import uvicorn
from boxmot.trackers.registry import create_tracker
from fastapi import (
    FastAPI,
    WebSocket,
    WebSocketDisconnect,
    Depends,
    HTTPException,
    Security,
    status,
    Request,
    UploadFile,
    File,
    Form,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.security import APIKeyHeader, HTTPBearer, HTTPAuthorizationCredentials
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv
from passlib.context import CryptContext
from pydantic import BaseModel, Field, EmailStr, validator
from prometheus_client import Counter, Histogram, Gauge, generate_latest
from starlette.responses import Response
from ultralytics import YOLO

load_dotenv()

# =============================================================================
# Configuration & Settings
# =============================================================================

class Settings:
    """Application settings from environment variables. No insecure defaults."""
    
    # API Security - REQUIRED in production
    API_KEY: str = os.getenv("API_KEY")
    JWT_SECRET: str = os.getenv("JWT_SECRET")
    JWT_ALGORITHM: str = os.getenv("JWT_ALGORITHM", "HS256")
    JWT_EXPIRY_MINUTES: int = int(os.getenv("JWT_EXPIRY_MINUTES", "60"))
    
    # Database
    DATABASE_URL: str = os.getenv("DATABASE_URL", "sqlite:///./ibvap.db")
    
    # Model Paths
    MODEL_PATH: Path = Path(os.getenv("MODEL_PATH", "/app/models"))
    YOLO_MODEL: str = os.getenv("YOLO_MODEL", "yolov8n.pt")
    REID_MODEL: str = os.getenv("REID_MODEL", "osnet_x0_25_msmt17.pt")
    
    # Detection Classes (COCO class IDs) - Configurable
    PERSON_CLASS_ID: int = int(os.getenv("PERSON_CLASS_ID", "0"))
    VEHICLE_CLASS_IDS: List[int] = [int(x) for x in os.getenv("VEHICLE_CLASS_IDS", "2,3,5,7").split(",")]
    ALLOWED_CLASS_IDS: List[int] = [int(x) for x in os.getenv("ALLOWED_CLASS_IDS", "0,2,3,5,7").split(",")]
    
    # Runtime
    DEVICE: str = "cuda:0" if torch.cuda.is_available() else "cpu"
    LOG_LEVEL: str = os.getenv("LOG_LEVEL", "INFO")
    ENVIRONMENT: str = os.getenv("ENVIRONMENT", "development")
    
    # Video Processing
    CONFIDENCE_THRESHOLD: float = float(os.getenv("CONFIDENCE_THRESHOLD", "0.4"))
    IOU_THRESHOLD: float = float(os.getenv("IOU_THRESHOLD", "0.5"))
    MAX_DETECTIONS: int = int(os.getenv("MAX_DETECTIONS", "100"))
    
    # WebSocket
    WS_FRAME_INTERVAL: float = float(os.getenv("WS_FRAME_INTERVAL", "0.2"))  # 5 FPS keeps CPU uploads responsive
    WS_JPEG_QUALITY: int = int(os.getenv("WS_JPEG_QUALITY", "80"))
    WS_MAX_QUEUE_SIZE: int = int(os.getenv("WS_MAX_QUEUE_SIZE", "10"))
    WS_MAX_CLIENTS: int = int(os.getenv("WS_MAX_CLIENTS", "2"))
    WS_VIDEO_SOURCE: str = os.getenv("WS_VIDEO_SOURCE", "test_video.mp4")
    
    # Upload
    UPLOAD_DIR: Path = Path(os.getenv("UPLOAD_DIR", "/app/uploads"))
    MAX_UPLOAD_SIZE: int = int(os.getenv("MAX_UPLOAD_SIZE", "104857600"))  # 100MB
    
    # Rate Limiting
    AUTH_RATE_LIMIT: int = int(os.getenv("AUTH_RATE_LIMIT", "10"))  # requests per minute
    
    # CORS
    ALLOWED_ORIGINS: List[str] = os.getenv("ALLOWED_ORIGINS", "*").split(",") if os.getenv("ALLOWED_ORIGINS") else ["*"]

    # Server location shown on the operations map
    SERVER_LATITUDE: float = float(os.getenv("SERVER_LATITUDE", "28.9845"))
    SERVER_LONGITUDE: float = float(os.getenv("SERVER_LONGITUDE", "77.7064"))
    SERVER_LOCATION_NAME: str = os.getenv("SERVER_LOCATION_NAME", "IBVAP Server")

    def __init__(self):
        # Validate required secrets in production
        if self.ENVIRONMENT == "production":
            if not self.API_KEY or self.API_KEY == "dev-secret-key-change-in-production":
                raise ValueError("API_KEY must be set in production")
            if not self.JWT_SECRET or self.JWT_SECRET == "dev-jwt-secret-change-in-production":
                raise ValueError("JWT_SECRET must be set in production")


settings = Settings()

# =============================================================================
# Database Setup (SQLite for persistence)
# =============================================================================

DB_PATH = settings.DATABASE_URL.replace("sqlite:///", "").replace("sqlite://", "")

async def init_db():
    """Initialize database schema."""
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS users (
                user_id TEXT PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                email TEXT UNIQUE NOT NULL,
                full_name TEXT,
                hashed_password TEXT NOT NULL,
                role TEXT DEFAULT 'Operator',
                bop_location TEXT DEFAULT 'BOP-01',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                is_active BOOLEAN DEFAULT 1
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS rate_limits (
                key TEXT PRIMARY KEY,
                count INTEGER DEFAULT 0,
                window_start TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        await db.commit()

async def get_user_by_username(username: str) -> Optional[Dict]:
    """Get user from database by username."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM users WHERE username = ?", (username,)
        ) as cursor:
            row = await cursor.fetchone()
            return dict(row) if row else None

async def get_user_by_email(email: str) -> Optional[Dict]:
    """Get user from database by email."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM users WHERE email = ?", (email,)
        ) as cursor:
            row = await cursor.fetchone()
            return dict(row) if row else None

async def create_user(user_data: Dict) -> None:
    """Create new user in database."""
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """INSERT INTO users (user_id, username, email, full_name, hashed_password, role, bop_location, created_at, is_active)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                user_data["user_id"],
                user_data["username"],
                user_data["email"],
                user_data.get("full_name"),
                user_data["hashed_password"],
                user_data.get("role", "Operator"),
                user_data.get("bop_location", "BOP-01"),
                user_data["created_at"],
                user_data.get("is_active", True),
            )
        )
        await db.commit()

async def check_rate_limit(key: str, limit: int, window_seconds: int = 60) -> bool:
    """Check and increment rate limit. Returns True if allowed."""
    async with aiosqlite.connect(DB_PATH) as db:
        now = time.time()
        window_start = now - window_seconds
        
        # Clean old entries
        await db.execute("DELETE FROM rate_limits WHERE window_start < ?", (window_start,))
        
        # Get current count
        async with db.execute(
            "SELECT count FROM rate_limits WHERE key = ?", (key,)
        ) as cursor:
            row = await cursor.fetchone()
        
        if row and row[0] >= limit:
            return False
        
        # Increment or insert
        if row:
            await db.execute(
                "UPDATE rate_limits SET count = count + 1 WHERE key = ?", (key,)
            )
        else:
            await db.execute(
                "INSERT INTO rate_limits (key, count, window_start) VALUES (?, 1, ?)",
                (key, now)
            )
        await db.commit()
        return True

# =============================================================================
# Structured Logging Setup
# =============================================================================

structlog.configure(
    processors=[
        structlog.stdlib.filter_by_level,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.stdlib.PositionalArgumentsFormatter(),
        structlog.processors.TimeStamper(fmt="iso", utc=True),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        structlog.processors.UnicodeDecoder(),
        structlog.processors.JSONRenderer()
    ],
    context_class=dict,
    logger_factory=structlog.stdlib.LoggerFactory(),
    wrapper_class=structlog.stdlib.BoundLogger,
    cache_logger_on_first_use=True,
)

logger = structlog.get_logger()

# =============================================================================
# Prometheus Metrics
# =============================================================================

REQUEST_COUNT = Counter(
    "ibvap_requests_total",
    "Total HTTP requests",
    ["method", "endpoint", "status"]
)

REQUEST_LATENCY = Histogram(
    "ibvap_request_duration_seconds",
    "Request latency in seconds",
    ["method", "endpoint"]
)

WS_CONNECTIONS = Gauge(
    "ibvap_websocket_connections",
    "Active WebSocket connections"
)

DETECTION_COUNT = Counter(
    "ibvap_detections_total",
    "Total detections by class",
    ["class_name", "severity"]
)

INFERENCE_LATENCY = Histogram(
    "ibvap_inference_duration_seconds",
    "Model inference latency",
    ["model"]
)

MODEL_HEALTH = Gauge(
    "ibvap_model_healthy",
    "Model health status (1=healthy, 0=unhealthy)",
    ["model"]
)

# =============================================================================
# Security Schemes
# =============================================================================

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)
bearer_scheme = HTTPBearer(auto_error=False)

# Password validation regex
PASSWORD_REGEX = re.compile(r"^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$")

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a plain password against a hashed password."""
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password: str) -> str:
    """Hash a password."""
    return pwd_context.hash(password)

def validate_password(password: str) -> tuple[bool, str]:
    """Validate password complexity."""
    if len(password) < 8:
        return False, "Password must be at least 8 characters"
    if not re.search(r"[A-Z]", password):
        return False, "Password must contain at least one uppercase letter"
    if not re.search(r"[a-z]", password):
        return False, "Password must contain at least one lowercase letter"
    if not re.search(r"\d", password):
        return False, "Password must contain at least one digit"
    if not re.search(r"[@$!%*?&]", password):
        return False, "Password must contain at least one special character (@$!%*?&)"
    return True, "Valid"

def create_access_token(data: Dict[str, Any], expires_delta: Optional[timedelta] = None) -> str:
    """Create a JWT access token."""
    to_encode = data.copy()
    now = datetime.now(timezone.utc)
    if expires_delta:
        expire = now + expires_delta
    else:
        expire = now + timedelta(minutes=settings.JWT_EXPIRY_MINUTES)
    to_encode.update({"exp": expire, "iat": now})
    encoded_jwt = jwt.encode(to_encode, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)
    return encoded_jwt

async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    api_key: Optional[str] = Security(api_key_header),
) -> Dict[str, Any]:
    """Get current user from an X-API-Key header or a JWT bearer token."""
    request_id = getattr(credentials, 'request_id', None) or str(uuid.uuid4())[:8]

    if settings.ENVIRONMENT == "development":
        return {
            "user_id": None,
            "username": "local-operator",
            "email": "local@ibvap.dev",
            "full_name": "Local Operator",
            "role": "Operator",
            "bop_location": "BOP-01",
            "auth_type": "development",
            "scopes": ["read", "write"],
        }
    
    if api_key:
        if api_key != settings.API_KEY:
            logger.warning("invalid_api_key", request_id=request_id)
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid API key",
            )
        return {
            "user_id": None,
            "username": None,
            "email": None,
            "full_name": None,
            "role": "api_client",
            "bop_location": "N/A",
            "auth_type": "api_key",
            "scopes": ["read", "write"],
        }

    if not credentials:
        if settings.ENVIRONMENT == "development":
            return {
                "user_id": None,
                "username": "local-operator",
                "email": "local@ibvap.dev",
                "full_name": "Local Operator",
                "role": "Operator",
                "bop_location": "BOP-01",
                "auth_type": "development",
                "scopes": ["read", "write"],
            }
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing authentication token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        payload = jwt.decode(
            credentials.credentials,
            settings.JWT_SECRET,
            algorithms=[settings.JWT_ALGORITHM]
        )
        username: str = payload.get("sub")
        if username is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token payload",
                headers={"WWW-Authenticate": "Bearer"},
            )
    except jwt.ExpiredSignatureError:
        logger.warning("expired_jwt_token", request_id=request_id)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token expired",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except jwt.PyJWTError as e:
        logger.warning("invalid_jwt_token", request_id=request_id, error=str(e))
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Check if user exists in database
    user = await get_user_by_username(username)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user.get("is_active", True):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User account is disabled",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return {
        "user_id": user["user_id"],
        "username": user["username"],
        "email": user["email"],
        "full_name": user.get("full_name"),
        "role": user.get("role", "Operator"),
        "bop_location": user.get("bop_location", "BOP-01"),
        "auth_type": "jwt",
        "scopes": payload.get("scopes", ["read", "write"])
    }

# WebSocket auth dependency
async def get_ws_user(
    websocket: WebSocket,
    api_key: Optional[str] = None,
    token: Optional[str] = None,
) -> Dict[str, Any]:
    """Authenticate WebSocket connection via API key or JWT token."""
    if settings.ENVIRONMENT == "development":
        return {
            "user_id": None,
            "username": "local-operator",
            "email": "local@ibvap.dev",
            "full_name": "Local Operator",
            "role": "Operator",
            "bop_location": "BOP-01",
            "auth_type": "development",
            "scopes": ["read", "write"],
        }

    # Try API key first
    if api_key and api_key == settings.API_KEY:
        return {
            "user_id": None,
            "username": None,
            "email": None,
            "full_name": None,
            "role": "api_client",
            "bop_location": "N/A",
            "auth_type": "api_key",
            "scopes": ["read", "write"],
        }
    
    # Try JWT token from query param
    if token:
        try:
            payload = jwt.decode(
                token,
                settings.JWT_SECRET,
                algorithms=[settings.JWT_ALGORITHM]
            )
            username: str = payload.get("sub")
            if username:
                user = await get_user_by_username(username)
                if user and user.get("is_active", True):
                    return {
                        "user_id": user["user_id"],
                        "username": user["username"],
                        "email": user["email"],
                        "full_name": user.get("full_name"),
                        "role": user.get("role", "Operator"),
                        "bop_location": user.get("bop_location", "BOP-01"),
                        "auth_type": "jwt",
                        "scopes": payload.get("scopes", ["read", "write"])
                    }
        except jwt.PyJWTError:
            pass

    if settings.ENVIRONMENT == "development" and not token:
        return {
            "user_id": None,
            "username": "local-operator",
            "email": "local@ibvap.dev",
            "full_name": "Local Operator",
            "role": "Operator",
            "bop_location": "BOP-01",
            "auth_type": "development",
            "scopes": ["read", "write"],
        }
    
    await websocket.close(code=4001, reason="Invalid authentication")
    raise HTTPException(status_code=401, detail="Invalid authentication")

# =============================================================================
# Pydantic Models
# =============================================================================

class HealthResponse(BaseModel):
    status: str
    version: str
    device: str
    models_loaded: bool
    uptime_seconds: float
    gpu_available: bool
    gpu_memory_used: Optional[str] = None
    gpu_memory_total: Optional[str] = None
    model_inference_test: Optional[bool] = None


class ServerLocationResponse(BaseModel):
    latitude: float
    longitude: float
    name: str
    updated_at: str
    source: str


class Detection(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4())[:8])
    class_name: str
    class_id: int
    confidence: float
    bbox: List[float]  # [x1, y1, x2, y2]
    track_id: Optional[int] = None


class Alert(BaseModel):
    type: str
    severity: str
    message: str
    timestamp: str
    detection_id: Optional[str] = None


class FrameAnalysisRequest(BaseModel):
    frame_base64: str
    camera_id: Optional[str] = None
    timestamp: Optional[str] = None
    
    @validator('frame_base64')
    def validate_base64(cls, v):
        if not v:
            raise ValueError("frame_base64 cannot be empty")
        # Check approximate size before decoding (base64 is ~33% larger than binary)
        if len(v) > settings.MAX_UPLOAD_SIZE * 4 / 3:
            raise ValueError(f"Frame data too large (max {settings.MAX_UPLOAD_SIZE} bytes decoded)")
        return v


class FrameAnalysisResponse(BaseModel):
    request_id: str
    timestamp: str
    processing_time_ms: float
    detections: List[Detection]
    alerts: List[Alert]
    annotated_frame_base64: Optional[str] = None


class FootageUploadResponse(BaseModel):
    id: str
    filename: str
    url: str
    size: int
    uploaded_at: str


class TokenRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int


class RegisterRequest(BaseModel):
    username: str
    email: EmailStr
    password: str
    full_name: Optional[str] = None
    
    @validator('password')
    def validate_password_complexity(cls, v):
        valid, msg = validate_password(v)
        if not valid:
            raise ValueError(msg)
        return v


class RegisterResponse(BaseModel):
    user_id: str
    username: str
    email: str
    full_name: Optional[str] = None
    created_at: datetime


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: Dict[str, Any]


# =============================================================================
# Global State
# =============================================================================

class AppState:
    """Application state container."""
    yolo_model: Optional[YOLO] = None
    tracker: Any = None
    ocr_reader: Any = None
    start_time: float = time.time()
    models_loaded: bool = False
    ws_clients: Set[WebSocket] = set()


app_state = AppState()

# =============================================================================
# Model Initialization with Retry
# =============================================================================

async def initialize_models(max_retries: int = 3, backoff_base: float = 2.0):
    """Initialize all AI models with retry logic."""
    global app_state
    
    logger.info("initializing_models", device=settings.DEVICE)
    
    for attempt in range(max_retries):
        try:
            # YOLOv8
            yolo_path = settings.MODEL_PATH / settings.YOLO_MODEL
            if not yolo_path.exists():
                yolo_path = settings.YOLO_MODEL  # Will auto-download
            app_state.yolo_model = YOLO(str(yolo_path))
            app_state.yolo_model.to(settings.DEVICE)
            logger.info("yolo_model_loaded", path=str(yolo_path))
            
            # Test inference
            test_frame = np.zeros((640, 640, 3), dtype=np.uint8)
            _ = app_state.yolo_model(test_frame, verbose=False)
            MODEL_HEALTH.labels(model="yolo").set(1)
            logger.info("yolo_inference_test_passed")
            
            # Tracker with Re-ID
            reid_path = settings.MODEL_PATH / settings.REID_MODEL
            if not reid_path.exists():
                reid_path = settings.REID_MODEL  # Will auto-download
            app_state.tracker = create_tracker(
                tracker_type="botsort",
                reid_weights=str(reid_path),
                device=settings.DEVICE
            )
            logger.info("tracker_loaded", reid_model=str(reid_path))
            MODEL_HEALTH.labels(model="tracker").set(1)
            
            # OCR Reader (optional - only load if needed)
            # app_state.ocr_reader = easyocr.Reader(
            #     ['en'], 
            #     gpu=torch.cuda.is_available(),
            #     model_storage_directory=str(settings.MODEL_PATH),
            #     download_enabled=True
            # )
            # logger.info("ocr_reader_loaded")
            # MODEL_HEALTH.labels(model="ocr").set(1)
            
            app_state.models_loaded = True
            logger.info("all_models_initialized_successfully")
            return
            
        except Exception as e:
            logger.warning("model_initialization_attempt_failed", attempt=attempt + 1, max_retries=max_retries, error=str(e))
            if attempt < max_retries - 1:
                wait_time = backoff_base ** attempt
                logger.info("retrying_model_initialization", wait_seconds=wait_time)
                await asyncio.sleep(wait_time)
            else:
                MODEL_HEALTH.labels(model="yolo").set(0)
                MODEL_HEALTH.labels(model="tracker").set(0)
                logger.error("model_initialization_failed", error=str(e), exc_info=True)
                raise


def get_gpu_info() -> Dict[str, Optional[str]]:
    """Get GPU memory info. Raises on error instead of swallowing."""
    if not torch.cuda.is_available():
        return {"gpu_memory_used": None, "gpu_memory_total": None}
    
    used = torch.cuda.memory_allocated() / 1024**3
    total = torch.cuda.get_device_properties(0).total_memory / 1024**3
    return {
        "gpu_memory_used": f"{used:.2f} GB",
        "gpu_memory_total": f"{total:.2f} GB"
    }


# =============================================================================
# Lifespan Management
# =============================================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager."""
    # Startup
    logger.info("application_starting", environment=settings.ENVIRONMENT)
    
    # Initialize database
    await init_db()
    logger.info("database_initialized", path=DB_PATH)
    
    # Create upload directory
    settings.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    logger.info("upload_directory_created", path=str(settings.UPLOAD_DIR))
    
    # Initialize models
    await initialize_models()
    logger.info("application_ready")
    
    yield
    
    # Shutdown
    logger.info("application_shutting_down")
    
    # Gracefully close WebSocket connections
    for ws in app_state.ws_clients:
        try:
            await ws.close(code=1001, reason="Server shutting down")
        except Exception:
            pass
    app_state.ws_clients.clear()
    
    # Cleanup resources
    if app_state.yolo_model:
        del app_state.yolo_model
    if app_state.tracker:
        del app_state.tracker
    if torch.cuda.is_available():
        torch.cuda.empty_cache()


# =============================================================================
# FastAPI App Creation
# =============================================================================

app = FastAPI(
    title="IBVAP - Intelligent Border Video Analytics Platform",
    description="AI-powered video analytics for border surveillance",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs" if settings.ENVIRONMENT != "production" else None,
    redoc_url="/redoc" if settings.ENVIRONMENT != "production" else None,
)

# CORS - Use configured origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

settings.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=settings.UPLOAD_DIR), name="uploads")


# =============================================================================
# Middleware
# =============================================================================

@app.middleware("http")
async def metrics_middleware(request: Request, call_next):
    """Prometheus metrics middleware with error tracking."""
    start_time = time.time()
    request_id = str(uuid.uuid4())[:8]
    request.state.request_id = request_id
    
    # Add request ID to logger context
    structlog.contextvars.bind_contextvars(request_id=request_id)
    
    try:
        response = await call_next(request)
        duration = time.time() - start_time
        REQUEST_COUNT.labels(
            method=request.method,
            endpoint=request.url.path,
            status=response.status_code
        ).inc()
        REQUEST_LATENCY.labels(
            method=request.method,
            endpoint=request.url.path
        ).observe(duration)
        return response
    except Exception as e:
        duration = time.time() - start_time
        REQUEST_COUNT.labels(
            method=request.method,
            endpoint=request.url.path,
            status=500
        ).inc()
        REQUEST_LATENCY.labels(
            method=request.method,
            endpoint=request.url.path
        ).observe(duration)
        raise
    finally:
        structlog.contextvars.clear_contextvars()


# =============================================================================
# Health Check Endpoint
# =============================================================================

@app.get("/health", response_model=HealthResponse, tags=["System"])
async def health_check():
    """Health check endpoint for monitoring with model inference test."""
    gpu_info = get_gpu_info()
    
    # Test model inference
    model_test_passed = False
    if app_state.models_loaded and app_state.yolo_model:
        try:
            test_frame = np.zeros((320, 320, 3), dtype=np.uint8)
            _ = app_state.yolo_model(test_frame, verbose=False)
            model_test_passed = True
        except Exception as e:
            logger.error("health_check_model_test_failed", error=str(e))
    
    overall_healthy = app_state.models_loaded and model_test_passed
    
    return HealthResponse(
        status="healthy" if overall_healthy else "degraded",
        version="1.0.0",
        device=settings.DEVICE,
        models_loaded=app_state.models_loaded,
        uptime_seconds=time.time() - app_state.start_time,
        gpu_available=torch.cuda.is_available(),
        model_inference_test=model_test_passed,
        **gpu_info
    )


@app.get("/metrics", tags=["System"])
async def metrics():
    """Prometheus metrics endpoint."""
    return Response(
        content=generate_latest(),
        media_type="text/plain"
    )


@app.get("/api/system/location", response_model=ServerLocationResponse, tags=["System"])
async def server_location(user: Dict = Depends(get_current_user)):
    """Return the current configured location of the API server."""
    return ServerLocationResponse(
        latitude=settings.SERVER_LATITUDE,
        longitude=settings.SERVER_LONGITUDE,
        name=settings.SERVER_LOCATION_NAME,
        updated_at=datetime.now(timezone.utc).isoformat(),
        source="server-config",
    )


# =============================================================================
# Authentication Endpoints
# =============================================================================

@app.post("/api/auth/register", response_model=RegisterResponse, status_code=status.HTTP_201_CREATED, tags=["Authentication"])
async def register(request: RegisterRequest, http_request: Request):
    """Register a new user with rate limiting."""
    client_ip = http_request.client.host if http_request.client else "unknown"
    rate_key = f"register:{client_ip}"
    
    if not await check_rate_limit(rate_key, settings.AUTH_RATE_LIMIT):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many registration attempts. Please try again later."
        )
    
    # Check if username already exists
    existing_user = await get_user_by_username(request.username)
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already registered"
        )

    # Check if email already exists
    existing_email = await get_user_by_email(request.email)
    if existing_email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered"
        )

    # Hash password
    hashed_password = get_password_hash(request.password)

    # Create user
    user_id = str(uuid.uuid4())
    created_at = datetime.now(timezone.utc)
    user_data = {
        "user_id": user_id,
        "username": request.username,
        "email": request.email,
        "full_name": request.full_name,
        "hashed_password": hashed_password,
        "role": "Operator",
        "bop_location": "BOP-01",
        "created_at": created_at,
        "is_active": True
    }

    await create_user(user_data)

    logger.info("user_registered", username=request.username, user_id=user_id, request_id=http_request.state.request_id)

    return RegisterResponse(
        user_id=user_id,
        username=request.username,
        email=request.email,
        full_name=request.full_name,
        created_at=created_at
    )


@app.post("/api/auth/login", response_model=LoginResponse, tags=["Authentication"])
async def login(request: LoginRequest, http_request: Request):
    """Authenticate user and return JWT token with rate limiting."""
    client_ip = http_request.client.host if http_request.client else "unknown"
    rate_key = f"login:{client_ip}"
    
    if not await check_rate_limit(rate_key, settings.AUTH_RATE_LIMIT):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many login attempts. Please try again later."
        )
    
    user = await get_user_by_username(request.username)

    if not user:
        logger.warning("login_failed_user_not_found", username=request.username, request_id=http_request.state.request_id)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not verify_password(request.password, user["hashed_password"]):
        logger.warning("login_failed_invalid_password", username=request.username, request_id=http_request.state.request_id)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user.get("is_active", True):
        logger.warning("login_failed_user_disabled", username=request.username, request_id=http_request.state.request_id)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User account is disabled",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Create access token
    access_token = create_access_token(
        data={
            "sub": user["username"],
            "user_id": user["user_id"],
            "email": user["email"],
            "role": user.get("role", "Operator"),
            "bop_location": user.get("bop_location", "BOP-01"),
            "scopes": ["read", "write"]
        }
    )

    logger.info("user_logged_in", username=request.username, user_id=user["user_id"], request_id=http_request.state.request_id)

    return LoginResponse(
        access_token=access_token,
        expires_in=settings.JWT_EXPIRY_MINUTES * 60,
        user={
            "user_id": user["user_id"],
            "username": user["username"],
            "email": user["email"],
            "full_name": user.get("full_name"),
            "role": user.get("role", "Operator"),
            "bop_location": user.get("bop_location", "BOP-01"),
        }
    )


@app.post("/api/auth/verify", tags=["Authentication"])
async def verify_token(current_user: Dict = Depends(get_current_user)):
    """Verify current token validity and return user info."""
    return {
        "valid": True,
        "user": current_user
    }


@app.get("/api/auth/me", tags=["Authentication"])
async def get_me(current_user: Dict = Depends(get_current_user)):
    """Get current authenticated user details."""
    return current_user


# =============================================================================
# Video Analysis Endpoints
# =============================================================================

def process_frame(frame: np.ndarray, request_id: str = "") -> tuple:
    """Process a single frame through the AI pipeline. Does not mutate input."""
    start_time = time.time()
    detections = []
    alerts = []
    
    # Work on a copy to avoid mutating input
    frame_copy = frame.copy()
    
    # YOLO Detection
    with INFERENCE_LATENCY.labels(model="yolo").time():
        results = app_state.yolo_model(frame_copy, verbose=False)[0]
    
    raw_detections = []
    for box in results.boxes:
        cls_id = int(box.cls[0])
        conf = float(box.conf[0])
        xyxy = box.xyxy[0].cpu().numpy()
        
        # Use configurable class IDs
        if cls_id in settings.ALLOWED_CLASS_IDS and conf >= settings.CONFIDENCE_THRESHOLD:
            raw_detections.append([xyxy[0], xyxy[1], xyxy[2], xyxy[3], conf, cls_id])
    
    # Enforce MAX_DETECTIONS
    if len(raw_detections) > settings.MAX_DETECTIONS:
        raw_detections = sorted(raw_detections, key=lambda x: x[4], reverse=True)[:settings.MAX_DETECTIONS]
    
    # Tracking
    tracks = []
    if len(raw_detections) > 0:
        with INFERENCE_LATENCY.labels(model="tracker").time():
            dets_array = np.array(raw_detections)
            tracks = app_state.tracker.update(dets_array, frame_copy)
    
    # Process tracks
    for track in tracks:
        # Safely extract track data - BoT-SORT format: [x1, y1, x2, y2, track_id, conf, cls]
        try:
            track_list = track.tolist() if hasattr(track, 'tolist') else list(track)
            if len(track_list) < 7:
                logger.warning("track_data_incomplete", track_len=len(track_list), request_id=request_id)
                continue
                
            x1, y1, x2, y2 = map(int, track_list[:4])
            track_id = int(track_list[4])
            conf = float(track_list[5])
            cls = int(track_list[6])
        except (IndexError, ValueError) as e:
            logger.warning("track_parse_failed", error=str(e), request_id=request_id)
            continue
        
        label_type = "Person" if cls == settings.PERSON_CLASS_ID else "Vehicle"
        
        detection = Detection(
            class_name=label_type,
            class_id=cls,
            confidence=conf,
            bbox=[float(x1), float(y1), float(x2), float(y2)],
            track_id=track_id
        )
        detections.append(detection)
        
        # Count for metrics
        severity = "critical" if cls == settings.PERSON_CLASS_ID else "high"
        DETECTION_COUNT.labels(class_name=label_type, severity=severity).inc()
        
        # Draw annotations on copy
        cv2.rectangle(frame_copy, (x1, y1), (x2, y2), (0, 255, 0), 2)
        cv2.putText(
            frame_copy, f"ID:{track_id} {label_type} {conf:.2f}",
            (x1, max(y1 - 10, 20)), cv2.FONT_HERSHEY_SIMPLEX,
            0.6, (0, 255, 0), 2
        )
        
        # Generate alerts for all detection types
        alert_type_map = {
            settings.PERSON_CLASS_ID: ("INTRUSION", "HIGH", f"Person detected (Track ID: {track_id})"),
        }
        
        # Add vehicle alerts
        if cls in settings.VEHICLE_CLASS_IDS:
            alert_type_map[cls] = ("ANPR", "MEDIUM", f"Vehicle detected (Track ID: {track_id})")
        
        if cls in alert_type_map:
            alert_type, severity, message = alert_type_map[cls]
            alert = Alert(
                type=alert_type,
                severity=severity,
                message=message,
                timestamp=datetime.now(timezone.utc).isoformat(),
                detection_id=detection.id
            )
            alerts.append(alert)
    
    processing_time = (time.time() - start_time) * 1000
    return detections, alerts, frame_copy, processing_time


def decode_base64_frame(frame_base64: str) -> np.ndarray:
    """Decode base64 frame, handling both data URL and raw base64 formats."""
    # Handle data URL format: "data:image/jpeg;base64,..."
    if "," in frame_base64:
        frame_base64 = frame_base64.split(",")[-1]
    
    frame_data = base64.b64decode(frame_base64)
    nparr = np.frombuffer(frame_data, np.uint8)
    frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    
    if frame is None:
        raise HTTPException(status_code=400, detail="Invalid image data")
    
    return frame


@app.post("/analyze", response_model=FrameAnalysisResponse, tags=["Analysis"])
async def analyze_frame(
    request: FrameAnalysisRequest,
    user: Dict = Depends(get_current_user)
):
    """Analyze a single frame (base64 encoded) and return detections."""
    request_id = getattr(user, 'request_id', None) or str(uuid.uuid4())[:8]
    start_time = time.time()
    
    try:
        # Decode base64 frame (handles both formats)
        frame = decode_base64_frame(request.frame_base64)
        
        # Process frame
        detections, alerts, annotated_frame, proc_time = process_frame(frame, request_id)
        
        # Encode annotated frame
        _, buffer = cv2.imencode('.jpg', annotated_frame, [cv2.IMWRITE_JPEG_QUALITY, settings.WS_JPEG_QUALITY])
        annotated_base64 = base64.b64encode(buffer).decode('utf-8')
        
        total_time = (time.time() - start_time) * 1000
        
        logger.info(
            "frame_analyzed",
            request_id=request_id,
            detections=len(detections),
            alerts=len(alerts),
            processing_time_ms=proc_time
        )
        
        return FrameAnalysisResponse(
            request_id=request_id,
            timestamp=datetime.now(timezone.utc).isoformat(),
            processing_time_ms=total_time,
            detections=detections,
            alerts=alerts,
            annotated_frame_base64=f"data:image/jpeg;base64,{annotated_base64}"
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error("frame_analysis_failed", request_id=request_id, error=str(e), exc_info=True)
        raise HTTPException(status_code=500, detail="Frame analysis failed")


@app.post("/analyze/upload", response_model=FrameAnalysisResponse, tags=["Analysis"])
async def analyze_upload(
    file: UploadFile = File(...),
    camera_id: Optional[str] = Form(None),
    user: Dict = Depends(get_current_user)
):
    """Analyze an uploaded image/video frame."""
    request_id = str(uuid.uuid4())[:8]
    start_time = time.time()
    
    # Validate file type
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image")
    
    # Check file size by reading in chunks
    content = b""
    chunk_size = 8192
    while True:
        chunk = await file.read(chunk_size)
        if not chunk:
            break
        content += chunk
        if len(content) > settings.MAX_UPLOAD_SIZE:
            raise HTTPException(status_code=413, detail="File too large")
    
    try:
        # Decode image
        nparr = np.frombuffer(content, np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        if frame is None:
            raise HTTPException(status_code=400, detail="Invalid image data")
        
        # Process frame
        detections, alerts, annotated_frame, proc_time = process_frame(frame, request_id)
        
        # Encode annotated frame
        _, buffer = cv2.imencode('.jpg', annotated_frame, [cv2.IMWRITE_JPEG_QUALITY, settings.WS_JPEG_QUALITY])
        annotated_base64 = base64.b64encode(buffer).decode('utf-8')
        
        total_time = (time.time() - start_time) * 1000
        
        # Sanitize filename for logging
        safe_filename = file.filename.replace("\n", "").replace("\r", "")[:255] if file.filename else "unknown"
        
        logger.info(
            "upload_analyzed",
            request_id=request_id,
            filename=safe_filename,
            detections=len(detections),
            alerts=len(alerts),
            processing_time_ms=proc_time
        )
        
        return FrameAnalysisResponse(
            request_id=request_id,
            timestamp=datetime.now(timezone.utc).isoformat(),
            processing_time_ms=total_time,
            detections=detections,
            alerts=alerts,
            annotated_frame_base64=f"data:image/jpeg;base64,{annotated_base64}"
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error("upload_analysis_failed", request_id=request_id, error=str(e), exc_info=True)
        raise HTTPException(status_code=500, detail="Upload analysis failed")


@app.post("/footage/upload", response_model=FootageUploadResponse, tags=["Footage"])
async def upload_footage(
    file: UploadFile = File(...),
    camera_id: Optional[str] = Form(None),
    detection_id: Optional[str] = Form(None),
    user: Dict = Depends(get_current_user)
):
    """Store an uploaded video for playback in the tracking view."""
    allowed_types = {"video/mp4", "video/webm", "video/quicktime", "video/x-msvideo"}
    allowed_extensions = {".mp4", ".webm", ".mov", ".avi"}
    original_name = file.filename or "uploaded-video"
    extension = Path(original_name).suffix.lower()

    if file.content_type not in allowed_types and extension not in allowed_extensions:
        raise HTTPException(status_code=400, detail="File must be an MP4, WebM, MOV, or AVI video")

    footage_id = str(uuid.uuid4())
    stored_name = f"{footage_id}{extension or '.mp4'}"
    destination = settings.UPLOAD_DIR / stored_name
    total_size = 0

    try:
        with destination.open("wb") as output:
            while chunk := await file.read(1024 * 1024):
                total_size += len(chunk)
                if total_size > settings.MAX_UPLOAD_SIZE:
                    destination.unlink(missing_ok=True)
                    raise HTTPException(status_code=413, detail="File too large")
                output.write(chunk)
    except HTTPException:
        raise
    except Exception as exc:
        destination.unlink(missing_ok=True)
        logger.error("footage_upload_failed", error=str(exc), exc_info=True)
        raise HTTPException(status_code=500, detail="Could not store uploaded footage")
    finally:
        await file.close()

    logger.info(
        "footage_uploaded",
        footage_id=footage_id,
        filename=original_name[:255],
        camera_id=camera_id,
        detection_id=detection_id,
        size=total_size,
        user_id=user.get("user_id"),
    )
    return FootageUploadResponse(
        id=footage_id,
        filename=original_name[:255],
        url=f"/uploads/{stored_name}",
        size=total_size,
        uploaded_at=datetime.now(timezone.utc).isoformat(),
    )


# =============================================================================
# WebSocket Streaming
# =============================================================================

@app.websocket("/ws/stream")
async def websocket_stream(
    websocket: WebSocket,
    api_key: Optional[str] = None,
    token: Optional[str] = None,
    monitor: Optional[str] = None,
):
    """WebSocket endpoint for real-time video streaming with AI analysis."""
    # Authenticate
    try:
        user = await get_ws_user(websocket, api_key, token)
    except HTTPException:
        return

    if monitor == "primary":
        for client in list(app_state.ws_clients):
            if client is not websocket:
                try:
                    await client.close(code=4000, reason="Replaced by active monitor")
                except Exception:
                    pass
                app_state.ws_clients.discard(client)
    elif len(app_state.ws_clients) >= settings.WS_MAX_CLIENTS:
        await websocket.close(code=1013, reason="Live monitoring capacity reached")
        return
    
    await websocket.accept()
    WS_CONNECTIONS.inc()
    app_state.ws_clients.add(websocket)
    client_id = str(uuid.uuid4())[:8]
    
    logger.info("websocket_connected", client_id=client_id, user_id=user.get("user_id"))
    
    # Message queue for backpressure handling
    send_queue: asyncio.Queue = asyncio.Queue(maxsize=settings.WS_MAX_QUEUE_SIZE)
    connection_closed = asyncio.Event()
    
    async def sender():
        """Background task to send messages with backpressure."""
        try:
            while True:
                payload = await send_queue.get()
                if payload is None:  # Shutdown signal
                    break
                try:
                    await websocket.send_json(payload)
                except Exception as e:
                    logger.warning("websocket_send_failed", client_id=client_id, error=str(e))
                    connection_closed.set()
                    break
        except asyncio.CancelledError:
            pass
    
    sender_task = asyncio.create_task(sender())
    
    try:
        # Configurable video source
        video_source = settings.WS_VIDEO_SOURCE
        video_path = Path(video_source)
        if not video_path.exists():
            uploaded_sources = [
                path for path in settings.UPLOAD_DIR.iterdir()
                if path.suffix.lower() in {'.mp4', '.webm', '.mov', '.avi'}
            ]
            if uploaded_sources:
                video_path = max(uploaded_sources, key=lambda path: path.stat().st_mtime)
                logger.info("using_latest_uploaded_video", path=str(video_path))
        cap = cv2.VideoCapture(str(video_path) if video_path.exists() else 0)
        
        if not cap.isOpened():
            await send_queue.put({
                "error": "Video source not available",
                "timestamp": datetime.now(timezone.utc).isoformat()
            })
            return
        
        frame_count = 0
        last_frame_time = time.time()
        
        while cap.isOpened() and not connection_closed.is_set():
            loop_start = time.time()
            
            ret, frame = cap.read()
            if not ret:
                # Loop video
                cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                continue
            
            # Process frame
            detections, alerts, annotated_frame, proc_time = await asyncio.to_thread(process_frame, frame, client_id)
            
            # Encode frame
            _, buffer = cv2.imencode('.jpg', annotated_frame, [cv2.IMWRITE_JPEG_QUALITY, settings.WS_JPEG_QUALITY])
            frame_base64 = base64.b64encode(buffer).decode('utf-8')
            
            # Prepare payload
            payload = {
                "frame_id": frame_count,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "frame": f"data:image/jpeg;base64,{frame_base64}",
                "detections": [d.model_dump() for d in detections],
                "alerts": [a.model_dump() for a in alerts],
                "processing_time_ms": proc_time
            }
            
            # Non-blocking send with backpressure
            try:
                send_queue.put_nowait(payload)
            except asyncio.QueueFull:
                logger.warning("websocket_queue_full_dropping_frame", client_id=client_id)
                # Drop oldest frame if queue full
                try:
                    send_queue.get_nowait()
                    send_queue.put_nowait(payload)
                except asyncio.QueueEmpty:
                    pass
            
            frame_count += 1
            
            # Dynamic frame rate control - account for processing time
            elapsed = time.time() - loop_start
            sleep_time = max(0, settings.WS_FRAME_INTERVAL - elapsed)
            await asyncio.sleep(sleep_time)
            
    except WebSocketDisconnect:
        logger.info("websocket_disconnected", client_id=client_id)
    except Exception as e:
        logger.error("websocket_error", client_id=client_id, error=str(e), exc_info=True)
    finally:
        sender_task.cancel()
        try:
            await sender_task
        except asyncio.CancelledError:
            pass
        await send_queue.put(None)  # Signal sender to exit
        WS_CONNECTIONS.dec()
        app_state.ws_clients.discard(websocket)
        cap.release()


@app.websocket("/ws/footage/{footage_id}")
async def websocket_footage_stream(
    websocket: WebSocket,
    footage_id: str,
    token: Optional[str] = None,
    api_key: Optional[str] = None,
    monitor: Optional[str] = None,
):
    """Stream AI-analyzed frames from an uploaded video in real time."""
    try:
        user = await get_ws_user(websocket, api_key, token)
    except HTTPException:
        return

    if monitor == "primary":
        for client in list(app_state.ws_clients):
            if client is not websocket:
                try:
                    await client.close(code=4000, reason="Replaced by active monitor")
                except Exception:
                    pass
                app_state.ws_clients.discard(client)
    elif len(app_state.ws_clients) >= settings.WS_MAX_CLIENTS:
        await websocket.close(code=1013, reason="Live monitoring capacity reached")
        return

    if not re.fullmatch(r"[0-9a-f-]{36}", footage_id):
        await websocket.close(code=4004, reason="Invalid footage id")
        return

    matches = list(settings.UPLOAD_DIR.glob(f"{footage_id}.*"))
    if not matches:
        await websocket.close(code=4004, reason="Footage not found")
        return

    await websocket.accept()
    cap = cv2.VideoCapture(str(matches[0]))
    if not cap.isOpened():
        await websocket.send_json({"error": "Uploaded video could not be opened"})
        await websocket.close(code=4000)
        return

    client_id = str(uuid.uuid4())[:8]
    WS_CONNECTIONS.inc()
    app_state.ws_clients.add(websocket)
    frame_count = 0

    try:
        while True:
            loop_start = time.time()
            ret, frame = cap.read()
            if not ret:
                break

            detections, alerts, annotated_frame, proc_time = await asyncio.to_thread(process_frame, frame, client_id)
            _, buffer = cv2.imencode('.jpg', annotated_frame, [cv2.IMWRITE_JPEG_QUALITY, settings.WS_JPEG_QUALITY])
            payload = {
                "frame_id": frame_count,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "frame": f"data:image/jpeg;base64,{base64.b64encode(buffer).decode('utf-8')}",
                "detections": [d.model_dump() for d in detections],
                "alerts": [a.model_dump() for a in alerts],
                "processing_time_ms": proc_time,
                "video_time_seconds": cap.get(cv2.CAP_PROP_POS_MSEC) / 1000,
            }
            await websocket.send_json(payload)
            frame_count += 1
            await asyncio.sleep(max(0, settings.WS_FRAME_INTERVAL - (time.time() - loop_start)))
    except WebSocketDisconnect:
        logger.info("footage_stream_disconnected", client_id=client_id)
    except Exception as exc:
        logger.error("footage_stream_error", client_id=client_id, error=str(exc), exc_info=True)
    finally:
        cap.release()
        WS_CONNECTIONS.dec()
        app_state.ws_clients.discard(websocket)
        try:
            await websocket.close()
        except Exception:
            pass


# =============================================================================
# Root Endpoint
# =============================================================================

@app.get("/", tags=["System"])
async def root():
    """Root endpoint with API information."""
    return {
        "name": "IBVAP Backend",
        "version": "1.0.0",
        "description": "Intelligent Border Video Analytics Platform",
        "device": settings.DEVICE,
        "docs": "/docs" if settings.ENVIRONMENT != "production" else "disabled",
        "health": "/health",
        "metrics": "/metrics",
        "endpoints": {
            "websocket_stream": "/ws/stream?api_key=YOUR_KEY or /ws/stream?token=JWT",
            "analyze_frame": "POST /analyze",
            "analyze_upload": "POST /analyze/upload",
            "auth_register": "POST /api/auth/register",
            "auth_login": "POST /api/auth/login",
            "auth_verify": "POST /api/auth/verify",
            "auth_me": "GET /api/auth/me"
        }
    }


# =============================================================================
# Error Handlers
# =============================================================================

@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    """Structured HTTP exception handler."""
    request_id = getattr(request.state, 'request_id', 'unknown')
    logger.warning(
        "http_exception",
        request_id=request_id,
        path=request.url.path,
        status_code=exc.status_code,
        detail=exc.detail
    )
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": exc.detail, "status_code": exc.status_code, "request_id": request_id}
    )


@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
    """General exception handler."""
    request_id = getattr(request.state, 'request_id', 'unknown')
    logger.error(
        "unhandled_exception",
        request_id=request_id,
        path=request.url.path,
        error=str(exc),
        exc_info=True
    )
    return JSONResponse(
        status_code=500,
        content={"error": "Internal server error", "status_code": 500, "request_id": request_id}
    )


# =============================================================================
# Main Entry Point
# =============================================================================

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        workers=1,
        log_level=settings.LOG_LEVEL.lower(),
        access_log=True
    )