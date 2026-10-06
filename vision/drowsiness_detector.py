import time
from config import EAR_THRESHOLD, CLOSURE_TIME


class DrowsinessDetector:

    def __init__(self):

        self.eyes_closed_start = None
        self.drowsy = False

        # Adaptive baseline for specs / glasses wearers
        self.open_ear_baseline = 0.30
        self.baseline_samples = []
        self.max_samples = 60              # ~2 seconds of frames
        self.specs_detected = False

    def update(self, ear):

        # Update open eye baseline when ear is active (> 0.15)
        if ear > 0.15:
            self.baseline_samples.append(ear)
            if len(self.baseline_samples) > self.max_samples:
                self.baseline_samples.pop(0)

            # 80th percentile of open values as driver's personal open-eye baseline
            sorted_samples = sorted(self.baseline_samples)
            top_idx = int(len(sorted_samples) * 0.80)
            self.open_ear_baseline = max(0.24, sorted_samples[top_idx])

        # If driver wears specs or has elevated landmark baseline (> 0.25),
        # mark specs_detected = True
        if self.open_ear_baseline > 0.25:
            self.specs_detected = True

        # Calculate dynamic adaptive threshold for specs wearers:
        # 73% of personal open-eye baseline (clamped between 0.20 and 0.24)
        adaptive_threshold = max(
            EAR_THRESHOLD,
            min(0.24, round(self.open_ear_baseline * 0.73, 3))
        )

        # Eyes are closed if EAR falls below adaptive threshold
        if ear < adaptive_threshold:

            if self.eyes_closed_start is None:
                self.eyes_closed_start = time.time()

            closure_time = (
                time.time() - self.eyes_closed_start
            )

            # Drowsiness decision
            if closure_time >= CLOSURE_TIME:
                self.drowsy = True

            return {
                "eye_state": "CLOSED",
                "closure_time": closure_time,
                "drowsy": self.drowsy,
                "specs_detected": self.specs_detected,
                "adaptive_threshold": adaptive_threshold
            }

        # Eyes are open
        else:

            self.eyes_closed_start = None
            self.drowsy = False

            return {
                "eye_state": "OPEN",
                "closure_time": 0,
                "drowsy": False,
                "specs_detected": self.specs_detected,
                "adaptive_threshold": adaptive_threshold
            }

    def reset(self):

        self.eyes_closed_start = None
        self.drowsy = False
        self.baseline_samples = []
        self.open_ear_baseline = 0.30