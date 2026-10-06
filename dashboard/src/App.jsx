import { useEffect, useRef, useState } from "react";
import "./App.css";

const API = "http://127.0.0.1:5001";

function App() {
  const [serverOnline, setServerOnline] = useState(false);

  const [status, setStatus] = useState({
    ear: 0,
    eye_state: "UNKNOWN",
    closure_time: 0,
    drowsy: false,
    camera: false,
  });

  const [browserCamera, setBrowserCamera] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const [videoFeedSrc, setVideoFeedSrc] = useState(
    typeof window !== "undefined" &&
      (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")
      ? "http://127.0.0.1:5001/video_feed"
      : "/video_feed"
  );

  // --------------------------------
  // ALARM STATE
  // --------------------------------
  const [alarmMuted, setAlarmMuted] = useState(false);
  const [alarmActive, setAlarmActive] = useState(false);

  const videoRef = useRef(null);
  const streamRef = useRef(null);

  // Web Audio context and nodes
  const audioCtxRef = useRef(null);
  const alarmIntervalRef = useRef(null);
  const prevDrowsyRef = useRef(false);

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(""), 3500);
  };

  // --------------------------------
  // PYTHON CAMERA CONTROLS
  // --------------------------------
  const startPythonCamera = async () => {
    const endpoints = [
      "/camera/start",
      "http://127.0.0.1:5001/camera/start",
      "http://localhost:5001/camera/start",
      "http://127.0.0.1:5000/camera/start",
      "http://localhost:5000/camera/start",
    ];
    for (const ep of endpoints) {
      try {
        const res = await fetch(ep, { method: "POST" });
        if (res.ok) {
          showToast("Starting Python camera...");
          break;
        }
      } catch (e) {}
    }
  };

  const stopPythonCamera = async () => {
    const endpoints = [
      "/camera/stop",
      "http://127.0.0.1:5001/camera/stop",
      "http://localhost:5001/camera/stop",
      "http://127.0.0.1:5000/camera/stop",
      "http://localhost:5000/camera/stop",
    ];
    for (const ep of endpoints) {
      try {
        const res = await fetch(ep, { method: "POST" });
        if (res.ok) {
          showToast("Python camera turned OFF");
          break;
        }
      } catch (e) {}
    }
  };

  // --------------------------------
  // GET LIVE DATA FROM PYTHON
  // --------------------------------
  useEffect(() => {
    const endpoints = [
      "/api/status",
      "http://127.0.0.1:5001/api/status",
      "http://localhost:5001/api/status",
      "http://127.0.0.1:5000/api/status",
      "http://localhost:5000/api/status",
    ];

    const getStatus = async () => {
      let data = null;
      let fetchedSuccessfully = false;

      for (const endpoint of endpoints) {
        try {
          const response = await fetch(endpoint, {
            cache: "no-store",
          });
          if (response.ok) {
            data = await response.json();
            fetchedSuccessfully = true;
            break;
          }
        } catch (e) {
          // Try next endpoint candidate
        }
      }

      if (fetchedSuccessfully && data) {
        setServerOnline(true);
        setStatus({
          ear: Number(data.ear ?? data.EAR ?? 0),
          eye_state: data.eye_state ?? data.eyeState ?? "UNKNOWN",
          closure_time: Number(data.closure_time ?? data.closureTime ?? 0),
          drowsy: Boolean(data.drowsy ?? data.is_drowsy ?? false),
          camera: Boolean(data.camera ?? false),
        });
      } else {
        setServerOnline(false);
        setStatus({
          ear: 0,
          eye_state: "UNKNOWN",
          closure_time: 0,
          drowsy: false,
          camera: false,
        });
      }
    };

    getStatus();
    const interval = setInterval(getStatus, 300);
    return () => clearInterval(interval);
  }, []);

  // --------------------------------
  // KEYBOARD SHORTCUTS LISTENER
  // --------------------------------
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (["INPUT", "TEXTAREA", "SELECT"].includes(e.target?.tagName)) return;

      const key = e.key.toLowerCase();
      // Shortcuts to turn off / toggle camera: 'c', 'q', 'escape'
      if (key === "c" || key === "escape" || key === "q") {
        e.preventDefault();

        let actionTaken = false;

        // Python Camera control
        if (serverOnline && status.camera) {
          stopPythonCamera();
          showToast(`Python camera turned OFF via shortcut (${e.key.toUpperCase()})`);
          actionTaken = true;
        } else if (serverOnline && !status.camera && key === "c") {
          startPythonCamera();
          showToast("Python camera turned ON via shortcut ('C')");
          actionTaken = true;
        }

        // Browser Camera control
        if (streamRef.current) {
          stopBrowserCamera();
          showToast(`Browser camera turned OFF via shortcut (${e.key.toUpperCase()})`);
          actionTaken = true;
        }

        if (!actionTaken && (key === "escape" || key === "q")) {
          showToast("Camera is already offline");
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [serverOnline, status.camera]);

  // --------------------------------
  // ALARM — Web Audio beep
  // --------------------------------
  const playBeep = () => {
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext ||
          window.webkitAudioContext)();
      }

      const ctx = audioCtxRef.current;

      // Resume if suspended (browser autoplay policy)
      if (ctx.state === "suspended") ctx.resume();

      // Oscillator
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.type = "square";
      osc.frequency.setValueAtTime(880, ctx.currentTime);       // A5
      osc.frequency.setValueAtTime(660, ctx.currentTime + 0.15); // E5

      gain.gain.setValueAtTime(0.35, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(
        0.001,
        ctx.currentTime + 0.45
      );

      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.45);
    } catch (e) {
      // Silently ignore if AudioContext not available
    }
  };

  const startAlarm = () => {
    if (alarmIntervalRef.current) return; // already running
    setAlarmActive(true);
    playBeep(); // immediate first beep
    alarmIntervalRef.current = setInterval(playBeep, 1200);

    // Browser notification (only fires once per alarm session)
    if (
      "Notification" in window &&
      Notification.permission === "granted"
    ) {
      new Notification("⚠️ SMART EYE — Drowsiness Detected", {
        body: "Driver attention required! Eyes closed too long.",
        icon: "/favicon.ico",
      });
    }
  };

  const stopAlarmBrowser = () => {
    if (alarmIntervalRef.current) {
      clearInterval(alarmIntervalRef.current);
      alarmIntervalRef.current = null;
    }
    setAlarmActive(false);
  };

  // Request notification permission once on mount
  useEffect(() => {
    if (
      "Notification" in window &&
      Notification.permission === "default"
    ) {
      Notification.requestPermission();
    }
  }, []);

  // Watch drowsy state transitions
  useEffect(() => {
    const isDrowsy = Boolean(status.drowsy);

    if (isDrowsy && !prevDrowsyRef.current) {
      // Transition: alert → drowsy
      if (!alarmMuted) startAlarm();
    }

    if (!isDrowsy && prevDrowsyRef.current) {
      // Transition: drowsy → alert
      stopAlarmBrowser();
    }

    prevDrowsyRef.current = isDrowsy;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.drowsy, alarmMuted]);

  // Mute / unmute toggle
  const toggleMute = () => {
    setAlarmMuted((prev) => {
      const nowMuted = !prev;
      if (nowMuted) stopAlarmBrowser();
      else if (Boolean(status.drowsy)) startAlarm();
      return nowMuted;
    });
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopAlarmBrowser();
      if (audioCtxRef.current) {
        audioCtxRef.current.close();
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --------------------------------
  // START BUILT-IN BROWSER CAMERA
  // --------------------------------
  const startBrowserCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: 1280,
          height: 720,
          facingMode: "user",
        },
        audio: false,
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      setBrowserCamera(true);
    } catch (error) {
      console.error("Browser camera error:", error);

      alert(
        "Could not access the built-in camera. Please allow camera permission for your browser."
      );
    }
  };

  // --------------------------------
  // STOP BUILT-IN CAMERA
  // --------------------------------
  const stopBrowserCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        track.stop();
      });

      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setBrowserCamera(false);
  };

  // --------------------------------
  // CLEAN CAMERA WHEN PAGE CLOSES
  // --------------------------------
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => {
          track.stop();
        });
      }
    };
  }, []);

  const ear = Number(status.ear) || 0;

  const closureTime = Number(status.closure_time) || 0;

  const eyeState = String(status.eye_state || "UNKNOWN").toUpperCase();

  const drowsy = Boolean(status.drowsy);

  // Python camera is actively running and sending frames
  const pythonCameraActive = serverOnline && status.camera;

  const systemStatus = drowsy ? "ALERT" : "SAFE";

  return (
    <div className="app">
      {/* ================= TOAST NOTIFICATION ================= */}
      {toastMessage && (
        <div className="toast-notification">
          <span className="toast-icon">⌨️</span>
          <span>{toastMessage}</span>
        </div>
      )}

      {/* ================= HEADER ================= */}

      <header className="topbar">

        <div className="brand">

          <div className="brand-logo">
            SE
          </div>

          <div className="brand-info">
            <h1>SMART EYE</h1>
            <p>
              Driver Safety Monitoring System
            </p>
          </div>

        </div>

        <div
          className={`server-indicator ${
            serverOnline ? "online" : "offline"
          }`}
        >

          <span className="server-dot"></span>

          <span>
            {serverOnline
              ? "PYTHON SERVER ONLINE"
              : "PYTHON SERVER OFFLINE"}
          </span>

        </div>

      </header>


      {/* ================= MAIN ================= */}

      <main className="main">

        {/* HERO */}

        <section className="hero">

          <div className="hero-content">

            <div className="eyebrow">
              REAL-TIME DRIVER MONITORING
            </div>

            <h2>
              Keep the driver
              <br />
              <span>awake &amp; alert.</span>
            </h2>

            <p className="hero-description">
              SMART EYE continuously monitors
              eye movement using computer vision
              and detects prolonged eye closure
              associated with driver drowsiness.
            </p>

          </div>


          <div
            className={`driver-alert-card ${
              drowsy ? "danger-card" : ""
            }`}
          >

            <div
              className={`alert-dot ${
                drowsy ? "danger-dot" : ""
              }`}
            ></div>

            <div>

              <h3>
                {drowsy
                  ? "DROWSINESS DETECTED"
                  : "DRIVER ALERT"}
              </h3>

              <p>
                {drowsy
                  ? "Driver attention required"
                  : "Monitoring continuously"}
              </p>

            </div>

            {/* Mute button — only visible when alarm is active */}
            {alarmActive && (
              <button
                className={`mute-button ${
                  alarmMuted ? "muted" : ""
                }`}
                onClick={toggleMute}
                title={alarmMuted ? "Unmute alarm" : "Mute alarm"}
              >
                {alarmMuted ? "🔇 UNMUTE" : "🔊 MUTE"}
              </button>
            )}

          </div>

        </section>


        {/* ================= METRICS ================= */}

        <section className="metrics-grid">

          <div className="metric-card">

            <div className="metric-label">
              EYE ASPECT RATIO
            </div>

            <div className="metric-value">
              {pythonCameraActive ? ear.toFixed(3) : "—"}
            </div>

            <div className="metric-caption">
              EAR
            </div>

          </div>


          <div className="metric-card">

            <div className="metric-label">
              EYE STATE
            </div>

            <div
              className={`metric-value eye-state${
                pythonCameraActive && eyeState === "CLOSED"
                  ? " state-closed"
                  : pythonCameraActive && eyeState === "OPEN"
                  ? " state-open"
                  : ""
              }`}
            >
              {pythonCameraActive ? eyeState : "—"}
            </div>

            <div className="metric-caption">
              CURRENT
            </div>

          </div>


          <div className="metric-card">

            <div className="metric-label">
              CLOSURE TIME
            </div>

            <div className="metric-value">
              {pythonCameraActive
                ? `${closureTime.toFixed(1)}s`
                : "—"}
            </div>

            <div className="metric-caption">
              {pythonCameraActive && eyeState === "CLOSED"
                ? "EYES CLOSED"
                : "CONTINUOUS"}
            </div>

          </div>


          <div className="metric-card">

            <div className="metric-label">
              SYSTEM STATUS
            </div>

            <div
              className={`metric-value ${
                !pythonCameraActive
                  ? ""
                  : drowsy
                  ? "status-danger"
                  : "status-safe"
              }`}
            >
              {pythonCameraActive ? systemStatus : "—"}
            </div>

            <div className="metric-caption">
              DRIVER STATE
            </div>

          </div>

        </section>


        {/* ================================================= */}
        {/* PYTHON CAMERA */}
        {/* ================================================= */}

        <section className="monitor-section">

          <div className="section-header">

            <div>

              <div className="section-eyebrow">
                PYTHON VISION ENGINE
              </div>

              <h2>
                Drowsiness Detection Camera
              </h2>

            </div>

            <div className="camera-header-right">
              <div className="shortcut-badge" title="Press 'C' or 'ESC' on your keyboard to turn off camera">
                <span className="kbd-icon">⌨️</span> PRESS <kbd>C</kbd> / <kbd>ESC</kbd> TO TOGGLE CAMERA
              </div>

              <div className="camera-status">

                <span
                  className={`camera-status-dot ${
                    status.camera && serverOnline
                      ? "active"
                      : ""
                  }`}
                ></span>

                {status.camera && serverOnline
                  ? "PYTHON CAMERA ACTIVE"
                  : "PYTHON CAMERA OFFLINE"}

              </div>
            </div>

          </div>


          <div
            className={`camera-container ${
              drowsy ? "camera-danger" : ""
            }`}
          >

            {serverOnline && status.camera ? (
              <img
                src={videoFeedSrc}
                className="python-video"
                alt="Python Drowsiness Detection"
                onError={() => {
                  setVideoFeedSrc((prev) =>
                    prev.includes("127.0.0.1:5001")
                      ? "/video_feed"
                      : prev === "/video_feed"
                      ? "http://localhost:5001/video_feed"
                      : "/video_feed"
                  );
                }}
              />
            ) : null}

            {!serverOnline && (
              <div className="camera-message">

                <div className="camera-message-title">
                  PYTHON SERVER OFFLINE
                </div>

                <div className="camera-message-text">
                  Start server.py to activate
                  drowsiness detection.
                </div>

              </div>
            )}

            {serverOnline && !status.camera && (
              <div className="camera-message">

                <div className="camera-message-title">
                  PYTHON CAMERA STOPPED
                </div>

                <div className="camera-message-text">
                  Camera turned off manually or via shortcut.
                  <br />
                  Press <kbd>C</kbd> or click below to start camera.
                </div>

              </div>
            )}

            {drowsy && (
              <div className="drowsiness-overlay">

                <div className="warning-box">

                  <div className="warning-title">
                    DROWSINESS DETECTED
                  </div>

                  <div className="warning-text">
                    DRIVER ATTENTION REQUIRED
                  </div>

                </div>

              </div>
            )}

          </div>

          <div className="camera-controls">
            {serverOnline && (
              !status.camera ? (
                <button
                  className="camera-button"
                  onClick={startPythonCamera}
                >
                  START PYTHON CAMERA <span className="btn-key-hint">(Press 'C')</span>
                </button>
              ) : (
                <button
                  className="camera-button stop-button"
                  onClick={stopPythonCamera}
                >
                  STOP PYTHON CAMERA <span className="btn-key-hint">(Press 'C' / 'ESC')</span>
                </button>
              )
            )}
          </div>

        </section>


        {/* ================================================= */}
        {/* BUILT-IN BROWSER CAMERA */}
        {/* ================================================= */}

        <section className="monitor-section">

          <div className="section-header">

            <div>

              <div className="section-eyebrow">
                BROWSER CAMERA
              </div>

              <h2>
                Built-in Camera
              </h2>

            </div>

            <div className="camera-status">

              <span
                className={`camera-status-dot ${
                  browserCamera ? "active" : ""
                }`}
              ></span>

              {browserCamera
                ? "CAMERA ACTIVE"
                : "CAMERA OFFLINE"}

            </div>

          </div>


          <div className="browser-camera-container">

            <video
              ref={videoRef}
              className="browser-video"
              autoPlay
              playsInline
              muted
            />

            {!browserCamera && (
              <div className="camera-message">

                <div className="camera-message-title">
                  BUILT-IN CAMERA READY
                </div>

                <div className="camera-message-text">
                  Click the button below to
                  activate your laptop camera.
                </div>

              </div>
            )}

            {/* Show drowsiness warning on browser camera too */}
            {browserCamera && drowsy && (
              <div className="drowsiness-overlay">

                <div className="warning-box">

                  <div className="warning-title">
                    DROWSINESS DETECTED
                  </div>

                  <div className="warning-text">
                    DRIVER ATTENTION REQUIRED
                  </div>

                </div>

              </div>
            )}

          </div>


          <div className="camera-controls">

            {!browserCamera ? (

              <button
                className="camera-button"
                onClick={startBrowserCamera}
              >
                START BUILT-IN CAMERA
              </button>

            ) : (

              <button
                className="camera-button stop-button"
                onClick={stopBrowserCamera}
              >
                STOP BUILT-IN CAMERA
              </button>

            )}

          </div>

        </section>


        {/* ================= PIPELINE ================= */}

        <section className="pipeline-section">

          <div className="section-eyebrow">
            DETECTION PIPELINE
          </div>

          <h2>
            How SMART EYE works
          </h2>

          <div className="pipeline">

            <div className="pipeline-item">
              <div className="pipeline-number">01</div>
              <h3>Camera</h3>
              <p>Live driver video</p>
            </div>

            <div className="pipeline-connector"></div>

            <div className="pipeline-item">
              <div className="pipeline-number">02</div>
              <h3>Face Detection</h3>
              <p>MediaPipe landmarks</p>
            </div>

            <div className="pipeline-connector"></div>

            <div className="pipeline-item">
              <div className="pipeline-number">03</div>
              <h3>EAR Analysis</h3>
              <p>Eye opening measurement</p>
            </div>

            <div className="pipeline-connector"></div>

            <div className="pipeline-item">
              <div className="pipeline-number">04</div>
              <h3>Drowsiness</h3>
              <p>Closure duration</p>
            </div>

            <div className="pipeline-connector"></div>

            <div className="pipeline-item">
              <div className="pipeline-number">05</div>
              <h3>Alert</h3>
              <p>Driver warning</p>
            </div>

          </div>

        </section>


        {/* ================= SYSTEM INFO ================= */}

        <section className="system-section">

          <div className="section-eyebrow">
            SYSTEM INFORMATION
          </div>

          <div className="system-grid">

            <div className="system-item">
              <span>VISION ENGINE</span>
              <strong>MediaPipe Face Mesh</strong>
            </div>

            <div className="system-item">
              <span>PROCESSING</span>
              <strong>Python + OpenCV</strong>
            </div>

            <div className="system-item">
              <span>METRIC</span>
              <strong>Eye Aspect Ratio</strong>
            </div>

            <div className="system-item">
              <span>EAR THRESHOLD</span>
              <strong>0.20</strong>
            </div>

            <div className="system-item">
              <span>CLOSURE LIMIT</span>
              <strong>2.0 seconds</strong>
            </div>

            <div className="system-item">
              <span>BACKEND</span>
              <strong>Flask API</strong>
            </div>

          </div>

        </section>


        {/* ================= FOOTER ================= */}

        <footer className="footer">

          <strong>SMART EYE</strong>

          <span>
            Real-Time Driver Safety System
          </span>

          <span>
            Computer Vision • EAR • Drowsiness Detection
          </span>

        </footer>

      </main>

    </div>
  );
}

export default App;