import torch
import cv2
import numpy as np

print("\n--------------------------------------------------")
print(f"CUDA Available: {torch.cuda.is_available()}")
if torch.cuda.is_available():
    print(f"GPU Device: {torch.cuda.get_device_name(0)}")
print("--------------------------------------------------\n")

# 1. Test YOLOv8n (Detection & ByteTrack)
print("[1/4] Loading YOLOv8n...")
from ultralytics import YOLO
yolo_model = YOLO("yolov8n.pt")
print("✓ YOLOv8n Loaded Successfully!")

# 2. Test ArcFace (Face Recognition)
print("\n[2/4] Testing DeepFace / ArcFace...")
from deepface import DeepFace
print("✓ DeepFace Framework Ready!")

# 3. Test OSNet via BoxMOT (Person Re-ID Tracker)
print("\n[3/4] Testing OSNet Re-ID Tracker...")
from boxmot.trackers.registry import create_tracker
tracker = create_tracker(
    tracker_type="botsort",
    reid_weights="osnet_x0_25_msmt17.pt",
    device="cuda:0" if torch.cuda.is_available() else "cpu"
)
print("✓ BoxMOT OSNet Tracker Ready!")

# 4. Test EasyOCR (ANPR Engine)
print("\n[4/4] Testing EasyOCR Engine...")
import easyocr
reader = easyocr.Reader(['en'], gpu=torch.cuda.is_available())
print("✓ ANPR Engine Ready!")

print("\n==================================================")
print("  ALL LOCAL MODELS SUCCESSFULLY INSTALLED & READY!")
print("==================================================\n")