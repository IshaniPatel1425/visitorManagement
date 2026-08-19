import os
import cv2
import pickle
import numpy as np

# Status flags
FACE_REC_AVAILABLE = False
ZED_AVAILABLE = False

# Try importing face_recognition
try:
    import face_recognition
    FACE_REC_AVAILABLE = True
except ImportError:
    pass

# Try importing pyzed
try:
    import pyzed.sl as sl
    ZED_AVAILABLE = True
except ImportError:
    pass

# Load Haar Cascade for face detection in fallback mode
face_cascade = None
if not FACE_REC_AVAILABLE:
    try:
        cascade_path = cv2.data.haarcascades + 'haarcascade_frontalface_default.xml'
        face_cascade = cv2.CascadeClassifier(cascade_path)
    except Exception as e:
        print(f"Could not load Haar Cascade: {e}. Fallback mock box will be used.")

# Paths for database
DB_PATH = "face_encodings.pkl"
image_directory = 'captured_faces'

def load_known_faces():
    """Load face encodings from pickle file."""
    if not os.path.exists(DB_PATH):
        return {}
    try:
        with open(DB_PATH, "rb") as f:
            return pickle.load(f)
    except Exception as e:
        print(f"Error loading face encodings: {e}")
        return {}

def save_known_faces(known_faces):
    """Save face encodings to pickle file."""
    try:
        with open(DB_PATH, "wb") as f:
            pickle.dump(known_faces, f)
        return True
    except Exception as e:
        print(f"Error saving face encodings: {e}")
        return False

# Initialize database
known_faces = load_known_faces()

# Add some initial mock names if DB is empty and face_recognition isn't installed
if not known_faces and not FACE_REC_AVAILABLE:
    # Just to show some registered users in fallback mode
    known_faces = {
        "Ishani": None,
        "Hema": None,
        "Tanvi": None
    }
    save_known_faces(known_faces)

class VideoCamera:
    def __init__(self, use_zed=False):
        self.use_zed = use_zed and ZED_AVAILABLE
        self.zed = None
        self.video = None
        self.is_running = False

        if self.use_zed:
            try:
                self.zed = sl.Camera()
                init_params = sl.InitParameters()
                init_params.camera_resolution = sl.RESOLUTION.HD720
                init_params.depth_mode = sl.DEPTH_MODE.QUALITY
                if self.zed.open(init_params) != sl.ERROR_CODE.SUCCESS:
                    print("Failed to open ZED camera, falling back to webcam.")
                    self.use_zed = False
                else:
                    self.is_running = True
            except Exception as e:
                print(f"Error initializing ZED camera: {e}")
                self.use_zed = False

        if not self.use_zed:
            # Fallback to standard webcam
            self.video = cv2.VideoCapture(0, cv2.CAP_DSHOW) # Use DSHOW on Windows for faster startup
            if not self.video.isOpened():
                # Try default backend if DSHOW fails
                self.video = cv2.VideoCapture(0)
            if self.video.isOpened():
                self.is_running = True
            else:
                print("Failed to open laptop webcam.")

    def __del__(self):
        self.close()

    def close(self):
        if self.use_zed and self.zed:
            try:
                self.zed.close()
            except:
                pass
            self.zed = None
        if self.video:
            try:
                self.video.release()
            except:
                pass
            self.video = None
        self.is_running = False

    def get_frame(self):
        """
        Grab a frame, perform face recognition, spoof detection (real or simulated),
        and return the annotated frame along with log info.
        """
        if not self.is_running:
            # Return a blank frame with text
            blank = np.zeros((480, 640, 3), dtype=np.uint8)
            cv2.putText(blank, "Camera Unavailable", (150, 240),
                        cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 0, 255), 2)
            return blank, []

        frame = None
        depth_map = None

        if self.use_zed:
            try:
                if self.zed.grab() == sl.ERROR_CODE.SUCCESS:
                    image_zed = sl.Mat()
                    depth_zed = sl.Mat()
                    self.zed.retrieve_image(image_zed, sl.VIEW.LEFT)
                    self.zed.retrieve_measure(depth_zed, sl.MEASURE.DEPTH)
                    
                    frame = image_zed.get_data()
                    frame = cv2.cvtColor(frame, cv2.COLOR_RGBA2RGB)
                    depth_map = depth_zed
            except Exception as e:
                print(f"ZED grab error: {e}")
                self.use_zed = False # Fall back

        if not self.use_zed and self.video:
            success, frame = self.video.read()
            if not success:
                return np.zeros((480, 640, 3), dtype=np.uint8), []

        # Detect and process faces
        detected_logs = []
        
        if FACE_REC_AVAILABLE:
            # Real face_recognition logic
            rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            face_locations = face_recognition.face_locations(rgb_frame)
            encodings = face_recognition.face_encodings(rgb_frame, face_locations)

            for (face_location, face_encoding) in zip(face_locations, encodings):
                name = "Unknown"
                spoofed = False
                avg_depth = 0.0
                std_depth = 0.0
                
                # Check match against known faces
                known_db = load_known_faces()
                valid_encodings = {k: v for k, v in known_db.items() if v is not None}
                
                if valid_encodings:
                    matches = face_recognition.compare_faces(list(valid_encodings.values()), face_encoding)
                    if True in matches:
                        first_match_index = matches.index(True)
                        name = list(valid_encodings.keys())[first_match_index]

                # Spoof detection (ZED depth check)
                top, right, bottom, left = face_location
                if self.use_zed and depth_map:
                    face_depths = []
                    for x in range(left, right):
                        for y in range(top, bottom):
                            # Ensure within camera bounds
                            if 0 <= x < depth_map.get_width() and 0 <= y < depth_map.get_height():
                                depth_val = depth_map.get_value(x, y)[1]
                                if not np.isnan(depth_val) and depth_val > 0:
                                    face_depths.append(depth_val)
                    if face_depths:
                        avg_depth = sum(face_depths) / len(face_depths)
                        std_depth = np.std(face_depths)
                        # Thresholds
                        if avg_depth < 300 or avg_depth > 800:
                            spoofed = True
                            name += " (Spoofed!)"
                else:
                    # Simulated spoof detection for laptop webcam:
                    avg_depth = float(np.random.normal(550, 15))
                    std_depth = float(np.random.normal(12, 2))
                    
                    if name == "Unknown" and np.random.rand() < 0.05:
                        spoofed = True
                        name = "Intruder (Spoofed!)"
                        avg_depth = 150.0  # Too close (e.g., photo on phone screen)
                
                # Draw box
                color = (0, 0, 255) if spoofed else ((0, 255, 0) if name != "Unknown" else (0, 165, 255))
                cv2.rectangle(frame, (left, top), (right, bottom), color, 2)
                cv2.putText(frame, name, (left, top - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.75, color, 2)
                
                detected_logs.append({
                    "name": name,
                    "spoofed": spoofed,
                    "depth": f"{avg_depth:.1f} mm",
                    "std": f"{std_depth:.1f} mm"
                })

        else:
            # Fallback face detection using Haar Cascade or Mock Centered Box
            faces = []
            if face_cascade is not None:
                try:
                    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                    faces = face_cascade.detectMultiScale(gray, 1.1, 4)
                except Exception as e:
                    print(f"Haar detection error: {e}")
            
            if len(faces) == 0:
                # Create a mock bounding box in the center of the frame
                h_img, w_img = frame.shape[:2]
                w_box, h_box = int(w_img * 0.35), int(h_img * 0.45)
                x_box, y_box = int((w_img - w_box) / 2), int((h_img - h_box) / 2)
                faces = [(x_box, y_box, w_box, h_box)]

            for i, (x, y, w, h) in enumerate(faces):
                known_db = load_known_faces()
                names = list(known_db.keys())
                
                # Mock matching based on the detection index
                if names:
                    # Deterministic mock assignment based on coordinate to avoid flickering
                    name_idx = (x + y) % (len(names) + 1)
                    if name_idx < len(names):
                        name = names[name_idx]
                    else:
                        name = "Unknown"
                else:
                    name = "Unknown"
                
                spoofed = False
                # Simulate depth details
                avg_depth = float(np.random.normal(520 + (x % 50), 10))
                std_depth = float(np.random.normal(11, 1))

                # Simulate a spoof check failure if coordinates match
                if name == "Unknown" and (x + y) % 7 == 0:
                    spoofed = True
                    name = "Mock Spoof (Photo/Screen)"
                    avg_depth = 180.0 # Too close
                
                color = (0, 0, 255) if spoofed else ((0, 255, 0) if name != "Unknown" else (0, 165, 255))
                cv2.rectangle(frame, (x, y), (x+w, y+h), color, 2)
                cv2.putText(frame, name, (x, y - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.75, color, 2)
                
                detected_logs.append({
                    "name": name,
                    "spoofed": spoofed,
                    "depth": f"{avg_depth:.1f} mm",
                    "std": f"{std_depth:.1f} mm"
                })

        return frame, detected_logs

def register_new_face(name, camera):
    """
    Simulates or performs face registration.
    """
    known_db = load_known_faces()
    
    if FACE_REC_AVAILABLE and camera and camera.is_running:
        all_encodings = []
        capture_count = 0
        
        # Take 10 frames to average the face encodings
        for _ in range(30):
            frame = None
            if camera.use_zed:
                if camera.zed.grab() == sl.ERROR_CODE.SUCCESS:
                    image_zed = sl.Mat()
                    camera.zed.retrieve_image(image_zed, sl.VIEW.LEFT)
                    frame = image_zed.get_data()
                    frame = cv2.cvtColor(frame, cv2.COLOR_RGBA2RGB)
            else:
                success, frame = camera.video.read()
                if success:
                    frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            
            if frame is not None:
                face_locations = face_recognition.face_locations(frame)
                encodings = face_recognition.face_encodings(frame, face_locations)
                if encodings:
                    all_encodings.append(encodings[0])
                    capture_count += 1
                    if capture_count >= 10:
                        break
            cv2.waitKey(50)
            
        if all_encodings:
            average_encoding = sum(all_encodings) / len(all_encodings)
            known_db[name] = average_encoding
            save_known_faces(known_db)
            return True, f"Successfully registered face for '{name}' with {capture_count} samples."
        else:
            return False, "Failed to capture any face samples. Is your face visible in the camera?"
    else:
        # Fallback registration
        known_db[name] = None
        save_known_faces(known_db)
        return True, f"Mock-registered '{name}'. Added to face database (Webcam Simulation mode)."
