import { useCallback, useEffect, useRef, useState } from "react";
import "./App.css";
import {
  DrowsinessDetector,
  LEFT_EYE,
  RIGHT_EYE,
  calculateEar,
  drawDetectionOverlay,
  getFaceLandmarker,
} from "./services/browserDetector";

const API = "http://127.0.0.1:5001";

// Detect if running locally (Python backend could be available)
const IS_LOCAL =
  typeof window !== "undefined" &&
  (window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1");

function App() {
  // =============================================
  // PYTHON BACKEND STATE
  // =============================================
  const [serverOnline, setServerOnline] = useState(false);
  const [status, setStatus] = useState({
    ear: 0,
    eye_state: "UNKNOWN",
    closure_time: 0,
    drowsy: false,
    camera: false,
  });

  const [videoFeedSrc, setVideoFeedSrc] = useState(
    IS_LOCAL ? "http://127.0.0.1:5001/video_feed" : "/video_feed"
  );

  // =============================================
  // BROWSER AI STATE
  // =============================================
  const [browserAiActive, setBrowserAiActive] = useState(false);
  const [browserAiLoading, setBrowserAiLoading] = useState(false);
  const [browserAiError, setBrowserAiError] = useState(null);
  const [browserAiStatus, setBrowserAiStatus] = useState({
    ear: 0,
    eyeState: "UNKNOWN",
    closureTime: 0,
    drowsy: false,
    faceDetected: false,
  });

  const browserAiVideoRef = useRef(null);
  const browserAiCanvasRef = useRef(null);
  const browserAiStreamRef = useRef(null);
  const browserAiAnimRef = useRef(null);
  const browserAiDetectorRef = useRef(null);
  const landmarkerRef = useRef(null);

  // =============================================
  // LEGACY BROWSER CAMERA STATE (basic, no AI)
  // =============================================
  const [browserCamera, setBrowserCamera] = useState(false);
  const [toastMessage, setToastMessage] = useState("");

  // =============================================
  // ALARM STATE
  // =============================================
  const [alarmMuted, setAlarmMuted] = useState(false);
  const [alarmActive, setAlarmActive] = useState(false);

  const videoRef = useRef(null);
  const streamRef = useRef(null);

  const audioCtxRef = useRef(null);
  const alarmIntervalRef = useRef(null);
  const prevDrowsyRef = useRef(false);

  const showToast = useCallback((msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(""), 3500);
  }, []);

  // =============================================
  // PYTHON BACKEND POLLING
  // =============================================
  useEffect(() => {
    const endpoints = [
      "/api/status",
      "http://127.0.0.1:5001/api/status",
      "http://localhost:5001/api/status",
    ];

    const getStatus = async () => {
      for (const endpoint of endpoints) {
        try {
          const response = await fetch(endpoint, { cache: "no-store" });
          if (response.ok) {
            const data = await response.json();
            setServerOnline(true);
            setStatus({
              ear: Number(data.ear ?? 0),
              eye_state: data.eye_state ?? "UNKNOWN",
              closure_time: Number(data.closure_time ?? 0),
              drowsy: Boolean(data.drowsy ?? false),
              camera: Boolean(data.camera ?? false),
            });
            return;
          }
        } catch (_) {}
      }
      setServerOnline(false);
      setStatus({ ear: 0, eye_state: "UNKNOWN", closure_time: 0, drowsy: false, camera: false });
    };

    getStatus();
    const interval = setInterval(getStatus, 300);
    return () => clearInterval(interval);
  }, []);

  // =============================================
  // PYTHON CAMERA CONTROLS
  // =============================================
  const startPythonCamera = async () => {
    for (const ep of ["/camera/start", "http://127.0.0.1:5001/camera/start"]) {
      try {
        const res = await fetch(ep, { method: "POST" });
        if (res.ok) { showToast("Python camera starting…"); return; }
      } catch (_) {}
    }
  };

  const stopPythonCamera = async () => {
    for (const ep of ["/camera/stop", "http://127.0.0.1:5001/camera/stop"]) {
      try {
        const res = await fetch(ep, { method: "POST" });
        if (res.ok) { showToast("Python camera stopped"); return; }
      } catch (_) {}
    }
  };

  // =============================================
  // BROWSER AI — MEDIAPIPE DETECTION LOOP
  // =============================================
  const stopBrowserAi = useCallback(() => {
    if (browserAiAnimRef.current) {
      cancelAnimationFrame(browserAiAnimRef.current);
      browserAiAnimRef.current = null;
    }
    if (browserAiStreamRef.current) {
      browserAiStreamRef.current.getTracks().forEach((t) => t.stop());
      browserAiStreamRef.current = null;
    }
    if (browserAiVideoRef.current) browserAiVideoRef.current.srcObject = null;
    if (browserAiCanvasRef.current) {
      const ctx = browserAiCanvasRef.current.getContext("2d");
      ctx.clearRect(0, 0, browserAiCanvasRef.current.width, browserAiCanvasRef.current.height);
    }
    browserAiDetectorRef.current = null;
    setBrowserAiActive(false);
    setBrowserAiStatus({ ear: 0, eyeState: "UNKNOWN", closureTime: 0, drowsy: false, faceDetected: false });
  }, []);

  const startBrowserAi = async () => {
    setBrowserAiError(null);
    setBrowserAiLoading(true);

    try {
      // Load MediaPipe landmarker once and cache it
      if (!landmarkerRef.current) {
        showToast("Loading AI model… please wait");
        landmarkerRef.current = await getFaceLandmarker();
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720, facingMode: "user" },
        audio: false,
      });

      browserAiStreamRef.current = stream;

      const video = browserAiVideoRef.current;
      video.srcObject = stream;
      await video.play();

      browserAiDetectorRef.current = new DrowsinessDetector();
      setBrowserAiActive(true);
      setBrowserAiLoading(false);
      showToast("Browser AI detection active");

      let lastTime = -1;

      const detect = (now) => {
        if (!browserAiStreamRef.current) return;
        browserAiAnimRef.current = requestAnimationFrame(detect);

        if (!video.videoWidth || !video.videoHeight) return;

        // Resize canvas to match video
        const canvas = browserAiCanvasRef.current;
        if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth;
        if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight;

        // Run landmark detection at video rate
        if (now === lastTime) return;
        lastTime = now;

        let result;
        try {
          result = landmarkerRef.current.detectForVideo(video, now);
        } catch (_) {
          return;
        }

        const ctx = canvas.getContext("2d");
        const { videoWidth: w, videoHeight: h } = video;

        if (!result.faceLandmarks || result.faceLandmarks.length === 0) {
          drawDetectionOverlay(ctx, w, h, null, {});
          setBrowserAiStatus((prev) => ({ ...prev, faceDetected: false, eyeState: "NO FACE" }));
          return;
        }

        const landmarks = result.faceLandmarks[0];

        // Extract eye points and calculate EAR
        const leftEye = LEFT_EYE.map((i) => landmarks[i]);
        const rightEye = RIGHT_EYE.map((i) => landmarks[i]);
        const leftEar = calculateEar(leftEye);
        const rightEar = calculateEar(rightEye);
        const ear = (leftEar + rightEar) / 2;

        const detection = browserAiDetectorRef.current.update(ear);

        const telemetry = {
          isDrowsy: detection.drowsy,
          isClosed: detection.eyeState === "CLOSED",
          ear,
          closureTime: detection.closureTime,
        };

        drawDetectionOverlay(ctx, w, h, landmarks, telemetry);

        setBrowserAiStatus({
          ear: Number(ear.toFixed(3)),
          eyeState: detection.eyeState,
          closureTime: detection.closureTime,
          drowsy: detection.drowsy,
          faceDetected: true,
        });
      };

      browserAiAnimRef.current = requestAnimationFrame(detect);
    } catch (err) {
      console.error("Browser AI error:", err);
      setBrowserAiError(
        err.name === "NotAllowedError"
          ? "Camera permission denied. Please allow camera access in your browser."
          : "Failed to start AI camera. Please try again."
      );
      setBrowserAiLoading(false);
      stopBrowserAi();
    }
  };

  // Cleanup on unmount
  useEffect(() => () => stopBrowserAi(), [stopBrowserAi]);

  // =============================================
  // ALARM — Web Audio beep
  // =============================================
  const playBeep = () => {
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === "suspended") ctx.resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "square";
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.setValueAtTime(660, ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.35, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.45);
    } catch (_) {}
  };

  const startAlarm = useCallback(() => {
    if (alarmIntervalRef.current) return;
    setAlarmActive(true);
    playBeep();
    alarmIntervalRef.current = setInterval(playBeep, 1200);
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification("⚠️ SMART EYE — Drowsiness Detected", {
        body: "Driver attention required! Eyes closed too long.",
      });
    }
  }, []);

  const stopAlarmBrowser = useCallback(() => {
    if (alarmIntervalRef.current) {
      clearInterval(alarmIntervalRef.current);
      alarmIntervalRef.current = null;
    }
    setAlarmActive(false);
  }, []);

  const toggleMute = () => {
    setAlarmMuted((prev) => {
      const nowMuted = !prev;
      if (nowMuted) stopAlarmBrowser();
      else if (activeDrowsy) startAlarm();
      return nowMuted;
    });
  };

  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  useEffect(() => () => { stopAlarmBrowser(); audioCtxRef.current?.close(); }, [stopAlarmBrowser]);

  // =============================================
  // LEGACY BROWSER CAMERA (basic preview, no AI)
  // =============================================
  const startBrowserCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720, facingMode: "user" }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
      setBrowserCamera(true);
    } catch {
      alert("Could not access the built-in camera. Please allow camera permission.");
    }
  };

  const stopBrowserCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setBrowserCamera(false);
  };

  useEffect(() => () => streamRef.current?.getTracks().forEach((t) => t.stop()), []);

  // =============================================
  // DROWSINESS ALARM WATCH
  // =============================================
  // Active drowsy: either from Python backend OR Browser AI
  const activeDrowsy = Boolean(status.drowsy) || Boolean(browserAiStatus.drowsy);

  useEffect(() => {
    if (activeDrowsy && !prevDrowsyRef.current) {
      if (!alarmMuted) startAlarm();
    }
    if (!activeDrowsy && prevDrowsyRef.current) stopAlarmBrowser();
    prevDrowsyRef.current = activeDrowsy;
  }, [activeDrowsy, alarmMuted, startAlarm, stopAlarmBrowser]);

  // =============================================
  // KEYBOARD SHORTCUTS
  // =============================================
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (["INPUT", "TEXTAREA", "SELECT"].includes(e.target?.tagName)) return;
      const key = e.key.toLowerCase();
      if (key === "c" || key === "escape" || key === "q") {
        e.preventDefault();
        if (serverOnline && status.camera) stopPythonCamera();
        else if (serverOnline && !status.camera && key === "c") startPythonCamera();
        if (browserAiActive) stopBrowserAi();
        if (streamRef.current) stopBrowserCamera();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [serverOnline, status.camera, browserAiActive, stopBrowserAi]);

  // =============================================
  // DERIVED DISPLAY VALUES
  // =============================================
  const pythonCameraActive = serverOnline && status.camera;

  // For metric cards: prefer Python if active, else Browser AI
  const activeEar = pythonCameraActive ? Number(status.ear) : browserAiStatus.ear;
  const activeEyeState = pythonCameraActive
    ? String(status.eye_state || "UNKNOWN").toUpperCase()
    : browserAiStatus.eyeState;
  const activeClosureTime = pythonCameraActive ? Number(status.closure_time) : browserAiStatus.closureTime;
  const anyActive = pythonCameraActive || browserAiActive;
  const systemStatus = activeDrowsy ? "ALERT" : "SAFE";

  return (
    <div className="app">

      {/* TOAST */}
      {toastMessage && (
        <div className="toast-notification">
          <span className="toast-icon">⌨️</span>
          <span>{toastMessage}</span>
        </div>
      )}

      {/* HEADER */}
      <header className="topbar">
        <div className="brand">
          <div className="brand-logo">SE</div>
          <div className="brand-info">
            <h1>SMART EYE</h1>
            <p>Driver Safety Monitoring System</p>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>

          {/* Mute alarm button */}
          {alarmActive && (
            <button
              onClick={toggleMute}
              style={{
                background: alarmMuted ? "#1b3030" : "#4a1212",
                border: `1px solid ${alarmMuted ? "#337a76" : "#943737"}`,
                color: alarmMuted ? "#6ee7b7" : "#f87171",
                padding: "6px 14px", borderRadius: "6px", fontWeight: 700,
                fontSize: "11px", cursor: "pointer", letterSpacing: "1px",
              }}
            >
              {alarmMuted ? "🔕 UNMUTE ALARM" : "🔔 MUTE ALARM"}
            </button>
          )}

          <div className={`server-indicator ${serverOnline ? "online" : "offline"}`}>
            <span className="server-dot"></span>
            <span>{serverOnline ? "PYTHON SERVER ONLINE" : "PYTHON SERVER OFFLINE"}</span>
          </div>

        </div>
      </header>

      {/* MAIN */}
      <main className="main">

        {/* HERO */}
        <section className="hero">
          <div className="hero-content">
            <div className="eyebrow">REAL-TIME DRIVER MONITORING</div>
            <h2>Keep the driver<br /><span>awake &amp; alert.</span></h2>
            <p className="hero-description">
              SMART EYE continuously monitors eye movement using computer vision
              and detects prolonged eye closure associated with driver drowsiness.
              Works both locally with Python and directly in your browser.
            </p>
          </div>

          <div className="driver-alert-card">
            <div className={`alert-dot ${activeDrowsy ? "drowsy-dot" : ""}`}></div>
            <div>
              <h3>{activeDrowsy ? "⚠️ DROWSINESS ALERT" : "DRIVER STATUS"}</h3>
              <p>{anyActive ? (activeDrowsy ? "Drowsiness detected" : "Driver alert") : "No active camera"}</p>
            </div>
          </div>
        </section>


        {/* METRICS */}
        <section className="metrics-grid">

          <div className="metric-card">
            <div className="metric-label">EYE ASPECT RATIO</div>
            <div className="metric-value">{anyActive ? activeEar.toFixed(3) : "—"}</div>
            <div className="metric-caption">EAR</div>
          </div>

          <div className="metric-card">
            <div className="metric-label">EYE STATE</div>
            <div className={`metric-value eye-state${anyActive && activeEyeState === "CLOSED" ? " state-closed" : anyActive && activeEyeState === "OPEN" ? " state-open" : ""}`}>
              {anyActive ? activeEyeState : "—"}
            </div>
            <div className="metric-caption">CURRENT</div>
          </div>

          <div className="metric-card">
            <div className="metric-label">CLOSURE TIME</div>
            <div className="metric-value">
              {anyActive ? `${activeClosureTime.toFixed(1)}s` : "—"}
            </div>
            <div className="metric-caption">
              {anyActive && activeEyeState === "CLOSED" ? "EYES CLOSED" : "CONTINUOUS"}
            </div>
          </div>

          <div className="metric-card">
            <div className="metric-label">SYSTEM STATUS</div>
            <div className={`metric-value ${!anyActive ? "" : activeDrowsy ? "status-danger" : "status-safe"}`}>
              {anyActive ? systemStatus : "—"}
            </div>
            <div className="metric-caption">DRIVER STATE</div>
          </div>

        </section>


        {/* ================================================= */}
        {/* PYTHON CAMERA SECTION */}
        {/* ================================================= */}
        <section className="monitor-section">

          <div className="section-header">
            <div>
              <div className="section-eyebrow">PYTHON VISION ENGINE</div>
              <h2>Drowsiness Detection Camera</h2>
            </div>

            <div className="camera-header-right">
              <div className="shortcut-badge">
                <span className="kbd-icon">⌨️</span> PRESS <kbd>C</kbd> / <kbd>ESC</kbd> TO TOGGLE
              </div>
              <div className="camera-status">
                <span className={`camera-status-dot ${status.camera && serverOnline ? "active" : ""}`}></span>
                {status.camera && serverOnline ? "PYTHON CAMERA ACTIVE" : "PYTHON CAMERA OFFLINE"}
              </div>
            </div>
          </div>

          <div className={`camera-container ${activeDrowsy ? "camera-danger" : ""}`}>

            {serverOnline && status.camera ? (
              <img
                src={videoFeedSrc}
                className="python-video"
                alt="Python Drowsiness Detection"
                onError={() => {
                  setVideoFeedSrc((prev) =>
                    prev.includes("127.0.0.1:5001")
                      ? "/video_feed"
                      : "http://localhost:5001/video_feed"
                  );
                }}
              />
            ) : null}

            {!serverOnline && (
              <div className="camera-message">
                <div className="camera-message-title">PYTHON SERVER OFFLINE</div>
                <div className="camera-message-text">
                  Start <code>vision/server.py</code> to activate drowsiness detection.
                  <br /><br />
                  <button className="inline-switch-btn" onClick={startBrowserAi}>
                    👁️ Use Browser AI Instead
                  </button>
                </div>
              </div>
            )}

            {serverOnline && !status.camera && (
              <div className="camera-message">
                <div className="camera-message-title">PYTHON CAMERA STOPPED</div>
                <div className="camera-message-text">
                  Camera off. Press <kbd>C</kbd> or click below to start.
                </div>
              </div>
            )}

            {activeDrowsy && (
              <div className="drowsiness-overlay">
                <div className="warning-box">
                  <div className="warning-title">DROWSINESS DETECTED</div>
                  <div className="warning-text">DRIVER ATTENTION REQUIRED</div>
                </div>
              </div>
            )}

          </div>

          <div className="camera-controls">
            {serverOnline && (
              !status.camera ? (
                <button className="camera-button" onClick={startPythonCamera}>
                  START PYTHON CAMERA <span className="btn-key-hint">(Press 'C')</span>
                </button>
              ) : (
                <button className="camera-button stop-button" onClick={stopPythonCamera}>
                  STOP PYTHON CAMERA <span className="btn-key-hint">(Press 'C' / 'ESC')</span>
                </button>
              )
            )}
          </div>

        </section>


        {/* ================================================= */}
        {/* BROWSER AI SECTION */}
        {/* ================================================= */}
        <section className="monitor-section">

          <div className="section-header">
            <div>
              <div className="section-eyebrow">BROWSER AI ENGINE · WORKS DEPLOYED</div>
              <h2>In-Browser Drowsiness Detection</h2>
            </div>

            <div className="camera-status">
              <span className={`camera-status-dot ${browserAiActive ? "active" : ""}`}></span>
              {browserAiLoading
                ? "LOADING AI MODEL…"
                : browserAiActive
                ? "BROWSER AI ACTIVE"
                : "BROWSER AI OFFLINE"}
            </div>
          </div>

          <div style={{ marginBottom: "14px", color: "#67c8c5", fontSize: "12px", fontWeight: 600, opacity: 0.8 }}>
            ✅ No Python backend required — runs entirely in your browser using WebAssembly + MediaPipe
          </div>

          <div className={`camera-container ${browserAiStatus.drowsy ? "camera-danger" : ""}`}>

            {/* Video feed (mirrored) */}
            <video
              ref={browserAiVideoRef}
              className="browser-ai-video"
              autoPlay
              playsInline
              muted
              style={{ display: browserAiActive ? "block" : "none" }}
            />

            {/* AI overlay canvas */}
            <canvas
              ref={browserAiCanvasRef}
              className="browser-ai-canvas"
              style={{ display: browserAiActive ? "block" : "none" }}
            />

            {/* Not started */}
            {!browserAiActive && !browserAiLoading && (
              <div className="camera-message">
                <div className="camera-message-title">BROWSER AI READY</div>
                <div className="camera-message-text">
                  Click below to start real-time drowsiness detection
                  <br />powered by MediaPipe running in your browser.
                  <br /><br />
                  {browserAiError && (
                    <span style={{ color: "#f87171", display: "block", marginBottom: "10px" }}>
                      ⚠️ {browserAiError}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Loading */}
            {browserAiLoading && (
              <div className="camera-message">
                <div className="camera-message-title" style={{ color: "#67c8c5" }}>
                  ⏳ LOADING AI MODEL
                </div>
                <div className="camera-message-text">
                  Downloading MediaPipe face landmarker model…
                  <br />This only happens once.
                </div>
              </div>
            )}

            {/* Drowsiness overlay */}
            {browserAiStatus.drowsy && (
              <div className="drowsiness-overlay">
                <div className="warning-box">
                  <div className="warning-title">DROWSINESS DETECTED</div>
                  <div className="warning-text">DRIVER ATTENTION REQUIRED</div>
                </div>
              </div>
            )}

          </div>

          {/* Live metrics for browser AI */}
          {browserAiActive && (
            <div style={{
              display: "flex", gap: "16px", marginTop: "14px",
              fontSize: "12px", fontWeight: 700, color: "#7e9192"
            }}>
              <span>EAR: <span style={{ color: "#67c8c5" }}>{browserAiStatus.ear.toFixed(3)}</span></span>
              <span>STATE: <span style={{ color: browserAiStatus.eyeState === "CLOSED" ? "#f87171" : "#6ee7b7" }}>{browserAiStatus.eyeState}</span></span>
              <span>CLOSURE: <span style={{ color: "#67c8c5" }}>{browserAiStatus.closureTime.toFixed(1)}s</span></span>
              <span>FACE: <span style={{ color: browserAiStatus.faceDetected ? "#6ee7b7" : "#f87171" }}>{browserAiStatus.faceDetected ? "DETECTED" : "NOT FOUND"}</span></span>
            </div>
          )}

          <div className="camera-controls">
            {!browserAiActive ? (
              <button
                className="camera-button"
                onClick={startBrowserAi}
                disabled={browserAiLoading}
              >
                {browserAiLoading ? "LOADING AI…" : "START BROWSER AI DETECTION"}
              </button>
            ) : (
              <button className="camera-button stop-button" onClick={stopBrowserAi}>
                STOP BROWSER AI
              </button>
            )}
          </div>

        </section>


        {/* ================================================= */}
        {/* LEGACY BROWSER CAMERA (basic preview, no AI) */}
        {/* ================================================= */}
        <section className="monitor-section">

          <div className="section-header">
            <div>
              <div className="section-eyebrow">BROWSER CAMERA</div>
              <h2>Raw Camera Preview</h2>
            </div>
            <div className="camera-status">
              <span className={`camera-status-dot ${browserCamera ? "active" : ""}`}></span>
              {browserCamera ? "CAMERA ACTIVE" : "CAMERA OFFLINE"}
            </div>
          </div>

          <div className="browser-camera-container">
            <video ref={videoRef} className="browser-video" autoPlay playsInline muted />
            {!browserCamera && (
              <div className="camera-message">
                <div className="camera-message-title">BUILT-IN CAMERA READY</div>
                <div className="camera-message-text">
                  Basic preview only — no drowsiness detection.
                  <br />Use <strong>Browser AI Detection</strong> above for full analysis.
                </div>
              </div>
            )}
          </div>

          <div className="camera-controls">
            {!browserCamera ? (
              <button className="camera-button" onClick={startBrowserCamera}>
                START RAW PREVIEW
              </button>
            ) : (
              <button className="camera-button stop-button" onClick={stopBrowserCamera}>
                STOP RAW PREVIEW
              </button>
            )}
          </div>

        </section>


        {/* PIPELINE */}
        <section className="pipeline-section">
          <div className="section-eyebrow">DETECTION PIPELINE</div>
          <h2>How SMART EYE works</h2>
          <div className="pipeline">
            <div className="pipeline-item">
              <div className="pipeline-number">01</div>
              <h3>Camera</h3><p>Live driver video</p>
            </div>
            <div className="pipeline-connector"></div>
            <div className="pipeline-item">
              <div className="pipeline-number">02</div>
              <h3>Face Detection</h3><p>MediaPipe landmarks</p>
            </div>
            <div className="pipeline-connector"></div>
            <div className="pipeline-item">
              <div className="pipeline-number">03</div>
              <h3>EAR Analysis</h3><p>Eye opening measurement</p>
            </div>
            <div className="pipeline-connector"></div>
            <div className="pipeline-item">
              <div className="pipeline-number">04</div>
              <h3>Drowsiness</h3><p>Closure duration</p>
            </div>
            <div className="pipeline-connector"></div>
            <div className="pipeline-item">
              <div className="pipeline-number">05</div>
              <h3>Alert</h3><p>Driver warning</p>
            </div>
          </div>
        </section>


        {/* SYSTEM INFO */}
        <section className="system-section">
          <div className="section-eyebrow">SYSTEM INFORMATION</div>
          <div className="system-grid">
            <div className="system-item"><span>VISION ENGINE</span><strong>MediaPipe Face Mesh</strong></div>
            <div className="system-item"><span>LOCAL BACKEND</span><strong>Python + OpenCV + Flask</strong></div>
            <div className="system-item"><span>BROWSER ENGINE</span><strong>MediaPipe WASM (WebAssembly)</strong></div>
            <div className="system-item"><span>METRIC</span><strong>Eye Aspect Ratio (EAR)</strong></div>
            <div className="system-item"><span>EAR THRESHOLD</span><strong>0.21 (adaptive)</strong></div>
            <div className="system-item"><span>CLOSURE LIMIT</span><strong>1.5 seconds</strong></div>
          </div>
        </section>


        {/* FOOTER */}
        <footer className="footer">
          <strong>SMART EYE</strong>
          <span>Real-Time Driver Safety System</span>
          <span>Computer Vision · EAR · MediaPipe · Drowsiness Detection</span>
        </footer>

      </main>
    </div>
  );
}

export default App;