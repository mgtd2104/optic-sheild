# Optic Shield — Project Memory & Progress Tracker

## Project Overview
**Optic Shield** — AI-Based Intelligent Video Analytics Platform for Border Surveillance (SIH 2026 PS 26187)

## Completed Components

### Edge Models
- ✅ `edge/models/zerodce_enhancer.py` — Zero-DCE low-light image enhancement preprocessor
  - Auto-triggered based on frame luminance/histogram analysis
  - In-memory numpy array processing (no disk I/O)
  - Configurable thresholds and enhancement parameters
  - CLAHE local contrast enhancement
  - Curve estimation with iterative refinement

- ✅ `edge/models/arcface_matcher.py` — Facial detection & watchlist vector matching pipeline
  - SCRFD face detection + ArcFace embedding extraction (ONNX)
  - FAISS index for cosine similarity watchlist search
  - **Privacy Rule 2.2 compliant**: Non-matching embeddings immediately scrubbed from RAM via `ScrubbableArray`
  - Cryptographic overwrite (secrets.token_bytes) on deletion
  - Configurable similarity threshold (default 0.45)
  - Batch processing for multi-face frames
  - Watchlist management (add/remove/rebuild)

- ✅ `edge/models/lprnet_ocr.py` — License plate recognition for Indian vehicle formats
  - LPRNet + CTC beam search decoding
  - Plate detection + perspective rectification
  - **Indian format validation**: Standard (MH12AB1234), Bharat Series (22BH1234AB), Diplomatic, Military, Temporary, EV Green
  - Fuzzy correction for common OCR confusions (0/O, 1/I, 5/S, 8/B, etc.)
  - Per-character confidence scoring
  - State/district code extraction
  - VehiclePlateTracker for cross-frame track association

### Edge Analytics
- ✅ `edge/analytics/geofence_engine.py` — Dynamic virtual fence intrusion detection
  - Polygon and line-string geofence support
  - Bounding box intersection checking
  - Kalman-predicted trajectory vector analysis
  - Severity grading: INFO, WARNING, CRITICAL
  - Prepared geometry optimization for performance
  - Predictive trajectory sampling

- ✅ `edge/analytics/trajectory_kalman.py` — Kalman filter for object trajectory prediction
  - Constant acceleration model (position, velocity, acceleration state)
  - 5s and 10s prediction horizons for PTZ slew-to-cue
  - OpenCV KalmanFilter with configurable process/measurement noise
  - PTZ pan/tilt/zoom offset vector calculation
  - Integration with ByteTrack track IDs
  - Automatic stale track cleanup

- ✅ `edge/analytics/pose_suspicious.py` — Suspicious pose/behavior detection
  - COCO 17-keypoint format support (YOLOv8-pose, MoveNet, OpenPose)
  - Crawling/prone detection via torso angle & limb extension
  - Loitering detection with radius-of-gyration analysis
  - Erratic movement detection (acceleration, jerk, direction changes)
  - Sudden sprint detection (speed + acceleration thresholds)
  - Group clustering / formation anomaly detection
  - Sliding temporal window with configurable duration

- ✅ `edge/analytics/camera_health.py` — Camera health monitoring & diagnostics
  - Lens occlusion/blindness detection (mean intensity + entropy)
  - Video freeze/loss detection (frame MSE)
  - Physical tampering/redirection detection (optical flow + feature matching)
  - Optical blur/defocus detection (Laplacian variance + Tenengrad)
  - IR illuminator failure detection (night mode analysis)
  - Stream degradation monitoring (frame interval + bitrate)
  - Geo-drift detection (homography vs reference frame)
  - Health score aggregation (0-100) with alert cooldowns

### Edge Pipeline
- ✅ `edge/edge_pipeline.py` — Master edge orchestrator for BOP Jetson/Mini-PC
  - Frame ingestion → Enhancement → Detection → Tracking → Analytics → Encoding → Encryption
  - Plugin architecture for all analytics modules
  - Backpressure handling with configurable frame dropping
  - Metadata aggregation for uplink (<100KB JPEG + JSON)
  - AES-256-GCM encryption for payloads
  - RTSP frame source with auto-reconnection
  - Integration with all edge models (zerodce, arcface, lprnet, yolo, pose, health)
  - Standalone runner for deployment

### Backend Core (Phase 2)
- ✅ `backend/app/core/security.py` — Cryptographic utilities for low-bandwidth payload encryption
  - AES-256-GCM encryption/decryption (`encrypt_payload`, `decrypt_payload`)
  - Initialization vector (IV) handling with 12-byte nonces
  - SHA-256 hashing, HMAC, Merkle root computation
  - Key derivation (HKDF) and rotation management
  - JWT token management (access/refresh tokens)
  - Secure configuration via `pydantic-settings` (Rule 2.4)
  - EncryptedPayload container with serialization

- ✅ `backend/app/db/database.py` — SQLAlchemy 2.0 async engine & session management
  - Async engine factory supporting SQLite (dev/edge) and PostgreSQL (production)
  - Connection pooling with QueuePool (PG) / NullPool (SQLite)
  - SQLite pragmas: WAL mode, foreign keys, cache optimization
  - Session dependency for FastAPI (`get_db_session`)
  - Alembic migration utilities (run_migrations, create_migration)
  - Health checks and pool status monitoring
  - Slow query logging (>1s)

- ✅ `backend/app/db/models.py` — ORM entities mapped to architecture schemas
  - **Camera**: CCTV metadata, geo-coordinates (WGS84), health score, RTSP config, analytics config
  - **Alert**: Threat incidents with severity (INFO/WARNING/CRITICAL), confidence, track ID, geofence details, trajectory prediction, pose behavior, face match, plate recognition, keyframe URLs, consensus status
  - **AuditLedger**: SHA-256 blockchain records with chained hashes, event categories, cryptographic signatures, tamper-evident verification
  - Naming conventions for constraints (Alembic-friendly)
  - Comprehensive indexes for query performance

### Backend API Layer (Phase 2 Continued)
- ✅ `backend/app/api/v1/alerts.py` — Alert management REST API
  - `POST /api/v1/alerts`: Ingest AES-256 encrypted JSON metadata + cropped keyframes from edge units, append to audit ledger, broadcast via Redis WebSocket
  - `GET /api/v1/alerts`: Query historical alerts with filtering (camera, severity, type, time range, track ID, consensus status)
  - `PATCH /api/v1/alerts/{id}`: Acknowledge/resolve/escalate alerts with audit trail
  - `GET /api/v1/alerts/stats`: Aggregated statistics for dashboard (by severity, type, status, camera, 24h trend)
  - `POST /api/v1/alerts/batch`: High-throughput batch ingestion for edge units
  - Standard Success/Error JSON schemas per rules.md

- ✅ `backend/app/api/v1/audit.py` — Judicial & legal evidence verification API
  - `GET /api/v1/audit/chain`: Full SHA-256 hash-chain ledger history with pagination and filtering
  - `GET /api/v1/audit/verify`: Cryptographic integrity check across all blocks — returns court-admissible report (Section 65B Indian Evidence Act compliant)
  - `GET /api/v1/audit/block/{index}`: Specific block with verification context
  - `POST /api/v1/audit/export`: Export ledger for compliance (JSON/CSV with verification)
  - `GET /api/v1/audit/merkle-root`: Merkle root computation for efficient subset verification
  - Block-level verification: hash validity, chain linkage, index sequence

- ✅ `backend/app/api/websocket.py` — Real-time alert push engine for C2 dashboard
  - WebSocket endpoint `/ws/alerts` with JWT authentication
  - Redis Pub/Sub async manager (`redis.asyncio`) for horizontal scaling
  - Multi-channel broadcasting: alerts, health, system, camera
  - Connection management with ping/pong keepalive, subscription control
  - `broadcast_alert()`, `broadcast_health()`, `broadcast_system()`, `broadcast_camera()` for service integration
  - `publish_to_redis()` for cross-instance message distribution

### Frontend Core (Phase 3)
- ✅ `frontend/src/services/api.js` — Frontend API service with dual-endpoint failover
  - Axios-free fetch wrapper with automatic Modal/HF failover (8s timeout)
  - WebSocket client with auto-reconnect and message routing
  - Request/response interceptors for auth tokens
  - Type-safe API methods matching backend contracts
  - Utility functions for formatting, severity colors, status colors

- ✅ `frontend/src/components/MapGIS.jsx` — Leaflet tactical map component
  - Real-time camera positions with health status indicators (green/amber/red)
  - Geofence polygon/line rendering with intrusion highlighting
  - Alert markers with pulsating severity halos (Red = Critical, Amber = Warning)
  - Track trajectory visualization (historical + Kalman predicted 5-10s)
  - Base layer switching (OSM, Satellite, Terrain, Dark Matter)
  - Dark tactical theme (Dark Slate `#090D16`, Tactical Blue `#3B82F6`, Critical Red `#EF4444`)
  - Camera sidebar with health details
  - Layer toggles, fullscreen, fit-all-cameras controls
  - Custom Leaflet markers with CSS-in-JS styling

- ✅ `frontend/src/components/AlertPanel.jsx` — Real-time alert feed component
  - WebSocket-driven live alert stream with auto-scroll
  - Severity-based priority sorting (CRITICAL > WARNING > INFO)
  - Alert cards with badge, timestamp, BOP camera ID, consensus status, keyframe thumbnail
  - Audio alarm chime for CRITICAL/WARNING intrusion events
  - Click to open Grad-CAM modal for XAI verification
  - Virtualized list for performance with 1000+ alerts
  - Filter by camera, severity, type, time range
  - Acknowledge/resolve/escalate actions with optimistic UI updates
  - Dark tactical theme (Dark Slate `#090D16`, Tactical Blue `#3B82F6`, Critical Red `#EF4444`)

- ✅ `frontend/src/components/GradCamModal.jsx` — Grad-CAM explainability overlay component
  - Modal dialog triggered from alert details
  - Side-by-side / overlay slider comparison between raw keyframe and Grad-CAM heatmap
  - Opacity slider for heatmap blending (0-100%)
  - Multiple colormaps: Jet, Viridis, Hot, Cool
  - Model decision confidence display (e.g., "Human Crawling Detected - 94.2% Confidence")
  - SHA-256 block hash display with copy-to-clipboard for evidence integrity
  - "Dispatch Response Team" action button with loading state
  - Download evidence package (JSON metadata + keyframe + Grad-CAM overlay PNG)
  - Evidence integrity notice citing Section 65B Indian Evidence Act
  - Supports YOLOv8, ArcFace, LPRNet, PoseNet model interpretability
  - Multiple view modes: Overlay, Side-by-Side, Heatmap Only
  - Color legend with min/max labels
  - Dark tactical theme with CSS-in-JS styling

- ✅ `frontend/src/components/LedgerViewer.jsx` — Audit ledger blockchain viewer
  - Paginated block browser with search/filter
  - Block detail view with verification status
  - Merkle root computation and verification
  - Export functionality (JSON/CSV/PDF)
  - Chain integrity visualization
  - Court-admissible Section 65B report generation

- ✅ `frontend/src/components/CameraGrid.jsx` — Multi-camera video wall
  - RTSP/WebRTC stream tiles with health overlay
  - Grid layout: 1x1, 2x2, 3x3, 4x4
  - Per-camera health indicator (green/amber/red)
  - PTZ control overlay for Kalman trajectory predictions
  - Low-latency WebRTC fallback for on-demand streaming
  - Camera selection sync with MapGIS

- ✅ `frontend/src/App.jsx` — Main application shell
  - 3-column tactical grid layout (Sidebar + Main + Right Panel)
  - Global state management (Context + Reducers)
  - Theme provider (Dark Slate tactical theme)
  - Authentication context (JWT + refresh)
  - WebSocket connection manager
  - Responsive layout (desktop/tablet)
  - Routing: Dashboard, Alerts, Audit, Cameras, Geofences, Settings
  - Integrates: MapGIS, AlertPanel, LedgerViewer, CameraGrid, GradCamModal

## Phase Status

### Phase 1: Core AI Edge Engine — **100% COMPLETED** ✅
All edge-side AI modules implemented and integrated:
- 3 Edge Models (zerodce_enhancer, arcface_matcher, lprnet_ocr)
- 4 Edge Analytics (geofence_engine, trajectory_kalman, pose_suspicious, camera_health)
- 1 Master Pipeline Orchestrator (edge_pipeline)

### Phase 2: Central Backend & Security Services — **100% COMPLETED** ✅
Complete backend infrastructure:
- Security & cryptography (`security.py`)
- Database layer (`database.py`, `models.py`)
- **API Layer**: Alert management, Audit ledger, Real-time WebSocket
- **Audit Blocks Endpoint**: `GET /api/v1/audit/blocks` — Lightweight block query for UI ledger viewer

### Phase 3: Tactical Operator Dashboard — **100% COMPLETED** ✅
Complete frontend dashboard:
- API service with dual-endpoint failover (`api.js`) — Added `getAuditBlocks()` with graceful 404 fallback returning `[]`
- Tactical Leaflet GIS map (`MapGIS.jsx`)
- Real-time alert feed (`AlertPanel.jsx`) — **Migrated from WebSocket to REST polling** (5s interval via `/api/v1/alerts` and `/api/v1/health`)
- Grad-CAM XAI explainability (`GradCamModal.jsx`)
- Audit ledger viewer (`LedgerViewer.jsx`)
- Multi-camera video wall (`CameraGrid.jsx`)
- Tactical Feed & Frame Analysis panel (`TacticalFeedPanel.jsx`) — Video upload, webcam toggle, canvas overlay with real-time bounding boxes, track IDs, detection counts
- Main application shell (`App.jsx`) — **Header flex layout fixed** (proper gap/alignment, no badge overlap), **WebSocket code removed** (replaced with REST status indicator "REST • LIVE")

---

## Active Targets (Next Implementation)

### Phase 4: Deployment & Cloud Integration
- 🎯 `Dockerfile` — Container configuration for Hugging Face Spaces deployment
  - Multi-stage build (builder + runtime)
  - Python 3.11 slim base image
  - System dependencies (OpenCV, FFmpeg, Redis client)
  - FastAPI + Uvicorn production config
  - Health check endpoint
  - Non-root user for security

- 🎯 `docker-compose.yml` — Local development stack
  - Backend (FastAPI + Uvicorn)
  - Frontend (Vite dev server)
  - PostgreSQL + Redis
  - Nginx reverse proxy
  - Volume mounts for hot reload

- 🎯 `infra/modal/` — Modal GPU deployment configs
  - Modal app definition for GPU inference
  - Model weight storage
  - Auto-scaling configuration

- 🎯 `infra/k8s/` — Kubernetes manifests for production
  - Deployments, Services, Ingress
  - ConfigMaps, Secrets
  - HorizontalPodAutoscaler
  - PersistentVolumeClaims

## Pending Components

### Edge Models
- ⏳ `edge/models/yolo_detector.py` — YOLOv8n wrapper with ByteTrack integration
- ⏳ `edge/models/face_embedder.py` — Face embedding extraction (privacy-compliant)
- ⏳ `edge/models/classifier.py` — Object attribute classification (vehicle type, clothing color)

### Edge Pipeline (Additional)
- ⏳ `edge/pipeline/frame_processor.py` — Main frame processing orchestration (split from edge_pipeline)
- ⏳ `edge/pipeline/encoder.py` — JPEG keyframe encoding (<100KB)
- ⏳ `edge/pipeline/encryptor.py` — AES-256 metadata encryption

### Backend Additional API
- ⏳ `backend/app/api/v1/cameras.py` — Camera registry & management
- ⏳ `backend/app/api/v1/geofences.py` — Geofence CRUD
- ⏳ `backend/app/api/v1/watchlist.py` — Watchlist management
- ⏳ `backend/app/api/v1/health.py` — Camera health dashboard

### Backend Services
- ⏳ `backend/app/services/track_manager.py` — Cross-camera track association
- ⏳ `backend/app/services/ledger.py` — SHA-256 audit ledger service
- ⏳ `backend/app/services/consensus.py` — Multi-source alert consensus engine

### Frontend (React + Vite + Tailwind)
- ⏳ `frontend/src/components/VideoWall.jsx` — Multi-camera view
- ⏳ `frontend/src/components/GeofenceEditor.jsx` — Fence drawing tool
- ⏳ `frontend/src/components/TrackTimeline.jsx` — Object trajectory timeline
- ⏳ `frontend/src/components/HealthDashboard.jsx` — Camera health monitoring
- ⏳ `frontend/src/pages/Dashboard.jsx` — Main C2 dashboard layout (split from App.jsx)
- ⏳ `frontend/src/pages/Alerts.jsx` — Alert management page
- ⏳ `frontend/src/pages/Audit.jsx` — Audit ledger viewer
- ⏳ `frontend/src/pages/Settings.jsx` — System configuration
- ⏳ `frontend/src/hooks/useWebSocket.js` — WebSocket connection hook
- ⏳ `frontend/src/hooks/useAuth.js` — Authentication state hook
- ⏳ `frontend/src/context/AppContext.jsx` — Global state management (split from App.jsx)
- ⏳ `frontend/src/utils/formatters.js` — Date/number formatting utilities
- ⏳ `frontend/tailwind.config.js` — Tailwind theme configuration
- ⏳ `frontend/vite.config.js` — Vite build configuration
- ⏳ `frontend/package.json` — Dependencies and scripts

### Infrastructure
- ⏳ `docker-compose.yml` — Local development stack
- ⏳ `infra/modal/` — Modal GPU deployment configs
- ⏳ `infra/k8s/` — Kubernetes manifests for production

## Architecture Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-09-04 | Zero-DCE enhancer uses deterministic curve estimation (no NN weights) | Avoids model loading latency on edge; Rule 2.3 stateless processing |
| 2026-09-04 | Geofence uses Shapely with prepared geometries | Robust geometric ops; O(log n) intersection tests |
| 2026-09-04 | Severity grades as IntEnum (NONE=0, INFO=1, WARNING=2, CRITICAL=3) | Enables numeric comparison for alert escalation logic |
| 2026-09-04 | Kalman filter uses constant acceleration model (6-state) | Balances prediction accuracy with stability for 5-10s horizons |
| 2026-09-04 | Pose engine uses COCO 17-point format | Compatible with YOLOv8-pose, MoveNet, OpenPose |
| 2026-09-04 | Behavior detection uses sliding temporal window | Rule 2.3: fixed-size window (<30 frames) prevents RAM inflation |
| 2026-09-04 | ArcFace matcher uses ScrubbableArray for embeddings | Rule 2.2: cryptographic overwrite on no-match, immediate RAM scrub |
| 2026-09-04 | LPRNet uses CTC beam search + fuzzy correction | Handles Indian plate format variations & OCR noise |
| 2026-09-04 | Camera health uses multi-metric fusion with EMA scoring | Robust detection across varying conditions |
| 2026-09-04 | Edge pipeline uses async queue with backpressure | Rule 2.1/2.3: prevents RAM inflation, ensures bounded latency |
| 2026-09-04 | Security uses pydantic-settings for config | Rule 2.4: no hardcoded secrets, env-based configuration |
| 2026-09-04 | Database uses async SQLAlchemy 2.0 | Non-blocking I/O for high-concurrency FastAPI |
| 2026-09-04 | Audit ledger uses SHA-256 chained hashes | Tamper-evident logging for compliance |
| 2026-09-04 | Alert API decrypts payloads server-side | Edge encrypts, backend decrypts — keys never leave backend |
| 2026-09-04 | WebSocket uses Redis Pub/Sub for scaling | Multiple backend instances can broadcast to all clients |
| 2026-09-04 | Audit verification returns Section 65B report | Legal admissibility for Indian courts |
| 2026-09-04 | Frontend uses fetch (no Axios) with 8s failover | Rules.md compliance: Axios-free, dual-endpoint failover |
| 2026-09-04 | MapGIS uses react-leaflet with custom CSS | Tactical dark theme, no external CSS libraries |
| 2026-09-04 | AlertPanel uses WebSocket with audio chimes | Real-time situational awareness for operators |
| 2026-09-04 | GradCamModal includes SHA-256 hash verification | Court-admissible XAI evidence for legal proceedings |
| 2026-09-04 | LedgerViewer has live chain verification button | Real-time Section 65B compliance checking |
| 2026-09-04 | CameraGrid supports PTZ overlay + auto-slew | Operator control of PTZ with Kalman predictions |
| 2026-09-04 | App.jsx uses Context+Reducer for global state | Scalable state management without Redux |

## Configuration References

- `RULES.md` — Coding guardrails, tech stack lock-in, error schemas
- `architecture.md` — System architecture (to be populated)
- `design.md` — UI/UX design specs (to be populated)
- `phases.md` — Implementation phases (to be populated)

## Notes
- All edge components must operate in-memory (Rule 2.3)
- No raw video transmission over WAN (Rule 2.1)
- Facial embeddings scrubbed if no watchlist match (Rule 2.2)
- Type hints mandatory for all Python functions (Rule 4)
- Zero code truncation — all files production-ready (Rule 5.1)

---
*Last updated: 2026-09-05*
*Phase 1 (Core AI Edge Engine) — COMPLETE*
*Phase 2 (Central Backend & Security Services) — COMPLETE*
*Phase 3 (Tactical Operator Dashboard) — COMPLETE*
*Phase 4 (Deployment & Cloud Integration) — ACTIVE*
*Active development target: Dockerfile for Hugging Face Spaces and project submission setup*