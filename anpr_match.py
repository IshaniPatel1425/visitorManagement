import easyocr
import cv2
import re
import warnings

# Suppress PyTorch CPU pin_memory warnings
warnings.filterwarnings("ignore", category=UserWarning)

# Initialize EasyOCR reader
reader = easyocr.Reader(['en'], gpu=False)

registered_vehicles = {
    "MH12AB1234": {"name": "Ishani", "flat": "420"},
    "MH14CD5678": {"name": "Hema",   "flat": "420"},
    "GJ01EF9012": {"name": "Tanvi",  "flat": "118"},
    "HR98AA0000": {"name": "Tanvi",  "flat": "119"},
}


def normalize_plate(raw_plate: str) -> str:
    """
    Fixes common OCR digit/letter confusions (e.g., 'O' -> '0', 'I' -> '1').
    Indian plates follow standard formats (2 letters + 2 numbers + 2 letters + 4 numbers).
    """
    cleaned = re.sub(r"[^A-Z0-9]", "", raw_plate.upper())

    # Replace letter 'O' with number '0' if it appears in numerical sections
    # Handles common mistakes like 'HR98AAO000' -> 'HR98AA0000'
    if len(cleaned) >= 4:
        state_code = cleaned[:2]          # First 2: State (e.g., HR)
        district_num = cleaned[2:4].replace('O', '0').replace('I', '1') # District (e.g., 98)
        rest = cleaned[4:]

        # Separate series letters and trailing 4 digits if plate is standard length
        if len(rest) >= 6:
            series = rest[:2]             # Series letters (e.g., AA)
            digits = rest[2:].replace('O', '0').replace('I', '1').replace('S', '5') # Digits (e.g., 0000)
            return f"{state_code}{district_num}{series}{digits}"

    # General fallback for non-standard lengths: replace 'O' with '0' in trailing digits
    return cleaned.replace("O", "0")


def read_plate_text(image_path: str) -> str:
    img = cv2.imread(image_path)
    if img is None:
        return ""

    results = reader.readtext(img)
    detected_text = " ".join([text for _, text, prob in results if prob > 0.2])

    # Normalize OCR typos
    return normalize_plate(detected_text)


def check_registered(plate_text: str):
    if plate_text in registered_vehicles:
        info = registered_vehicles[plate_text]
        return True, info
    return False, None


def process_gate_entry(image_path: str):
    print(f"\n📷 Photo captured: {image_path}")
    plate_text = read_plate_text(image_path)
    print(f"🔤 OCR read & normalized plate as: '{plate_text}'")
    is_match, info = check_registered(plate_text)

    if is_match:
        print(f"✅ MATCH FOUND — {info['name']}, Flat {info['flat']}")
        print("   → Guard dashboard shows: GREEN")
    else:
        print("❌ NO MATCH — plate not in registered vehicles")
        print("   → Guard dashboard shows: 'Unregistered vehicle, treat as visitor'")

    return is_match, info


if __name__ == "__main__":
    process_gate_entry("test_plate.png")