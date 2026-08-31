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
import json
import os
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional

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
from passlib.context import CryptContext
from pydantic import BaseModel, Field, EmailStr
from prometheus_client import Counter, Histogram, Gauge, generate_latest
from starlette.responses import Response
from ultralytics import YOLO

# =============================================================================
# Configuration & Settings
# =============================================================================

class Settings:
    """Application settings from environment variables."""
    
    # API Security
    API_KEY: str = os.getenv("API_KEY", "dev-secret-key-change-in-production")
    JWT_SECRET: str = os.getenv("JWT_SECRET", "dev-jwt-secret-change-in-production")
    JWT_ALGORITHM: str = os.getenv("JWT_ALGORITHM", "HS256")
    JWT_EXPIRY_MINUTES: int = int(os.getenv("JWT_EXPIRY_MINUTES", "60"))
    
    # Model Paths
    MODEL_PATH: Path = Path(os.getenv("MODEL_PATH", "/app/models"))
    YOLO_MODEL: str = os.getenv("YOLO_MODEL", "yolov8n.pt")
    REID_MODEL: str = os.getenv("REID_MODEL", "osnet_x0_25_msmt17.pt")
    
    # Runtime
    DEVICE: str = "cuda:0" if torch.cuda.is_available() else "cpu"
    LOG_LEVEL: str = os.getenv("LOG_LEVEL", "INFO")
    ENVIRONMENT: str = os.getenv("ENVIRONMENT", "development")
    
    # Video Processing
    CONFIDENCE_THRESHOLD: float = float(os.getenv("CONFIDENCE_THRESHOLD", "0.4"))
    IOU_THRESHOLD: float = float(os.getenv("IOU_THRESHOLD", "0.5"))
    MAX_DETECTIONS: int = int(os.getenv("MAX_DETECTIONS", "100"))
    
    # WebSocket
    WS_FRAME_INTERVAL: float = float(os.getenv("WS_FRAME_INTERVAL", "0.033"))  # ~30 FPS
    WS_JPEG_QUALITY: int = int(os.getenv("WS_JPEG_QUALITY", "80"))
    
    # Upload
    UPLOAD_DIR: Path = Path(os.getenv("UPLOAD_DIR", "/app/uploads"))
    MAX_UPLOAD_SIZE: int = int(os.getenv("MAX_UPLOAD_SIZE", "104857600"))  # 100MB


settings = Settings()

# =============================================================================
# Structured Logging Setup
# =============================================================================

structlog.configure(
    processors=[
        structlog.stdlib.filter_by_level,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.stdlib.PositionalArgumentsFormatter(),
        structlog.processors.TimeStamper(fmt="iso"),
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

# =============================================================================
# Security Schemes
# =============================================================================

# Password hashing context
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)
bearer_scheme = HTTPBearer(auto_error=False)

# In-memory user store (replace with database in production)
# Structure: {username: {"user_id": str, "username": str, "email": str, "full_name": str, "hashed_password": str, "created_at": datetime, "is_active": bool}}
users_db: Dict[str, Dict] = {}


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a plain password against a hashed password."""
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    """Hash a password."""
    return pwd_context.hash(password)


def create_access_token(data: Dict[str, Any], expires_delta: Optional[timedelta] = None) -> str:
    """Create a JWT access token."""
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=settings.JWT_EXPIRY_MINUTES)
    to_encode.update({"exp": expire, "iat": datetime.utcnow()})
    encoded_jwt = jwt.encode(to_encode, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)
    return encoded_jwt


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme)
) -> Dict[str, Any]:
    """Get current user from JWT token."""
    if not credentials:
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
    except jwt.PyJWTError as e:
        logger.warning("invalid_jwt_token", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Check if user exists in database
    user = users_db.get(username)
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
        "auth_type": "jwt",
        "scopes": payload.get("scopes", ["read", "write"])
    }

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


class FrameAnalysisResponse(BaseModel):
    request_id: str
    timestamp: str
    processing_time_ms: float
    detections: List[Detection]
    alerts: List[Alert]
    annotated_frame_base64: Optional[str] = None


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


app_state = AppState()

# =============================================================================
# Model Initialization
# =============================================================================

async def initialize_models():
    """Initialize all AI models."""
    global app_state
    
    logger.info("initializing_models", device=settings.DEVICE)
    
    try:
        # YOLOv8
        yolo_path = settings.MODEL_PATH / settings.YOLO_MODEL
        if not yolo_path.exists():
            yolo_path = settings.YOLO_MODEL  # Will auto-download
        app_state.yolo_model = YOLO(str(yolo_path))
        app_state.yolo_model.to(settings.DEVICE)
        logger.info("yolo_model_loaded", path=str(yolo_path))
        
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
        
        # OCR Reader
        app_state.ocr_reader = easyocr.Reader(
            ['en'], 
            gpu=torch.cuda.is_available(),
            model_storage_directory=str(settings.MODEL_PATH),
            download_enabled=True
        )
        logger.info("ocr_reader_loaded")
        
        app_state.models_loaded = True
        logger.info("all_models_initialized_successfully")
        
    except Exception as e:
        logger.error("model_initialization_failed", error=str(e), exc_info=True)
        raise


def get_gpu_info() -> Dict[str, Optional[str]]:
    """Get GPU memory info."""
    if not torch.cuda.is_available():
        return {"gpu_memory_used": None, "gpu_memory_total": None}
    
    try:
        used = torch.cuda.memory_allocated() / 1024**3
        total = torch.cuda.get_device_properties(0).total_memory / 1024**3
        return {
            "gpu_memory_used": f"{used:.2f} GB",
            "gpu_memory_total": f"{total:.2f} GB"
        }
    except Exception:
        return {"gpu_memory_used": None, "gpu_memory_total": None}

# =============================================================================
# Lifespan Management
# =============================================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager."""
    # Startup
    logger.info("application_starting", environment=settings.ENVIRONMENT)
    await initialize_models()
    logger.info("application_ready")
    
    yield
    
    # Shutdown
    logger.info("application_shutting_down")
    # Cleanup resources if needed


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

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if settings.ENVIRONMENT == "development" else ["https://your-frontend-domain.com"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# =============================================================================
# Middleware
# =============================================================================

@app.middleware("http")
async def metrics_middleware(request: Request, call_next):
    """Prometheus metrics middleware."""
    start_time = time.time()
    
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


# =============================================================================
# Health Check Endpoint
# =============================================================================

@app.get("/health", response_model=HealthResponse, tags=["System"])
async def health_check():
    """Health check endpoint for monitoring."""
    gpu_info = get_gpu_info()
    
    return HealthResponse(
        status="healthy" if app_state.models_loaded else "degraded",
        version="1.0.0",
        device=settings.DEVICE,
        models_loaded=app_state.models_loaded,
        uptime_seconds=time.time() - app_state.start_time,
        gpu_available=torch.cuda.is_available(),
        **gpu_info
    )


@app.get("/metrics", tags=["System"])
async def metrics():
    """Prometheus metrics endpoint."""
    return Response(
        content=generate_latest(),
        media_type="text/plain"
    )


# =============================================================================
# Authentication Endpoints
# =============================================================================

@app.post("/api/auth/register", response_model=RegisterResponse, status_code=status.HTTP_201_CREATED, tags=["Authentication"])
async def register(request: RegisterRequest):
    """Register a new user."""
    # Check if username already exists
    if request.username in users_db:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already registered"
        )

    # Check if email already exists
    for user in users_db.values():
        if user["email"] == request.email:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email already registered"
            )

    # Hash password
    hashed_password = get_password_hash(request.password)

    # Create user
    user_id = str(uuid.uuid4())
    created_at = datetime.utcnow()
    user_data = {
        "user_id": user_id,
        "username": request.username,
        "email": request.email,
        "full_name": request.full_name,
        "hashed_password": hashed_password,
        "created_at": created_at,
        "is_active": True
    }

    users_db[request.username] = user_data

    logger.info("user_registered", username=request.username, user_id=user_id)

    return RegisterResponse(
        user_id=user_id,
        username=request.username,
        email=request.email,
        full_name=request.full_name,
        created_at=created_at
    )


@app.post("/api/auth/login", response_model=LoginResponse, tags=["Authentication"])
async def login(request: LoginRequest):
    """Authenticate user and return JWT token."""
    user = users_db.get(request.username)

    if not user:
        logger.warning("login_failed_user_not_found", username=request.username)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not verify_password(request.password, user["hashed_password"]):
        logger.warning("login_failed_invalid_password", username=request.username)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user.get("is_active", True):
        logger.warning("login_failed_user_disabled", username=request.username)
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
            "scopes": ["read", "write"]
        }
    )

    logger.info("user_logged_in", username=request.username, user_id=user["user_id"])

    return LoginResponse(
        access_token=access_token,
        expires_in=settings.JWT_EXPIRY_MINUTES * 60,
        user={
            "user_id": user["user_id"],
            "username": user["username"],
            "email": user["email"],
            "full_name": user.get("full_name")
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

def process_frame(frame: np.ndarray) -> tuple:
    """Process a single frame through the AI pipeline."""
    start_time = time.time()
    detections = []
    alerts = []
    
    # YOLO Detection
    with INFERENCE_LATENCY.labels(model="yolo").time():
        results = app_state.yolo_model(frame, verbose=False)[0]
    
    raw_detections = []
    for box in results.boxes:
        cls_id = int(box.cls[0])
        conf = float(box.conf[0])
        xyxy = box.xyxy[0].cpu().numpy()
        
        # Person (0) or Vehicle (2, 3, 5, 7)
        if cls_id in [0, 2, 3, 5, 7] and conf >= settings.CONFIDENCE_THRESHOLD:
            raw_detections.append([xyxy[0], xyxy[1], xyxy[2], xyxy[3], conf, cls_id])
    
    # Tracking
    tracks = []
    if len(raw_detections) > 0:
        with INFERENCE_LATENCY.labels(model="tracker").time():
            dets_array = np.array(raw_detections)
            tracks = app_state.tracker.update(dets_array, frame)
    
    # Process tracks
    for track in tracks:
        x1, y1, x2, y2, track_id, cls, conf = map(int, track[:7])
        label_type = "Person" if cls == 0 else "Vehicle"
        
        detection = Detection(
            class_name=label_type,
            class_id=cls,
            confidence=conf / 100.0,
            bbox=[float(x1), float(y1), float(x2), float(y2)],
            track_id=track_id
        )
        detections.append(detection)
        
        # Count for metrics
        DETECTION_COUNT.labels(class_name=label_type, severity="high").inc()
        
        # Draw annotations
        cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 255, 0), 2)
        cv2.putText(
            frame, f"ID:{track_id} {label_type} {conf/100:.2f}",
            (x1, max(y1 - 10, 20)), cv2.FONT_HERSHEY_SIMPLEX,
            0.6, (0, 255, 0), 2
        )
        
        # Generate alert for persons
        if cls == 0:
            alert = Alert(
                type="INTRUSION",
                severity="HIGH",
                message=f"Person detected (Track ID: {track_id})",
                timestamp=time.strftime("%H:%M:%S"),
                detection_id=detection.id
            )
            alerts.append(alert)
    
    processing_time = (time.time() - start_time) * 1000
    return detections, alerts, frame, processing_time


@app.post("/analyze", response_model=FrameAnalysisResponse, tags=["Analysis"])
async def analyze_frame(
    request: FrameAnalysisRequest,
    user: Dict = Depends(get_current_user)
):
    """Analyze a single frame (base64 encoded) and return detections."""
    request_id = str(uuid.uuid4())[:8]
    start_time = time.time()
    
    try:
        # Decode base64 frame
        frame_data = base64.b64decode(request.frame_base64.split(",")[-1])
        nparr = np.frombuffer(frame_data, np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        if frame is None:
            raise HTTPException(status_code=400, detail="Invalid image data")
        
        # Process frame
        detections, alerts, annotated_frame, proc_time = process_frame(frame)
        
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
            timestamp=time.strftime("%Y-%m-%dT%H:%M:%S"),
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
    
    # Check file size
    content = await file.read()
    if len(content) > settings.MAX_UPLOAD_SIZE:
        raise HTTPException(status_code=413, detail="File too large")
    
    try:
        # Decode image
        nparr = np.frombuffer(content, np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        if frame is None:
            raise HTTPException(status_code=400, detail="Invalid image data")
        
        # Process frame
        detections, alerts, annotated_frame, proc_time = process_frame(frame)
        
        # Encode annotated frame
        _, buffer = cv2.imencode('.jpg', annotated_frame, [cv2.IMWRITE_JPEG_QUALITY, settings.WS_JPEG_QUALITY])
        annotated_base64 = base64.b64encode(buffer).decode('utf-8')
        
        total_time = (time.time() - start_time) * 1000
        
        logger.info(
            "upload_analyzed",
            request_id=request_id,
            filename=file.filename,
            detections=len(detections),
            alerts=len(alerts),
            processing_time_ms=proc_time
        )
        
        return FrameAnalysisResponse(
            request_id=request_id,
            timestamp=time.strftime("%Y-%m-%dT%H:%M:%S"),
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


# =============================================================================
# WebSocket Streaming
# =============================================================================

@app.websocket("/ws/stream")
async def websocket_stream(
    websocket: WebSocket,
    api_key: Optional[str] = None
):
    """WebSocket endpoint for real-time video streaming with AI analysis."""
    # Authenticate via query parameter for WebSocket
    if api_key != settings.API_KEY:
        await websocket.close(code=4001, reason="Invalid API key")
        return
    
    await websocket.accept()
    WS_CONNECTIONS.inc()
    client_id = str(uuid.uuid4())[:8]
    
    logger.info("websocket_connected", client_id=client_id)
    
    try:
        # Use default test video or webcam
        video_path = Path("test_video.mp4")
        cap = cv2.VideoCapture(str(video_path) if video_path.exists() else 0)
        
        if not cap.isOpened():
            await websocket.send_json({
                "error": "Video source not available",
                "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S")
            })
            return
        
        frame_count = 0
        
        while cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                # Loop video
                cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                continue
            
            # Process frame
            detections, alerts, annotated_frame, proc_time = process_frame(frame)
            
            # Encode frame
            _, buffer = cv2.imencode('.jpg', annotated_frame, [cv2.IMWRITE_JPEG_QUALITY, settings.WS_JPEG_QUALITY])
            frame_base64 = base64.b64encode(buffer).decode('utf-8')
            
            # Prepare payload
            payload = {
                "frame_id": frame_count,
                "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
                "frame": f"data:image/jpeg;base64,{frame_base64}",
                "detections": [d.model_dump() for d in detections],
                "alerts": [a.model_dump() for a in alerts],
                "processing_time_ms": proc_time
            }
            
            try:
                await websocket.send_json(payload)
            except Exception as e:
                logger.warning("websocket_send_failed", client_id=client_id, error=str(e))
                break
            
            frame_count += 1
            await asyncio.sleep(settings.WS_FRAME_INTERVAL)
            
    except WebSocketDisconnect:
        logger.info("websocket_disconnected", client_id=client_id)
    except Exception as e:
        logger.error("websocket_error", client_id=client_id, error=str(e), exc_info=True)
    finally:
        WS_CONNECTIONS.dec()
        cap.release()


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
            "websocket_stream": "/ws/stream?api_key=YOUR_KEY",
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
    logger.warning(
        "http_exception",
        path=request.url.path,
        status_code=exc.status_code,
        detail=exc.detail
    )
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": exc.detail, "status_code": exc.status_code}
    )


@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
    """General exception handler."""
    logger.error(
        "unhandled_exception",
        path=request.url.path,
        error=str(exc),
        exc_info=True
    )
    return JSONResponse(
        status_code=500,
        content={"error": "Internal server error", "status_code": 500}
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