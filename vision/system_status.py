class SystemStatus:

    def __init__(self):
        self.ear = 0.0
        self.eye_state = "UNKNOWN"
        self.closure_time = 0.0
        self.drowsy = False
        self.face_detected = False

    def update(
        self,
        ear,
        eye_state,
        closure_time,
        drowsy,
        face_detected
    ):

        self.ear = ear
        self.eye_state = eye_state
        self.closure_time = closure_time
        self.drowsy = drowsy
        self.face_detected = face_detected

    def get_status(self):

        return {
            "ear": round(self.ear, 3),
            "eye_state": self.eye_state,
            "closure_time": round(self.closure_time, 2),
            "drowsy": self.drowsy,
            "face_detected": self.face_detected
        }