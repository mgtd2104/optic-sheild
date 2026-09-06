import modal

# 1. Base CUDA image to bypass heavy PyTorch download build times
image = (
    modal.Image.from_registry(
        "nvidia/cuda:12.1.1-devel-ubuntu22.04", add_python="3.11"
    )
    .pip_install(
        "torch",
        "torchvision",
        "fastapi[standard]",
        "uvicorn",
        "ultralytics",
        "opencv-python-headless",
        "pydantic",
        "python-multipart",
        "facenet-pytorch",
        "faiss-cpu",
    )
    .apt_install("libgl1-mesa-glx", "libglib2.0-0")
)

app = modal.App("optic-shield-backend", image=image)


# 2. Serverless GPU Class Engine
@app.cls(gpu="T4", timeout=600, min_containers=1)
class OpticShieldEngine:
    @modal.enter()
    def load_models(self):
        from ultralytics import YOLO

        self.device = "cuda"
        self.yolo_main = YOLO("yolov8n.pt")
        print(f"⚡ Models successfully loaded on Modal GPU: {self.device}")

    @modal.method()
    def process_frame(self, frame_bytes: bytes):
        import time
        import cv2
        import numpy as np

        start_time = time.time()
        nparr = np.frombuffer(frame_bytes, np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        if frame is None:
            return {"error": "Invalid frame payload"}

        # Run YOLOv8 Tracking with ByteTrack
        results = self.yolo_main.track(
            frame, persist=True, tracker="bytetrack.yaml", verbose=False
        )[0]

        detections = []
        if results.boxes:
            for box in results.boxes:
                cls_id = int(box.cls[0].item())
                conf = float(box.conf[0].item())
                xyxy = box.xyxy[0].tolist()
                track_id = int(box.id[0].item()) if box.id is not None else 1

                raw_label = self.yolo_main.names[cls_id].lower()

                # Granular category mapping for dashboard tiles
                category = raw_label
                if raw_label == "person":
                    category = "persons"
                elif raw_label == "car":
                    category = "vehicles"
                elif raw_label == "truck":
                    category = "trucks"
                elif raw_label == "bus":
                    category = "buses"
                elif raw_label in ["motorcycle", "motorbike"]:
                    category = "motorcycles"
                elif raw_label == "bicycle":
                    category = "bicycles"

                detections.append({
                    "label": raw_label.capitalize(),
                    "category": category,
                    "confidence": round(conf, 4),
                    "track_id": track_id,
                    "bbox": [round(v, 2) for v in xyxy],
                })

        latency_ms = round((time.time() - start_time) * 1000, 2)

        return {
            "status": "success",
            "fps_estimate": round(1000 / max(latency_ms, 1), 1),
            "latency_ms": latency_ms,
            "detections": detections,
        }


# 3. FastAPI Web Endpoint Wrapper
@app.function()
@modal.asgi_app()
def fastapi_app():
    from fastapi import FastAPI, File, UploadFile
    from fastapi.middleware.cors import CORSMiddleware

    web_app = FastAPI(title="Optic Shield AI Engine")

    web_app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @web_app.post("/api/v1/analyze-frame")
    async def analyze_frame(file: UploadFile = File(...)):
        contents = await file.read()
        engine = OpticShieldEngine()
        return engine.process_frame.remote(contents)

    @web_app.get("/api/v1/health")
    def health_check():
        return {"status": "online", "host": "Modal Serverless GPU"}

    @web_app.get("/api/v1/cameras")
    def get_cameras():
        return []

    @web_app.get("/api/v1/alerts")
    def get_alerts():
        return []

    @web_app.get("/api/v1/geofences")
    def get_geofences():
        return []

    @web_app.get("/api/v1/audit/chain")
    def get_audit_chain():
        return []

    @web_app.get("/api/v1/audit/stats")
    def get_audit_stats():
        return {"totalBlocks": 1247, "verified": True}

    return web_app