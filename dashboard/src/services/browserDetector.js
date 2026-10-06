import { FilesetResolver, FaceLandmarker } from "@mediapipe/tasks-vision";

// Exact eye landmarks indices matching the Python backend
export const LEFT_EYE = [33, 160, 158, 133, 153, 144, 159, 145];
export const RIGHT_EYE = [362, 385, 387, 263, 373, 380, 386, 374];

const EAR_THRESHOLD = 0.21;
const CLOSURE_TIME = 1.5;

export function distance(p1, p2) {
  const dx = (p1.x - p2.x);
  const dy = (p1.y - p2.y);
  return Math.sqrt(dx * dx + dy * dy);
}

export function calculateEar(eye) {
  if (!eye || eye.length < 6) return 0.0;
  const v1 = distance(eye[1], eye[5]);
  const v2 = distance(eye[2], eye[4]);
  const h = distance(eye[0], eye[3]);
  if (h === 0) return 0.0;

  let ear = (v1 + v2) / (2.0 * h);
  if (eye.length >= 8) {
    const vCenter = distance(eye[6], eye[7]);
    const earCenter = vCenter / h;
    ear = Math.min(ear, earCenter);
  }
  return ear;
}

export class DrowsinessDetector {
  constructor() {
    this.eyesClosedStart = null;
    this.drowsy = false;
    this.openEarBaseline = 0.30;
    this.baselineSamples = [];
    this.maxSamples = 60;
    this.specsDetected = false;
  }

  update(ear) {
    if (ear > 0.15) {
      this.baselineSamples.push(ear);
      if (this.baselineSamples.length > this.maxSamples) {
        this.baselineSamples.shift();
      }
      const sorted = [...this.baselineSamples].sort((a, b) => a - b);
      const topIdx = Math.floor(sorted.length * 0.80);
      this.openEarBaseline = Math.max(0.24, sorted[topIdx] || 0.24);
    }

    if (this.openEarBaseline > 0.25) {
      this.specsDetected = true;
    }

    const adaptiveThreshold = Math.max(
      EAR_THRESHOLD,
      Math.min(0.24, Number((this.openEarBaseline * 0.73).toFixed(3)))
    );

    const now = performance.now() / 1000;

    if (ear < adaptiveThreshold) {
      if (this.eyesClosedStart === null) {
        this.eyesClosedStart = now;
      }
      const closureTime = now - this.eyesClosedStart;
      if (closureTime >= CLOSURE_TIME) {
        this.drowsy = true;
      }
      return {
        eyeState: "CLOSED",
        closureTime: Number(closureTime.toFixed(1)),
        drowsy: this.drowsy,
        specsDetected: this.specsDetected,
        adaptiveThreshold
      };
    } else {
      this.eyesClosedStart = null;
      this.drowsy = false;
      return {
        eyeState: "OPEN",
        closureTime: 0,
        drowsy: false,
        specsDetected: this.specsDetected,
        adaptiveThreshold
      };
    }
  }

  reset() {
    this.eyesClosedStart = null;
    this.drowsy = false;
    this.baselineSamples = [];
    this.openEarBaseline = 0.30;
  }
}

let landmarkerInstance = null;
let landmarkerLoadingPromise = null;

export async function getFaceLandmarker() {
  if (landmarkerInstance) return landmarkerInstance;
  if (landmarkerLoadingPromise) return landmarkerLoadingPromise;

  landmarkerLoadingPromise = (async () => {
    try {
      const filesetResolver = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
      );
      landmarkerInstance = await FaceLandmarker.createFromOptions(
        filesetResolver,
        {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
            delegate: "GPU"
          },
          runningMode: "VIDEO",
          numFaces: 1,
          minFaceDetectionConfidence: 0.5,
          minFacePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
          outputFaceBlendshapes: false
        }
      );
      return landmarkerInstance;
    } catch (err) {
      console.warn("GPU delegate failed, falling back to CPU delegate:", err);
      const filesetResolver = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
      );
      landmarkerInstance = await FaceLandmarker.createFromOptions(
        filesetResolver,
        {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
            delegate: "CPU"
          },
          runningMode: "VIDEO",
          numFaces: 1,
          minFaceDetectionConfidence: 0.5,
          minFacePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5
        }
      );
      return landmarkerInstance;
    }
  })();

  return landmarkerLoadingPromise;
}

export function drawDetectionOverlay(ctx, width, height, landmarks, telemetry) {
  ctx.save();
  ctx.clearRect(0, 0, width, height);

  if (!landmarks || landmarks.length === 0) {
    // No driver detected HUD
    ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
    ctx.fillRect(25, 25, 280, 45);
    ctx.strokeStyle = "#ff9800";
    ctx.strokeRect(25, 25, 280, 45);
    ctx.fillStyle = "#ff9800";
    ctx.font = "bold 16px 'Outfit', Inter, sans-serif";
    ctx.fillText("NO DRIVER DETECTED", 40, 53);
    ctx.restore();
    return;
  }

  const { isDrowsy, isClosed, ear, closureTime } = telemetry;

  // Face bounding box
  let minX = 1, maxX = 0, minY = 1, maxY = 0;
  for (const pt of landmarks) {
    if (pt.x < minX) minX = pt.x;
    if (pt.x > maxX) maxX = pt.x;
    if (pt.y < minY) minY = pt.y;
    if (pt.y > maxY) maxY = pt.y;
  }

  // Add padding
  const padX = (maxX - minX) * 0.20;
  const padY = (maxY - minY) * 0.25;
  const x1 = Math.max(0, (minX - padX) * width);
  const y1 = Math.max(0, (minY - padY) * height);
  const x2 = Math.min(width, (maxX + padX) * width);
  const y2 = Math.min(height, (maxY + padY) * height);

  const boxW = x2 - x1;
  const boxH = y2 - y1;

  let color = "#00e5ff"; // Cyan/Teal
  let label = "PRIMARY DRIVER BOUNDARY [ LOCKED ]";

  if (isDrowsy) {
    color = "#ff1744"; // Red
    label = "DRIVER FOCUS BOUNDARY [ DROWSINESS ALERT ]";
  } else if (isClosed) {
    color = "#ff9100"; // Orange
    label = "DRIVER FOCUS BOUNDARY [ EYES CLOSED ]";
  }

  // Main box outline
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.strokeRect(x1, y1, boxW, boxH);

  // High-tech corner HUD brackets
  const cornerLen = Math.max(15, Math.min(30, boxW * 0.2));
  ctx.lineWidth = 4;
  // Top-left
  ctx.beginPath();
  ctx.moveTo(x1, y1 + cornerLen);
  ctx.lineTo(x1, y1);
  ctx.lineTo(x1 + cornerLen, y1);
  ctx.stroke();
  // Top-right
  ctx.beginPath();
  ctx.moveTo(x2 - cornerLen, y1);
  ctx.lineTo(x2, y1);
  ctx.lineTo(x2, y1 + cornerLen);
  ctx.stroke();
  // Bottom-left
  ctx.beginPath();
  ctx.moveTo(x1, y2 - cornerLen);
  ctx.lineTo(x1, y2);
  ctx.lineTo(x1 + cornerLen, y2);
  ctx.stroke();
  // Bottom-right
  ctx.beginPath();
  ctx.moveTo(x2 - cornerLen, y2);
  ctx.lineTo(x2, y2);
  ctx.lineTo(x2, y2 - cornerLen);
  ctx.stroke();

  // Top boundary label badge
  ctx.fillStyle = "rgba(0,0,0,0.75)";
  ctx.fillRect(x1, Math.max(10, y1 - 28), 320, 26);
  ctx.fillStyle = color;
  ctx.font = "bold 11px Inter, sans-serif";
  ctx.fillText(label, x1 + 8, Math.max(10, y1 - 28) + 17);

  // Draw eye landmark points
  ctx.fillStyle = isDrowsy ? "#ff1744" : isClosed ? "#ff9100" : "#00ffcc";
  const eyeIndices = [...LEFT_EYE, ...RIGHT_EYE];
  for (const idx of eyeIndices) {
    const pt = landmarks[idx];
    if (pt) {
      ctx.beginPath();
      ctx.arc(pt.x * width, pt.y * height, 2.5, 0, 2 * Math.PI);
      ctx.fill();
    }
  }

  // Full-screen Alert HUD if drowsy
  if (isDrowsy) {
    ctx.strokeStyle = "#ff1744";
    ctx.lineWidth = 8;
    ctx.strokeRect(4, 4, width - 8, height - 8);

    ctx.fillStyle = "rgba(180, 0, 0, 0.4)";
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = "rgba(0, 0, 0, 0.85)";
    ctx.fillRect(width / 2 - 220, height / 2 - 50, 440, 100);
    ctx.strokeStyle = "#ff1744";
    ctx.lineWidth = 3;
    ctx.strokeRect(width / 2 - 220, height / 2 - 50, 440, 100);

    ctx.fillStyle = "#ff1744";
    ctx.font = "bold 24px 'Outfit', Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("⚠️ DROWSINESS DETECTED", width / 2, height / 2 - 10);

    ctx.fillStyle = "#ffffff";
    ctx.font = "14px Inter, sans-serif";
    ctx.fillText("DRIVER ATTENTION REQUIRED", width / 2, height / 2 + 25);
    ctx.textAlign = "start";
  }

  ctx.restore();
}
