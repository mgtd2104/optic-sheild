# IBVAP Backend – Complete Implementation Details

## Overview
This document describes the **production-ready backend** for **IBVAP – Intelligent Border Video Analytics Platform**. It is a FastAPI-based AI inference service featuring YOLOv8 object detection, BoT-SORT tracking with OSNet Re-ID, EasyOCR ANPR, WebSocket video streaming, REST frame analysis, API Key + JWT authentication, Prometheus metrics, structured JSON logging, and TLS termination via Nginx.

---

## File Structure

```
backend/
├── main.py                      # FastAPI application (800+ lines)
├── Dockerfile                   # Multi-stage CUDA 12.1 + Python 3.11
├── docker-compose.yml           # Full stack: PostgreSQL, Redis, Nginx, Prometheus, Grafana
├── entrypoint.sh                # Container initialization script
├── nginx.conf                   # TLS termination + rate limiting + WebSocket proxy
├── requirements.txt             # Python dependencies
├── prometheus.yml               # Prometheus scrape configuration
├── .env.example                 # Environment variables template
├── README.md                    # Complete documentation
├── .github/workflows/ci.yml     # GitHub Actions CI/CD pipeline
├── yolov8n.pt                   # YOLOv8 nano model weights (6.5 MB)
├── test_models.py               # Model verification script
├── info.md                      # This file
└── tests/
    ├── conftest.py              # Pytest fixtures & configuration
    ├── test_api.py              # Unit tests (25+ tests)
    └── test_integration.py      # Container integration tests
```

---

## Technology Stack

| Layer | Technology | Version | Purpose |
|-------|------------|---------|---------|
| **Language** | Python | 3.11 | Modern async support, type hints |
| **Framework** | FastAPI | 0.109 | High-performance async API |
| **ASGI Server** | Uvicorn | 0.27 | Production ASGI server |
| **AI/ML** | PyTorch | 2.1.2+cu121 | GPU-accelerated inference |
| **Detection** | Ultralytics YOLOv8 | 8.0.200 | Object detection |
| **Tracking** | BoxMOT BoT-SORT | 1.1.5 | Multi-object tracking with Re-ID |
| **Re-ID** | OSNet | x0_25 | Person re-identification |
| **OCR** | EasyOCR | 1.7.1 | ANPR (license plate recognition) |
| **Video** | OpenCV | 4.8.1 | Frame processing |
| **Database** | PostgreSQL + asyncpg | 16 / 0.29 | Async database |
| **Cache** | Redis | 7 / 5.0 | Caching, pub/sub |
| **Auth** | python-jose + passlib | 3.3 / 1.7 | JWT + bcrypt |
| **Logging** | structlog | 24.1 | Structured JSON logging |
| **Metrics** | prometheus-client | 0.19 | Prometheus exposition |
| **Reverse Proxy** | Nginx | alpine | TLS termination, rate limiting |
| **Container** | Docker | 24+ | Multi-stage CUDA build |
| **Orchestration** | Docker Compose | 2.0 | Multi-service deployment |

---

## Core Components

### 1. FastAPI Application (`main.py`)

#### Application Lifecycle
- **Lifespan manager** for startup/shutdown
- **Model initialization** on startup (YOLO, Tracker, OCR)
- **Graceful shutdown** with resource cleanup

#### Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | None | API info & endpoint discovery |
| GET | `/health` | None | Health check with GPU/status |
| GET | `/metrics` | None | Prometheus metrics |
| POST | `/auth/token` | None | Generate JWT token |
| POST | `/auth/verify` | API Key/JWT | Verify token validity |
| POST | `/analyze` | API Key/JWT | Analyze base64 frame |
| POST | `/analyze/upload` | API Key/JWT | Analyze uploaded image |
| WS | `/ws/stream` | API Key (query) | Real-time video stream |

#### Authentication
- **API Key**: `X-API-Key` header or `?api_key=` query param (WebSocket)
- **JWT**: `Authorization: Bearer <token>` header
- **Token expiry**: Configurable (default 60 min)
- **Algorithm**: HS256

#### AI Pipeline (`process_frame()`)
```python
1. YOLOv8 Detection → Person (0), Vehicle (2,3,5,7)
2. BoT-SORT Tracking → Persistent track IDs
3. Alert Generation → INTRUSION for persons
4. Annotation → Bounding boxes + labels
5. Output → Base64 JPEG + JSON detections/alerts
```

#### Structured Logging (structlog)
```json
{
  "timestamp": "2024-01-15T10:30:00.123Z",
  "level": "info",
  "event": "frame_analyzed",
  "request_id": "a1b2c3d4",
  "detections": 2,
  "alerts": 1,
  "processing_time_ms": 45.2
}
```

#### Prometheus Metrics
| Metric | Type | Labels |
|--------|------|--------|
| `ibvap_requests_total` | Counter | method, endpoint, status |
| `ibvap_request_duration_seconds` | Histogram | method, endpoint |
| `ibvap_websocket_connections` | Gauge | - |
| `ibvap_detections_total` | Counter | class_name, severity |
| `ibvap_inference_duration_seconds` | Histogram | model |

---

### 2. Docker Configuration

#### Dockerfile (Multi-stage)
```dockerfile
# Builder stage: nvidia/cuda:12.1-runtime-ubuntu22.04
# - Python 3.11 + venv
# - Install all dependencies via pip
# - Cache requirements layer

# Runtime stage: nvidia/cuda:12.1-runtime-ubuntu22.04
# - Copy venv from builder
# - Non-root user (appuser)
# - Nginx for TLS
# - Health check endpoint
# - Entrypoint script
```

#### Key Build Features
- **CUDA 12.1** runtime base
- **Python 3.11** with virtual environment
- **Multi-stage** for smaller final image
- **Non-root user** for security
- **BuildKit cache** for fast rebuilds
- **NVIDIA runtime** for GPU access

#### Entrypoint Script (`entrypoint.sh`)
- Waits for PostgreSQL/Redis
- Runs Alembic migrations
- Downloads model weights if missing
- Starts Nginx (if SSL certs exist)
- Starts FastAPI with uvicorn

---

### 3. Docker Compose Services

```yaml
services:
  postgres:    # PostgreSQL 16-alpine
    - Port: 5432
    - Health check: pg_isready
    - Volume: postgres_data
    
  redis:       # Redis 7-alpine
    - Port: 6379
    - AOF persistence
    - LRU eviction
    
  backend:     # FastAPI + AI
    - Port: 8000
    - GPU: all (nvidia runtime)
    - Depends on: postgres, redis
    - Volumes: models, logs, uploads
    
  nginx:       # Nginx alpine
    - Ports: 80, 443
    - TLS termination
    - Rate limiting
    - WebSocket proxy
    
  prometheus:  # Monitoring (profile: monitoring)
    - Port: 9090
    
  grafana:     # Dashboards (profile: monitoring)
    - Port: 3000
```

#### Profiles
```bash
# Core services
docker compose up -d

# With monitoring
docker compose --profile monitoring up -d
```

---

### 4. Nginx Configuration (`nginx.conf`)

#### Features
- **HTTP → HTTPS redirect** (port 80 → 443)
- **TLS 1.2/1.3** with modern cipher suites
- **Security headers**: HSTS, CSP, X-Frame-Options, etc.
- **Rate limiting**:
  - API: 100 req/s burst 50
  - WebSocket: 10 req/s burst 20
- **WebSocket proxy** with 24h timeouts
- **Health check** bypass (no rate limit)
- **Client max body**: 100MB for uploads

#### SSL Certificates
Place in `./ssl/`:
```
ssl/
├── ibvap.crt    # Full chain
└── ibvap.key    # Private key
```

---

### 5. Environment Variables (`.env.example`)

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `API_KEY` | API key for authentication | `dev-secret-key...` | **Yes** (prod) |
| `JWT_SECRET` | JWT signing secret | `dev-jwt-secret...` | **Yes** (prod) |
| `JWT_ALGORITHM` | JWT algorithm | `HS256` | No |
| `JWT_EXPIRY_MINUTES` | Token expiry | `60` | No |
| `MODEL_PATH` | Model weights directory | `/app/models` | No |
| `YOLO_MODEL` | YOLO model file | `yolov8n.pt` | No |
| `REID_MODEL` | Re-ID model file | `osnet_x0_25_msmt17.pt` | No |
| `DEVICE` | Compute device | `cuda:0` (auto) | No |
| `LOG_LEVEL` | Logging level | `INFO` | No |
| `ENVIRONMENT` | Runtime environment | `development` | No |
| `CONFIDENCE_THRESHOLD` | Detection threshold | `0.4` | No |
| `WS_FRAME_INTERVAL` | WS frame interval (s) | `0.033` | No |
| `DATABASE_URL` | PostgreSQL URL | - | No |
| `REDIS_URL` | Redis URL | - | No |
| `MAX_UPLOAD_SIZE` | Max upload bytes | `104857600` | No |

---

## Exact Start Commands

### 1. Build Docker Image
```bash
cd C:\optic-sheild\backend

# Production build
docker build -t ibvap-backend .

# Development build (builder stage)
docker build -t ibvap-backend:dev --target builder .
```

### 2. Run Standalone Container
```bash
# CPU-only (no GPU)
docker run -d --name ibvap-backend \
  -p 8000:8000 \
  -e API_KEY=sk-ibvap-your-key \
  -e JWT_SECRET=your-256-bit-secret \
  -e ENVIRONMENT=production \
  -v $(pwd)/models:/app/models:ro \
  -v $(pwd)/logs:/app/logs \
  ibvap-backend

# With GPU (requires NVIDIA Container Toolkit)
docker run -d --name ibvap-backend \
  --gpus all \
  -p 8000:8000 \
  -e API_KEY=sk-ibvap-your-key \
  -e JWT_SECRET=your-256-bit-secret \
  -e ENVIRONMENT=production \
  -v $(pwd)/models:/app/models:ro \
  -v $(pwd)/logs:/app/logs \
  ibvap-backend
```

### 3. Run with Docker Compose (Recommended)
```bash
# Core services only
docker compose up -d

# With monitoring stack
docker compose --profile monitoring up -d

# Development override
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d

# View logs
docker compose logs -f backend

# Stop
docker compose down

# Stop with volumes
docker compose down -v
```

### 4. Local Development (No Docker)
```bash
cd C:\optic-sheild\backend

# Create virtual environment
python -m venv venv
source venv/bin/activate  # Linux/Mac
# venv\Scripts\activate   # Windows

# Install dependencies
pip install -r requirements.txt

# Set environment
export API_KEY=dev-key
export JWT_SECRET=dev-secret
export ENVIRONMENT=development

# Run with auto-reload
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### 5. Run Tests
```bash
# Unit tests
pytest tests/test_api.py -v

# With coverage
pytest tests/test_api.py --cov=main --cov-report=html

# Integration tests (requires Docker)
pytest tests/test_integration.py -v -m integration --run-integration

# Specific test class
pytest tests/test_api.py::TestHealthEndpoints -v
```

---

## API Usage Examples

### Health Check
```bash
curl http://localhost:8000/health
```
Response:
```json
{
  "status": "healthy",
  "version": "1.0.0",
  "device": "cuda:0",
  "models_loaded": true,
  "uptime_seconds": 123.45,
  "gpu_available": true,
  "gpu_memory_used": "2.34 GB",
  "gpu_memory_total": "8.00 GB"
}
```

### Get JWT Token
```bash
curl -X POST http://localhost:8000/auth/token \
  -H "Content-Type: application/json" \
  -d '{"username": "operator", "password": "securepass"}'
```
Response:
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "token_type": "bearer",
  "expires_in": 3600
}
```

### Analyze Frame (Base64)
```bash
curl -X POST http://localhost:8000/analyze \
  -H "X-API-Key: sk-ibvap-your-key" \
  -H "Content-Type: application/json" \
  -d '{
    "frame_base64": "data:image/jpeg;base64,/9j/4AAQSkZJRg...",
    "camera_id": "CAM-001",
    "timestamp": "2024-01-15T10:30:00Z"
  }'
```

### Analyze Uploaded Image
```bash
curl -X POST http://localhost:8000/analyze/upload \
  -H "X-API-Key: sk-ibvap-your-key" \
  -F "file=@frame.jpg" \
  -F "camera_id=CAM-001"
```

### WebSocket Stream
```javascript
const ws = new WebSocket('ws://localhost:8000/ws/stream?api_key=sk-ibvap-your-key');

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('Frame:', data.frame_id);
  console.log('Detections:', data.detections);
  console.log('Alerts:', data.alerts);
  // Display data.frame (base64 JPEG)
};
```

### Prometheus Metrics
```bash
curl http://localhost:8000/metrics
```

---

## Model Details

### YOLOv8n (Detection)
- **Classes detected**: Person (0), Bicycle (1), Car (2), Motorcycle (3), Bus (5), Truck (7)
- **Confidence threshold**: 0.4 (configurable)
- **Input**: 640x640 (auto-resize)
- **Device**: CUDA or CPU

### BoT-SORT + OSNet (Tracking)
- **Tracker**: BoT-SORT (Bayesian optimization)
- **Re-ID**: OSNet x0.25 (MSMT17)
- **Features**: Appearance + motion association
- **Max detections**: 100/frame

### EasyOCR (ANPR)
- **Languages**: English
- **GPU**: Enabled when CUDA available
- **Use case**: License plate recognition

---

## Monitoring & Observability

### Prometheus Scraping (`prometheus.yml`)
```yaml
scrape_configs:
  - job_name: 'ibvap-backend'
    metrics_path: '/metrics'
    static_configs:
      - targets: ['backend:8000']
```

### Key Dashboards (Grafana)
- Request throughput & latency
- Detection rates by class
- GPU memory utilization
- WebSocket connection health
- Error rates by endpoint

### Log Aggregation
Structured JSON logs compatible with:
- **ELK Stack** (Elasticsearch, Logstash, Kibana)
- **Loki/Grafana**
- **Datadog/New Relic**

---

## Security Hardening

### Container Security
- Non-root user (`appuser`)
- Read-only model mounts
- Minimal runtime dependencies
- Health checks for orchestration

### Network Security
- TLS 1.2/1.3 only
- Rate limiting (API + WebSocket)
- Security headers (HSTS, CSP, etc.)
- CORS restricted in production

### Application Security
- API Key + JWT dual auth
- Input validation (Pydantic)
- File upload validation (MIME, size)
- SQL injection prevention (SQLAlchemy ORM)
- XSS prevention (no HTML rendering)

---

## CI/CD Pipeline (`.github/workflows/ci.yml`)

### Pipeline Stages
1. **Lint** → Ruff, Black, isort, MyPy
2. **Test** → Unit tests with coverage
3. **Build** → Multi-arch Docker image
4. **Security** → Trivy vulnerability scan
5. **Deploy Staging** → On `develop` branch
6. **Deploy Production** → On version tags (`v*`)

### Required Secrets
| Secret | Purpose |
|--------|---------|
| `GITHUB_TOKEN` | Container registry auth |
| `DOCKERHUB_USERNAME` | Docker Hub (optional) |
| `DOCKERHUB_TOKEN` | Docker Hub (optional) |

---

## Troubleshooting

### Common Issues

| Issue | Diagnosis | Fix |
|-------|-----------|-----|
| Container exits | Model download fails | Pre-download models, check network |
| CUDA OOM | Batch too large | Reduce `MAX_DETECTIONS`, lower resolution |
| WS disconnects | Proxy timeout | Increase Nginx `proxy_read_timeout` |
| Slow inference | CPU fallback | Verify `nvidia-smi` in container |
| Health check fails | Models not loading | Check `docker logs ibvap-backend` |

### Debug Commands
```bash
# View logs
docker logs -f ibvap-backend

# Shell into container
docker exec -it ibvap-backend bash

# Check GPU in container
docker exec ibvap-backend nvidia-smi

# Test model loading
docker exec ibvap-backend python -c "from ultralytics import YOLO; YOLO('yolov8n.pt')"

# Check Nginx config
docker exec ibvap-nginx nginx -t

# Test health endpoint
curl -v http://localhost:8000/health
```

---

## Performance Benchmarks (Typical)

| Metric | Target | Notes |
|--------|--------|-------|
| Inference latency | < 50ms | YOLOv8n on RTX 3080 |
| WebSocket FPS | ~30 FPS | Configurable via `WS_FRAME_INTERVAL` |
| Memory usage | < 4 GB | GPU + model weights |
| API latency (p99) | < 200ms | Including encoding |
| Concurrent WS | 50+ | Limited by GPU memory |

---

## Deployment Checklist

- [ ] `.env` configured with strong secrets
- [ ] SSL certificates in `./ssl/`
- [ ] Database migrations run
- [ ] Monitoring alerts configured
- [ ] Backup strategy for PostgreSQL
- [ ] Log aggregation configured
- [ ] Load testing completed
- [ ] Security scan passed (Trivy)
- [ ] CI/CD pipeline verified

---

## License & Support

**License**: Proprietary - IBVAP Project  
**Support**: Internal team / GitHub Issues  
**Documentation**: `/docs` (Swagger UI) when `ENVIRONMENT=development`

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2024-01-15 | Initial production release |
| | | YOLOv8 + BoT-SORT + EasyOCR |
| | | WebSocket + REST API |
| | | Docker + Compose + K8s ready |
| | | Full CI/CD + Monitoring |