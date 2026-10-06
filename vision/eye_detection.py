import math
import mediapipe as mp
from config import (
    MIN_DETECTION_CONFIDENCE,
    MIN_TRACKING_CONFIDENCE
)


class EyeDetector:

    LEFT_EYE = [33, 160, 158, 133, 153, 144, 159, 145]
    RIGHT_EYE = [362, 385, 387, 263, 373, 380, 386, 374]

    def __init__(self):

        self.mp_face_mesh = mp.solutions.face_mesh

        # Detect up to 4 faces in frame so we can strictly lock onto primary driver
        self.face_mesh = self.mp_face_mesh.FaceMesh(
            max_num_faces=4,
            refine_landmarks=True,
            min_detection_confidence=MIN_DETECTION_CONFIDENCE,
            min_tracking_confidence=MIN_TRACKING_CONFIDENCE
        )

        # Spatial Driver Lock Tracking State
        self.tracked_driver_center = None  # (cx, cy) in normalized coords [0..1]
        self.tracked_driver_box = None     # (x_min, y_min, x_max, y_max)
        self.frames_lost = 0
        self.max_frames_lost = 45          # ~1.5s tolerance before re-locking primary face

    def _get_face_bbox_and_center(self, landmarks, frame_w, frame_h):
        xs = [l.x for l in landmarks]
        ys = [l.y for l in landmarks]

        x_min = int(min(xs) * frame_w)
        x_max = int(max(xs) * frame_w)
        y_min = int(min(ys) * frame_h)
        y_max = int(max(ys) * frame_h)

        # Padding around face boundary
        w = x_max - x_min
        h = y_max - y_min
        pad_x = int(w * 0.20)
        pad_y = int(h * 0.25)

        x_min_pad = max(0, x_min - pad_x)
        y_min_pad = max(0, y_min - pad_y)
        x_max_pad = min(frame_w, x_max + pad_x)
        y_max_pad = min(frame_h, y_max + pad_y)

        cx_norm = (min(xs) + max(xs)) / 2.0
        cy_norm = (min(ys) + max(ys)) / 2.0

        area = (x_max - x_min) * (y_max - y_min)

        return (x_min_pad, y_min_pad, x_max_pad, y_max_pad), (cx_norm, cy_norm), area

    def process(self, frame):

        height, width = frame.shape[:2]
        rgb_frame = frame[:, :, ::-1]

        results = self.face_mesh.process(rgb_frame)

        if not results.multi_face_landmarks:
            self.frames_lost += 1
            if self.frames_lost > self.max_frames_lost:
                self.tracked_driver_center = None
                self.tracked_driver_box = None
                return None, None, None, False

            # Keep focus boundary on driver's last position during brief obstructions
            if self.tracked_driver_box is not None:
                return None, None, self.tracked_driver_box, True
            return None, None, None, False

        # Parse all detected faces in frame
        faces = []
        for face_landmarks in results.multi_face_landmarks:
            bbox, center, area = self._get_face_bbox_and_center(
                face_landmarks.landmark, width, height
            )
            faces.append({
                "landmarks": face_landmarks.landmark,
                "bbox": bbox,
                "center": center,
                "area": area
            })

        selected_face = None

        # Lock onto primary driver if no driver currently locked
        if self.tracked_driver_center is None or self.frames_lost > self.max_frames_lost:
            best_score = -1.0
            for face in faces:
                cx, cy = face["center"]
                dist_to_img_center = math.sqrt((cx - 0.5)**2 + (cy - 0.5)**2)
                # Primary driver is usually centered and largest face in view
                score = face["area"] / (1.0 + 2.0 * dist_to_img_center)
                if score > best_score:
                    best_score = score
                    selected_face = face

            if selected_face:
                self.tracked_driver_center = selected_face["center"]
                self.tracked_driver_box = selected_face["bbox"]
                self.frames_lost = 0
        else:
            # Driver IS locked -> Only match face closest to driver's tracked position
            best_dist = float("inf")
            tcx, tcy = self.tracked_driver_center

            for face in faces:
                fcx, fcy = face["center"]
                dist = math.sqrt((fcx - tcx)**2 + (fcy - tcy)**2)

                # Distance threshold ensures we don't jump to secondary passengers/objects
                if dist < 0.35 and dist < best_dist:
                    best_dist = dist
                    selected_face = face

            if selected_face:
                # Smooth tracked driver center position
                scx = 0.7 * tcx + 0.3 * selected_face["center"][0]
                scy = 0.7 * tcy + 0.3 * selected_face["center"][1]
                self.tracked_driver_center = (scx, scy)
                self.tracked_driver_box = selected_face["bbox"]
                self.frames_lost = 0
            else:
                # No face near driver center -> hold driver focus boundary
                self.frames_lost += 1
                if self.frames_lost <= self.max_frames_lost and self.tracked_driver_box is not None:
                    return None, None, self.tracked_driver_box, True

        if selected_face is None:
            return None, None, None, False

        landmarks = selected_face["landmarks"]

        left_eye = [landmarks[i] for i in self.LEFT_EYE]
        right_eye = [landmarks[i] for i in self.RIGHT_EYE]

        return left_eye, right_eye, selected_face["bbox"], True

    def reset_lock(self):
        self.tracked_driver_center = None
        self.tracked_driver_box = None
        self.frames_lost = 0

    def close(self):
        self.face_mesh.close()