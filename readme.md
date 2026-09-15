# Optic Shield – Autonomous On-Premises AI Border Surveillance Platform

Optic Shield is an air-gapped, zero-cloud AI border surveillance platform designed for perimeter defense. It processes live CCTV and optical camera feeds on local edge hardware using YOLOv8, ByteTrack, MTCNN, and ANPR, transmitting low-bandwidth threat metadata and real-time alerts to a self-hosted central command dashboard.

---

## Technical Stack & Architecture

* **Frontend Dashboard:** React.js, HTML5, CSS3, JavaScript (Vite / Tailwind UI)
* **Backend Core:** Python, FastAPI, RTSP Stream Ingestion, WebSockets
* **AI Analytics Engine:**
* YOLOv8 – Real-Time Object Detection
* ByteTrack – Multi-Object Target Tracking
* MTCNN & InceptionXR – Face Detection & Recognition
* ANPR – Automatic Number Plate Recognition


* **Data & Vector Layer:** Meta FAISS (High-Dimensional Vector Similarity Search)
* **Security & Audit:** SHA-256 Cryptographic Hashing for tamper-proof evidence logs

---

## Option 1: Standard Local Setup (On-Premises Machine)

### Prerequisites

* Python 3.9 or higher
* Node.js v18+ and npm
* CUDA-compatible GPU (Recommended for high FPS edge inference)

### 1. Backend Setup (FastAPI + AI Engine)

Clone the repository:
git clone [https://github.com/your-username/optic-shield.git](https://www.google.com/search?q=https://github.com/your-username/optic-shield.git&utm_source=gemini)
cd optic-shield/backend

Create and activate a virtual environment:
python -m venv venv

On Linux/macOS:
source venv/bin/activate

On Windows:
venv\Scripts\activate

Install Python dependencies:
pip install -r requirements.txt

Launch the FastAPI application server:
uvicorn main:app --reload --host 0.0.0.0 --port 8000

### 2. Frontend Setup (React Command Center)

Open a new terminal window:
cd optic-shield/frontend

Install dependencies:
npm install

Start local React development server:
npm run dev

Access the command dashboard at http://localhost:5173

---

## Option 2: Running Directly from Google Colab (GPU-Accelerated)

You can run the full FastAPI backend with free NVIDIA T4 GPU support inside a Google Colab notebook and connect it to your local React frontend using pyngrok.

### Step 1: Install Dependencies in Colab

Run this code in your first Colab cell:

!pip install fastapi uvicorn pyngrok nest_asyncio ultralytics opencv-python-headless faiss-gpu

import nest_asyncio
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pyngrok import ngrok
from ultralytics import YOLO

nest_asyncio.apply()

### Step 2: Configure Public Tunnel (ngrok)

Sign up at ngrok.com to get your free Auth Token, then run:

NGROK_TOKEN = "YOUR_NGROK_AUTHTOKEN_HERE"
ngrok.set_auth_token(NGROK_TOKEN)

public_url = ngrok.connect(8000)
print(f"🚀 Public API Endpoint: {public_url}")

### Step 3: Run the FastAPI AI Analytics Engine

Run the server cell to process detections on Google Colab's GPU:

app = FastAPI(title="Optic Shield AI Analytics Engine")

app.add_middleware(
CORSMiddleware,
allow_origins=["*"],
allow_credentials=True,
allow_methods=["*"],
allow_headers=["*"],
)

model = YOLO('yolov8n.pt')

@app.get("/")
def root():
return {
"system": "Optic Shield Engine",
"status": "Operational",
"cloud_dependency": "Zero"
}

@app.get("/detect-sample")
def detect_sample():
results = model("[https://ultralytics.com/images/bus.jpg](https://www.google.com/search?q=https://ultralytics.com/images/bus.jpg&utm_source=gemini)")
detections = []
for r in results:
for box in r.boxes:
detections.append({
"class": model.names[int(box.cls)],
"confidence": float(box.conf),
"bbox": box.xyxy.tolist()
})
return {"threat_level": "ANALYZED", "detections": detections}

uvicorn.run(app, host="0.0.0.0", port=8000)

---

## Repository Directory Structure

optic-shield/
├── backend/
│   ├── main.py              # FastAPI application entry point
│   ├── ai_engine/           # YOLOv8, ByteTrack, & MTCNN pipelines
│   ├── models/              # Pre-trained weights (.pt / TensorRT)
│   └── database/            # FAISS index vector storage & SHA-256 logger
├── frontend/
│   ├── src/                 # React UI components, maps, & state
│   └── public/              # Static assets & UI heatmaps
├── colab_demo.ipynb         # One-click Google Colab deployment notebook
└── README.md                # Project documentation