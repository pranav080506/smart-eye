import cv2
from config import CAMERA_INDEX


class Camera:

    def __init__(self):
        self.cap = cv2.VideoCapture(CAMERA_INDEX)

        if not self.cap.isOpened():
            raise RuntimeError("Could not open camera")

    def read(self):
        ret, frame = self.cap.read()

        if not ret:
            return None

        return cv2.flip(frame, 1)

    def release(self):
        self.cap.release()