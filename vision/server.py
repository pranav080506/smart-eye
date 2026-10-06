
import cv2
import math
import time
import threading
import subprocess

from flask import Flask, jsonify, Response
from flask_cors import CORS

from eye_detection import EyeDetector
from drowsiness_detector import DrowsinessDetector
from config import CAMERA_INDEX


# ==========================================
# FLASK
# ==========================================

app = Flask(__name__)
CORS(app)


# ==========================================
# GLOBAL STATE
# ==========================================

camera = None
camera_running = False

latest_frame = None

latest_status = {
    "ear": 0.0,
    "eye_state": "UNKNOWN",
    "closure_time": 0.0,
    "drowsy": False,
    "face_detected": False,
    "camera": False,
    "camera_mode": "PYTHON"
}

frame_lock = threading.Lock()

detector = None
drowsiness_detector = None

alarm_process = None


# ==========================================
# EAR CALCULATION
# ==========================================

def distance(p1, p2):
    return math.sqrt(
        (p1.x - p2.x) ** 2 +
        (p1.y - p2.y) ** 2
    )


def calculate_ear(eye):
    vertical_1 = distance(eye[1], eye[5])
    vertical_2 = distance(eye[2], eye[4])
    horizontal = distance(eye[0], eye[3])

    if horizontal == 0:
        return 0.0

    ear = (vertical_1 + vertical_2) / (2.0 * horizontal)

    # Specs lens refinement: center eyelid distance check
    if len(eye) >= 8:
        vertical_center = distance(eye[6], eye[7])
        ear_center = vertical_center / horizontal
        ear = min(ear, ear_center)

    return ear


# ==========================================
# ALARM
# ==========================================

def start_alarm():
    global alarm_process

    # Don't start another voice process
    # if alarm is already running.
    if alarm_process is not None:

        # Check whether the process is
        # still alive.
        if alarm_process.poll() is None:
            return

        alarm_process = None

    try:

        print("================================")
        print("ALARM: DROWSINESS DETECTED")
        print("================================")

        alarm_process = subprocess.Popen(
            [
                "say",
                "-v",
                "Samantha",
                "Warning. Driver drowsiness detected. Please stay alert."
            ]
        )

    except Exception as e:

        print("Alarm error:", e)

        alarm_process = None


def stop_alarm():
    global alarm_process

    if alarm_process is not None:

        try:

            if alarm_process.poll() is None:
                alarm_process.terminate()

        except Exception:
            pass

        alarm_process = None


# ==========================================
# DRAW TEXT
# ==========================================

def draw_text_box(
    frame,
    text,
    position,
    font_scale=0.7,
    color=(255, 255, 255),
    thickness=2
):

    font = cv2.FONT_HERSHEY_SIMPLEX

    x, y = position

    (text_width, text_height), baseline = cv2.getTextSize(
        text,
        font,
        font_scale,
        thickness
    )

    padding = 8

    cv2.rectangle(
        frame,
        (
            x - padding,
            y - text_height - padding
        ),
        (
            x + text_width + padding,
            y + baseline + padding
        ),
        (0, 0, 0),
        -1
    )

    cv2.putText(
        frame,
        text,
        (x, y),
        font,
        font_scale,
        color,
        thickness,
        cv2.LINE_AA
    )


# ==========================================
# DRAW DRIVER FOCUS BOUNDARY
# ==========================================

def draw_driver_boundary(frame, box, is_drowsy, is_closed):
    x1, y1, x2, y2 = box

    if is_drowsy:
        color = (0, 0, 255)         # Red
        label = "DRIVER FOCUS BOUNDARY [ DROWSINESS ALERT ]"
    elif is_closed:
        color = (0, 165, 255)       # Amber / Orange
        label = "DRIVER FOCUS BOUNDARY [ EYES CLOSED ]"
    else:
        color = (255, 215, 0)       # Cyan / Teal
        label = "PRIMARY DRIVER BOUNDARY [ LOCKED ]"

    # Draw primary boundary box
    cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)

    # Draw corner HUD accents
    corner_len = max(15, min(30, (x2 - x1) // 5))
    thick = 3

    # Top-Left corner
    cv2.line(frame, (x1, y1), (x1 + corner_len, y1), color, thick)
    cv2.line(frame, (x1, y1), (x1, y1 + corner_len), color, thick)

    # Top-Right corner
    cv2.line(frame, (x2, y1), (x2 - corner_len, y1), color, thick)
    cv2.line(frame, (x2, y1), (x2, y1 + corner_len), color, thick)

    # Bottom-Left corner
    cv2.line(frame, (x1, y2), (x1 + corner_len, y2), color, thick)
    cv2.line(frame, (x1, y2), (x1, y2 - corner_len), color, thick)

    # Bottom-Right corner
    cv2.line(frame, (x2, y2), (x2 - corner_len, y2), color, thick)
    cv2.line(frame, (x2, y2), (x2, y2 - corner_len), color, thick)

    # Boundary Label
    draw_text_box(
        frame,
        label,
        (x1, max(30, y1 - 10)),
        0.5,
        color,
        2
    )


# ==========================================
# PROCESS FRAME
# ==========================================

def process_frame(frame):

    global detector
    global drowsiness_detector
    global latest_status

    left_eye, right_eye, driver_box, is_locked = detector.process(frame)

    # ======================================
    # NO DRIVER DETECTED
    # ======================================

    if driver_box is None and left_eye is None:

        latest_status = {
            "ear": 0.0,
            "eye_state": "NO FACE",
            "closure_time": 0.0,
            "drowsy": False,
            "face_detected": False,
            "camera": True,
            "camera_mode": "PYTHON"
        }

        draw_text_box(
            frame,
            "NO DRIVER DETECTED",
            (25, 45),
            0.8,
            (0, 165, 255),
            2
        )

        return frame

    # ======================================
    # CALCULATE EAR (OR MAINTAIN CLOSED STATE IF OBSTRUCTED)
    # ======================================

    if left_eye is None or right_eye is None:
        # Driver face boundary is locked, but eye landmarks are obscured/closed tight
        ear = 0.0
    else:
        left_ear = calculate_ear(left_eye)
        right_ear = calculate_ear(right_eye)
        ear = (left_ear + right_ear) / 2.0

    # ======================================
    # DROWSINESS DECISION
    # ======================================

    result = drowsiness_detector.update(ear)

    latest_status = {
        "ear": round(ear, 3),
        "eye_state": result["eye_state"],
        "closure_time": round(
            result["closure_time"],
            2
        ),
        "drowsy": result["drowsy"],
        "face_detected": True,
        "camera": True,
        "camera_mode": "PYTHON",
        "specs_mode": result.get("specs_detected", False),
        "adaptive_threshold": result.get("adaptive_threshold", 0.20)
    }

    # ======================================
    # DRAW DRIVER FOCUS BOUNDARY BOX
    # ======================================

    if driver_box is not None:
        draw_driver_boundary(
            frame,
            driver_box,
            result["drowsy"],
            result["eye_state"] == "CLOSED"
        )

    # ======================================
    # EAR & ADAPTIVE SPECS OVERLAY
    # ======================================

    ear_label = f"EAR: {ear:.3f}"
    if result.get("specs_detected"):
        ear_label += f" | SPECS MODE (TH: {result.get('adaptive_threshold'):.2f})"

    draw_text_box(
        frame,
        ear_label,
        (25, 45),
        0.65,
        (255, 255, 255),
        2
    )

    # ======================================
    # EYE STATE
    # ======================================

    draw_text_box(
        frame,
        f"EYE STATE: {result['eye_state']}",
        (25, 85),
        0.7,
        (255, 255, 255),
        2
    )

    # ======================================
    # CLOSURE TIME
    # ======================================

    draw_text_box(
        frame,
        f"CLOSURE TIME: {result['closure_time']:.1f}s",
        (25, 125),
        0.7,
        (255, 255, 255),
        2
    )

    # ======================================
    # DROWSINESS
    # ======================================

    if result["drowsy"]:

        draw_text_box(
            frame,
            "DROWSINESS DETECTED",
            (25, 180),
            0.9,
            (0, 0, 255),
            3
        )

        draw_text_box(
            frame,
            "WARNING - DRIVER ATTENTION REQUIRED",
            (25, 225),
            0.65,
            (0, 0, 255),
            2
        )

        # Red border

        height, width = frame.shape[:2]

        cv2.rectangle(
            frame,
            (5, 5),
            (width - 5, height - 5),
            (0, 0, 255),
            5
        )

        # Voice alarm

        start_alarm()

    else:

        draw_text_box(
            frame,
            "DRIVER STATUS: ALERT",
            (25, 180),
            0.8,
            (0, 255, 0),
            2
        )

        stop_alarm()

    # ======================================
    # TITLE
    # ======================================

    height, width = frame.shape[:2]

    draw_text_box(
        frame,
        "SMART EYE | BOUNDARY LOCKED",
        (width - 380, 40),
        0.55,
        (255, 255, 255),
        2
    )

    return frame


# ==========================================
# CAMERA LOOP
# ==========================================

def camera_loop():

    global camera
    global camera_running
    global latest_frame
    global detector
    global drowsiness_detector

    print("Python camera thread started.")

    # ======================================
    # OPEN CAMERA
    # ======================================

    camera = cv2.VideoCapture(CAMERA_INDEX)

    camera.set(
        cv2.CAP_PROP_FRAME_WIDTH,
        1280
    )

    camera.set(
        cv2.CAP_PROP_FRAME_HEIGHT,
        720
    )

    if not camera.isOpened():

        print("ERROR: Could not open camera.")

        camera_running = False

        return

    print("Camera opened successfully.")

    # ======================================
    # INITIALIZE MEDIAPIPE
    # ======================================

    detector = EyeDetector()

    drowsiness_detector = DrowsinessDetector()

    # ======================================
    # MAIN CAMERA LOOP
    # ======================================

    while camera_running:

        ret, frame = camera.read()

        if not ret:

            print("Could not read camera frame.")

            time.sleep(0.05)

            continue

        # Mirror camera

        frame = cv2.flip(
            frame,
            1
        )

        # Process detection

        processed_frame = process_frame(
            frame
        )

        # ==================================
        # SAVE FRAME FOR FLASK
        # ==================================

        with frame_lock:

            latest_frame = processed_frame.copy()

        time.sleep(0.01)

    # ======================================
    # CLEANUP
    # ======================================

    stop_alarm()

    if detector is not None:

        detector.close()

        detector = None

    if camera is not None:

        camera.release()

        camera = None

    print("Python camera stopped.")


# ==========================================
# START CAMERA
# ==========================================

def start_camera():

    global camera_running

    if camera_running:

        return

    camera_running = True

    thread = threading.Thread(
        target=camera_loop,
        daemon=True
    )

    thread.start()


# ==========================================
# STOP CAMERA
# ==========================================

def stop_camera():

    global camera_running
    global latest_frame
    global latest_status

    camera_running = False

    stop_alarm()

    with frame_lock:

        latest_frame = None

    # Reset status so dashboard reflects camera is off
    latest_status = {
        "ear": 0.0,
        "eye_state": "UNKNOWN",
        "closure_time": 0.0,
        "drowsy": False,
        "face_detected": False,
        "camera": False,
        "camera_mode": "PYTHON"
    }


# ==========================================
# FLASK HOME
# ==========================================

@app.route("/")
def home():

    return jsonify({
        "system": "SMART EYE",
        "status": "API RUNNING"
    })


# ==========================================
# STATUS API
# ==========================================

@app.route("/api/status")
def get_status():

    with frame_lock:

        return jsonify(
            latest_status
        )


# ==========================================
# START CAMERA API
# ==========================================

@app.route(
    "/camera/start",
    methods=["POST"]
)
def camera_start():

    start_camera()

    return jsonify({
        "success": True,
        "camera": "PYTHON"
    })


# ==========================================
# STOP CAMERA API
# ==========================================

@app.route(
    "/camera/stop",
    methods=["POST"]
)
def camera_stop():

    stop_camera()

    return jsonify({
        "success": True,
        "camera": "STOPPED"
    })


# ==========================================
# VIDEO STREAM
# ==========================================

def generate_frames():

    while True:

        with frame_lock:

            if latest_frame is None:

                frame = None

            else:

                frame = latest_frame.copy()

        if frame is None:

            time.sleep(0.05)

            continue

        success, buffer = cv2.imencode(
            ".jpg",
            frame
        )

        if not success:

            continue

        frame_bytes = buffer.tobytes()

        yield (
            b"--frame\r\n"
            b"Content-Type: image/jpeg\r\n\r\n"
            + frame_bytes
            + b"\r\n"
        )


@app.route("/video_feed")
def video_feed():

    return Response(
        generate_frames(),
        mimetype=(
            "multipart/x-mixed-replace; "
            "boundary=frame"
        )
    )


# ==========================================
# MAIN
# ==========================================

if __name__ == "__main__":

    print()
    print("--------------------------------")
    print("SMART EYE SERVER")
    print("--------------------------------")

    # ======================================
    # START CAMERA IN BACKGROUND THREAD
    # ======================================

    start_camera()

    print("Python camera started.")
    print(
        "Open React dashboard at "
        "http://localhost:5174"
    )
    print()
    print("Press Ctrl+C to stop the server.")
    print("--------------------------------")
    print()

    # ======================================
    # RUN FLASK ON MAIN THREAD (blocking)
    # This keeps the process alive.
    # Ctrl+C stops everything.
    # ======================================

    port = 5001
    try:
        app.run(
            host="0.0.0.0",
            port=port,
            debug=False,
            use_reloader=False
        )
    except OSError:
        port = 5000
        app.run(
            host="0.0.0.0",
            port=port,
            debug=False,
            use_reloader=False
        )
    except KeyboardInterrupt:
        pass

    # ======================================
    # CLEANUP
    # ======================================

    stop_camera()

    print()
    print("--------------------------------")
    print("SMART EYE SERVER STOPPED")
    print("--------------------------------")



