import sys
import os
import json
import warnings
import re
import cv2
import easyocr

# Suppress PyTorch CPU memory and package deprecation warnings
warnings.filterwarnings("ignore")

# Initialize EasyOCR reader once
reader = easyocr.Reader(['en'], gpu=False)

def resize_to_optimal(img, target_width=800):
    height, width = img.shape[:2]
    if width > target_width:
        ratio = target_width / float(width)
        target_height = int(height * ratio)
        return cv2.resize(img, (target_width, target_height), interpolation=cv2.INTER_AREA)
    return img


def apply_indian_corrections(text: str) -> str:
    chars = list(text.upper())
    n = len(chars)
    to_letter = {'0': 'O', '1': 'I', '2': 'Z', '3': 'E', '4': 'A', '5': 'S', '6': 'G', '8': 'B'}
    to_digit  = {'O': '0', 'D': '0', 'I': '1', 'L': '1', 'Z': '2', 'S': '5', 'G': '6', 'B': '8', 'Y': '4', 'T': '7', 'J': '1', 'U': '0', 'V': '0'}
    
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


def extract_indian_plate(raw_text: str) -> str:
    cleaned = re.sub(r"[^A-Z0-9]", "", raw_text.upper())
    for length in [10, 9]:
        for i in range(len(cleaned) - length + 1):
            sub = cleaned[i:i+length]
            corrected = apply_indian_corrections(sub)
            if re.match(r"^[A-Z]{2}[0-9]{2}[A-Z]{1,2}[0-9]{4}$", corrected):
                return corrected
    return apply_indian_corrections(cleaned)


def read_plate_text(image_path: str) -> str:
    img = cv2.imread(image_path)
    if img is None:
        return ""

    img = resize_to_optimal(img, 800)
    results = reader.readtext(img)
    if not results:
        return ""
        
    results_sorted = sorted(results, key=lambda x: x[2], reverse=True)
    
    # Pass 1: Try single text block matching regex
    for _, text, prob in results_sorted:
        if prob > 0.15:
            plate_candidate = extract_indian_plate(text)
            if re.match(r"^[A-Z]{2}[0-9]{2}[A-Z]{1,2}[0-9]{4}$", plate_candidate):
                return plate_candidate
                
    # Pass 2: Concatenate blocks (excluding brand names)
    filtered_texts = []
    for _, text, prob in results:
        clean_word = re.sub(r"[^A-Z0-9]", "", text.upper())
        if len(clean_word) <= 4 and clean_word in ["KIA", "TATA", "FORD", "FIAT", "BMW", "AUDI", "JEEP", "PUNE"]:
            continue
        if prob > 0.15:
            filtered_texts.append(text)
            
    combined_text = "".join(filtered_texts)
    return extract_indian_plate(combined_text)


def preprocess_passes(image_path: str):
    img = cv2.imread(image_path)
    if img is None:
        return []
        
    img_opt = resize_to_optimal(img, 800)
    gray = cv2.cvtColor(img_opt, cv2.COLOR_BGR2GRAY)
    
    base_dir = os.path.dirname(image_path)
    filename = os.path.basename(image_path)
    paths = []
    
    # Blur pass
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    blur_path = os.path.join(base_dir, f"blur_{filename}")
    cv2.imwrite(blur_path, blurred)
    paths.append(blur_path)
    
    # Threshold pass
    bilateral = cv2.bilateralFilter(gray, 9, 75, 75)
    thresh = cv2.adaptiveThreshold(bilateral, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 11, 2)
    thresh_path = os.path.join(base_dir, f"thresh_{filename}")
    cv2.imwrite(thresh_path, thresh)
    paths.append(thresh_path)
    
    return paths


def run_anpr(image_path: str) -> str:
    # Pass 1: Raw image
    plate_text = read_plate_text(image_path)
    if re.match(r"^[A-Z]{2}[0-9]{2}[A-Z]{1,2}[0-9]{4}$", plate_text):
        return plate_text
        
    # Pass 2: Retry with preprocessed images
    prep_paths = preprocess_passes(image_path)
    for prep_path in prep_paths:
        prep_text = read_plate_text(prep_path)
        if os.path.exists(prep_path):
            os.remove(prep_path)
        if re.match(r"^[A-Z]{2}[0-9]{2}[A-Z]{1,2}[0-9]{4}$", prep_text):
            return prep_text
            
    # Fallback to Pass 1 result if no clean match found in prep
    return plate_text if plate_text else "UNKNOWN"


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Missing image path parameter"}))
        sys.exit(1)
        
    img_path = sys.argv[1]
    if not os.path.exists(img_path):
        print(json.dumps({"error": "Image file not found"}))
        sys.exit(1)
        
    try:
        detected_plate = run_anpr(img_path)
        # Print ONLY the clean JSON output to stdout
        print(json.dumps({"plate": detected_plate}))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
