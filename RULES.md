# rules.md — Coding Guardrails & Standards (Part 1: Tech Stack & Operational Rules)

## 1. Technology Boundaries & Stack Lock-In
* **Frontend:**
  * Framework: React 18 with Vite. Standard React Hooks (`useState`, `useEffect`, `useContext`, `useRef`, `useCallback`, `useMemo`) only.
  * Styling: Tailwind CSS exclusively. No external CSS libraries (Bootstrap, Material UI, Chakra UI).
  * Icons: `lucide-react` icons exclusively.
  * Mapping: `leaflet` and `react-leaflet` for GIS tactical map rendering.
* **Backend:**
  * Framework: Python 3.11 with FastAPI (ASGI runtime).
  * Validation: Pydantic v2 schemas for all request/response models.
  * ORM / Database: SQLAlchemy 2.0 (async engine) with SQLite (local development) / PostgreSQL (production).
* **AI & Computer Vision Engines:**
  * Object Detection / Tracking: Ultralytics YOLOv8n, ByteTrack[cite: 1, 2].
  * Preprocessing & Feature Extraction: OpenCV (`opencv-python-headless`), PyTorch, torchvision.
  * Cryptography: PyCryptodome (`Crypto.Cipher`, `Crypto.Hash`) for AES-256 and SHA-256 ledger operations[cite: 1, 2].

---

## 2. Core Architectural & Operational Rules

### Rule 2.1 — Zero Raw Video Network Transmission
* Edge nodes **must never** transmit full, uncompressed, or continuous raw video streams over WAN/Satellite links[cite: 1, 2].
* Uplinks are strictly restricted to AES-256 encrypted JSON metadata objects and cropped JPEG keyframe buffers (< 100 KB)[cite: 1, 2].
* On-demand raw video streaming is permitted **only** when an operator explicitly requests a low-latency WebRTC tunnel from the C2 dashboard[cite: 1, 2].

### Rule 2.2 — Privacy-by-Design Data Disposal
* Facial embedding vectors generated during detection must be checked in volatile RAM against FAISS/watchlist stores[cite: 1, 2].
* If no cosine similarity match is identified, facial embeddings and associated crops **must be scrubbed from memory immediately**[cite: 1, 2].
* Temporary disk writes or persistent logging of non-watchlist citizens is strictly forbidden to prevent unlawful mass surveillance[cite: 1, 2].

### Rule 2.3 — Stateless Edge Ingestion
* Frame processing functions must operate statelessly or on fixed-size sliding windows (< 30 frames) to prevent RAM inflation on NVIDIA Jetson or edge Mini-PC units[cite: 1, 2].
* Background models (such as Zero-DCE) must process frames in-memory without disk caching[cite: 1, 2].

### Rule 2.4 — Environment Configuration & Secrets
* No hardcoded API keys, backend endpoints, database passwords, or cryptographic keys inside source code.
* Environment variables must be loaded via `pydantic-settings` on the backend and `import.meta.env` (Vite) on the frontend.

# rules.md — Coding Guardrails & Standards (Part 2: Error Schemas & Failover)

## 3. Error Handling & API Response Specifications

### Standard Success Response Schema
* All successful API calls must adhere to the following JSON structure:
  * `success`: `true` (boolean)
  * `data`: Payload dictionary or list
  * `timestamp`: ISO 8601 UTC string (e.g., `"2026-09-04T11:28:00Z"`)

### Standard Error Response Schema
* All backend routes must catch exceptions and return unified HTTP error payloads:
  * `success`: `false` (boolean)
  * `error.code`: Categorized string code (e.g., `"EDGE_NODE_DISCONNECTED"`, `"UNAUTHORIZED_ACCESS"`)
  * `error.message`: Clear context explanation string
  * `error.details`: Additional debug dictionary or `null`
  * `timestamp`: ISO 8601 UTC string

### Frontend Failover Handling
* The frontend API service (`api.js`) must implement automated dual-endpoint failover:
  1. Primary Endpoint: Modal Cloud GPU (`https://<app>.modal.run`)
  2. Secondary Endpoint: Hugging Face Spaces (`https://<user>-<space>.hf.space`)
* Requests timing out after 8,000 ms must automatically fall back to the backup endpoint without crashing the UI.

# rules.md — Coding Guardrails & Standards (Part 3: Code Quality & AI Rules)

## 4. Code Quality & Formatting Rules

* **Python (Backend & AI Pipelines):**
  * Type hints are mandatory for every function signature (`def process_frame(frame: np.ndarray) -> Dict[str, Any]:`).
  * Async execution (`async def`) must be used for all non-blocking I/O operations (database queries, WebSocket broadcasts, HTTP endpoints).
* **JavaScript / JSX (Frontend):**
  * Functional components only. No class components.
  * Modular component architecture: Each UI component (e.g., `MapGIS.jsx`, `AlertPanel.jsx`) must reside in its own file under `src/components/`.

---

## 5. AI-Assisted Code Generation Boundaries

1. **No Code Truncation:** AI coding assistants must generate complete, syntactically valid, production-ready files. Never use placeholder comments like `// rest of code here` or `# implement logic here`.
2. **Directory Structure Strictness:** Every newly generated file must map directly to the defined layout in `architecture.md`.
3. **No Unapproved Dependencies:** AI must not import or introduce non-approved dependencies (e.g., Axios, Redux, jQuery, Moment.js, Express) without explicit user authorization.

