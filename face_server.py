"""
Face Recognition Server - Visitor Management System
====================================================
Runs on port 5001 (does NOT touch server_with_camera_page.py on port 5000).

Uses OpenCV 5's built-in FaceDetectorYN + FaceRecognizerSF (ONNX models).
No dlib / ZED SDK required — works entirely with a laptop webcam.

Features:
 - Live webcam MJPEG stream with bounding boxes + name labels
 - Upload a photo + enter name to register a new person
 - Cosine-similarity matching against registered face embeddings (saved as .pkl)
 - Spoof confidence shown based on face-score from detector
"""

import os
import cv2
import pickle
import numpy as np
import threading
import time
import requests
import tempfile
from flask import Flask, Response, jsonify, request, render_template_string

# ─────────────────────────────────────────────────────
# Paths & Config
# ─────────────────────────────────────────────────────
MODELS_DIR = os.path.join(os.path.dirname(__file__), "models")
FACE_DETECT_MODEL = os.path.join(MODELS_DIR, "face_detection_yunet_2023mar.onnx")
FACE_RECOG_MODEL  = os.path.join(MODELS_DIR, "face_recognition_sface_2021dec.onnx")
EMBEDDINGS_FILE   = os.path.join(os.path.dirname(__file__), "face_embeddings.pkl")
UPLOADS_DIR       = os.path.join(os.path.dirname(__file__), "face_uploads")
os.makedirs(UPLOADS_DIR, exist_ok=True)

# Node.js server webhook URL
NODE_SERVER_URL = os.environ.get("NODE_SERVER_URL", "http://localhost:5000")

# Cooldown state: prevents flooding the guard with repeat events
# Key: face_key (e.g. "506_Sai Patel" or "Unknown"), Value: last sent timestamp
_webhook_cooldown: dict = {}
_webhook_cooldown_lock = threading.Lock()
COOLDOWN_SECONDS = 10.0

# ─────────────────────────────────────────────────────
# Load OpenCV DNN models
# ─────────────────────────────────────────────────────
DETECTOR_OK   = False
RECOGNIZER_OK = False
detector      = None
recognizer    = None

if os.path.exists(FACE_DETECT_MODEL):
    try:
        detector = cv2.FaceDetectorYN_create(FACE_DETECT_MODEL, "", (320, 320))
        DETECTOR_OK = True
        print("[INFO] Face Detector (YuNet) loaded.")
    except Exception as e:
        print(f"[WARN] Could not load face detector: {e}")
else:
    print(f"[WARN] Face detector model not found at {FACE_DETECT_MODEL}")

if os.path.exists(FACE_RECOG_MODEL):
    try:
        recognizer = cv2.FaceRecognizerSF_create(FACE_RECOG_MODEL, "")
        RECOGNIZER_OK = True
        print("[INFO] Face Recognizer (SFace) loaded.")
    except Exception as e:
        print(f"[WARN] Could not load face recognizer: {e}")
else:
    print(f"[WARN] Face recognizer model not found at {FACE_RECOG_MODEL}")

# ─────────────────────────────────────────────────────
# Embedding database
# ─────────────────────────────────────────────────────
# Structure: { name: [embedding1, embedding2, ...] }
face_db: dict[str, list] = {}
db_lock = threading.Lock()

def load_embeddings():
    global face_db
    if os.path.exists(EMBEDDINGS_FILE):
        try:
            with open(EMBEDDINGS_FILE, "rb") as f:
                face_db = pickle.load(f)
            print(f"[INFO] Loaded {sum(len(v) for v in face_db.values())} embeddings for {len(face_db)} people.")
        except Exception as e:
            print(f"[WARN] Could not load embeddings: {e}")
            face_db = {}

def save_embeddings():
    with open(EMBEDDINGS_FILE, "wb") as f:
        pickle.dump(face_db, f)

load_embeddings()

# ─────────────────────────────────────────────────────
# Face detection helper
# ─────────────────────────────────────────────────────
COSINE_THRESHOLD = 0.363  # from SFace paper — below this = same person

def detect_faces(frame):
    """Returns list of face dicts: {box, landmarks, score, face_row}"""
    if not DETECTOR_OK:
        return []
    h, w = frame.shape[:2]
    detector.setInputSize((w, h))
    try:
        _, faces = detector.detect(frame)
    except Exception:
        return []
    if faces is None:
        return []
    results = []
    for face in faces:
        x, y, fw, fh = int(face[0]), int(face[1]), int(face[2]), int(face[3])
        score = float(face[14])
        results.append({"box": (x, y, fw, fh), "score": score, "face_row": face})
    return results

def get_embedding(frame, face_row):
    """Align + extract 128-d embedding for a single detected face."""
    if not RECOGNIZER_OK:
        return None
    try:
        aligned = recognizer.alignCrop(frame, face_row)
        feat = recognizer.feature(aligned)
        return feat
    except Exception:
        return None

def match_face(embedding):
    """
    Compare embedding against all known faces.
    Returns (name, score) or ("Unknown", 0.0).
    """
    best_name  = "Unknown"
    best_score = 0.0
    with db_lock:
        for name, embeddings in face_db.items():
            for stored_emb in embeddings:
                score = recognizer.match(embedding, stored_emb, cv2.FACE_RECOGNIZER_SF_FR_COSINE)
                if score > best_score:
                    best_score = score
                    best_name  = name
    if best_score < COSINE_THRESHOLD:
        return "Unknown", best_score
    return best_name, best_score

# ─────────────────────────────────────────────────────
# Camera + streaming
# ─────────────────────────────────────────────────────
class CameraStream:
    def __init__(self):
        self.cap = None
        self.is_running = False
        self._lock = threading.Lock()
        self._frame = None
        self._detections = []  # list of {name, score, box}
        self._thread = None
        self._open_camera()

    def _open_camera(self):
        cap = cv2.VideoCapture(0, cv2.CAP_DSHOW)
        if not cap.isOpened():
            cap = cv2.VideoCapture(0)
        if cap.isOpened():
            cap.set(cv2.CAP_PROP_FRAME_WIDTH,  640)
            cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
            self.cap = cap
            self.is_running = True
            self._thread = threading.Thread(target=self._capture_loop, daemon=True)
            self._thread.start()
        else:
            print("[WARN] Could not open webcam.")

    def _capture_loop(self):
        """Capture frames + run inference in background thread."""
        frame_count = 0
        while self.is_running:
            if self.cap is None or not self.cap.isOpened():
                time.sleep(0.5)
                continue
            ret, frame = self.cap.read()
            if not ret:
                time.sleep(0.05)
                continue

            # Annotate frame every 3rd frame to reduce CPU load
            annotated = frame.copy()
            detections_out = []
            if frame_count % 3 == 0:
                faces = detect_faces(frame)
                detections_out = []
                for face in faces:
                    x, y, fw, fh = face["box"]
                    score_detect  = face["score"]
                    emb = get_embedding(frame, face["face_row"])

                    name  = "Unknown"
                    match_score = 0.0
                    if emb is not None and RECOGNIZER_OK and len(face_db) > 0:
                        name, match_score = match_face(emb)

                    # Draw bounding box
                    if name == "Unknown":
                        color = (0, 165, 255)   # Orange for unknown
                    else:
                        color = (0, 220, 90)    # Green for known

                    cv2.rectangle(annotated, (x, y), (x + fw, y + fh), color, 2)

                    # Label background pill
                    label = f"{name}  {match_score:.2f}" if name != "Unknown" else "Unknown"
                    (lw, lh), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.65, 2)
                    cv2.rectangle(annotated, (x, y - lh - 14), (x + lw + 10, y), color, -1)
                    cv2.putText(annotated, label, (x + 5, y - 6),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.65, (15, 15, 15), 2)

                    # Detection score dot in corner
                    det_label = f"det:{score_detect:.2f}"
                    cv2.putText(annotated, det_label, (x, y + fh + 18),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.45, color, 1)

                    detections_out.append({"name": name, "score": round(float(match_score), 3), "box": [x, y, fw, fh]})

                    # ── Webhook: notify Node.js server with cooldown ──
                    self._maybe_send_webhook(name, match_score, frame, x, y, fw, fh)

            with self._lock:
                self._frame = annotated
                if detections_out:
                    self._detections = detections_out

            frame_count += 1
            time.sleep(0.03)   # ~30 fps cap

    def _maybe_send_webhook(self, name, score, frame, x, y, fw, fh):
        """Send face event to Node.js server if outside cooldown window."""
        now = time.time()
        face_key = name  # "Unknown" or "flatNumber_memberName"

        with _webhook_cooldown_lock:
            last_sent = _webhook_cooldown.get(face_key, 0)
            if now - last_sent < COOLDOWN_SECONDS:
                return  # Still in cooldown window
            _webhook_cooldown[face_key] = now

        # Crop the face region with a small margin for the snapshot
        margin = 20
        h_frame, w_frame = frame.shape[:2]
        cx1 = max(0, x - margin)
        cy1 = max(0, y - margin)
        cx2 = min(w_frame, x + fw + margin)
        cy2 = min(h_frame, y + fh + margin)
        face_crop = frame[cy1:cy2, cx1:cx2]

        # Send webhook in a separate daemon thread to not block capture
        threading.Thread(
            target=self._send_webhook_request,
            args=(face_key, score, face_crop.copy()),
            daemon=True
        ).start()

    @staticmethod
    def _send_webhook_request(face_key, score, face_crop):
        """POST face event to Node.js /api/face-event."""
        try:
            _, buf = cv2.imencode(".jpg", face_crop, [int(cv2.IMWRITE_JPEG_QUALITY), 90])
            img_bytes = buf.tobytes()

            files = {"photo": ("face_event.jpg", img_bytes, "image/jpeg")}
            data  = {"matched_key": face_key, "score": str(round(score, 4))}

            resp = requests.post(
                f"{NODE_SERVER_URL}/api/face-event",
                files=files,
                data=data,
                timeout=5
            )
            print(f"[WEBHOOK] Sent face event for '{face_key}': {resp.status_code}")
        except Exception as e:
            print(f"[WEBHOOK] Failed to send face event for '{face_key}': {e}")

    def get_jpeg(self):
        with self._lock:
            frame = self._frame
        if frame is None:
            blank = np.zeros((480, 640, 3), dtype=np.uint8)
            cv2.putText(blank, "Camera unavailable", (140, 240),
                        cv2.FONT_HERSHEY_SIMPLEX, 1.0, (60, 60, 60), 2)
            frame = blank
        _, jpeg = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
        return jpeg.tobytes()

    def get_detections(self):
        with self._lock:
            return list(self._detections)

    def close(self):
        self.is_running = False
        if self.cap:
            self.cap.release()

cam = CameraStream()

# ─────────────────────────────────────────────────────
# Flask app
# ─────────────────────────────────────────────────────
app = Flask(__name__)

DASHBOARD = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Face Verification — Visitor Management</title>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg:       #0b0f1a;
      --bg2:      #131929;
      --glass:    rgba(255,255,255,0.04);
      --border:   rgba(255,255,255,0.08);
      --accent:   #6c63ff;
      --accent2:  #4e46e5;
      --green:    #10b981;
      --amber:    #f59e0b;
      --red:      #ef4444;
      --blue:     #38bdf8;
      --txt:      #f1f5f9;
      --muted:    #64748b;
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Outfit', sans-serif;
      background: radial-gradient(ellipse at 70% 0%, #1a1050 0%, var(--bg) 60%);
      color: var(--txt);
      min-height: 100vh;
    }

    /* ── Header ── */
    header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 18px 36px;
      border-bottom: 1px solid var(--border);
      background: rgba(11,15,26,0.7);
      backdrop-filter: blur(14px);
      position: sticky; top: 0; z-index: 50;
    }
    .brand { display: flex; align-items: center; gap: 12px; }
    .brand-icon {
      width: 38px; height: 38px; border-radius: 10px;
      background: linear-gradient(135deg, var(--accent), #a855f7);
      display: grid; place-items: center; font-size: 18px;
    }
    .brand h1 {
      font-size: 20px; font-weight: 700;
      background: linear-gradient(135deg, #c4b5fd, var(--accent));
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
    }
    .brand h1 sub {
      font-size: 11px; font-weight: 500;
      padding: 2px 8px; border-radius: 20px;
      background: rgba(108,99,255,0.15); border: 1px solid rgba(108,99,255,0.3);
      color: #a5b4fc; -webkit-text-fill-color: #a5b4fc;
      margin-left: 8px; vertical-align: middle;
    }
    .status-badge {
      display: flex; align-items: center; gap: 8px;
      padding: 8px 16px; border-radius: 8px;
      background: rgba(16,185,129,0.1); border: 1px solid rgba(16,185,129,0.3);
      color: var(--green); font-size: 13px; font-weight: 500;
    }
    .status-badge.warn {
      background: rgba(245,158,11,0.1); border-color: rgba(245,158,11,0.3);
      color: var(--amber);
    }
    .pulse {
      width: 8px; height: 8px; border-radius: 50%;
      background: currentColor;
      animation: pulse 1.5s ease-in-out infinite;
    }
    @keyframes pulse {
      0%,100% { transform: scale(0.85); opacity: 0.5; }
      50%      { transform: scale(1.2);  opacity: 1; }
    }

    /* ── Layout ── */
    main {
      display: grid;
      grid-template-columns: 1fr 420px;
      gap: 24px;
      padding: 28px 36px;
      max-width: 1500px; margin: 0 auto;
    }

    /* ── Panels ── */
    .panel {
      background: var(--glass);
      border: 1px solid var(--border);
      border-radius: 18px;
      padding: 24px;
      backdrop-filter: blur(12px);
      box-shadow: 0 8px 40px rgba(0,0,0,0.25);
    }
    .panel-title {
      font-size: 17px; font-weight: 600;
      border-left: 3px solid var(--accent);
      padding-left: 12px;
      margin-bottom: 18px;
    }

    /* ── Video ── */
    .video-wrap {
      position: relative;
      border-radius: 12px; overflow: hidden;
      background: #000;
      aspect-ratio: 4/3;
      border: 1px solid var(--border);
    }
    .video-wrap img {
      width: 100%; height: 100%; object-fit: cover; display: block;
    }
    .video-badge {
      position: absolute; top: 12px; left: 12px;
      padding: 6px 12px; border-radius: 6px;
      font-size: 12px; font-weight: 500;
      backdrop-filter: blur(8px);
    }
    .badge-live  { background: rgba(16,185,129,0.2); border: 1px solid rgba(16,185,129,0.35); color: var(--green); }
    .badge-warn  { background: rgba(245,158,11,0.2); border: 1px solid rgba(245,158,11,0.35); color: var(--amber); }

    /* ── Right Column ── */
    .right-col { display: flex; flex-direction: column; gap: 20px; }

    /* ── Diagnostics ── */
    .diag-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .diag-box { display: flex; flex-direction: column; gap: 4px; }
    .diag-label { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; }
    .diag-val   { font-size: 15px; font-weight: 600; }
    .ok  { color: var(--green); }
    .warn{ color: var(--amber); }

    /* ── Register form ── */
    .reg-tabs { display: flex; gap: 8px; margin-bottom: 16px; }
    .reg-tab {
      flex: 1; padding: 9px 0; border-radius: 8px;
      font-family: 'Outfit',sans-serif; font-size: 14px; font-weight: 500;
      border: 1px solid var(--border); background: transparent;
      color: var(--muted); cursor: pointer; transition: all 0.25s;
    }
    .reg-tab.active {
      background: rgba(108,99,255,0.15); border-color: rgba(108,99,255,0.35);
      color: var(--txt);
    }
    .reg-pane { display: none; flex-direction: column; gap: 12px; }
    .reg-pane.active { display: flex; }
    label { font-size: 13px; color: var(--muted); display: block; margin-bottom: 4px; }
    input[type="text"], input[type="file"] {
      width: 100%; background: rgba(0,0,0,0.3); border: 1px solid var(--border);
      border-radius: 8px; padding: 10px 14px; color: var(--txt);
      font-family: 'Outfit',sans-serif; font-size: 14px; outline: none;
      transition: border-color 0.25s;
    }
    input[type="text"]:focus { border-color: var(--accent); }
    input[type="file"] { padding: 8px 12px; cursor: pointer; }
    .btn {
      padding: 11px 20px; border: none; border-radius: 8px;
      font-family: 'Outfit',sans-serif; font-size: 14px; font-weight: 600;
      cursor: pointer; transition: all 0.25s;
      display: inline-flex; align-items: center; justify-content: center; gap: 8px;
    }
    .btn-primary { background: var(--accent); color: #fff; }
    .btn-primary:hover { background: var(--accent2); }
    .toast {
      padding: 10px 14px; border-radius: 8px; font-size: 13px;
      display: none; margin-top: 4px;
    }
    .toast.ok   { background: rgba(16,185,129,0.1); border: 1px solid rgba(16,185,129,0.3); color: var(--green); }
    .toast.err  { background: rgba(239,68,68,0.1);  border: 1px solid rgba(239,68,68,0.3);  color: var(--red);   }

    /* ── DB List ── */
    .db-list { max-height: 160px; overflow-y: auto; display: flex; flex-direction: column; gap: 7px; }
    .db-item {
      display: flex; justify-content: space-between; align-items: center;
      background: rgba(255,255,255,0.025); padding: 8px 12px; border-radius: 7px;
      font-size: 13px; transition: background 0.2s;
    }
    .db-item:hover { background: rgba(255,255,255,0.045); }
    .db-item-left { display: flex; align-items: center; gap: 8px; }
    .db-name { font-weight: 600; }
    .db-count { color: var(--muted); font-family: 'JetBrains Mono', monospace; }
    .btn-delete {
      display: inline-flex; align-items: center; justify-content: center;
      width: 28px; height: 28px; border-radius: 7px; border: none;
      background: transparent; color: var(--muted);
      cursor: pointer; font-size: 14px; transition: all 0.2s;
      flex-shrink: 0;
    }
    .btn-delete:hover { background: rgba(239,68,68,0.15); color: var(--red); }
    .btn-delete:active { transform: scale(0.9); }
    @keyframes fadeSlideOut {
      from { opacity: 1; transform: translateX(0); max-height: 50px; }
      to   { opacity: 0; transform: translateX(20px); max-height: 0; margin: 0; padding: 0; }
    }
    .db-item.removing { animation: fadeSlideOut 0.3s ease forwards; overflow: hidden; }

    /* ── Activity log ── */
    .log-box {
      background: #070c17; border: 1px solid var(--border); border-radius: 10px;
      padding: 12px 14px; height: 190px; overflow-y: auto;
      font-family: 'JetBrains Mono', monospace; font-size: 12px;
      display: flex; flex-direction: column; gap: 6px;
    }
    .log-line { line-height: 1.5; }
    .l-info    { color: var(--blue);  }
    .l-ok      { color: var(--green); }
    .l-warn    { color: var(--amber); }
    .l-danger  { color: var(--red);   }

    /* ── Preview image ── */
    #previewImg {
      width: 100%; border-radius: 8px; border: 1px solid var(--border);
      display: none; margin-top: 8px;
    }

    /* scrollbar */
    ::-webkit-scrollbar { width: 5px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 4px; }
  </style>
</head>
<body>

<header>
  <div class="brand">
    <div class="brand-icon">👁</div>
    <h1>Face Verification <sub>Live</sub></h1>
  </div>
  <div id="hdrBadge" class="status-badge warn">
    <div class="pulse"></div>
    <span id="hdrBadgeTxt">Checking models…</span>
  </div>
</header>

<main>
  <!-- LEFT: Live Video -->
  <div class="panel">
    <div class="panel-title">Live Webcam Feed — Face Detection &amp; Recognition</div>
    <div class="video-wrap">
      <img id="feed" src="/video_feed" alt="Live stream">
      <div id="liveBadge" class="video-badge badge-warn">
        <span class="pulse"></span>&nbsp; Loading…
      </div>
    </div>
    <!-- Current detections -->
    <div style="margin-top:14px;">
      <div style="font-size:13px;color:var(--muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px;">Detected Faces (real-time)</div>
      <div id="detList" style="display:flex;flex-wrap:wrap;gap:8px;min-height:32px;">
        <span style="font-size:13px;color:var(--muted);">Scanning…</span>
      </div>
    </div>
  </div>

  <!-- RIGHT: Controls -->
  <div class="right-col">

    <!-- Diagnostics -->
    <div class="panel">
      <div class="panel-title">System Status</div>
      <div class="diag-grid">
        <div class="diag-box">
          <span class="diag-label">Face Detector</span>
          <span id="detStatus" class="diag-val warn">—</span>
        </div>
        <div class="diag-box">
          <span class="diag-label">Face Recognizer</span>
          <span id="recStatus" class="diag-val warn">—</span>
        </div>
        <div class="diag-box">
          <span class="diag-label">Webcam</span>
          <span id="camStatus" class="diag-val warn">—</span>
        </div>
        <div class="diag-box">
          <span class="diag-label">Registered People</span>
          <span id="dbCount" class="diag-val ok">—</span>
        </div>
      </div>
    </div>

    <!-- Register -->
    <div class="panel">
      <div class="panel-title">Register New Face</div>
      <div class="reg-tabs">
        <button class="reg-tab active" onclick="switchReg('upload', this)">📁 Upload Photo</button>
        <button class="reg-tab" onclick="switchReg('webcam', this)">📷 Webcam Snapshot</button>
      </div>

      <!-- Upload pane -->
      <div id="pane-upload" class="reg-pane active">
        <div>
          <label>Full Name</label>
          <input type="text" id="uploadName" placeholder="e.g. Tanvi Patel">
        </div>
        <div>
          <label>Face Photo (clear, well-lit)</label>
          <input type="file" id="photoFile" accept="image/*" onchange="previewPhoto(event)">
          <img id="previewImg" alt="preview">
        </div>
        <button class="btn btn-primary" onclick="registerUpload()">Register from Photo</button>
        <div id="uploadToast" class="toast"></div>
      </div>

      <!-- Webcam pane -->
      <div id="pane-webcam" class="reg-pane">
        <div>
          <label>Full Name</label>
          <input type="text" id="webcamName" placeholder="e.g. Tanvi Patel">
        </div>
        <p style="font-size:13px;color:var(--muted);">Look directly at the webcam then click the button. The system will capture 5 frames and build an average embedding.</p>
        <button class="btn btn-primary" onclick="registerWebcam()">Capture &amp; Register</button>
        <div id="webcamToast" class="toast"></div>
      </div>
    </div>

    <!-- Database -->
    <div class="panel">
      <div class="panel-title">Registered Faces Database</div>
      <div class="db-list" id="dbList">
        <span style="font-size:13px;color:var(--muted);">Loading…</span>
      </div>
    </div>

    <!-- Activity -->
    <div class="panel" style="padding-bottom:18px;">
      <div class="panel-title">Activity Log</div>
      <div class="log-box" id="logBox">
        <div class="log-line l-info">System started — awaiting activity.</div>
      </div>
    </div>

  </div><!-- /right-col -->
</main>

<script>
  // ─── Log helper ───
  function log(cls, msg) {
    const box = document.getElementById('logBox');
    const el = document.createElement('div');
    el.className = `log-line ${cls}`;
    el.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    box.appendChild(el);
    box.scrollTop = box.scrollHeight;
  }

  // ─── Registration tab toggle ───
  function switchReg(pane, btn) {
    document.querySelectorAll('.reg-tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.reg-pane').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('pane-' + pane).classList.add('active');
  }

  // ─── Preview uploaded photo ───
  function previewPhoto(event) {
    const file = event.target.files[0];
    const img = document.getElementById('previewImg');
    if (file) {
      img.src = URL.createObjectURL(file);
      img.style.display = 'block';
    } else {
      img.style.display = 'none';
    }
  }

  // ─── Toast helper ───
  function showToast(id, msg, type) {
    const el = document.getElementById(id);
    el.textContent = msg;
    el.className = `toast ${type}`;
    el.style.display = 'block';
    setTimeout(() => el.style.display = 'none', 5000);
  }

  // ─── Register via uploaded photo ───
  async function registerUpload() {
    const name = document.getElementById('uploadName').value.trim();
    const file = document.getElementById('photoFile').files[0];
    if (!name) { showToast('uploadToast', '⚠ Please enter a name.', 'err'); return; }
    if (!file) { showToast('uploadToast', '⚠ Please choose a photo.', 'err'); return; }

    const fd = new FormData();
    fd.append('name', name);
    fd.append('photo', file);
    log('l-info', `Registering "${name}" from uploaded photo…`);
    const r = await fetch('/register_photo', { method: 'POST', body: fd });
    const d = await r.json();
    if (d.success) {
      showToast('uploadToast', `✅ ${d.message}`, 'ok');
      log('l-ok', d.message);
      refreshDB();
    } else {
      showToast('uploadToast', `❌ ${d.message}`, 'err');
      log('l-danger', d.message);
    }
  }

  // ─── Register via webcam snapshot ───
  async function registerWebcam() {
    const name = document.getElementById('webcamName').value.trim();
    if (!name) { showToast('webcamToast', '⚠ Please enter a name.', 'err'); return; }
    log('l-info', `Capturing webcam frames for "${name}"…`);
    const r = await fetch('/register_webcam', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    const d = await r.json();
    if (d.success) {
      showToast('webcamToast', `✅ ${d.message}`, 'ok');
      log('l-ok', d.message);
      refreshDB();
    } else {
      showToast('webcamToast', `❌ ${d.message}`, 'err');
      log('l-danger', d.message);
    }
  }

  // ─── Load DB list ───
  async function refreshDB() {
    const r = await fetch('/api/db');
    const d = await r.json();
    const box = document.getElementById('dbList');
    document.getElementById('dbCount').textContent = Object.keys(d).length;
    if (Object.keys(d).length === 0) {
      box.innerHTML = '<span style="font-size:13px;color:var(--muted)">No faces registered yet.</span>';
      return;
    }
    box.innerHTML = '';
    for (const [name, cnt] of Object.entries(d)) {
      const item = document.createElement('div');
      item.className = 'db-item';
      item.dataset.name = name;
      item.innerHTML = `
        <div class="db-item-left">
          <span class="db-name">${name}</span>
          <span class="db-count">${cnt} embed${cnt !== 1 ? 's' : ''}</span>
        </div>
        <button class="btn-delete" title="Delete ${name}" onclick="deleteEntry('${name.replace(/'/g, "\\'")}')">🗑</button>
      `;
      box.appendChild(item);
    }
  }

  // ─── Delete a face entry ───
  async function deleteEntry(name) {
    if (!confirm(`Delete all embeddings for "${name}"? This cannot be undone.`)) return;
    const item = document.querySelector(`.db-item[data-name="${name}"]`);
    if (item) item.classList.add('removing');
    try {
      const r = await fetch(`/delete_face/${encodeURIComponent(name)}`, { method: 'DELETE' });
      const d = await r.json();
      if (d.success) {
        log('l-warn', `Deleted face: ${name}`);
        setTimeout(refreshDB, 320);
      } else {
        if (item) item.classList.remove('removing');
        log('l-danger', `Delete failed: ${d.message}`);
      }
    } catch(e) {
      if (item) item.classList.remove('removing');
      log('l-danger', `Delete error: ${e}`);
    }
  }

  // ─── Fetch system status ───
  async function refreshStatus() {
    const r = await fetch('/api/status');
    const d = await r.json();
    document.getElementById('detStatus').textContent = d.detector  ? '✔ YuNet (ONNX)' : '✘ Model missing';
    document.getElementById('detStatus').className   = `diag-val ${d.detector  ? 'ok' : 'warn'}`;
    document.getElementById('recStatus').textContent = d.recognizer? '✔ SFace (ONNX)' : '✘ Model missing';
    document.getElementById('recStatus').className   = `diag-val ${d.recognizer? 'ok' : 'warn'}`;
    document.getElementById('camStatus').textContent = d.camera    ? '✔ Webcam active' : '✘ Not found';
    document.getElementById('camStatus').className   = `diag-val ${d.camera    ? 'ok' : 'warn'}`;

    const badge   = document.getElementById('hdrBadge');
    const badgeTxt= document.getElementById('hdrBadgeTxt');
    const lbadge  = document.getElementById('liveBadge');
    if (d.detector && d.recognizer && d.camera) {
      badge.className = 'status-badge';
      badgeTxt.textContent = 'All systems operational';
      lbadge.className = 'video-badge badge-live';
      lbadge.innerHTML = '<span class="pulse"></span>&nbsp;LIVE — face recognition active';
    } else {
      badge.className = 'status-badge warn';
      badgeTxt.textContent = 'Degraded — see status panel';
      lbadge.innerHTML = '<span class="pulse"></span>&nbsp;LIVE — limited mode';
    }
  }

  // ─── Poll detections ───
  async function pollDetections() {
    try {
      const r = await fetch('/api/detections');
      const d = await r.json();
      const box = document.getElementById('detList');
      if (!d.faces || d.faces.length === 0) {
        box.innerHTML = '<span style="font-size:13px;color:var(--muted);">No face in frame</span>';
        return;
      }
      box.innerHTML = '';
      d.faces.forEach(f => {
        const chip = document.createElement('div');
        const isKnown = f.name !== 'Unknown';
        chip.style.cssText = `
          display:inline-flex; align-items:center; gap:6px;
          padding:5px 12px; border-radius:20px; font-size:13px; font-weight:600;
          background:${isKnown ? 'rgba(16,185,129,0.12)' : 'rgba(245,158,11,0.12)'};
          border:1px solid ${isKnown ? 'rgba(16,185,129,0.35)' : 'rgba(245,158,11,0.35)'};
          color:${isKnown ? 'var(--green)' : 'var(--amber)'};
        `;
        chip.innerHTML = `${isKnown ? '✔' : '?'} ${f.name} <span style="opacity:.6;font-weight:400;">${(f.score*100).toFixed(0)}%</span>`;
        box.appendChild(chip);

        // Log notable events
        if (isKnown) log('l-ok', `Verified: ${f.name} (${(f.score*100).toFixed(1)}% confidence)`);
      });
    } catch(e) {}
  }

  // ─── Init ───
  window.onload = async () => {
    await refreshStatus();
    await refreshDB();
    setInterval(refreshDB, 10000);
    setInterval(pollDetections, 1200);
  };
</script>
</body>
</html>"""

# ─────────────────────────────────────────────────────
# Routes
# ─────────────────────────────────────────────────────

@app.route("/")
def index():
    return DASHBOARD

@app.route("/video_feed")
def video_feed():
    def stream():
        while True:
            jpeg = cam.get_jpeg()
            yield (b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + jpeg + b"\r\n")
            time.sleep(0.04)
    return Response(stream(), mimetype="multipart/x-mixed-replace; boundary=frame")

@app.route("/api/status")
def api_status():
    return jsonify({
        "detector":   DETECTOR_OK,
        "recognizer": RECOGNIZER_OK,
        "camera":     cam.is_running,
        "db_count":   len(face_db)
    })

@app.route("/api/db")
def api_db():
    with db_lock:
        return jsonify({name: len(embs) for name, embs in face_db.items()})

@app.route("/api/detections")
def api_detections():
    return jsonify({"faces": cam.get_detections()})

@app.route("/detect_face_only", methods=["POST"])
def detect_face_only():
    """Validate that an uploaded image contains at least one face. Does NOT register."""
    if "photo" not in request.files:
        return jsonify({"success": False, "message": "No photo uploaded."})

    file = request.files["photo"]
    img_bytes = np.frombuffer(file.read(), np.uint8)
    frame = cv2.imdecode(img_bytes, cv2.IMREAD_COLOR)
    if frame is None:
        return jsonify({"success": False, "message": "Cannot decode image. Please upload a valid JPG or PNG."})

    faces = detect_faces(frame)
    if not faces:
        return jsonify({"success": False, "message": "No face detected in the uploaded photo. Please use a clear, well-lit frontal photo with the face visible."})

    return jsonify({"success": True, "faces_count": len(faces)})


@app.route("/register_photo", methods=["POST"])
def register_photo():
    """Register a person from an uploaded image file."""
    name = request.form.get("name", "").strip()
    if not name:
        return jsonify({"success": False, "message": "Name is required."})
    if "photo" not in request.files:
        return jsonify({"success": False, "message": "No photo uploaded."})

    file = request.files["photo"]
    img_bytes = np.frombuffer(file.read(), np.uint8)
    frame = cv2.imdecode(img_bytes, cv2.IMREAD_COLOR)
    if frame is None:
        return jsonify({"success": False, "message": "Cannot decode image."})

    faces = detect_faces(frame)
    if not faces:
        return jsonify({"success": False, "message": "No face detected in the uploaded photo. Please use a clear, well-lit frontal photo."})

    # Use the highest-confidence face
    best_face = max(faces, key=lambda f: f["score"])
    emb = get_embedding(frame, best_face["face_row"])
    if emb is None:
        return jsonify({"success": False, "message": "Could not extract face features. Is the recognizer model loaded?"})

    with db_lock:
        if name not in face_db:
            face_db[name] = []
        face_db[name].append(emb)
        save_embeddings()

    return jsonify({"success": True, "message": f"'{name}' registered successfully from photo ({len(face_db[name])} embedding(s) total)."})

@app.route("/register_webcam", methods=["POST"])
def register_webcam():
    """Capture 5 frames from webcam and register face embeddings."""
    data = request.get_json() or {}
    name = data.get("name", "").strip()
    if not name:
        return jsonify({"success": False, "message": "Name is required."})

    if not cam.is_running:
        return jsonify({"success": False, "message": "Webcam is not available."})

    embs_collected = []
    for _ in range(50):  # try up to 50 grabs to get 5 good embeddings
        success, frame = cam.cap.read() if cam.cap else (False, None)
        if not success or frame is None:
            time.sleep(0.05)
            continue
        faces = detect_faces(frame)
        if not faces:
            time.sleep(0.05)
            continue
        best = max(faces, key=lambda f: f["score"])
        emb  = get_embedding(frame, best["face_row"])
        if emb is not None:
            embs_collected.append(emb)
        if len(embs_collected) >= 5:
            break
        time.sleep(0.1)

    if not embs_collected:
        return jsonify({"success": False, "message": "No face detected in webcam. Please ensure your face is visible and well-lit."})

    with db_lock:
        if name not in face_db:
            face_db[name] = []
        face_db[name].extend(embs_collected)
        save_embeddings()

    return jsonify({"success": True, "message": f"'{name}' registered with {len(embs_collected)} webcam frame(s) ({len(face_db[name])} embeddings total)."})

@app.route("/delete_face/<path:name>", methods=["DELETE"])
def delete_face(name):
    """Remove all embeddings for a registered person."""
    name = name.strip()
    with db_lock:
        if name not in face_db:
            return jsonify({"success": False, "message": f"'{name}' not found in database."})
        del face_db[name]
        save_embeddings()
    print(f"[INFO] Deleted face embeddings for: {name}")
    return jsonify({"success": True, "message": f"'{name}' removed from database."})

# ─────────────────────────────────────────────────────
if __name__ == "__main__":
    print("=" * 55)
    print("  Face Verification Server — Visitor Management")
    print("  http://localhost:5001")
    print("=" * 55)
    app.run(host="0.0.0.0", port=5001, threaded=True)
