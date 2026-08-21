import React, { useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';

export default function App() {
  const [currentView, setCurrentView] = useState('landing'); // 'landing', 'guard', 'resident', 'camera', 'face'

  return (
    <>
      <nav className="navbar">
        <button onClick={() => setCurrentView('landing')} className="nav-brand" style={{ background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
          <i className="fa-solid fa-shield-halved"></i>
          <span>GateGuard</span>
        </button>
        <div className="nav-links">
          <button onClick={() => setCurrentView('guard')} className={currentView === 'guard' ? 'active' : ''}>
            <i className="fa-solid fa-desktop"></i> Guard Dashboard
          </button>
          <button onClick={() => setCurrentView('camera')} className={currentView === 'camera' ? 'active' : ''}>
            <i className="fa-solid fa-camera"></i> Phone Camera
          </button>
          <button onClick={() => setCurrentView('resident')} className={currentView === 'resident' ? 'active' : ''}>
            <i className="fa-solid fa-house-user"></i> Resident Portal
          </button>
          <button onClick={() => setCurrentView('face')} className={currentView === 'face' ? 'active' : ''}
            style={currentView === 'face' ? { borderColor: 'rgba(168,85,247,0.5)', color: '#c084fc' } : {}}>
            <i className="fa-solid fa-eye"></i> Face Recognition
          </button>
        </div>
      </nav>

      <main className="container">
        {currentView === 'landing' && <LandingView onViewChange={setCurrentView} />}
        {currentView === 'guard' && <GuardDashboard />}
        {currentView === 'resident' && <ResidentPortal />}
        {currentView === 'camera' && <MobileCamera />}
        {currentView === 'face' && <FaceRecognition />}
      </main>

      <footer className="footer">
        <p>&copy; 2026 GateGuard Systems POC. Built with MERN Stack &amp; Socket.io.</p>
      </footer>
    </>
  );
}

// --- LANDING SCREEN ---
function LandingView({ onViewChange }) {
  return (
    <div className="landing-container">
      <div className="landing-header">
        <h1>Smart Visitor Management (MERN)</h1>
        <p>An automated ANPR &amp; Face Recognition gating solution. Manage residents, register family members with face data, and control entries in real-time.</p>
      </div>

      <div className="portal-grid">
        <div onClick={() => onViewChange('guard')} className="portal-card guard-card glass-panel">
          <i className="fa-solid fa-desktop"></i>
          <h2>Security Guard Portal</h2>
          <p>Monitor gate entries in real-time. View ANPR plate readings, face verification results, and get instant stranger alerts with profile comparison.</p>
        </div>

        <div onClick={() => onViewChange('camera')} className="portal-card camera-card glass-panel">
          <i className="fa-solid fa-camera-retro"></i>
          <h2>Gate Camera (Phone)</h2>
          <p>Open this portal on your phone browser. Point your phone camera at a vehicle plate to capture and upload it. Simulates the physical gate camera.</p>
        </div>

        <div onClick={() => onViewChange('resident')} className="portal-card resident-card glass-panel">
          <i className="fa-solid fa-house-user"></i>
          <h2>Resident Portal</h2>
          <p>Register your flat, add all family members with mandatory face photos, register vehicles, and view your complete entry history.</p>
        </div>

        <div onClick={() => onViewChange('face')} className="portal-card face-card glass-panel">
          <i className="fa-solid fa-eye"></i>
          <h2>Face Recognition</h2>
          <p>Live webcam face detection and recognition. Automatically alerts guards when a known resident or stranger is detected at the gate.</p>
        </div>
      </div>

      <div className="glass-panel" style={{ padding: '24px', textAlign: 'left', maxWidth: '800px', margin: '30px auto', borderLeft: '4px solid var(--color-primary)' }}>
        <h3 style={{ marginBottom: '12px', fontFamily: 'var(--font-heading)', color: '#818cf8' }}>
          <i className="fa-solid fa-circle-info"></i> How to Demo this MERN POC
        </h3>
        <ol style={{ marginLeft: '20px', color: 'var(--text-secondary)', lineHeight: '1.6', fontSize: '0.95rem' }}>
          <li style={{ marginBottom: '8px' }}>Start MongoDB locally and run <code>npm run dev</code> and <code>python face_server.py</code>.</li>
          <li style={{ marginBottom: '8px' }}>Go to the <strong>Resident Portal</strong>, log in with your flat number, and add all family members with clear face photos.</li>
          <li style={{ marginBottom: '8px' }}>Open the <strong>Guard Dashboard</strong> — it listens for both ANPR plate events and face verification events.</li>
          <li style={{ marginBottom: '8px' }}>Present a registered face to the webcam → Guard Dashboard shows the resident profile and announces "Welcome!".</li>
          <li>Present an unknown face → Guard sees a flashing "STRANGER ALERT" with live photo of the intruder!</li>
        </ol>
      </div>
    </div>
  );
}


// --- GUARD DASHBOARD ---
function GuardDashboard() {
  const [scanState, setScanState] = useState('idle'); // 'idle', 'granted', 'denied'
  const [plateText, setPlateText] = useState('WAITING...');
  const [resident, setResident] = useState({
    name: 'Waiting for scan\u2026', flat: '-', contact: '-',
    photo_url: '/static/images/unknown_avatar.svg', model: '-', color: '-',
    family_members: []
  });
  const [logs, setLogs] = useState([]);
  const [faceLogs, setFaceLogs] = useState([]);
  const [barrierOpen, setBarrierOpen] = useState(false);
  const [gateStateText, setGateStateText] = useState('Barrier State: CLOSED');
  const [customPlateInput, setCustomPlateInput] = useState('');

  // Webcam ANPR state
  const [webcamReady, setWebcamReady] = useState(false);
  const [webcamError, setWebcamError] = useState(null);
  const [isScanning, setIsScanning] = useState(false);
  const [lastDetectedPlate, setLastDetectedPlate] = useState(null);
  const lastDetectedRef = useRef({ plate: null, time: 0 });

  // Stranger alert modal
  const [strangerAlert, setStrangerAlert] = useState(null);
  const strangerDismissTimer = useRef(null);

  // Face scan state
  const [faceScanAlert, setFaceScanAlert] = useState(null);
  const [faceScanVisible, setFaceScanVisible] = useState(false);

  // Refs
  const videoRef = useRef(null);
  const overlayCanvasRef = useRef(null);
  const captureCanvasRef = useRef(null);
  const webcamStreamRef = useRef(null);
  const scanIntervalRef = useRef(null);
  const faceAlertTimer = useRef(null);
  const autoCloseTimer = useRef(null);

  const loadLogs = async () => {
    try { const res = await fetch('/api/logs'); setLogs(await res.json()); }
    catch (err) { console.error('Error fetching logs:', err); }
  };

  const loadFaceLogs = async () => {
    try { const res = await fetch('/api/face-logs'); setFaceLogs(await res.json()); }
    catch (err) { console.error('Error fetching face logs:', err); }
  };

  // Webcam management
  const startWebcam = useCallback(async () => {
    if (webcamStreamRef.current) return;
    try {
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
      }
      webcamStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => { setWebcamReady(true); setWebcamError(null); };
      }
    } catch (err) {
      setWebcamError(err.message);
      setWebcamReady(false);
    }
  }, []);

  const stopWebcam = useCallback(() => {
    if (webcamStreamRef.current) {
      webcamStreamRef.current.getTracks().forEach(t => t.stop());
      webcamStreamRef.current = null;
    }
    setWebcamReady(false);
  }, []);

  // Canvas bounding box overlay
  const drawBbox = useCallback((bbox, isMatch) => {
    const canvas = overlayCanvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video || !bbox) return;
    canvas.width = video.clientWidth;
    canvas.height = video.clientHeight;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const scaleX = canvas.width / (video.videoWidth || canvas.width);
    const scaleY = canvas.height / (video.videoHeight || canvas.height);
    const x = bbox.x * scaleX, y = bbox.y * scaleY;
    const w = bbox.w * scaleX, h = bbox.h * scaleY;
    const color = isMatch === true ? '#22c55e' : isMatch === false ? '#ef4444' : '#f59e0b';
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = isMatch === true ? 'rgba(34,197,94,0.85)' : isMatch === false ? 'rgba(239,68,68,0.85)' : 'rgba(245,158,11,0.85)';
    ctx.fillRect(x, y - 26, Math.min(w, 180), 26);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 13px monospace';
    ctx.shadowBlur = 0;
    ctx.fillText(isMatch === true ? '\u2713 REGISTERED' : isMatch === false ? '\u2717 UNKNOWN' : '\u25cb READING\u2026', x + 6, y - 7);
  }, []);

  const clearOverlay = useCallback(() => {
    const canvas = overlayCanvasRef.current;
    if (canvas) canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
  }, []);

  // Plate DB lookup
  const lookupPlate = useCallback(async (plate, capturedDataUrl, bbox) => {
    const now = Date.now();
    if (plate === lastDetectedRef.current.plate && (now - lastDetectedRef.current.time) < 60000) return null;
    lastDetectedRef.current = { plate, time: now };
    setLastDetectedPlate(plate);
    try {
      const res = await fetch('/api/anpr/lookup?plate=' + encodeURIComponent(plate));
      const data = await res.json();
      if (data.debounced) return null;
      const isMatch = data.isMatch;
      drawBbox(bbox, isMatch);
      if (isMatch && data.info) {
        setResident({
          name: data.info.name, flat: data.info.flat, contact: data.info.contact,
          photo_url: (data.info.photo_url || '/static/images/unknown_avatar.svg') + '?t=' + Date.now(),
          model: data.info.model || '-', color: data.info.color || '-',
          family_members: data.info.family_members || []
        });
        setPlateText(data.plate); setScanState('granted');
        setBarrierOpen(true); setGateStateText('Barrier State: OPEN (AUTO)'); setStrangerAlert(null);
        speak('Access Granted. Welcome ' + data.info.name + ' of flat ' + data.info.flat + '.');
        if (autoCloseTimer.current) clearTimeout(autoCloseTimer.current);
        autoCloseTimer.current = setTimeout(() => { setBarrierOpen(false); setGateStateText('Barrier State: CLOSED'); setScanState('idle'); }, 8000);
      } else {
        setResident({ name: 'Unknown Visitor', flat: '-', contact: '-', photo_url: '/static/images/unknown_avatar.svg', model: '-', color: '-', family_members: [] });
        setPlateText(data.plate || plate); setScanState('denied');
        setBarrierOpen(false); setGateStateText('Barrier State: CLOSED');
        setStrangerAlert({ plate: data.plate || plate, capturedFrame: capturedDataUrl });
        speak('Warning! Unregistered vehicle detected at gate. Please verify immediately.');
        if (strangerDismissTimer.current) clearTimeout(strangerDismissTimer.current);
        strangerDismissTimer.current = setTimeout(() => setStrangerAlert(null), 30000);
      }
      loadLogs();
      return isMatch;
    } catch (err) { console.error('[LOOKUP]', err); return null; }
  }, [drawBbox]);

  // Capture frame and run ANPR scan
  const captureAndScan = useCallback(async () => {
    if (!videoRef.current || !captureCanvasRef.current || !webcamReady || isScanning) return;
    if (!videoRef.current.videoWidth) return;
    setIsScanning(true);
    const video = videoRef.current;
    const canvas = captureCanvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    const capturedDataUrl = canvas.toDataURL('image/jpeg', 0.85);
    canvas.toBlob(async (blob) => {
      if (!blob) { setIsScanning(false); return; }
      const fd = new FormData();
      fd.append('photo', blob, 'frame.jpg');
      try {
        const res = await fetch('/api/anpr/live-scan', { method: 'POST', body: fd });
        const data = await res.json();
        if (!data.success || !data.plate || data.plate === 'UNKNOWN') { clearOverlay(); return; }
        if (!/^[A-Z]{2}[0-9]{2}[A-Z]{1,2}[0-9]{4}$/.test(data.plate)) { clearOverlay(); return; }
        drawBbox(data.bbox, null);
        await lookupPlate(data.plate, capturedDataUrl, data.bbox);
      } catch (err) { console.error('[SCAN]', err.message); clearOverlay(); }
      finally { setIsScanning(false); }
    }, 'image/jpeg', 0.85);
  }, [webcamReady, isScanning, drawBbox, clearOverlay, lookupPlate]);

  // Socket.io + startup
  useEffect(() => {
    loadLogs(); loadFaceLogs(); startWebcam();
    const socket = io();
    const handleScan = (data) => {
      if (autoCloseTimer.current) clearTimeout(autoCloseTimer.current);
      setPlateText(data.plate);
      setResident({ name: data.name, flat: data.flat, contact: data.contact, photo_url: (data.photo_url || '/static/images/unknown_avatar.svg') + '?t=' + Date.now(), model: data.model, color: data.color, family_members: data.family_members || [] });
      if (data.status === 'GRANTED') {
        setScanState('granted'); setBarrierOpen(true); setGateStateText('Barrier State: OPEN (AUTO)'); setStrangerAlert(null);
        speak('Access Granted. Welcome ' + data.name + ' of flat ' + data.flat + '.');
        autoCloseTimer.current = setTimeout(() => { setBarrierOpen(false); setGateStateText('Barrier State: CLOSED'); setScanState('idle'); }, 8000);
      } else {
        setScanState('denied'); setBarrierOpen(false); setGateStateText('Barrier State: CLOSED');
        setStrangerAlert({ plate: data.plate, capturedFrame: null });
        speak('Warning! Unregistered vehicle detected at gate.');
        if (strangerDismissTimer.current) clearTimeout(strangerDismissTimer.current);
        strangerDismissTimer.current = setTimeout(() => setStrangerAlert(null), 30000);
      }
      loadLogs();
    };
    socket.on('new-plate-scan', handleScan);
    socket.on('new-scan', handleScan);
    socket.on('new-face-scan', (data) => {
      setFaceScanAlert(data); setFaceScanVisible(true);
      if (faceAlertTimer.current) clearTimeout(faceAlertTimer.current);
      if (data.status === 'RECOGNIZED') { speak('Welcome ' + data.name + ' of flat ' + data.flat + '.'); faceAlertTimer.current = setTimeout(() => setFaceScanVisible(false), 8000); }
      else { speak('Warning! Stranger detected at the gate. Please verify immediately.'); }
      loadFaceLogs();
    });
    return () => {
      socket.disconnect(); stopWebcam();
      if (scanIntervalRef.current) clearInterval(scanIntervalRef.current);
      if (autoCloseTimer.current) clearTimeout(autoCloseTimer.current);
      if (faceAlertTimer.current) clearTimeout(faceAlertTimer.current);
      if (strangerDismissTimer.current) clearTimeout(strangerDismissTimer.current);
    };
  }, [startWebcam, stopWebcam]);

  // Auto-scan loop
  useEffect(() => {
    if (!webcamReady) return;
    if (scanIntervalRef.current) clearInterval(scanIntervalRef.current);
    scanIntervalRef.current = setInterval(captureAndScan, 2000);
    return () => { if (scanIntervalRef.current) clearInterval(scanIntervalRef.current); };
  }, [webcamReady, captureAndScan]);

  const speak = (text) => {
    if ('speechSynthesis' in window) { window.speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); u.rate = 0.95; u.pitch = 1.0; window.speechSynthesis.speak(u); }
  };

  const formatPlate = (plate) => {
    if (!plate || plate === 'WAITING...') return plate;
    const clean = plate.toUpperCase().replace(/\s+/g, '');
    if (clean.length >= 10) return clean.slice(0,2) + ' ' + clean.slice(2,4) + ' ' + clean.slice(4,6) + ' ' + clean.slice(6);
    return clean;
  };

  const triggerSimulation = async (plateNum) => {
    try {
      const res = await fetch('/api/simulate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plate_number: plateNum }) });
      const data = await res.json();
      if (!data.success) alert('Simulation error: ' + data.error);
    } catch (err) { console.error(err); }
  };

  const triggerCustomSimulation = () => {
    if (!customPlateInput.trim()) return alert('Please enter a plate code');
    triggerSimulation(customPlateInput.trim()); setCustomPlateInput('');
  };

  const handleManualOverride = (action) => {
    if (autoCloseTimer.current) clearTimeout(autoCloseTimer.current);
    if (action === 'OPEN') { setBarrierOpen(true); setGateStateText('Barrier State: OPEN (OVERRIDE)'); speak('Manual gate override. Barrier opened.'); }
    else { setBarrierOpen(false); setGateStateText('Barrier State: CLOSED (OVERRIDE)'); speak('Manual gate override. Barrier closed.'); setScanState('idle'); }
  };

  const handleClearLogs = async () => {
    if (!confirm('Clear all ANPR history logs?')) return;
    try { await fetch('/api/logs/clear', { method: 'POST' }); loadLogs(); } catch (err) { alert('Error: ' + err.message); }
  };

  const handleClearFaceLogs = async () => {
    if (!confirm('Clear all face verification logs?')) return;
    try { await fetch('/api/face-logs/clear', { method: 'POST' }); loadFaceLogs(); } catch (err) { alert('Error: ' + err.message); }
  };

  return (
    <div className="dashboard-grid">

      {/* STRANGER ALERT MODAL */}
      {strangerAlert && (
        <div className="stranger-alert-overlay" id="strangerAlertModal" onClick={() => setStrangerAlert(null)}>
          <div className="stranger-alert-box" onClick={e => e.stopPropagation()}>
            <div className="stranger-alert-icon"><i className="fa-solid fa-triangle-exclamation"></i></div>
            <h2 className="stranger-alert-title">UNREGISTERED VEHICLE</h2>
            <div className="stranger-alert-plate">{formatPlate(strangerAlert.plate)}</div>
            {strangerAlert.capturedFrame && (
              <img src={strangerAlert.capturedFrame} className="stranger-alert-capture" alt="Captured frame" />
            )}
            <p className="stranger-alert-desc">
              This vehicle is <strong>NOT registered</strong> in the society database.<br />
              Please verify the driver before granting entry.
            </p>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', marginTop: '16px' }}>
              <button id="alertGrantEntry" className="btn btn-success" onClick={() => { handleManualOverride('OPEN'); setStrangerAlert(null); }}>
                <i className="fa-solid fa-door-open"></i> Grant Entry
              </button>
              <button id="alertDismiss" className="btn btn-danger" onClick={() => setStrangerAlert(null)}>
                <i className="fa-solid fa-xmark"></i> Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {/* FACE SCAN TOAST */}
      {faceScanVisible && faceScanAlert && (
        <div className={'face-alert-toast ' + (faceScanAlert.status === 'RECOGNIZED' ? 'face-toast-ok' : 'face-toast-danger')}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <strong>{faceScanAlert.status === 'RECOGNIZED' ? '\u2713 Face Verified' : '\u26a0 Stranger Alert'}</strong>
            <button onClick={() => setFaceScanVisible(false)} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: '1rem', padding: '0 0 0 12px' }}>&times;</button>
          </div>
          <div>{faceScanAlert.name}{faceScanAlert.flat !== '-' ? ' \u2014 Flat ' + faceScanAlert.flat : ''}</div>
          {faceScanAlert.score > 0 && <div style={{ fontSize: '0.75rem', opacity: 0.8 }}>Confidence: {(faceScanAlert.score * 100).toFixed(1)}%</div>}
        </div>
      )}

      <div className="dashboard-left">

        {/* Status Panel */}
        <div id="statusPanel" className={'glass-panel status-panel state-' + scanState}>
          <div className="status-info">
            <div className="status-badge"></div>
            <div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Gate Security Status</div>
              <div className="status-text">
                {scanState === 'idle' && 'Idle \u2014 Live ANPR Scanning Active'}
                {scanState === 'granted' && 'ACCESS GRANTED \u2014 RESIDENT VEHICLE'}
                {scanState === 'denied' && 'ACCESS DENIED \u2014 UNREGISTERED VEHICLE'}
              </div>
            </div>
          </div>
          <div className="tts-indicator"><i className="fa-solid fa-volume-high"></i> Voice Guidance Active</div>
        </div>

        {/* Viewfinder + Details */}
        <div className="scan-content-grid">

          {/* Live Webcam Viewfinder */}
          <div className="glass-panel gate-view-container" style={{ position: 'relative', overflow: 'hidden' }}>
            <div className="scan-tag" style={{ backgroundColor: webcamReady ? 'rgba(239,68,68,0.9)' : 'rgba(0,0,0,0.7)', zIndex: 10 }}>
              <span className="live-dot" style={{ backgroundColor: webcamReady ? '#fff' : 'var(--color-danger)' }}></span>
              <span>{webcamReady ? 'LIVE GATE CAM \u00b7 ANPR ACTIVE' : 'CONNECTING CAMERA\u2026'}</span>
            </div>
            {isScanning && (
              <div className="anpr-scanning-badge">
                <i className="fa-solid fa-circle-notch fa-spin"></i> SCANNING PLATE&hellip;
              </div>
            )}
            {webcamError ? (
              <div className="webcam-error-state">
                <i className="fa-solid fa-camera-slash" style={{ fontSize: '2.5rem', color: 'var(--color-danger)', marginBottom: '12px' }}></i>
                <p style={{ fontWeight: 600, color: 'white', margin: '0 0 6px' }}>Camera Unavailable</p>
                <small style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{webcamError}</small>
                <button className="btn btn-secondary" style={{ marginTop: '14px' }} onClick={startWebcam}>
                  <i className="fa-solid fa-rotate-right"></i> Retry Camera
                </button>
              </div>
            ) : (
              <div className="webcam-video-wrapper">
                <video ref={videoRef} className="gate-webcam-video" autoPlay playsInline muted />
                <canvas ref={overlayCanvasRef} className="gate-overlay-canvas" />
                {!webcamReady && (
                  <div className="webcam-loading-overlay">
                    <i className="fa-solid fa-circle-notch fa-spin" style={{ fontSize: '2rem', color: 'var(--color-primary)' }}></i>
                    <span style={{ marginTop: '10px', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Starting camera&hellip;</span>
                  </div>
                )}
              </div>
            )}
            <canvas ref={captureCanvasRef} style={{ display: 'none' }} />
            <div className="scanner-overlay"><div className="scanner-line"></div></div>
          </div>

          {/* Household Info Panel */}
          <div className={'glass-panel details-card' + (scanState !== 'idle' ? ' state-' + scanState + '-card' : '')}>
            <div>
              <div className="details-header">
                <img src={resident.photo_url} className="resident-avatar" alt="Profile" />
                <div className="resident-title">
                  <h3>{resident.name}</h3>
                  <p>Flat: <strong>{resident.flat}</strong></p>
                </div>
              </div>
              <div className="info-rows">
                <div className="info-row"><span className="info-label">Contact:</span><span className="info-value">{resident.contact}</span></div>
                <div className="info-row"><span className="info-label">Vehicle:</span><span className="info-value">{resident.model}</span></div>
                <div className="info-row"><span className="info-label">Color:</span><span className="info-value">{resident.color}</span></div>
              </div>
            </div>

            {resident.family_members && resident.family_members.length > 0 && (
              <div className="household-members-section">
                <div className="household-members-title">
                  <i className="fa-solid fa-users"></i> Household Members ({resident.family_members.length})
                </div>
                <div className="household-members-grid">
                  {resident.family_members.map((m, idx) => (
                    <div key={m.id || idx} className="household-member-chip">
                      <img src={m.photo_url || '/static/images/unknown_avatar.svg'} alt={m.name} className="household-member-photo" />
                      <div className="household-member-info">
                        <div className="household-member-name">{m.name}</div>
                        <div className="household-member-phone"><i className="fa-solid fa-phone" style={{ fontSize: '0.65rem' }}></i> {m.phone}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="plate-badge-container">
              <div className={'plate-badge-large' + (scanState === 'granted' ? ' plate-granted' : scanState === 'denied' ? ' plate-denied' : '')}>
                {formatPlate(plateText)}
              </div>
            </div>
          </div>
        </div>

        {/* ANPR Logs */}
        <div className="glass-panel logs-panel">
          <div className="panel-header">
            <h2><i className="fa-solid fa-clock-rotate-left"></i> ANPR Gate Activity Logs</h2>
            <button className="btn btn-secondary" onClick={handleClearLogs}><i className="fa-solid fa-trash-can"></i> Clear Logs</button>
          </div>
          <div className="logs-table-container">
            <table className="logs-table">
              <thead><tr><th>Time</th><th>Plate Number</th><th>Resident Name</th><th>Flat</th><th>Status</th><th>Gate Photo</th></tr></thead>
              <tbody>
                {logs.length === 0 ? (
                  <tr><td colSpan="6" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '30px' }}>No entries logged yet. Point the webcam at a vehicle plate.</td></tr>
                ) : logs.map((log) => {
                  const timeStr = new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                  const isGranted = log.status === 'GRANTED';
                  return (
                    <tr key={log.id}>
                      <td><strong style={{ color: 'var(--text-primary)' }}>{timeStr}</strong></td>
                      <td><span className="plate-badge-small">{log.plate_number}</span></td>
                      <td>{log.resident_name}</td><td>{log.flat_number}</td>
                      <td><span className={'badge-status ' + (isGranted ? 'granted' : 'denied')}><i className={'fa-solid ' + (isGranted ? 'fa-circle-check' : 'fa-circle-xmark')}></i> {log.status}</span></td>
                      <td><a href={log.photo_path} target="_blank" rel="noreferrer" style={{ color: 'var(--color-primary)', fontSize: '0.85rem', textDecoration: 'none', fontWeight: 'bold', display: 'inline-flex', alignItems: 'center', gap: '4px' }}><i className="fa-regular fa-image"></i> View</a></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Face Verification Logs */}
        <div className="glass-panel logs-panel" style={{ marginTop: '20px' }}>
          <div className="panel-header">
            <h2><i className="fa-solid fa-face-viewfinder"></i> Face Verification Logs</h2>
            <button className="btn btn-secondary" onClick={handleClearFaceLogs}><i className="fa-solid fa-trash-can"></i> Clear</button>
          </div>
          <div className="logs-table-container">
            <table className="logs-table">
              <thead><tr><th>Time</th><th>Name</th><th>Flat</th><th>Status</th><th>Confidence</th><th>Live Photo</th></tr></thead>
              <tbody>
                {faceLogs.length === 0 ? (
                  <tr><td colSpan="6" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '30px' }}>No face scans logged yet.</td></tr>
                ) : faceLogs.map((log) => {
                  const timeStr = new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                  const isRecognized = log.status === 'RECOGNIZED';
                  return (
                    <tr key={log.id}>
                      <td><strong style={{ color: 'var(--text-primary)' }}>{timeStr}</strong></td>
                      <td>{log.name}</td><td>{log.flat_number}</td>
                      <td><span className={'badge-status ' + (isRecognized ? 'granted' : 'denied')}><i className={'fa-solid ' + (isRecognized ? 'fa-circle-check' : 'fa-triangle-exclamation')}></i>{isRecognized ? ' RECOGNIZED' : ' STRANGER'}</span></td>
                      <td style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{isRecognized ? (log.score * 100).toFixed(1) + '%' : '\u2014'}</td>
                      <td><a href={log.photo_path} target="_blank" rel="noreferrer" style={{ color: 'var(--color-primary)', fontSize: '0.85rem', textDecoration: 'none', fontWeight: 'bold', display: 'inline-flex', alignItems: 'center', gap: '4px' }}><i className="fa-regular fa-image"></i> View</a></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Right Column */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
        <div className="glass-panel barrier-panel">
          <h3><i className="fa-solid fa-road-barrier"></i> Boom Barrier Gate</h3>
          <div className="barrier-graphic-container">
            <div className="barrier-stand"></div>
            <div id="barrierArm" className={'barrier-arm ' + (barrierOpen ? 'open' : '')}></div>
          </div>
          <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginTop: '15px', fontWeight: 'bold', textTransform: 'uppercase' }}>{gateStateText}</div>
          <div className="barrier-controls">
            <button className="btn btn-success" onClick={() => handleManualOverride('OPEN')}><i className="fa-solid fa-arrow-up"></i> Manual Open</button>
            <button className="btn btn-danger" onClick={() => handleManualOverride('CLOSE')}><i className="fa-solid fa-arrow-down"></i> Manual Close</button>
          </div>
        </div>

        {/* Live ANPR Status Card */}
        <div className="glass-panel" style={{ padding: '20px' }}>
          <h3 style={{ marginBottom: '14px', fontSize: '1rem' }}><i className="fa-solid fa-camera-rotate"></i> Live ANPR Status</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '0.85rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Camera</span>
              <span style={{ color: webcamReady ? 'var(--color-success)' : webcamError ? 'var(--color-danger)' : 'var(--color-warning)', fontWeight: 600 }}>
                {webcamReady ? '\u25cf LIVE' : webcamError ? '\u2715 ERROR' : '\u25cc Connecting'}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Scan Interval</span>
              <span style={{ fontFamily: 'monospace' }}>every 2s</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Last Plate</span>
              <span style={{ fontFamily: 'monospace', color: 'var(--color-primary)', fontSize: '0.8rem' }}>{lastDetectedPlate || '\u2014'}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Debounce</span>
              <span style={{ fontFamily: 'monospace', color: 'var(--text-muted)' }}>60s / plate</span>
            </div>
            {isScanning && <div style={{ textAlign: 'center', color: 'var(--color-primary)', fontWeight: 600 }}><i className="fa-solid fa-circle-notch fa-spin"></i> Scanning&hellip;</div>}
          </div>
        </div>

        {/* Simulator */}
        <div className="glass-panel" style={{ padding: '24px' }}>
          <h3 style={{ marginBottom: '15px' }}><i className="fa-solid fa-vial"></i> Gate Simulator</h3>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '20px' }}>Quick triggers to test without camera.</p>
          <div className="sim-controls">
            <div className="sim-button-grid">
              <button className="btn btn-secondary" onClick={() => triggerSimulation('MH12AB1234')}>MH12AB1234<br /><span style={{ fontSize: '0.7rem', opacity: 0.7 }}>(Ishani Flat 420)</span></button>
              <button className="btn btn-secondary" onClick={() => triggerSimulation('MH14CD5678')}>MH14CD5678<br /><span style={{ fontSize: '0.7rem', opacity: 0.7 }}>(Hema Flat 420)</span></button>
            </div>
            <div className="sim-button-grid">
              <button className="btn btn-secondary" onClick={() => triggerSimulation('GJ01EF9012')}>GJ01EF9012<br /><span style={{ fontSize: '0.7rem', opacity: 0.7 }}>(Tanvi Flat 118)</span></button>
              <button className="btn btn-secondary" onClick={() => triggerSimulation('HR98AA0000')}>HR98AA0000<br /><span style={{ fontSize: '0.7rem', opacity: 0.7 }}>(Sai Patel Flat 506)</span></button>
            </div>
            <div className="sim-button-grid">
              <button className="btn btn-secondary" onClick={() => triggerSimulation('RJ14CV0002')} style={{ gridColumn: 'span 2', backgroundColor: 'rgba(99,102,241,0.15)', borderColor: 'rgba(99,102,241,0.3)', color: '#a5b4fc' }}>
                Simulate Kia Plate (RJ14CV0002) - fuzzy resolve!
              </button>
              <button className="btn btn-danger" onClick={() => triggerSimulation('KA03HA9999')} style={{ gridColumn: 'span 2' }}>Simulate Unregistered Plate (KA03HA9999)</button>
            </div>
            <div className="sim-input-group">
              <label htmlFor="customPlate">Custom plate code:</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input type="text" id="customPlate" className="text-input" placeholder="e.g. MH12XX9999" style={{ flex: 1, textTransform: 'uppercase' }} value={customPlateInput} onChange={(e) => setCustomPlateInput(e.target.value)} />
                <button className="btn btn-primary" onClick={triggerCustomSimulation} style={{ flex: '0 0 auto' }}>Scan</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── RESIDENT PORTAL ───────────────────────────────────────────────────────────
function ResidentPortal() {
  const [flatQuery, setFlatQuery] = useState('');
  const [profile, setProfile] = useState(null);
  const [vehicles, setVehicles] = useState([]);
  const [gateLogs, setGateLogs] = useState([]);
  const [registerMode, setRegisterMode] = useState(false);

  // Form Fields
  const [flatNumber, setFlatNumber] = useState('');
  const [familyName, setFamilyName] = useState('');
  const [contact, setContact] = useState('');
  const [uploadedFile, setUploadedFile] = useState(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState(null);

  // Vehicle form
  const [newPlate, setNewPlate] = useState('');
  const [newModel, setNewModel] = useState('');
  const [newColor, setNewColor] = useState('');

  // Member modal state
  const [showMemberModal, setShowMemberModal] = useState(false);
  const [memberName, setMemberName] = useState('');
  const [memberPhone, setMemberPhone] = useState('');
  const [memberPhotoFile, setMemberPhotoFile] = useState(null);
  const [memberPhotoPreview, setMemberPhotoPreview] = useState(null);
  const [memberCaptureMode, setMemberCaptureMode] = useState('upload'); // 'upload' | 'webcam'
  const [memberLoading, setMemberLoading] = useState(false);
  const [memberError, setMemberError] = useState('');
  const [memberSuccess, setMemberSuccess] = useState('');

  // Webcam refs for member capture
  const memberVideoRef = useRef(null);
  const memberCanvasRef = useRef(null);
  const memberStreamRef = useRef(null);

  const avatarInputRef = useRef(null);

  // Start/stop member webcam
  useEffect(() => {
    if (showMemberModal && memberCaptureMode === 'webcam') {
      startMemberWebcam();
    } else {
      stopMemberWebcam();
    }
    return () => stopMemberWebcam();
  }, [showMemberModal, memberCaptureMode]);

  const startMemberWebcam = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      memberStreamRef.current = stream;
      if (memberVideoRef.current) {
        memberVideoRef.current.srcObject = stream;
      }
    } catch (err) {
      setMemberError('Could not access camera: ' + err.message);
    }
  };

  const stopMemberWebcam = () => {
    if (memberStreamRef.current) {
      memberStreamRef.current.getTracks().forEach(t => t.stop());
      memberStreamRef.current = null;
    }
  };

  const captureMemberFromWebcam = () => {
    if (!memberVideoRef.current || !memberCanvasRef.current) return;
    const video = memberVideoRef.current;
    const canvas = memberCanvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (blob) {
        const file = new File([blob], 'webcam_capture.jpg', { type: 'image/jpeg' });
        setMemberPhotoFile(file);
        setMemberPhotoPreview(URL.createObjectURL(blob));
      }
    }, 'image/jpeg', 0.9);
  };

  const resetMemberModal = () => {
    setMemberName('');
    setMemberPhone('');
    setMemberPhotoFile(null);
    setMemberPhotoPreview(null);
    setMemberCaptureMode('upload');
    setMemberError('');
    setMemberSuccess('');
    setMemberLoading(false);
    stopMemberWebcam();
  };

  const openMemberModal = () => {
    resetMemberModal();
    setShowMemberModal(true);
  };

  const closeMemberModal = () => {
    resetMemberModal();
    setShowMemberModal(false);
  };

  const handleAddMember = async () => {
    if (!memberName.trim()) { setMemberError('Name is required.'); return; }
    if (!memberPhone.trim()) { setMemberError('Phone number is required.'); return; }
    if (!memberPhotoFile) { setMemberError('A face photo is required for face recognition.'); return; }
    if (!profile) return;

    setMemberLoading(true);
    setMemberError('');
    setMemberSuccess('');

    const formData = new FormData();
    formData.append('name', memberName.trim());
    formData.append('phone', memberPhone.trim());
    formData.append('photo', memberPhotoFile);

    try {
      const res = await fetch(`/api/residents/member?id=${profile.id}`, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();

      if (res.ok && data.success) {
        setMemberSuccess(`${memberName} added successfully with face recognition!`);
        // Refresh profile to show new member
        await refreshProfile(profile.id);
        setTimeout(closeMemberModal, 2000);
      } else {
        setMemberError(data.error || 'Failed to add member.');
      }
    } catch (err) {
      setMemberError('Network error: ' + err.message);
    } finally {
      setMemberLoading(false);
    }
  };

  const handleRemoveMember = async (memberId, memberNameStr) => {
    if (!confirm(`Remove ${memberNameStr} from your household? Their face data will also be deleted.`)) return;
    try {
      const res = await fetch(`/api/residents/member/${memberId}?id=${profile.id}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (data.success) {
        await refreshProfile(profile.id);
        alert(`${memberNameStr} removed successfully.`);
      } else {
        alert('Error: ' + data.error);
      }
    } catch (err) {
      alert('Error: ' + err.message);
    }
  };

  const refreshProfile = async (residentId) => {
    try {
      const res = await fetch(`/api/residents/profile?id=${residentId}`);
      const data = await res.json();
      if (res.ok) {
        setProfile({
          id: data.id || data._id,
          flat_number: data.flat_number,
          family_name: data.family_name,
          contact: data.contact,
          photo_url: data.photo_url || '/static/images/unknown_avatar.svg',
          head_face_registered: data.head_face_registered,
          family_members: data.family_members || []
        });
      }
    } catch (err) {
      console.error('Error refreshing profile:', err);
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!flatQuery.trim()) return;

    try {
      const res = await fetch(`/api/residents/login?flat=${flatQuery.trim()}`);
      if (res.ok) {
        const data = await res.json();
        setProfile({
          id: data.id,
          flat_number: data.flat_number,
          family_name: data.family_name,
          contact: data.contact,
          photo_url: data.photo_url || '/static/images/unknown_avatar.svg',
          head_face_registered: data.head_face_registered,
          family_members: data.family_members || []
        });
        setFlatNumber(data.flat_number);
        setFamilyName(data.family_name);
        setContact(data.contact || '');
        setRegisterMode(false);
        loadVehiclesAndLogs(data.id);
      } else {
        alert(`Flat ${flatQuery} is not registered yet. Please fill out the registration form.`);
        setFlatNumber(flatQuery.trim());
        setProfile(null);
        setRegisterMode(true);
      }
    } catch (err) {
      console.error(err);
      alert('Error logging in. Make sure your server and database are running!');
    }
  };

  const loadVehiclesAndLogs = async (residentId) => {
    try {
      const res = await fetch(`/api/residents/vehicles?id=${residentId}`);
      const data = await res.json();
      setVehicles(data.vehicles);
      setGateLogs(data.logs);
    } catch (err) {
      console.error(err);
    }
  };

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    const formData = new FormData();
    formData.append('flat_number', flatNumber.trim());
    formData.append('family_name', familyName.trim());
    formData.append('contact', contact.trim());
    if (uploadedFile) {
      formData.append('photo', uploadedFile);
    }

    const idParam = profile ? `?id=${profile.id}` : '';

    try {
      const res = await fetch(`/api/residents/profile${idParam}`, {
        method: 'POST',
        body: formData
      });
      const data = await res.json();

      if (res.ok) {
        const message = profile
          ? 'Profile updated successfully!'
          : 'Flat registered successfully! Now add your family members below.';
        alert(message);

        const loggedProfile = {
          id: data.id || data._id,
          flat_number: data.flat_number || data.flatNumber,
          family_name: data.family_name || data.familyName,
          contact: data.contact,
          photo_url: data.photo_url || data.photoUrl || '/static/images/unknown_avatar.svg',
          head_face_registered: data.head_face_registered || false,
          family_members: data.family_members || []
        };
        setProfile(loggedProfile);
        setRegisterMode(false);
        setUploadedFile(null);
        setPhotoPreviewUrl(null);
        loadVehiclesAndLogs(loggedProfile.id);
      } else {
        alert('Error: ' + data.error);
      }
    } catch (err) {
      alert('Error saving profile: ' + err.message);
    }
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setUploadedFile(file);
      const url = URL.createObjectURL(file);
      setPhotoPreviewUrl(url);
    }
  };

  const handleRegisterVehicle = async (e) => {
    e.preventDefault();
    if (!profile) return;

    const cleanPlate = newPlate.toUpperCase().replace(/\s+/g, '');
    try {
      const res = await fetch(`/api/residents/vehicles?id=${profile.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plate_number: cleanPlate,
          make_model: newModel.trim(),
          color: newColor.trim()
        })
      });

      const data = await res.json();
      if (res.ok) {
        setNewPlate(''); setNewModel(''); setNewColor('');
        loadVehiclesAndLogs(profile.id);
        alert('Vehicle registered successfully!');
      } else {
        alert('Error: ' + data.error);
      }
    } catch (err) {
      alert('Error saving vehicle: ' + err.message);
    }
  };

  const handleLogout = () => {
    setProfile(null); setFlatQuery(''); setFlatNumber('');
    setFamilyName(''); setContact(''); setVehicles([]);
    setGateLogs([]); setRegisterMode(false);
    setUploadedFile(null); setPhotoPreviewUrl(null);
  };

  return (
    <div>
      <div style={{ marginBottom: '30px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: '2rem', marginBottom: '6px' }}><i className="fa-solid fa-house-user"></i> Resident Control Portal</h1>
          <p style={{ color: 'var(--text-secondary)' }}>Register your flat, add all household members with face photos, and manage vehicles.</p>
        </div>
        {profile && (
          <button className="btn btn-secondary" onClick={handleLogout} style={{ flex: '0 0 auto' }}>
            <i className="fa-solid fa-right-from-bracket"></i> Logout
          </button>
        )}
      </div>

      {/* LOGIN PANEL */}
      {!profile && !registerMode && (
        <div className="glass-panel" style={{ padding: '30px', maxWidth: '500px', margin: '40px auto' }}>
          <h2 style={{ fontSize: '1.4rem', marginBottom: '15px', textAlign: 'center' }}><i className="fa-solid fa-right-to-bracket"></i> Resident Login</h2>
          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label htmlFor="flatQuery">Flat / Apartment Number</label>
              <input type="text" id="flatQuery" className="text-input" style={{ width: '100%' }} placeholder="e.g. 506" value={flatQuery} onChange={(e) => setFlatQuery(e.target.value)} required />
            </div>
            <button type="submit" className="btn btn-primary" style={{ width: '100%', padding: '12px' }}>
              Access Flat Portal
            </button>
            <div style={{ textAlign: 'center', marginTop: '10px' }}>
              <button type="button" onClick={() => setRegisterMode(true)} style={{ background: 'none', border: 'none', color: '#818cf8', cursor: 'pointer', fontSize: '0.9rem', textDecoration: 'underline' }}>
                Or Register New Flat Profile
              </button>
            </div>
          </form>
        </div>
      )}

      {/* REGISTRATION FORM */}
      {!profile && registerMode && (
        <div className="glass-panel" style={{ padding: '30px', maxWidth: '620px', margin: '20px auto' }}>
          <h2 style={{ fontSize: '1.5rem', marginBottom: '10px', textAlign: 'center' }}><i className="fa-solid fa-user-plus"></i> Flat Profile Registration</h2>
          <div className="resident-register-notice">
            <i className="fa-solid fa-camera"></i>
            <span>A <strong>clear face photo</strong> is required for the household head for face verification at the gate.</span>
          </div>
          <form onSubmit={handleSaveProfile}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', marginBottom: '15px' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label htmlFor="flatNum">Flat Number</label>
                <input type="text" id="flatNum" className="text-input" style={{ width: '100%' }} placeholder="e.g. 506" value={flatNumber} onChange={(e) => setFlatNumber(e.target.value)} required />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label htmlFor="ownerName">Family Head / Owner Name</label>
                <input type="text" id="ownerName" className="text-input" style={{ width: '100%' }} placeholder="e.g. Sai Patel" value={familyName} onChange={(e) => setFamilyName(e.target.value)} required />
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="contactNum">Contact Number</label>
              <input type="text" id="contactNum" className="text-input" style={{ width: '100%' }} placeholder="e.g. +91 99999 88888" value={contact} onChange={(e) => setContact(e.target.value)} required />
            </div>

            <div className="form-group">
              <label>Head of Family — Face Photo <span style={{ color: 'var(--color-danger)' }}>*Required</span></label>
              <div className="resident-photo-upload-area" onClick={() => avatarInputRef.current?.click()}>
                {photoPreviewUrl ? (
                  <img src={photoPreviewUrl} alt="Preview" className="resident-photo-preview-img" />
                ) : (
                  <>
                    <i className="fa-solid fa-camera" style={{ fontSize: '2rem', color: 'var(--text-muted)', marginBottom: '8px' }}></i>
                    <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Click to upload a clear face photo</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>JPG, PNG — well-lit, frontal face</div>
                  </>
                )}
                <input type="file" ref={avatarInputRef} accept="image/*" style={{ display: 'none' }} onChange={handleFileChange} />
              </div>
            </div>

            <div style={{ display: 'flex', gap: '15px', marginTop: '25px' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setRegisterMode(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary">Register &amp; Login</button>
            </div>
          </form>
        </div>
      )}

      {/* LOGGED-IN STATE */}
      {profile && (
        <div className="resident-layout">
          {/* Left Column: Profile Card */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
            <div className="glass-panel resident-card-profile">
              <div className="profile-avatar-container">
                <img src={photoPreviewUrl || profile.photo_url} className="profile-img" alt="Avatar" />
                <label className="file-upload-btn" title="Upload Photo" onClick={() => avatarInputRef.current?.click()}>
                  <i className="fa-solid fa-pen"></i>
                </label>
                <input type="file" ref={avatarInputRef} accept="image/*" style={{ display: 'none' }} onChange={handleFileChange} />
              </div>

              <h2 style={{ fontSize: '1.4rem', marginBottom: '4px' }}>{profile.family_name}</h2>
              <p style={{ color: 'var(--color-primary)', fontWeight: 600, fontSize: '0.95rem', marginBottom: '8px' }}>Flat Number: {profile.flat_number}</p>

              {/* Face Registration Status */}
              <div className={`face-status-badge ${profile.head_face_registered ? 'ok' : 'warn'}`}>
                <i className={`fa-solid ${profile.head_face_registered ? 'fa-face-smile' : 'fa-face-frown'}`}></i>
                <span>{profile.head_face_registered ? 'Face Registered ✓' : 'No Face Data — Upload Photo to Enable'}</span>
              </div>

              <form onSubmit={handleSaveProfile} style={{ borderTop: '1px solid var(--border-color)', paddingTop: '20px', marginTop: '16px' }}>
                <div className="form-group">
                  <label htmlFor="inputName">Family / Owner Name</label>
                  <input type="text" id="inputName" className="text-input" style={{ width: '100%' }} value={familyName} onChange={(e) => setFamilyName(e.target.value)} required />
                </div>
                <div className="form-group">
                  <label htmlFor="inputContact">Contact Number</label>
                  <input type="text" id="inputContact" className="text-input" style={{ width: '100%' }} value={contact} onChange={(e) => setContact(e.target.value)} required />
                </div>
                {photoPreviewUrl && (
                  <div style={{ marginBottom: '12px' }}>
                    <img src={photoPreviewUrl} alt="New photo preview" style={{ width: '60px', height: '60px', borderRadius: '8px', objectFit: 'cover', border: '2px solid var(--color-primary)' }} />
                    <span style={{ fontSize: '0.8rem', color: 'var(--color-primary)', marginLeft: '10px' }}>New photo ready to save</span>
                  </div>
                )}
                <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '10px' }}><i className="fa-solid fa-floppy-disk"></i> Save Changes</button>
              </form>
            </div>
          </div>

          {/* Right Column */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>

            {/* ── FAMILY MEMBERS SECTION ── */}
            <div className="glass-panel" style={{ padding: '24px' }}>
              <div className="panel-header" style={{ marginBottom: '16px' }}>
                <h2><i className="fa-solid fa-users"></i> Household Members</h2>
                <button className="btn btn-primary" onClick={openMemberModal} style={{ fontSize: '0.85rem', padding: '8px 16px' }}>
                  <i className="fa-solid fa-user-plus"></i> Add Member
                </button>
              </div>

              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '20px' }}>
                Every household member needs a registered face photo for gate verification. Unregistered members will be flagged as strangers.
              </p>

              {/* Family Head card */}
              <div className="member-card head-member">
                <div className="member-card-avatar">
                  <img src={profile.photo_url} alt={profile.family_name} />
                  {profile.head_face_registered && (
                    <div className="member-face-verified-badge"><i className="fa-solid fa-check"></i></div>
                  )}
                </div>
                <div className="member-card-info">
                  <div className="member-card-name">{profile.family_name}</div>
                  <div className="member-card-role">Head of Family</div>
                  <div className="member-card-phone"><i className="fa-solid fa-phone"></i> {profile.contact || '—'}</div>
                </div>
                <div className="member-card-status">
                  {profile.head_face_registered ? (
                    <span className="face-badge-ok"><i className="fa-solid fa-eye"></i> Face OK</span>
                  ) : (
                    <span className="face-badge-warn"><i className="fa-solid fa-eye-slash"></i> No Face</span>
                  )}
                </div>
              </div>

              {/* Other family members */}
              {profile.family_members && profile.family_members.length > 0 ? (
                profile.family_members.map((member) => (
                  <div key={member._id} className="member-card">
                    <div className="member-card-avatar">
                      <img src={member.photoUrl} alt={member.name} />
                      <div className="member-face-verified-badge"><i className="fa-solid fa-check"></i></div>
                    </div>
                    <div className="member-card-info">
                      <div className="member-card-name">{member.name}</div>
                      <div className="member-card-role">Family Member</div>
                      <div className="member-card-phone"><i className="fa-solid fa-phone"></i> {member.phone}</div>
                    </div>
                    <div className="member-card-status">
                      <span className="face-badge-ok"><i className="fa-solid fa-eye"></i> Face OK</span>
                      <button
                        className="btn btn-secondary"
                        style={{ marginTop: '8px', padding: '5px 10px', fontSize: '0.75rem', color: 'var(--color-danger)', borderColor: 'rgba(239,68,68,0.3)' }}
                        onClick={() => handleRemoveMember(member._id, member.name)}
                        title="Remove member"
                      >
                        <i className="fa-solid fa-trash-can"></i>
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="member-empty-state">
                  <i className="fa-solid fa-user-plus"></i>
                  <div>No additional members yet</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Click "Add Member" to register family members for face verification</div>
                </div>
              )}
            </div>

            {/* Vehicle Manager */}
            <div className="glass-panel" style={{ padding: '24px' }}>
              <h2><i className="fa-solid fa-car"></i> Registered Vehicles</h2>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '20px' }}>Vehicles listed below will trigger "Access Granted" and open the gate automatically upon plate capture.</p>

              <div className="vehicle-list">
                {vehicles.length === 0 ? (
                  <div style={{ color: 'var(--text-muted)', padding: '10px 0', fontSize: '0.9rem' }}>No registered vehicles. Add one using the form below.</div>
                ) : (
                  vehicles.map(v => (
                    <div key={v.plate_number} className="vehicle-item">
                      <div className="vehicle-desc">
                        <span><span className="plate-badge-small" style={{ fontSize: '0.75rem', padding: '2px 6px' }}>{v.plate_number}</span></span>
                        <span>{v.make_model || '-'} &bull; {v.color || '-'}</span>
                      </div>
                      <i className="fa-solid fa-car-side" style={{ color: 'var(--text-secondary)', fontSize: '1.2rem' }}></i>
                    </div>
                  ))
                )}
              </div>

              <form onSubmit={handleRegisterVehicle} style={{ marginTop: '25px', borderTop: '1px solid var(--border-color)', paddingTop: '20px' }}>
                <h3 style={{ fontSize: '1.1rem', marginBottom: '15px' }}>Register a New Vehicle</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', marginBottom: '15px' }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label htmlFor="inputPlate">License Plate Number</label>
                    <input type="text" id="inputPlate" className="text-input" style={{ width: '100%', textTransform: 'uppercase' }} placeholder="e.g. MH12AB1234" value={newPlate} onChange={(e) => setNewPlate(e.target.value)} required />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label htmlFor="inputModel">Vehicle Model / Brand</label>
                    <input type="text" id="inputModel" className="text-input" style={{ width: '100%' }} placeholder="e.g. Honda City" value={newModel} onChange={(e) => setNewModel(e.target.value)} required />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '15px', alignItems: 'end' }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label htmlFor="inputColor">Vehicle Color</label>
                    <input type="text" id="inputColor" className="text-input" style={{ width: '100%' }} placeholder="e.g. White" value={newColor} onChange={(e) => setNewColor(e.target.value)} required />
                  </div>
                  <button type="submit" className="btn btn-success" style={{ padding: '11px 20px' }}><i className="fa-solid fa-plus"></i> Register Plate</button>
                </div>
              </form>
            </div>

            {/* Entry Logs */}
            <div className="glass-panel" style={{ padding: '24px' }}>
              <h2><i className="fa-solid fa-route"></i> Flat Entry History</h2>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '15px' }}>Historical list of when your vehicles crossed the gate.</p>

              <div style={{ maxHeight: '250px', overflowY: 'auto' }}>
                <table className="logs-table">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Plate Number</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gateLogs.length === 0 ? (
                      <tr>
                        <td colSpan="3" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '20px' }}>No entries logged for your vehicles yet.</td>
                      </tr>
                    ) : (
                      gateLogs.map(log => {
                        const date = new Date(log.timestamp);
                        const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' ' + date.toLocaleDateString();
                        return (
                          <tr key={log.id}>
                            <td><strong>{timeStr}</strong></td>
                            <td><span className="plate-badge-small" style={{ fontSize: '0.75rem', padding: '2px 6px' }}>{log.plate_number}</span></td>
                            <td><span className="badge-status granted"><i className="fa-solid fa-circle-check"></i> {log.status}</span></td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── ADD MEMBER MODAL ── */}
      {showMemberModal && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && closeMemberModal()}>
          <div className="member-modal">
            <div className="modal-header">
              <h2><i className="fa-solid fa-user-plus"></i> Add Family Member</h2>
              <button className="modal-close-btn" onClick={closeMemberModal}><i className="fa-solid fa-xmark"></i></button>
            </div>

            <div className="modal-body">
              <div className="modal-notice">
                <i className="fa-solid fa-circle-info"></i>
                A clear, well-lit frontal face photo is <strong>mandatory</strong> for gate face verification.
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', marginBottom: '16px' }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label>Full Name <span style={{ color: 'var(--color-danger)' }}>*</span></label>
                  <input className="text-input" style={{ width: '100%' }} placeholder="e.g. Aarti Patel"
                    value={memberName} onChange={e => setMemberName(e.target.value)} />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label>Phone Number <span style={{ color: 'var(--color-danger)' }}>*</span></label>
                  <input className="text-input" style={{ width: '100%' }} placeholder="e.g. +91 98765 43210"
                    value={memberPhone} onChange={e => setMemberPhone(e.target.value)} />
                </div>
              </div>

              <div className="form-group">
                <label>Face Photo <span style={{ color: 'var(--color-danger)' }}>*</span></label>
                <div className="modal-photo-tabs">
                  <button
                    className={`modal-tab-btn ${memberCaptureMode === 'upload' ? 'active' : ''}`}
                    onClick={() => setMemberCaptureMode('upload')}
                  >
                    <i className="fa-solid fa-upload"></i> Upload Photo
                  </button>
                  <button
                    className={`modal-tab-btn ${memberCaptureMode === 'webcam' ? 'active' : ''}`}
                    onClick={() => setMemberCaptureMode('webcam')}
                  >
                    <i className="fa-solid fa-camera"></i> Use Webcam
                  </button>
                </div>

                {memberCaptureMode === 'upload' && (
                  <div>
                    <div
                      className="resident-photo-upload-area"
                      onClick={() => document.getElementById('memberFileInput').click()}
                      style={{ height: '140px' }}
                    >
                      {memberPhotoPreview ? (
                        <img src={memberPhotoPreview} alt="Preview" className="resident-photo-preview-img" />
                      ) : (
                        <>
                          <i className="fa-solid fa-image" style={{ fontSize: '1.5rem', color: 'var(--text-muted)', marginBottom: '8px' }}></i>
                          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Click to choose a face photo</div>
                        </>
                      )}
                    </div>
                    <input
                      id="memberFileInput"
                      type="file"
                      accept="image/*"
                      style={{ display: 'none' }}
                      onChange={e => {
                        const f = e.target.files[0];
                        if (f) {
                          setMemberPhotoFile(f);
                          setMemberPhotoPreview(URL.createObjectURL(f));
                        }
                      }}
                    />
                  </div>
                )}

                {memberCaptureMode === 'webcam' && (
                  <div className="webcam-capture-area">
                    {!memberPhotoPreview ? (
                      <>
                        <video ref={memberVideoRef} autoPlay playsInline className="member-webcam-video" />
                        <button type="button" className="btn btn-primary webcam-capture-btn" onClick={captureMemberFromWebcam}>
                          <i className="fa-solid fa-camera"></i> Capture Photo
                        </button>
                      </>
                    ) : (
                      <div style={{ textAlign: 'center' }}>
                        <img src={memberPhotoPreview} alt="Captured" style={{ width: '200px', height: '200px', objectFit: 'cover', borderRadius: '12px', border: '3px solid var(--color-success)' }} />
                        <br />
                        <button type="button" className="btn btn-secondary" style={{ marginTop: '10px', fontSize: '0.85rem' }} onClick={() => { setMemberPhotoFile(null); setMemberPhotoPreview(null); }}>
                          <i className="fa-solid fa-rotate-left"></i> Retake
                        </button>
                      </div>
                    )}
                    <canvas ref={memberCanvasRef} style={{ display: 'none' }} />
                  </div>
                )}
              </div>

              {memberError && (
                <div className="modal-error-msg">
                  <i className="fa-solid fa-triangle-exclamation"></i> {memberError}
                </div>
              )}
              {memberSuccess && (
                <div className="modal-success-msg">
                  <i className="fa-solid fa-circle-check"></i> {memberSuccess}
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={closeMemberModal} disabled={memberLoading}>Cancel</button>
              <button className="btn btn-primary" onClick={handleAddMember} disabled={memberLoading}>
                {memberLoading ? (
                  <><i className="fa-solid fa-spinner fa-spin"></i> Registering Face…</>
                ) : (
                  <><i className="fa-solid fa-user-plus"></i> Add Member</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}// --- PHONE CAMERA PORTAL ---
function MobileCamera() {
  const [useWebcam, setUseWebcam] = useState(true);
  const [scanStatus, setScanStatus] = useState('Ready to scan...');
  const [history, setHistory] = useState([]);

  const [autoScanActive, setAutoScanActive] = useState(true);
  const [liveStreamActive, setLiveStreamActive] = useState(true);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const viewfinderContainerRef = useRef(null);
  const socketRef = useRef(null);

  // Initialize socket connection
  useEffect(() => {
    socketRef.current = io();
    return () => {
      if (socketRef.current) socketRef.current.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!useWebcam) return;

    let localStream = null;
    const startCamera = async () => {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        enableFallback('Media API not supported');
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          localStream = stream;
        }
      } catch (err) {
        console.warn('Back camera failed, falling back...', err);
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: true });
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            localStream = stream;
          }
        } catch (err2) {
          enableFallback('No camera access available');
        }
      }
    };

    startCamera();
    return () => {
      if (localStream) localStream.getTracks().forEach(track => track.stop());
    };
  }, [useWebcam]);

  const enableFallback = (reason) => {
    console.log('Entering fallback camera capture mode:', reason);
    setUseWebcam(false);
  };

  // Live video frame streaming loop
  useEffect(() => {
    if (!useWebcam || !liveStreamActive) return;

    const streamInterval = setInterval(() => {
      if (videoRef.current && canvasRef.current && socketRef.current) {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        const context = canvas.getContext('2d');

        // Capture a low-res image for speed and network performance
        canvas.width = 320;
        canvas.height = 240;
        context.drawImage(video, 0, 0, canvas.width, canvas.height);

        const base64Frame = canvas.toDataURL('image/jpeg', 0.5);
        socketRef.current.emit('video-stream-frame', base64Frame);
      }
    }, 250); // 4 FPS

    return () => clearInterval(streamInterval);
  }, [useWebcam, liveStreamActive]);

  // Auto-scan loop for OCR
  useEffect(() => {
    if (!useWebcam || !autoScanActive) return;

    const scanInterval = setInterval(() => {
      if (videoRef.current && canvasRef.current) {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        const context = canvas.getContext('2d');

        // Capture full resolution for high OCR accuracy
        canvas.width = video.videoWidth || 800;
        canvas.height = video.videoHeight || 600;
        context.drawImage(video, 0, 0, canvas.width, canvas.height);

        canvas.toBlob((blob) => {
          if (blob) {
            uploadPhoto(blob);
          }
        }, 'image/jpeg', 0.85);
      }
    }, 4500); // OCR scan every 4.5 seconds

    return () => clearInterval(scanInterval);
  }, [useWebcam, autoScanActive]);

  // Upload photo blob
  const uploadPhoto = async (blob) => {
    setScanStatus('Scanning barcode / license plate...');
    const formData = new FormData();
    formData.append('photo', blob, 'gate_capture.jpg');

    try {
      const startTime = performance.now();
      const res = await fetch('/api/gate-camera/upload', { method: 'POST', body: formData });
      const data = await res.json();
      const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);

      if (data.success) {
        const isMatch = data.status === 'match';
        setScanStatus(
          <span style={{ color: isMatch ? 'var(--color-success)' : 'var(--color-danger)', fontWeight: 'bold' }}>
            {isMatch ? '✅' : '❌'} Plate: {data.plate} ({isMatch ? 'Registered' : 'Unknown'})
          </span>
        );
        addHistoryItem(data.plate, isMatch, elapsed);
      } else {
        setScanStatus(<span style={{ color: 'var(--color-danger)' }}>Error: {data.error}</span>);
      }
    } catch (err) {
      setScanStatus(<span style={{ color: 'var(--color-danger)' }}>Upload failed. Check server.</span>);
    }
  };

  // WebRTC Viewfinder Manual Capture
  const handleCapture = () => {
    if (!useWebcam || !videoRef.current || !canvasRef.current) return;

    if (viewfinderContainerRef.current) {
      viewfinderContainerRef.current.style.opacity = 0.3;
      setTimeout(() => { if (viewfinderContainerRef.current) viewfinderContainerRef.current.style.opacity = 1; }, 150);
    }
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (blob) uploadPhoto(blob);
      else setScanStatus('Error capturing frame.');
    }, 'image/jpeg', 0.85);
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    uploadPhoto(file);
    e.target.value = '';
  };

  const addHistoryItem = (plate, isMatch, elapsed) => {
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setHistory(prev => [{ plate, isMatch, elapsed, time }, ...prev.slice(0, 4)]);
  };

  return (
    <div className="phone-camera-container glass-panel">
      <div>
        <h2 style={{ fontSize: '1.5rem', marginBottom: '6px' }}><i className="fa-solid fa-camera"></i> Gate Camera Portal</h2>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Your device is now acting as the gate camera feed.</p>
      </div>

      {useWebcam && (
        <div className="glass-panel" style={{ padding: '12px', display: 'flex', justifyContent: 'space-around', fontSize: '0.85rem' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
            <input type="checkbox" checked={liveStreamActive} onChange={(e) => setLiveStreamActive(e.target.checked)} />
            <span>Stream Live Feed</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
            <input type="checkbox" checked={autoScanActive} onChange={(e) => setAutoScanActive(e.target.checked)} />
            <span>Auto-Scan Gating</span>
          </label>
        </div>
      )}

      <div ref={viewfinderContainerRef} className="phone-viewfinder" style={{ transition: 'opacity 0.15s ease' }}>
        {useWebcam ? (
          <>
            <video ref={videoRef} className="phone-video" autoPlay playsInline></video>
            <div className="capture-overlay"></div>

            {liveStreamActive && (
              <div style={{ position: 'absolute', top: '12px', right: '12px', backgroundColor: 'rgba(239, 68, 68, 0.85)', padding: '4px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span className="live-dot" style={{ backgroundColor: 'white' }}></span>
                <span>FEED LIVE</span>
              </div>
            )}
            {autoScanActive && (
              <div style={{ position: 'absolute', top: '12px', left: '12px', backgroundColor: 'rgba(59, 130, 246, 0.85)', padding: '4px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <i className="fa-solid fa-circle-notch fa-spin"></i>
                <span>AUTO-SCAN ACTIVE</span>
              </div>
            )}
          </>
        ) : (
          <div style={{ display: 'flex', width: '100%', height: '100%', backgroundColor: '#111827', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: '20px', color: 'var(--text-secondary)', textAlign: 'center' }}>
            <i className="fa-solid fa-circle-exclamation" style={{ fontSize: '2.5rem', color: 'var(--color-warning)', marginBottom: '15px' }}></i>
            <p style={{ fontWeight: 600, color: 'white', marginBottom: '8px' }}>Live Stream Unavailable</p>
            <p style={{ fontSize: '0.8rem', lineHeight: 1.4 }}>Browsers block live video streams over non-secure HTTP. Use the manual capture button below.</p>
          </div>
        )}
      </div>

      <canvas ref={canvasRef} className="phone-canvas"></canvas>
      <div className="camera-status-text">{scanStatus}</div>

      <div className="phone-controls">
        {useWebcam ? (
          <div>
            <button onClick={handleCapture} className="round-capture-btn" style={{ marginBottom: '8px' }}>
              <i className="fa-solid fa-aperture"></i>
            </button>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Or tap button to scan manually</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'center', marginTop: '10px' }}>
            <label htmlFor="fallbackPhoto" className="btn btn-primary" style={{ display: 'inline-flex', width: '100%', maxWidth: '250px', fontSize: '1rem', padding: '12px 20px', cursor: 'pointer', justifyContent: 'center', gap: '8px' }}>
              <i className="fa-solid fa-camera"></i> Take Live Photo
            </label>
            <input type="file" id="fallbackPhoto" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={handleFileChange} />

            <label htmlFor="fallbackVideo" className="btn btn-secondary" style={{ display: 'inline-flex', width: '100%', maxWidth: '250px', fontSize: '1rem', padding: '12px 20px', cursor: 'pointer', justifyContent: 'center', gap: '8px', border: '1px solid var(--border-color)', backgroundColor: 'transparent', color: '#fff' }}>
              <i className="fa-solid fa-video"></i> Upload Video File
            </label>
            <input type="file" id="fallbackVideo" accept="video/*" style={{ display: 'none' }} onChange={handleFileChange} />
          </div>
        )}
        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '10px' }}>
          <i className="fa-solid fa-wifi"></i> Connected to MERN server
        </div>
      </div>

      <div className="glass-panel" style={{ width: '100%', marginTop: '20px', padding: '15px', textAlign: 'left' }}>
        <h3 style={{ fontSize: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '10px', marginBottom: '10px' }}><i className="fa-solid fa-history"></i> Recent Uploads</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '150px', overflowY: 'auto', fontSize: '0.85rem' }}>
          {history.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '10px' }}>No uploads in this session yet.</div>
          ) : (
            history.map((item, index) => (
              <div key={index} style={{ display: 'flex', justifyContent: 'space-between', background: 'rgba(255,255,255,0.02)', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                <div>
                  <strong>{item.time}</strong> - <span style={{ fontFamily: 'monospace', background: '#fef08a', color: '#1e293b', padding: '1px 5px', borderRadius: '4px', fontWeight: 'bold' }}>{item.plate}</span>
                </div>
                <div>
                  <span style={{ color: item.isMatch ? 'var(--color-success)' : 'var(--color-danger)', fontWeight: 'bold' }}>{item.isMatch ? 'Granted' : 'Denied'}</span>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginLeft: '5px' }}>({item.elapsed}s)</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ─── FACE RECOGNITION COMPONENT ───────────────────────────────────────────────
function FaceRecognition() {
  const [status, setStatus] = useState({ detector: false, recognizer: false, camera: false, db_count: 0 });
  const [faceDb, setFaceDb] = useState({});
  const [detections, setDetections] = useState([]);
  const [detectedProfile, setDetectedProfile] = useState(null); // { name, flat, phone, score, profile_photo_url, live_photo_url, flat_profile, status }
  const [regTab, setRegTab] = useState('upload');
  const [uploadName, setUploadName] = useState('');
  const [webcamName, setWebcamName] = useState('');
  const [photoFile, setPhotoFile] = useState(null);
  const [previewSrc, setPreviewSrc] = useState(null);
  const [uploadMsg, setUploadMsg] = useState(null);
  const [webcamMsg, setWebcamMsg] = useState(null);
  const [logs, setLogs] = useState([{ cls: 'face-log-info', text: 'System started — awaiting activity.' }]);
  const [streamKey, setStreamKey] = useState(Date.now());
  const logBoxRef = useRef(null);
  const lastFetchedKeyRef = useRef(null);

  const addLog = (cls, text) =>
    setLogs(prev => [...prev.slice(-80), { cls, text: `[${new Date().toLocaleTimeString()}] ${text}` }]);

  useEffect(() => {
    if (logBoxRef.current) logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight;
  }, [logs]);

  // System diagnostics
  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const r = await fetch('/face/api/status');
        const d = await r.json();
        setStatus(d);
      } catch (_) { }
    };
    fetchStatus();
    const id = setInterval(fetchStatus, 4000);
    return () => clearInterval(id);
  }, []);

  // Database list
  const refreshDb = async () => {
    try {
      const r = await fetch('/face/api/db');
      const d = await r.json();
      setFaceDb(d);
    } catch (_) { }
  };
  useEffect(() => {
    refreshDb();
    const id = setInterval(refreshDb, 8000);
    return () => clearInterval(id);
  }, []);

  // Socket.io listener for instant webhook alerts
  useEffect(() => {
    const socket = io();
    socket.on('new-face-scan', (data) => {
      console.log('[FACE TAB] Socket new-face-scan:', data);
      setDetectedProfile(data);
      if (data.status === 'RECOGNIZED') {
        addLog('face-log-ok', `Verified: ${data.name} (Flat ${data.flat}) • Confidence: ${(data.score * 100).toFixed(1)}%`);
      } else {
        addLog('face-log-danger', `Stranger / Unrecognized face detected at gate!`);
      }
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  // Poll detections and auto-resolve resident profile if detected
  useEffect(() => {
    const poll = async () => {
      try {
        const r = await fetch('/face/api/detections');
        const d = await r.json();
        const faces = d.faces || [];
        setDetections(faces);

        if (faces.length > 0) {
          const known = faces.find(f => f.name !== 'Unknown');
          if (known) {
            // If we have a known face and haven't fetched profile recently
            if (lastFetchedKeyRef.current !== known.name) {
              lastFetchedKeyRef.current = known.name;
              try {
                const res = await fetch(`/api/residents/by-face-key?key=${encodeURIComponent(known.name)}`);
                if (res.ok) {
                  const prof = await res.json();
                  setDetectedProfile({
                    status: 'RECOGNIZED',
                    name: prof.name,
                    flat: prof.flat,
                    phone: prof.phone,
                    score: known.score,
                    profile_photo_url: prof.profile_photo_url,
                    flat_profile: prof.flat_profile
                  });
                }
              } catch (err) {
                console.warn('Could not fetch face details:', err);
              }
            }
          } else {
            // All unknown faces in frame
            const unknownFace = faces[0];
            if (!detectedProfile || detectedProfile.status !== 'UNKNOWN') {
              setDetectedProfile({
                status: 'UNKNOWN',
                name: 'Unknown Person',
                flat: '-',
                phone: '-',
                score: unknownFace.score
              });
            }
          }
        }
      } catch (_) { }
    };
    const id = setInterval(poll, 1200);
    return () => clearInterval(id);
  }, [detectedProfile]);

  const handleUpload = async () => {
    if (!uploadName.trim()) { setUploadMsg({ text: '⚠ Please enter a name.', ok: false }); return; }
    if (!photoFile) { setUploadMsg({ text: '⚠ Please choose a photo.', ok: false }); return; }
    addLog('face-log-info', `Registering "${uploadName}" from uploaded photo…`);
    const fd = new FormData();
    fd.append('name', uploadName.trim());
    fd.append('photo', photoFile);
    try {
      const r = await fetch('/face/register_photo', { method: 'POST', body: fd });
      const d = await r.json();
      setUploadMsg({ text: d.success ? `✅ ${d.message}` : `❌ ${d.message}`, ok: d.success });
      if (d.success) { addLog('face-log-ok', d.message); refreshDb(); }
      else addLog('face-log-danger', d.message);
    } catch (e) { setUploadMsg({ text: '❌ Network error', ok: false }); }
  };

  const handleWebcam = async () => {
    if (!webcamName.trim()) { setWebcamMsg({ text: '⚠ Please enter a name.', ok: false }); return; }
    addLog('face-log-info', `Capturing webcam frames for "${webcamName}"…`);
    try {
      const r = await fetch('/face/register_webcam', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: webcamName.trim() })
      });
      const d = await r.json();
      setWebcamMsg({ text: d.success ? `✅ ${d.message}` : `❌ ${d.message}`, ok: d.success });
      if (d.success) { addLog('face-log-ok', d.message); refreshDb(); }
      else addLog('face-log-danger', d.message);
    } catch (e) { setWebcamMsg({ text: '❌ Network error', ok: false }); }
  };

  const handleDelete = async (name) => {
    if (!window.confirm(`Delete all embeddings for "${name}"? This cannot be undone.`)) return;
    try {
      const r = await fetch(`/face/delete_face/${encodeURIComponent(name)}`, { method: 'DELETE' });
      const d = await r.json();
      if (d.success) { addLog('face-log-warn', `Deleted face: ${name}`); refreshDb(); }
      else addLog('face-log-danger', `Delete failed: ${d.message}`);
    } catch (e) { addLog('face-log-danger', `Delete error: ${e}`); }
  };

  const allOk = status.detector && status.recognizer && status.camera;

  return (
    <div className="face-layout">

      {/* ── LEFT COLUMN: Live Feed + Detected Household Profile ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

        {/* Live Camera Stream */}
        <div className="face-panel">
          <div className="face-panel-title">
            <i className="fa-solid fa-video"></i> Live Gate Camera — Face Detection &amp; Recognition
          </div>

          <div className="face-video-wrap">
            <img
              key={streamKey}
              src="/face/video_feed"
              alt="Live face stream"
              onError={() => setTimeout(() => setStreamKey(Date.now()), 3000)}
            />
            <div className={`face-live-badge ${allOk ? 'live' : 'warn'}`}>
              <span className="face-pulse"></span>
              {allOk ? 'LIVE — face recognition active' : 'LIVE — limited mode'}
            </div>
          </div>

          {/* Detected Realtime Chips */}
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 8 }}>
              Real-time In-Frame Detections
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, minHeight: 32 }}>
              {detections.length === 0 ? (
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>No face currently in frame</span>
              ) : (
                detections.map((f, i) => (
                  <div key={i} className={`face-chip ${f.name !== 'Unknown' ? 'known' : 'unknown'}`}>
                    {f.name !== 'Unknown' ? '✔' : '?'} {f.name}
                    <span style={{ opacity: .7, fontWeight: 400 }}>{(f.score * 100).toFixed(0)}%</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* ── LIVE DETECTED PROFILE & HOUSEHOLD DETAILS PANEL ── */}
        <div className="face-panel face-live-profile-panel">
          <div className="panel-header" style={{ marginBottom: '14px', borderBottom: '1px solid var(--border-color)', paddingBottom: '10px' }}>
            <h3 style={{ fontSize: '1.15rem', display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
              <i className="fa-solid fa-address-card" style={{ color: 'var(--color-primary)' }}></i>
              Live Detected Resident &amp; Household Profile
            </h3>
            {detectedProfile && (
              <button
                className="btn btn-secondary"
                style={{ padding: '4px 10px', fontSize: '0.75rem' }}
                onClick={() => { setDetectedProfile(null); lastFetchedKeyRef.current = null; }}
              >
                Clear
              </button>
            )}
          </div>

          {!detectedProfile ? (
            <div className="face-profile-idle">
              <div className="face-idle-pulse">
                <i className="fa-solid fa-expand"></i>
              </div>
              <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginTop: '8px' }}>Waiting for Face in Camera Stream...</div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', maxWidth: '380px', marginTop: '4px' }}>
                When a resident or stranger is detected by the camera, their full identity, flat number, phone, and all family members will appear here automatically.
              </div>
            </div>
          ) : detectedProfile.status === 'UNKNOWN' ? (
            /* Stranger Alert View */
            <div className="face-stranger-card">
              <div className="face-stranger-header">
                <div className="face-alert-icon stranger-icon">
                  <i className="fa-solid fa-triangle-exclamation"></i>
                </div>
                <div>
                  <div style={{ fontWeight: 'bold', color: '#ef4444', fontSize: '1.1rem' }}>🚨 STRANGER DETECTED</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>This face is not registered in the resident database.</div>
                </div>
              </div>
              {detectedProfile.live_photo_url && (
                <div style={{ marginTop: '12px', textAlign: 'center' }}>
                  <img
                    src={detectedProfile.live_photo_url + '?t=' + Date.now()}
                    alt="Stranger snapshot"
                    style={{ width: '120px', height: '120px', objectFit: 'cover', borderRadius: '12px', border: '2px solid #ef4444' }}
                  />
                </div>
              )}
            </div>
          ) : (
            /* Recognized Resident + Household Profile View */
            <div className="face-recognized-view">

              {/* Top: Detected Person Info Card */}
              <div className="face-detected-person-box">
                <div className="face-detected-person-left">
                  <div className="face-avatar-container">
                    <img
                      src={detectedProfile.profile_photo_url || '/static/images/unknown_avatar.svg'}
                      alt={detectedProfile.name}
                      className="face-detected-avatar"
                    />
                    <div className="face-verified-check">
                      <i className="fa-solid fa-check"></i>
                    </div>
                  </div>
                  {detectedProfile.live_photo_url && (
                    <div style={{ textAlign: 'center' }}>
                      <img
                        src={detectedProfile.live_photo_url + '?t=' + Date.now()}
                        alt="Live scan"
                        className="face-live-thumb"
                      />
                      <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Live Scan</div>
                    </div>
                  )}
                </div>

                <div className="face-detected-person-info">
                  <div className="face-verified-pill">
                    <i className="fa-solid fa-shield-check"></i> RECOGNIZED RESIDENT
                  </div>
                  <h2 className="face-person-name">{detectedProfile.name}</h2>

                  <div className="face-meta-grid">
                    <div className="face-meta-item">
                      <span className="face-meta-label">Flat Number</span>
                      <span className="face-meta-value highlight"><i className="fa-solid fa-building"></i> Flat {detectedProfile.flat}</span>
                    </div>
                    <div className="face-meta-item">
                      <span className="face-meta-label">Phone Number</span>
                      <span className="face-meta-value"><i className="fa-solid fa-phone"></i> {detectedProfile.phone || '—'}</span>
                    </div>
                    <div className="face-meta-item">
                      <span className="face-meta-label">Match Score</span>
                      <span className="face-meta-value ok"><i className="fa-solid fa-chart-line"></i> {detectedProfile.score ? `${(detectedProfile.score * 100).toFixed(1)}%` : 'Verified'}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Bottom: All Household / Family Members for that Flat */}
              {detectedProfile.flat_profile && (
                <div className="face-household-section">
                  <div className="face-household-header">
                    <i className="fa-solid fa-users"></i>
                    <span>All Household Members — Flat {detectedProfile.flat}</span>
                  </div>

                  <div className="face-household-grid">
                    {/* Head of Family */}
                    <div className={`face-member-mini-card ${detectedProfile.flat_profile.family_head.name === detectedProfile.name ? 'current-detected' : ''}`}>
                      <img
                        src={detectedProfile.flat_profile.family_head.photo_url}
                        alt={detectedProfile.flat_profile.family_head.name}
                        className="face-member-mini-avatar"
                      />
                      <div className="face-member-mini-info">
                        <div className="face-member-mini-name">
                          {detectedProfile.flat_profile.family_head.name}
                          {detectedProfile.flat_profile.family_head.name === detectedProfile.name && (
                            <span className="mini-detected-chip">Detected Now</span>
                          )}
                        </div>
                        <div className="face-member-mini-role"><i className="fa-solid fa-crown"></i> Head of Family</div>
                        <div className="face-member-mini-phone"><i className="fa-solid fa-phone"></i> {detectedProfile.flat_profile.family_head.contact}</div>
                      </div>
                    </div>

                    {/* Other Members */}
                    {detectedProfile.flat_profile.other_members && detectedProfile.flat_profile.other_members.map((member) => (
                      <div key={member.id} className={`face-member-mini-card ${member.name === detectedProfile.name ? 'current-detected' : ''}`}>
                        <img
                          src={member.photo_url}
                          alt={member.name}
                          className="face-member-mini-avatar"
                        />
                        <div className="face-member-mini-info">
                          <div className="face-member-mini-name">
                            {member.name}
                            {member.name === detectedProfile.name && (
                              <span className="mini-detected-chip">Detected Now</span>
                            )}
                          </div>
                          <div className="face-member-mini-role"><i className="fa-solid fa-user"></i> Family Member</div>
                          <div className="face-member-mini-phone"><i className="fa-solid fa-phone"></i> {member.phone}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

            </div>
          )}
        </div>

      </div>

      {/* ── RIGHT COLUMN: Controls, Registration, DB & Logs ── */}
      <div className="face-right-col">

        {/* System Status */}
        <div className="face-panel">
          <div className="face-panel-title">System Status</div>
          <div className="face-diag-grid">
            <div className="face-diag-box">
              <span className="face-diag-label">Face Detector</span>
              <span className={`face-diag-val ${status.detector ? 'ok' : 'warn'}`}>
                {status.detector ? '✔ YuNet (ONNX)' : '✘ Model missing'}
              </span>
            </div>
            <div className="face-diag-box">
              <span className="face-diag-label">Face Recognizer</span>
              <span className={`face-diag-val ${status.recognizer ? 'ok' : 'warn'}`}>
                {status.recognizer ? '✔ SFace (ONNX)' : '✘ Model missing'}
              </span>
            </div>
            <div className="face-diag-box">
              <span className="face-diag-label">Webcam</span>
              <span className={`face-diag-val ${status.camera ? 'ok' : 'warn'}`}>
                {status.camera ? '✔ Active' : '✘ Not found'}
              </span>
            </div>
            <div className="face-diag-box">
              <span className="face-diag-label">Registered</span>
              <span className="face-diag-val ok">{status.db_count} people</span>
            </div>
          </div>
        </div>

        {/* Register New Face */}
        <div className="face-panel">
          <div className="face-panel-title">Register New Face</div>
          <div className="face-reg-tabs">
            <button className={`face-reg-tab ${regTab === 'upload' ? 'active' : ''}`} onClick={() => setRegTab('upload')}>
              📁 Upload Photo
            </button>
            <button className={`face-reg-tab ${regTab === 'webcam' ? 'active' : ''}`} onClick={() => setRegTab('webcam')}>
              📷 Webcam Snapshot
            </button>
          </div>

          {regTab === 'upload' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <label className="face-label">Full Name</label>
                <input className="face-input" placeholder="e.g. Tanvi Patel" value={uploadName}
                  onChange={e => setUploadName(e.target.value)} />
              </div>
              <div>
                <label className="face-label">Face Photo (clear, well-lit)</label>
                <input className="face-input" type="file" accept="image/*"
                  onChange={e => {
                    const f = e.target.files[0];
                    setPhotoFile(f || null);
                    setPreviewSrc(f ? URL.createObjectURL(f) : null);
                  }} />
                {previewSrc && <img src={previewSrc} alt="preview" className="face-preview-img" style={{ display: 'block' }} />}
              </div>
              <button className="face-btn face-btn-primary" onClick={handleUpload}>
                <i className="fa-solid fa-user-plus"></i> Register from Photo
              </button>
              {uploadMsg && (
                <div className={`face-toast ${uploadMsg.ok ? 'ok' : 'err'}`} style={{ display: 'block' }}>
                  {uploadMsg.text}
                </div>
              )}
            </div>
          )}

          {regTab === 'webcam' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <label className="face-label">Full Name</label>
                <input className="face-input" placeholder="e.g. Tanvi Patel" value={webcamName}
                  onChange={e => setWebcamName(e.target.value)} />
              </div>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                Look directly at the webcam, then click the button. The system captures 5 frames and builds an average embedding.
              </p>
              <button className="face-btn face-btn-primary" onClick={handleWebcam}>
                <i className="fa-solid fa-camera"></i> Capture &amp; Register
              </button>
              {webcamMsg && (
                <div className={`face-toast ${webcamMsg.ok ? 'ok' : 'err'}`} style={{ display: 'block' }}>
                  {webcamMsg.text}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Registered Faces DB */}
        <div className="face-panel">
          <div className="face-panel-title">Registered Faces Database</div>
          <div className="face-db-list">
            {Object.keys(faceDb).length === 0
              ? <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>No faces registered yet.</span>
              : Object.entries(faceDb).map(([name, cnt]) => (
                <div key={name} className="face-db-item">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="face-db-name">{name}</span>
                    <span className="face-db-count">{cnt} embed{cnt !== 1 ? 's' : ''}</span>
                  </div>
                  <button className="face-del-btn" title={`Delete ${name}`} onClick={() => handleDelete(name)}>🗑</button>
                </div>
              ))
            }
          </div>
        </div>

        {/* Activity Log */}
        <div className="face-panel">
          <div className="face-panel-title">Activity Log</div>
          <div className="face-log-box" ref={logBoxRef}>
            {logs.map((l, i) => (
              <div key={i} className={`face-log-line ${l.cls}`}>{l.text}</div>
            ))}
          </div>
        </div>

      </div>{/* /right-col */}
    </div>
  );
}
