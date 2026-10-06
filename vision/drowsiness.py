import cv2
import math
import subprocess

from camera import Camera
from eye_detection import EyeDetector
from drowsiness_detector import DrowsinessDetector
from system_status import SystemStatus
from api_status import save_status


# --------------------------------------------------
# EAR calculation
# --------------------------------------------------

def distance(p1, p2):
    return math.sqrt(
        (p1.x - p2.x) ** 2 +
        (p1.y - p2.y) ** 2
    )


def calculate_ear(eye_points):

    vertical_1 = distance(
        eye_points[1],
        eye_points[5]
    )

    vertical_2 = distance(
        eye_points[2],
        eye_points[4]
    )

    horizontal = distance(
        eye_points[0],
        eye_points[3]
    )

    return (
        (vertical_1 + vertical_2)
        / (2.0 * horizontal)
    )


# --------------------------------------------------
# Alarm
# --------------------------------------------------

alarm_process = None


def start_alarm():

    global alarm_process

    if alarm_process is None:

        print("ALARM: DROWSINESS DETECTED")

        alarm_process = subprocess.Popen(
            [
                "say",
                "-v",
                "Samantha",
                "Warning! Driver drowsiness detected!"
            ]
        )


def stop_alarm():

    global alarm_process

    if alarm_process is not None:

        subprocess.run(
            ["killall", "say"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL
        )

        alarm_process = None


# --------------------------------------------------
# Initialize system
# --------------------------------------------------

camera = Camera()

eye_detector = EyeDetector()

drowsiness_detector = DrowsinessDetector()

system_status = SystemStatus()


print("SMART EYE started.")
print("Press Q to quit.")


# --------------------------------------------------
# Main loop
# --------------------------------------------------

while True:

    frame = camera.read()

    if frame is None:

        print("Error: Could not read camera.")
        break


    # --------------------------------------------------
    # Eye detection
    # --------------------------------------------------

    eyes = eye_detector.process(frame)


    if eyes is not None:

        left_eye, right_eye = eyes


        # --------------------------------------------------
        # Calculate EAR
        # --------------------------------------------------

        left_ear = calculate_ear(left_eye)

        right_ear = calculate_ear(right_eye)

        ear = (
            left_ear + right_ear
        ) / 2.0


        # --------------------------------------------------
        # Drowsiness detection
        # --------------------------------------------------

        result = drowsiness_detector.update(ear)

        eye_state = result["eye_state"]

        closure_time = result["closure_time"]

        drowsy = result["drowsy"]


        # --------------------------------------------------
        # Update system status
        # --------------------------------------------------

        system_status.update(
            ear=ear,
            eye_state=eye_state,
            closure_time=closure_time,
            drowsy=drowsy,
            face_detected=True
        )


        # --------------------------------------------------
        # Save real-time status
        # --------------------------------------------------

        status = system_status.get_status()

        save_status(status)


        # --------------------------------------------------
        # Alarm
        # --------------------------------------------------

        if drowsy:

            start_alarm()

        else:

            stop_alarm()


        # --------------------------------------------------
        # Display information
        # --------------------------------------------------

        cv2.putText(
            frame,
            f"EAR: {ear:.2f}",
            (20, 40),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.8,
            (255, 255, 255),
            2
        )


        cv2.putText(
            frame,
            f"Eyes: {eye_state}",
            (20, 75),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.8,
            (255, 255, 255),
            2
        )


        cv2.putText(
            frame,
            f"Closure: {closure_time:.1f}s",
            (20, 110),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.8,
            (255, 255, 255),
            2
        )


        if drowsy:

            cv2.putText(
                frame,
                "DROWSINESS DETECTED!",
                (20, 155),
                cv2.FONT_HERSHEY_SIMPLEX,
                1,
                (0, 0, 255),
                3
            )

        else:

            cv2.putText(
                frame,
                "DRIVER STATUS: ALERT",
                (20, 155),
                cv2.FONT_HERSHEY_SIMPLEX,
                1,
                (0, 255, 0),
                3
            )


    else:

        # --------------------------------------------------
        # No face detected
        # --------------------------------------------------

        drowsiness_detector.reset()

        system_status.update(
            ear=0.0,
            eye_state="NO FACE",
            closure_time=0.0,
            drowsy=False,
            face_detected=False
        )

        save_status(
            system_status.get_status()
        )

        stop_alarm()


        cv2.putText(
            frame,
            "NO FACE DETECTED",
            (20, 40),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.8,
            (0, 165, 255),
            2
        )


    # --------------------------------------------------
    # Show camera
    # --------------------------------------------------

    cv2.imshow(
        "SMART EYE - Drowsiness Detection",
        frame
    )


    # --------------------------------------------------
    # Quit
    # --------------------------------------------------

    if cv2.waitKey(1) & 0xFF == ord("q"):

        break


# --------------------------------------------------
# Cleanup
# --------------------------------------------------

stop_alarm()

camera.release()

eye_detector.close()

cv2.destroyAllWindows()