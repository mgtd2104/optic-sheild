# IBVAP Backend - Intelligent Border Video Analytics Platform

Production-ready FastAPI backend for real-time AI-powered video analytics with YOLOv8 detection, BoT-SORT tracking, EasyOCR ANPR, and WebSocket streaming.

## 🚀 Quick Start

### Prerequisites
- **Docker** 24.0+ with BuildKit enabled
- **NVIDIA Container Toolkit** (for GPU support)
- **Docker Compose** 2.0+
- **NVIDIA GPU** with CUDA 12.1+ drivers (for production)

### 1. Clone & Configure
```bash
cd backend
cp .env.example .env
# Edit .env with your configuration
```

### 2. Build the Image
```bash
# Production build
docker build -t ibvap-backend .

# Development build (with cache)
docker build -t ibvap-backend:dev --target builder .
```

### 3. Run the Container
```bash
# Simple run (no auxiliary services)
docker run -d \
  --name ibvap-backend \
  --gpus all \
  -p 8000:8000 \
  -e API_KEY=your-secure-api-key \
  -e JWT_SECRET=your-jwt-secret \
  -v $(pwd)/models:/app/models:ro \
  -v $(pwd)/logs:/app/logs \
  ibvap-backend

# With docker-compose (recommended for production)
docker compose up -d
```

### 4. Verify Deployment
```bash
# Health check
curl http://localhost:8000/health

# API documentation
open http://localhost:8000/docs

# Metrics
curl http://localhost:8000/metrics
```

---

## 📋 Environment Variables

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `API_KEY` | API key for authentication | `dev-secret-key-change-in-production` | **Yes** (prod) |
| `JWT_SECRET` | JWT signing secret | `dev-jwt-secret-change-in-production` | **Yes** (prod) |
| `JWT_ALGORITHM` | JWT algorithm | `HS256` | No |
| `JWT_EXPIRY_MINUTES` | Token expiry | `60` | No |
| `MODEL_PATH` | Model weights directory | `/app/models` | No |
| `YOLO_MODEL` | YOLO model filename | `yolov8n.pt` | No |
| `REID_MODEL` | Re-ID model filename | `osnet_x0_25_msmt17.pt` | No |
| `DEVICE` | Compute device | `cuda:0` (auto) | No |
| `LOG_LEVEL` | Logging level | `INFO` | No |
| `ENVIRONMENT` | Runtime environment | `development` | No |
| `CONFIDENCE_THRESHOLD` | Detection confidence | `0.4` | No |
| `WS_FRAME_INTERVAL` | WebSocket frame interval | `0.033` | No |
| `DATABASE_URL` | PostgreSQL connection string | - | No |
| `REDIS_URL` | Redis connection string | - | No |
| `MAX_UPLOAD_SIZE` | Max upload size (bytes) | `104857600` | No |

### Example `.env` file:
```env
# Security (CHANGE IN PRODUCTION!)
API_KEY=sk-ibvap-xxxxxxxxxxxxxxxx
JWT_SECRET=your-256-bit-secret-key-here
JWT_ALGORITHM=HS256
JWT_EXPIRY_MINUTES=60

# Models
MODEL_PATH=/app/models
YOLO_MODEL=yolov8n.pt
REID_MODEL=osnet_x0_25_msmt17.pt

# Runtime
DEVICE=cuda:0
LOG_LEVEL=INFO
ENVIRONMENT=production

# Detection tuning
CONFIDENCE_THRESHOLD=0.4
IOU_THRESHOLD=0.5
MAX_DETECTIONS=100

# WebSocket
WS_FRAME_INTERVAL=0.033
WS_JPEG_QUALITY=80

# Database (optional)
DATABASE_URL=postgresql+asyncpg://ibvap:password@postgres:5432/ibvap
REDIS_URL=redis://redis:6379/0
```

---

## 🏗️ Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Nginx (TLS)   │────▶│  FastAPI Backend │────▶│  PostgreSQL     │
│   Port 443/80   │     │   Port 8000      │     │  Port 5432      │
└─────────────────┘     └────────┬─────────┘     └─────────────────┘
                                 │
                    ┌────────────┼────────────┐
                    ▼            ▼            ▼
             ┌──────────┐ ┌──────────┐ ┌──────────┐
             │  YOLOv8  │ │ BoT-SORT │ │ EasyOCR  │
             │ Detection│ │ Tracking │ │ ANPR     │
             └──────────┘ └──────────┘ └──────────┘
                    │            │            │
                    └────────────┼────────────┘
                                 ▼
                    ┌──────────────────────┐
                    │  WebSocket Stream    │
                    │  /ws/stream          │
                    └──────────────────────┘
```

### AI Pipeline
1. **Frame Input** → Base64 JPEG via WebSocket or REST
2. **YOLOv8 Detection** → Person (class 0), Vehicle (classes 2,3,5,7)
3. **BoT-SORT Tracking** → Persistent track IDs with OSNet Re-ID
4. **Alert Generation** → Intrusion alerts for person detections
5. **Annotation** → Bounding boxes + labels on frame
6. **Output** → Base64 JPEG + JSON detections/alerts via WebSocket

---

## 🔐 Authentication

### API Key (Recommended for WebSocket)
```bash
# Header
X-API-Key: your-api-key

# WebSocket query param
ws://host:8000/ws/stream?api_key=your-api-key
```

### JWT Token (REST endpoints)
```bash
# Get token
curl -X POST http://localhost:8000/auth/token \
  -H "Content-Type: application/json" \
  -d '{"username": "user", "password": "pass"}'

# Use token
curl -H "Authorization: Bearer <token>" http://localhost:8000/analyze ...
```

---

## 📡 API Reference

### System Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/` | None | API info |
| GET | `/health` | None | Health check |
| GET | `/metrics` | None | Prometheus metrics |

### Authentication

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/auth/token` | None | Get JWT token |
| POST | `/auth/verify` | API Key/JWT | Verify token |

### Analysis

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/analyze` | API Key/JWT | Analyze base64 frame |
| POST | `/analyze/upload` | API Key/JWT | Analyze uploaded image |

#### `/analyze` Request:
```json
{
  "frame_base64": "data:image/jpeg;base64,/9j/4AAQSkZJRg...",
  "camera_id": "CAM-001",
  "timestamp": "2024-01-15T10:30:00Z"
}
```

#### Response:
```json
{
  "request_id": "a1b2c3d4",
  "timestamp": "2024-01-15T10:30:00",
  "processing_time_ms": 45.2,
  "detections": [
    {
      "id": "d1e2f3g4",
      "class_name": "Person",
      "class_id": 0,
      "confidence": 0.92,
      "bbox": [100.5, 150.2, 200.8, 300.1],
      "track_id": 42
    }
  ],
  "alerts": [
    {
      "type": "INTRUSION",
      "severity": "HIGH",
      "message": "Person detected (Track ID: 42)",
      "timestamp": "10:30:00",
      "detection_id": "d1e2f3g4"
    }
  ],
  "annotated_frame_base64": "data:image/jpeg;base64,/9j/4AAQSkZJRg..."
}
```

### WebSocket Stream

**Endpoint:** `ws://host:8000/ws/stream?api_key=YOUR_KEY`

**Message Format (Server → Client):**
```json
{
  "frame_id": 123,
  "timestamp": "2024-01-15T10:30:00.123",
  "frame": "data:image/jpeg;base64,/9j/4AAQSkZJRg...",
  "detections": [...],
  "alerts": [...],
  "processing_time_ms": 33.4
}
```

---

## 🐳 Docker Compose Services

```yaml
services:
  postgres:    # PostgreSQL 16
  redis:       # Redis 7 (cache/pubsub)
  backend:     # FastAPI + AI models
  nginx:       # TLS termination + rate limiting
  prometheus:  # Metrics collection (optional)
  grafana:     # Dashboards (optional)
```

### Profiles
```bash
# Core services only
docker compose up -d

# With monitoring
docker compose --profile monitoring up -d

# Development
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

### Service URLs
| Service | Internal | External |
|---------|----------|----------|
| Backend API | backend:8000 | localhost:8000 |
| Nginx (TLS) | nginx:443 | localhost:443 |
| PostgreSQL | postgres:5432 | localhost:5432 |
| Redis | redis:6379 | localhost:6379 |
| Prometheus | prometheus:9090 | localhost:9090 |
| Grafana | grafana:3000 | localhost:3000 |

---

## 🧪 Testing

### Unit Tests
```bash
# Install test dependencies
pip install -r requirements.txt

# Run tests
pytest tests/test_api.py -v

# With coverage
pytest tests/test_api.py --cov=main --cov-report=html
```

### Integration Tests (requires Docker)
```bash
# Run integration tests
pytest tests/test_integration.py -v -m integration --run-integration

# Or with docker-compose stack
pytest tests/test_integration.py::TestDockerComposeIntegration -v --run-integration
```

### Test Structure
```
tests/
├── conftest.py          # Fixtures & configuration
├── test_api.py          # Unit tests for API routes
└── test_integration.py  # Container integration tests
```

---

## 📊 Monitoring

### Prometheus Metrics
Key metrics exposed at `/metrics`:

| Metric | Type | Description |
|--------|------|-------------|
| `ibvap_requests_total` | Counter | HTTP requests by method/endpoint/status |
| `ibvap_request_duration_seconds` | Histogram | Request latency |
| `ibvap_websocket_connections` | Gauge | Active WebSocket connections |
| `ibvap_detections_total` | Counter | Detections by class/severity |
| `ibvap_inference_duration_seconds` | Histogram | Model inference time |

### Grafana Dashboards
Import dashboards from `grafana/dashboards/` for:
- Request throughput & latency
- Detection rates by class
- GPU memory utilization
- WebSocket connection health

### Structured Logging
JSON logs with fields:
```json
{
  "timestamp": "2024-01-15T10:30:00.123Z",
  "level": "info",
  "logger": "main",
  "event": "frame_analyzed",
  "request_id": "a1b2c3d4",
  "detections": 2,
  "alerts": 1,
  "processing_time_ms": 45.2
}
```

---

## 🔒 Production Security

### TLS Certificates
Place certificates in `./ssl/`:
```
ssl/
├── ibvap.crt      # Full chain certificate
└── ibvap.key      # Private key
```

Generate self-signed for testing:
```bash
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout ssl/ibvap.key -out ssl/ibvap.crt \
  -subj "/CN=ibvap.local"
```

### Security Checklist
- [ ] Change default `API_KEY` and `JWT_SECRET`
- [ ] Use strong passwords for PostgreSQL/Redis
- [ ] Enable TLS with valid certificates
- [ ] Configure firewall rules (allow only 443/80)
- [ ] Set up rate limiting in Nginx
- [ ] Enable audit logging
- [ ] Regular security updates: `docker compose pull && docker compose up -d`

---

## 🚀 CI/CD Pipeline

### GitHub Actions (`.github/workflows/ci.yml`)

The pipeline includes:
1. **Lint** - Ruff, Black, MyPy
2. **Test** - Unit tests with coverage
3. **Build** - Multi-arch Docker image
4. **Security** - Trivy vulnerability scan
5. **Deploy** - Push to registry on tag

### Required Secrets
| Secret | Description |
|--------|-------------|
| `DOCKERHUB_USERNAME` | Docker Hub username |
| `DOCKERHUB_TOKEN` | Docker Hub access token |
| `GHCR_TOKEN` | GitHub Container Registry token |

### Trigger Deployment
```bash
# Create and push tag
git tag v1.0.0
git push origin v1.0.0
```

---

## 🛠️ Development

### Local Development
```bash
# Install dependencies
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Run with auto-reload
uvicorn main:app --reload --host 0.0.0.0 --port 8000

# Run tests
pytest tests/ -v
```

### Code Quality
```bash
# Format
black main.py tests/
isort main.py tests/

# Lint
ruff check main.py tests/
mypy main.py

# Type check
mypy --strict main.py
```

### Adding New Models
1. Add model weights to `models/`
2. Update `Settings` class in `main.py`
3. Modify `initialize_models()` function
4. Update `requirements.txt` if new dependencies

---

## 🐛 Troubleshooting

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| Container exits immediately | Model download fails | Check internet access, pre-download models |
| CUDA out of memory | Batch size too large | Reduce `MAX_DETECTIONS`, lower resolution |
| WebSocket disconnects | Network timeout | Increase `WS_FRAME_INTERVAL`, check proxy timeouts |
| Slow inference | CPU fallback | Verify `nvidia-smi` in container, check `CUDA_VISIBLE_DEVICES` |
| Health check fails | Models not loaded | Check logs: `docker logs ibvap-backend` |

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
```

---

## 📦 Deployment

### Production Checklist
- [ ] All secrets in `.env` (not in image)
- [ ] TLS certificates configured
- [ ] Database migrations run
- [ ] Monitoring alerts configured
- [ ] Backup strategy for PostgreSQL
- [ ] Log aggregation (ELK/Loki)
- [ ] Load testing completed

### Kubernetes Deployment
```yaml
# Example K8s deployment (see k8s/ directory)
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ibvap-backend
spec:
  replicas: 3
  selector:
    matchLabels:
      app: ibvap-backend
  template:
    spec:
      containers:
      - name: backend
        image: your-registry/ibvap-backend:v1.0.0
        resources:
          limits:
            nvidia.com/gpu: 1
            memory: "8Gi"
            cpu: "4"
        envFrom:
        - secretRef:
            name: ibvap-secrets
```

---

## 📄 License

Proprietary - IBVAP Project

---

## 🤝 Contributing

1. Fork the repository
2. Create feature branch: `git checkout -b feature/amazing-feature`
3. Commit changes: `git commit -m 'feat: add amazing feature'`
4. Push to branch: `git push origin feature/amazing-feature`
5. Open Pull Request

---

## 📞 Support

- **Documentation**: `/docs` endpoint
- **Issues**: GitHub Issues
- **Email**: support@ibvap.example.com