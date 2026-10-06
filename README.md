# Smart Eye - Driver Drowsiness Detection System

Smart Eye is a real-time computer vision system designed to detect driver drowsiness and distraction using facial landmark analysis (Eye Aspect Ratio - EAR), adaptive thresholds for eyeglasses wearers, and a modern interactive web dashboard.

---

## 🌟 Key Features

- **Real-Time Eye Aspect Ratio (EAR) Tracking**: Measures eye openness and closure duration to accurately detect micro-sleeps and drowsiness.
- **Adaptive Eyeglass Calibration**: Dynamically adjusts baseline EAR thresholds for drivers wearing glasses or spectacles.
- **Auditory Alert System**: Triggers alerts when eyes remain closed past the configured closure duration threshold.
- **Live Video Streaming & Flask API**: Exposes MJPEG stream and telemetry endpoints (`/api/status`, `/video_feed`).
- **Interactive React Dashboard**: Modern UI with real-time gauges, live video feed, ear history charts, and status indicators.

---

## 🏗️ Architecture

```
smart-eye/
├── dashboard/         # React + Vite frontend dashboard
├── vision/            # Python backend (OpenCV, MediaPipe, Flask)
├── models/            # Pretrained face landmark models
├── docs/              # System architecture & research notes
└── package.json       # Root scripts to run the dashboard
```

---

## 🚀 Getting Started

### 1. Prerequisites
- **Python**: 3.10+
- **Node.js**: 18+ and `npm`

### 2. Python Backend Setup
```bash
# Navigate to vision directory
cd vision

# Create and activate virtual environment
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install flask flask-cors opencv-python mediapipe numpy

# Run the vision server (runs on http://localhost:5001)
python server.py
```

### 3. Frontend Dashboard Setup
```bash
# In another terminal, navigate to the dashboard
cd dashboard

# Install dependencies
npm install

# Start development server (runs on http://localhost:5173)
npm run dev
# or from root:
# npm start
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## ⚙️ Configuration
Detection thresholds and camera options can be tuned in `vision/config.py`:
- `EAR_THRESHOLD`: Base Eye Aspect Ratio threshold (default: `0.21`)
- `CLOSURE_TIME`: Continuous closure time before alarm trigger in seconds (default: `1.5`)
- `CAMERA_INDEX`: OpenCV camera device index (default: `0`)

---

## 📜 License
MIT License
