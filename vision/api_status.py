import json
import os


STATUS_FILE = "status.json"


def save_status(data):

    with open(STATUS_FILE, "w") as file:
        json.dump(data, file)


def load_status():

    if not os.path.exists(STATUS_FILE):

        return {
            "ear": 0.0,
            "eye_state": "UNKNOWN",
            "closure_time": 0.0,
            "drowsy": False,
            "face_detected": False
        }

    try:

        with open(STATUS_FILE, "r") as file:
            return json.load(file)

    except (json.JSONDecodeError, OSError):

        return {
            "ear": 0.0,
            "eye_state": "UNKNOWN",
            "closure_time": 0.0,
            "drowsy": False,
            "face_detected": False
        }