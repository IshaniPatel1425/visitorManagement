"""
anpr_server.py — Persistent ANPR HTTP Server (port 5002)

Keeps EasyOCR loaded in memory so every frame scan is fast (~300-600ms)
instead of cold-starting a new process (2-4s) each time.

Endpoints:
  GET  /anpr/health         -> { status: "ok" }
  POST /anpr/scan           -> multipart photo -> { plate, bbox, confidence }
"""

import re
import os
import sys
import warnings
import numpy as np
import cv2
import easyocr
from flask import Flask, request, jsonify

warnings.filterwarnings("ignore")

app = Flask(__name__)

# -- Load EasyOCR once at startup ---------------------------------------------
print("[ANPR SERVER] Loading EasyOCR model... (takes ~10s on first run)", flush=True)
reader = easyocr.Reader(['en'], gpu=False)
print("[ANPR SERVER] EasyOCR ready.", flush=True)


# -- Indian plate correction helpers ------------------------------------------
def apply_indian_corrections(text: str) -> str:
    chars = list(text.upper())
    n = len(chars)
    to_letter = {'0': 'O', '1': 'I', '2': 'Z', '3': 'E', '4': 'A', '5': 'S', '6': 'G', '8': 'B'}
    to_digit  = {'O': '0', 'D': '0', 'I': '1', 'L': '1', 'Z': '2', 'S': '5', 'G': '6', 'B': '8',
                 'Y': '4', 'T': '7', 'J': '1', 'U': '0', 'V': '0'}

    for i in [0, 1]:
        if i < n and chars[i] in to_letter:
            chars[i] = to_letter[chars[i]]
    for i in [2, 3]:
        if i < n and chars[i] in to_digit:
            chars[i] = to_digit[chars[i]]

    if n == 10:
        for i in [4, 5]:
            if chars[i] in to_letter:
                chars[i] = to_letter[chars[i]]
        for i in range(6, 10):
            if chars[i] in to_digit:
                chars[i] = to_digit[chars[i]]
    elif n == 9:
        if chars[4] in to_letter:
            chars[4] = to_letter[chars[4]]
        for i in range(5, 9):
            if chars[i] in to_digit:
                chars[i] = to_digit[chars[i]]

    return "".join(chars)


INDIAN_PLATE_RE = re.compile(r'^[A-Z]{2}[0-9]{2}[A-Z]{1,2}[0-9]{4}$')
BRAND_NAMES = {"KIA", "TATA", "FORD", "FIAT", "BMW", "AUDI", "JEEP", "PUNE",
               "HYUNDAI", "HONDA", "MARUTI", "SUZUKI", "TOYOTA", "MAHINDRA"}


def extract_indian_plate(raw_text: str) -> str:
    cleaned = re.sub(r"[^A-Z0-9]", "", raw_text.upper())
    for length in [10, 9]:
        for i in range(len(cleaned) - length + 1):
            sub = cleaned[i:i+length]
            corrected = apply_indian_corrections(sub)
            if INDIAN_PLATE_RE.match(corrected):
                return corrected
    return apply_indian_corrections(cleaned)


# -- OpenCV plate region localization -----------------------------------------
def find_plate_candidates(img: np.ndarray):
    """
    Use OpenCV morphology + contour analysis to find rectangular regions
    that are likely license plates.
    Returns list of (x, y, w, h, cropped_img), sorted by area descending.
    """
    candidates = []
    h_img, w_img = img.shape[:2]

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if len(img.shape) == 3 else img.copy()

    # CLAHE for contrast enhancement (handles dark/bright/backlit conditions)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    gray = clahe.apply(gray)

    # Bilateral filter preserves edges while reducing noise
    filtered = cv2.bilateralFilter(gray, 9, 75, 75)

    # Canny edge detection
    edges = cv2.Canny(filtered, 30, 150)

    # Dilate edges to close small gaps in the plate border rectangle
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 3))
    dilated = cv2.dilate(edges, kernel, iterations=2)

    contours, _ = cv2.findContours(dilated, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    for cnt in contours:
        x, y, cw, ch = cv2.boundingRect(cnt)

        if cw < 60 or ch < 15:
            continue

        aspect = cw / float(ch)
        if not (1.5 <= aspect <= 6.5):
            continue

        area = cw * ch
        frame_area = w_img * h_img
        if not (0.003 * frame_area <= area <= 0.30 * frame_area):
            continue

        # Add padding around the candidate region
        pad = 8
        x1 = max(0, x - pad)
        y1 = max(0, y - pad)
        x2 = min(w_img, x + cw + pad)
        y2 = min(h_img, y + ch + pad)

        cropped = img[y1:y2, x1:x2]
        candidates.append((x1, y1, x2 - x1, y2 - y1, cropped))

    # Sort by area descending — try largest plate candidates first
    candidates.sort(key=lambda c: c[2] * c[3], reverse=True)
    return candidates[:8]


# -- Core OCR -----------------------------------------------------------------
def ocr_image(img: np.ndarray) -> list:
    """Run EasyOCR, return results sorted by confidence desc."""
    results = reader.readtext(img)
    return sorted(results, key=lambda x: x[2], reverse=True)


def read_plate_from_image(img: np.ndarray) -> tuple:
    """
    Returns (plate_text: str, confidence: float, bbox: dict|None)
    bbox = {"x": int, "y": int, "w": int, "h": int} in original image coordinates
    """
    # Pass 1: Try plate region candidates
    candidates = find_plate_candidates(img)
    for (cx, cy, cw, ch, crop) in candidates:
        # Upscale small crops for better OCR accuracy
        scale = max(1, int(120 / max(ch, 1)))
        if scale > 1:
            crop = cv2.resize(crop, (crop.shape[1] * scale, crop.shape[0] * scale),
                              interpolation=cv2.INTER_CUBIC)

        results = ocr_image(crop)
        for _, text, prob in results:
            if prob > 0.10:
                plate_candidate = extract_indian_plate(text)
                if INDIAN_PLATE_RE.match(plate_candidate):
                    return plate_candidate, float(prob), {"x": cx, "y": cy, "w": cw, "h": ch}

    # Pass 2: Full image OCR (single blocks, then concatenation)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if len(img.shape) == 3 else img.copy()
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    enhanced = clahe.apply(gray)

    for proc_img in [img, enhanced]:
        results = ocr_image(proc_img)
        if not results:
            continue

        # Single-block pass
        for _, text, prob in results:
            if prob > 0.15:
                plate = extract_indian_plate(text)
                if INDIAN_PLATE_RE.match(plate):
                    return plate, float(prob), None

        # Concatenation pass (skip brand names)
        filtered_texts = []
        for _, text, prob in results:
            clean_word = re.sub(r"[^A-Z0-9]", "", text.upper())
            if clean_word in BRAND_NAMES:
                continue
            if prob > 0.15:
                filtered_texts.append(text)
        if filtered_texts:
            combined = "".join(filtered_texts)
            plate = extract_indian_plate(combined)
            if INDIAN_PLATE_RE.match(plate):
                return plate, 0.6, None

    return "UNKNOWN", 0.0, None


# -- Flask Endpoints ----------------------------------------------------------
@app.route('/anpr/health', methods=['GET'])
def health():
    return jsonify({"status": "ok", "model": "easyocr-en"})


@app.route('/anpr/scan', methods=['POST'])
def scan():
    if 'photo' not in request.files:
        return jsonify({"error": "No photo in request"}), 400

    file = request.files['photo']
    file_bytes = file.read()
    if not file_bytes:
        return jsonify({"error": "Empty file"}), 400

    try:
        nparr = np.frombuffer(file_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None:
            return jsonify({"error": "Could not decode image"}), 400

        # Resize if too large (keep performance snappy)
        h, w = img.shape[:2]
        if w > 1280:
            scale = 1280.0 / w
            img = cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)

        plate, confidence, bbox = read_plate_from_image(img)

        print(f"[ANPR] '{plate}' (conf={confidence:.2f}, bbox={bbox})", flush=True)

        return jsonify({
            "plate": plate,
            "confidence": round(confidence, 3),
            "bbox": bbox
        })

    except Exception as e:
        print(f"[ANPR ERROR] {e}", flush=True, file=sys.stderr)
        return jsonify({"error": str(e)}), 500


# -- Main ---------------------------------------------------------------------
if __name__ == '__main__':
    port = int(os.environ.get('ANPR_PORT', 5002))
    print(f"[ANPR SERVER] Listening on http://0.0.0.0:{port}", flush=True)
    app.run(host='0.0.0.0', port=port, threaded=True, debug=False)
