import React, { useState, useEffect, useRef } from 'react';
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
        <p>&copy; 2026 GateGuard Systems POC. Built with MERN Stack & Socket.io.</p>
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
        <p>An automated ANPR (Automatic Number Plate Recognition) gating solution. Manage residents, register plates, and control entries in real-time.</p>
      </div>

      <div className="portal-grid">
        <div onClick={() => onViewChange('guard')} className="portal-card guard-card glass-panel">
          <i className="fa-solid fa-desktop"></i>
          <h2>Security Guard Portal</h2>
          <p>Monitor gate entries in real-time. View captured number plate photos, OCR readings, and resident profile details. Control the automated boom barrier.</p>
        </div>

        <div onClick={() => onViewChange('camera')} className="portal-card camera-card glass-panel">
          <i className="fa-solid fa-camera-retro"></i>
          <h2>Gate Camera (Phone)</h2>
          <p>Open this portal on your phone browser. Point your phone camera at a vehicle plate to capture and upload it. Simulates the physical gate camera.</p>
        </div>

        <div onClick={() => onViewChange('resident')} className="portal-card resident-card glass-panel">
          <i className="fa-solid fa-house-user"></i>
          <h2>Resident Portal</h2>
          <p>Log in as a resident to upload family profile photos, register vehicle plate numbers, and view complete entry timestamps of your vehicles.</p>
        </div>

        <div onClick={() => onViewChange('face')} className="portal-card face-card glass-panel">
          <i className="fa-solid fa-eye"></i>
          <h2>Face Recognition</h2>
          <p>Live webcam face detection and recognition powered by OpenCV YuNet + SFace. Register visitors by photo or webcam snapshot and verify identities in real-time.</p>
        </div>
      </div>

      <div className="glass-panel" style={{ padding: '24px', textAlign: 'left', maxWidth: '800px', margin: '30px auto', borderLeft: '4px solid var(--color-primary)' }}>
        <h3 style={{ marginBottom: '12px', fontFamily: 'var(--font-heading)', color: '#818cf8' }}>
          <i className="fa-solid fa-circle-info"></i> How to Demo this MERN POC
        </h3>
        <ol style={{ marginLeft: '20px', color: 'var(--text-secondary)', lineHeight: '1.6', fontSize: '0.95rem' }}>
          <li style={{ marginBottom: '8px' }}>Start MongoDB locally and run <code>npm run dev</code> in the root folder.</li>
          <li style={{ marginBottom: '8px' }}>Open the <strong>Security Guard Portal</strong> on your laptop browser. This is where you will see the logs and gate animations in real-time.</li>
          <li style={{ marginBottom: '8px' }}>Connect your phone to the same local Wi-Fi, scan the URL shown in the terminal (port 5173), and open the <strong>Gate Camera Portal</strong>.</li>
          <li style={{ marginBottom: '8px' }}>Take a photo of a vehicle's license plate with your phone. (Or, use the <strong>Gate Camera Simulator</strong> buttons on the guard screen directly).</li>
          <li>Observe how the Guard Dashboard instantly registers the entry, plays the Text-to-Speech greeting, and opens the gate barrier!</li>
        </ol>
      </div>
    </div>
  );
}

// --- GUARD DASHBOARD ---
function GuardDashboard() {
  const [scanState, setScanState] = useState('idle'); // 'idle', 'granted', 'denied'
  const [plateText, setPlateText] = useState('WAITING...');
  const [gatePhoto, setGatePhoto] = useState('/static/images/simulated_car.svg');
  const [resident, setResident] = useState({
    name: 'Unknown Visitor',
    flat: '-',
    contact: '-',
    photo_url: '/static/images/unknown_avatar.svg',
    model: '-',
    color: '-'
  });
  const [logs, setLogs] = useState([]);
  const [barrierOpen, setBarrierOpen] = useState(false);
  const [gateStateText, setGateStateText] = useState('Barrier State: CLOSED');
  const [customPlateInput, setCustomPlateInput] = useState('');
  const [liveStreamActive, setLiveStreamActive] = useState(false);

  const autoCloseTimer = useRef(null);
  const liveTimeoutRef = useRef(null);

  // 1. Fetch logs on load
  const loadLogs = async () => {
    try {
      const res = await fetch('/api/logs');
      const data = await res.json();
      setLogs(data);
    } catch (err) {
      console.error('Error fetching logs:', err);
    }
  };

  useEffect(() => {
    loadLogs();

    // 2. Connect WebSockets (Socket.io) for real-time scans
    const socket = io(); // Connects to the same domain

    socket.on('video-stream-frame', (frameData) => {
      setGatePhoto(frameData);
      setLiveStreamActive(true);
      if (liveTimeoutRef.current) clearTimeout(liveTimeoutRef.current);
      liveTimeoutRef.current = setTimeout(() => {
        setLiveStreamActive(false);
      }, 1500);
    });

    socket.on('new-scan', (data) => {
      console.log('Socket.io scan received:', data);

      if (autoCloseTimer.current) {
        clearTimeout(autoCloseTimer.current);
      }

      // Update scan states
      setPlateText(data.plate);
      setGatePhoto(data.photo_path + '?t=' + Date.now());

      setResident({
        name: data.name,
        flat: data.flat,
        contact: data.contact,
        photo_url: data.photo_url + '?t=' + Date.now(),
        model: data.model,
        color: data.color
      });

      if (data.status === 'GRANTED') {
        setScanState('granted');
        setBarrierOpen(true);
        setGateStateText('Barrier State: OPEN (AUTO)');
        speak(`Access Granted. Welcome ${data.name} of flat ${data.flat}.`);

        // Auto close after 6 seconds
        autoCloseTimer.current = setTimeout(() => {
          setBarrierOpen(false);
          setGateStateText('Barrier State: CLOSED');
          setScanState('idle');
        }, 6000);
      } else {
        setScanState('denied');
        setBarrierOpen(false);
        setGateStateText('Barrier State: CLOSED');
        speak('Warning. Unregistered vehicle detected at gate.');
      }

      loadLogs();
    });

    return () => {
      socket.disconnect();
      if (autoCloseTimer.current) clearTimeout(autoCloseTimer.current);
      if (liveTimeoutRef.current) clearTimeout(liveTimeoutRef.current);
    };
  }, []);

  // Text-to-Speech Announcement
  const speak = (text) => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 0.95;
      utterance.pitch = 1.0;
      window.speechSynthesis.speak(utterance);
    }
  };

  // Format Plate (e.g. MH12AB1234 -> MH 12 AB 1234)
  const formatPlate = (plate) => {
    if (!plate || plate === 'WAITING...') return plate;
    const clean = plate.toUpperCase().replace(/\s+/g, '');
    if (clean.length >= 10) {
      return `${clean.slice(0, 2)} ${clean.slice(2, 4)} ${clean.slice(4, 6)} ${clean.slice(6)}`;
    }
    return clean;
  };

  // Simulation Trigger
  const triggerSimulation = async (plateNum) => {
    try {
      const res = await fetch('/api/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plate_number: plateNum })
      });
      const data = await res.json();
      if (!data.success) {
        alert('Simulation error: ' + data.error);
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Custom Simulator Trigger
  const triggerCustomSimulation = () => {
    if (!customPlateInput.trim()) return alert('Please enter a plate code');
    triggerSimulation(customPlateInput.trim());
    setCustomPlateInput('');
  };

  // Manual Gate Override
  const handleManualOverride = (action) => {
    if (autoCloseTimer.current) clearTimeout(autoCloseTimer.current);

    if (action === 'OPEN') {
      setBarrierOpen(true);
      setGateStateText('Barrier State: OPEN (OVERRIDE)');
      speak('Manual gate override. Barrier opened.');
    } else {
      setBarrierOpen(false);
      setGateStateText('Barrier State: CLOSED (OVERRIDE)');
      speak('Manual gate override. Barrier closed.');
      setScanState('idle');
    }
  };

  // Clear log DB
  const handleClearLogs = async () => {
    if (!confirm('Are you sure you want to clear all history logs?')) return;
    try {
      await fetch('/api/logs/clear', { method: 'POST' });
      loadLogs();
    } catch (err) {
      alert('Error: ' + err.message);
    }
  };

  return (
    <div className="dashboard-grid">
      <div className="dashboard-left">
        {/* Status Indicator Panel */}
        <div id="statusPanel" className={`glass-panel status-panel state-${scanState}`}>
          <div className="status-info">
            <div className="status-badge"></div>
            <div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Gate Security Status</div>
              <div className="status-text">
                {scanState === 'idle' && 'Idle - Waiting for Scan'}
                {scanState === 'granted' && 'ACCESS GRANTED — RESIDENT VEHICLE'}
                {scanState === 'denied' && 'ACCESS DENIED — UNREGISTERED VEHICLE'}
              </div>
            </div>
          </div>
          <div className="tts-indicator">
            <i className="fa-solid fa-volume-high"></i> Voice Guidance Active
          </div>
        </div>

        {/* Viewfinder and details */}
        <div className="scan-content-grid">
          <div className="glass-panel gate-view-container">
            <div className="scan-tag" style={{ backgroundColor: liveStreamActive ? 'rgba(239, 68, 68, 0.85)' : 'rgba(0, 0, 0, 0.7)' }}>
              <span className="live-dot" style={{ backgroundColor: liveStreamActive ? '#fff' : 'var(--color-danger)' }}></span>
              <span>{liveStreamActive ? 'LIVE GATE CAMERA FEED' : 'GATE CAMERA STREAM'}</span>
            </div>
            <img src={gatePhoto} className="gate-photo" alt="Gate camera feed" />
            <div className="scanner-overlay">
              <div className="scanner-line"></div>
            </div>
          </div>

          {/* Details Card */}
          <div className="glass-panel details-card">
            <div>
              <div className="details-header">
                <img src={resident.photo_url} className="resident-avatar" alt="Profile" />
                <div className="resident-title">
                  <h3>{resident.name}</h3>
                  <p>Flat Number: {resident.flat}</p>
                </div>
              </div>

              <div className="info-rows">
                <div className="info-row">
                  <span className="info-label">Contact:</span>
                  <span className="info-value">{resident.contact}</span>
                </div>
                <div className="info-row">
                  <span className="info-label">Vehicle Type:</span>
                  <span className="info-value">{resident.model}</span>
                </div>
                <div className="info-row">
                  <span className="info-label">Color:</span>
                  <span className="info-value">{resident.color}</span>
                </div>
              </div>
            </div>

            <div className="plate-badge-container">
              <div className="plate-badge-large">{formatPlate(plateText)}</div>
            </div>
          </div>
        </div>

        {/* Logs List */}
        <div className="glass-panel logs-panel">
          <div className="panel-header">
            <h2><i className="fa-solid fa-clock-rotate-left"></i> Gate Activity Logs</h2>
            <button className="btn btn-secondary" onClick={handleClearLogs}><i class="fa-solid fa-trash-can"></i> Clear Logs</button>
          </div>
          <div className="logs-table-container">
            <table className="logs-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Plate Number</th>
                  <th>Resident Name</th>
                  <th>Flat</th>
                  <th>Status</th>
                  <th>Gate Photo</th>
                </tr>
              </thead>
              <tbody>
                {logs.length === 0 ? (
                  <tr>
                    <td colSpan="6" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '30px' }}>No entries logged yet. Try scanning a vehicle.</td>
                  </tr>
                ) : (
                  logs.map((log) => {
                    const date = new Date(log.timestamp);
                    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                    const isGranted = log.status === 'GRANTED';
                    return (
                      <tr key={log.id}>
                        <td><strong style={{ color: 'var(--text-primary)' }}>{timeStr}</strong></td>
                        <td><span className="plate-badge-small">{log.plate_number}</span></td>
                        <td>{log.resident_name}</td>
                        <td>{log.flat_number}</td>
                        <td>
                          <span className={`badge-status ${isGranted ? 'granted' : 'denied'}`}>
                            <i className={`fa-solid ${isGranted ? 'fa-circle-check' : 'fa-circle-xmark'}`}></i> {log.status}
                          </span>
                        </td>
                        <td>
                          <a href={log.photo_path} target="_blank" rel="noreferrer" style={{ color: 'var(--color-primary)', fontSize: '0.85rem', textDecoration: 'none', fontWeight: 'bold', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                            <i className="fa-regular fa-image"></i> View Photo
                          </a>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Right Column: Boom Barrier & Simulator */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
        {/* Gate barrier arm card */}
        <div className="glass-panel barrier-panel">
          <h3><i className="fa-solid fa-road-barrier"></i> Boom Barrier Gate</h3>
          <div className="barrier-graphic-container">
            <div className="barrier-stand"></div>
            <div id="barrierArm" className={`barrier-arm ${barrierOpen ? 'open' : ''}`}></div>
          </div>
          <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginTop: '15px', fontWeight: 'bold', textTransform: 'uppercase' }}>
            {gateStateText}
          </div>
          <div className="barrier-controls">
            <button className="btn btn-success" onClick={() => handleManualOverride('OPEN')}><i className="fa-solid fa-arrow-up"></i> Manual Open</button>
            <button className="btn btn-danger" onClick={() => handleManualOverride('CLOSE')}><i className="fa-solid fa-arrow-down"></i> Manual Close</button>
          </div>
        </div>

        {/* Simulator controls card */}
        <div className="glass-panel" style={{ padding: '24px' }}>
          <h3 style={{ marginBottom: '15px' }}><i className="fa-solid fa-vial"></i> Gate Camera Simulator</h3>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '20px' }}>Use these quick triggers to simulate plate reads directly without phone upload.</p>
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
              <label htmlFor="customPlate">Or input a custom plate code:</label>
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

// --- RESIDENT PORTAL ---
function ResidentPortal() {
  const [flatQuery, setFlatQuery] = useState('');
  const [profile, setProfile] = useState(null);
  const [vehicles, setVehicles] = useState([]);
  const [logs, setLogs] = useState([]);

  // Form Fields for Edit / Register
  const [flatNumber, setFlatNumber] = useState('');
  const [familyName, setFamilyName] = useState('');
  const [familyMembers, setFamilyMembers] = useState('');
  const [contact, setContact] = useState('');

  // Form Fields for new vehicle registration
  const [newPlate, setNewPlate] = useState('');
  const [newModel, setNewModel] = useState('');
  const [newColor, setNewColor] = useState('');

  const [registerMode, setRegisterMode] = useState(false);
  const [uploadedFile, setUploadedFile] = useState(null);
  const avatarInputRef = useRef(null);

  // 1. Fetch Resident Details (Login)
  const handleLogin = async (e) => {
    e.preventDefault();
    if (!flatQuery.trim()) return;

    try {
      const res = await fetch(`/api/residents/login?flat=${flatQuery.trim()}`);
      if (res.ok) {
        const data = await res.json();
        setProfile(data);
        setFlatNumber(data.flat_number);
        setFamilyName(data.family_name);
        setFamilyMembers(data.family_members || '');
        setContact(data.contact || '');
        setRegisterMode(false);
        loadVehiclesAndLogs(data.id);
      } else {
        // Flat not found - prompt registration
        alert(`Flat ${flatQuery} is not registered yet. Please register your flat profile using the registration form!`);
        setFlatNumber(flatQuery.trim());
        setProfile(null);
        setRegisterMode(true);
      }
    } catch (err) {
      console.error(err);
      alert('Error logging in. Make sure your server and database are running!');
    }
  };

  // 2. Fetch vehicles and logs
  const loadVehiclesAndLogs = async (residentId) => {
    try {
      const res = await fetch(`/api/residents/vehicles?id=${residentId}`);
      const data = await res.json();
      setVehicles(data.vehicles);
      setLogs(data.logs);
    } catch (err) {
      console.error(err);
    }
  };

  // 3. Register / Save Profile
  const handleSaveProfile = async (e) => {
    e.preventDefault();

    const formData = new FormData();
    formData.append('flat_number', flatNumber.trim());
    formData.append('family_name', familyName.trim());
    formData.append('family_members', familyMembers.trim());
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
        alert(profile ? 'Profile updated successfully!' : 'Flat registered successfully! You are now logged in.');

        // Log in
        const loggedProfile = {
          id: data.id || data._id,
          flat_number: data.flat_number || data.flatNumber,
          family_name: data.family_name || data.familyName,
          family_members: data.family_members || data.familyMembers || '',
          contact: data.contact,
          photo_url: data.photo_url || data.photoUrl || '/static/images/unknown_avatar.svg'
        };
        setProfile(loggedProfile);
        setRegisterMode(false);
        setUploadedFile(null);
        loadVehiclesAndLogs(loggedProfile.id);
      } else {
        alert('Error: ' + data.error);
      }
    } catch (err) {
      alert('Error saving profile: ' + err.message);
    }
  };

  // 4. File input change
  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setUploadedFile(file);
      // Create local URL for preview
      setProfile(prev => ({
        ...prev,
        photo_url: URL.createObjectURL(file)
      }));
    }
  };

  // 5. Register a vehicle
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
        setNewPlate('');
        setNewModel('');
        setNewColor('');
        loadVehiclesAndLogs(profile.id);
        alert('Vehicle registered successfully!');
      } else {
        alert('Error: ' + data.error);
      }
    } catch (err) {
      alert('Error saving vehicle: ' + err.message);
    }
  };

  // 6. Logout
  const handleLogout = () => {
    setProfile(null);
    setFlatQuery('');
    setFlatNumber('');
    setFamilyName('');
    setFamilyMembers('');
    setContact('');
    setVehicles([]);
    setLogs([]);
    setRegisterMode(false);
  };

  return (
    <div>
      <div style={{ marginBottom: '30px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: '2rem', marginBottom: '6px' }}><i className="fa-solid fa-house-user"></i> Resident Control Portal</h1>
          <p style={{ color: 'var(--text-secondary)' }}>Register your flat details, manage vehicles, and view logs.</p>
        </div>
        {profile && (
          <button className="btn btn-secondary" onClick={handleLogout} style={{ flex: '0 0 auto' }}>
            <i className="fa-solid fa-right-from-bracket"></i> Logout
          </button>
        )}
      </div>

      {/* LOGIN / OUT-OF-LOGGED STATE */}
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

      {/* REGISTRATION CARD (New Resident) */}
      {!profile && registerMode && (
        <div className="glass-panel" style={{ padding: '30px', maxWidth: '600px', margin: '20px auto' }}>
          <h2 style={{ fontSize: '1.5rem', marginBottom: '10px', textAlign: 'center' }}><i className="fa-solid fa-user-plus"></i> Flat Profile Registration</h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '20px', textAlign: 'center' }}>
            Enter your flat details and upload a profile photo to activate your gating dashboard.
          </p>
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
              <label htmlFor="familyMems">All Family Member Names (Comma separated)</label>
              <input type="text" id="familyMems" className="text-input" style={{ width: '100%' }} placeholder="e.g. Sai Patel, Aarti Patel, Kiara Patel" value={familyMembers} onChange={(e) => setFamilyMembers(e.target.value)} required />
            </div>

            <div className="form-group">
              <label htmlFor="contactNum">Contact Number</label>
              <input type="text" id="contactNum" className="text-input" style={{ width: '100%' }} placeholder="e.g. +91 99999 88888" value={contact} onChange={(e) => setContact(e.target.value)} required />
            </div>

            <div className="form-group">
              <label>Profile Avatar Photo</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '15px', marginTop: '8px' }}>
                <div style={{ width: '60px', height: '60px', borderRadius: '50%', backgroundColor: 'var(--bg-dark)', border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                  {uploadedFile ? (
                    <img src={URL.createObjectURL(uploadedFile)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="Preview" />
                  ) : (
                    <i className="fa-solid fa-user" style={{ fontSize: '1.5rem', color: 'var(--text-muted)' }}></i>
                  )}
                </div>
                <button type="button" className="btn btn-secondary" onClick={() => avatarInputRef.current.click()} style={{ flex: '0 0 auto' }}>
                  Choose Photo
                </button>
                <input type="file" ref={avatarInputRef} accept="image/*" style={{ display: 'none' }} onChange={handleFileChange} />
              </div>
            </div>

            <div style={{ display: 'flex', gap: '15px', marginTop: '25px' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setRegisterMode(false)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary">
                Register & Login
              </button>
            </div>
          </form>
        </div>
      )}

      {/* LOGGED-IN STATE DASHBOARD */}
      {profile && (
        <div className="resident-layout">
          {/* Left Column: Profile Card */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
            <div className="glass-panel resident-card-profile">
              <div className="profile-avatar-container">
                <img src={profile.photo_url} className="profile-img" alt="Avatar" />
                <label className="file-upload-btn" title="Upload Photo" onClick={() => avatarInputRef.current.click()}>
                  <i className="fa-solid fa-pen"></i>
                </label>
                <input type="file" ref={avatarInputRef} accept="image/*" style={{ display: 'none' }} onChange={handleFileChange} />
              </div>

              <h2 style={{ fontSize: '1.4rem', marginBottom: '4px' }}>{profile.family_name}</h2>
              <p style={{ color: 'var(--color-primary)', fontWeight: 600, fontSize: '0.95rem', marginBottom: '20px' }}>Flat Number: {profile.flat_number}</p>

              <form onSubmit={handleSaveProfile} style={{ borderTop: '1px solid var(--border-color)', paddingTop: '20px' }}>
                <div className="form-group">
                  <label htmlFor="inputName">Family / Owner Name</label>
                  <input type="text" id="inputName" className="text-input" style={{ width: '100%' }} value={familyName} onChange={(e) => setFamilyName(e.target.value)} required />
                </div>
                <div className="form-group">
                  <label htmlFor="inputMembers">Family Members</label>
                  <input type="text" id="inputMembers" className="text-input" style={{ width: '100%' }} value={familyMembers} onChange={(e) => setFamilyMembers(e.target.value)} required />
                </div>
                <div className="form-group">
                  <label htmlFor="inputContact">Contact Number</label>
                  <input type="text" id="inputContact" className="text-input" style={{ width: '100%' }} value={contact} onChange={(e) => setContact(e.target.value)} required />
                </div>
                <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '10px' }}><i className="fa-solid fa-floppy-disk"></i> Save Changes</button>
              </form>
            </div>
          </div>

          {/* Right Column: Vehicle manager & Entry logs */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
            {/* Vehicle List manager */}
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

              {/* Add vehicle form */}
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

            {/* Timelines logs */}
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
                    {logs.length === 0 ? (
                      <tr>
                        <td colSpan="3" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '20px' }}>No entries logged for your vehicles yet.</td>
                      </tr>
                    ) : (
                      logs.map(log => {
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

  // Initialize camera stream
  useEffect(() => {
    if (!useWebcam) return;

    let localStream = null;
    const startCamera = async () => {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        enableFallback('Media API not supported');
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' }
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          localStream = stream;
        }
      } catch (err) {
        console.warn('Back camera failed, falling back to default camera...', err);
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: true });
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            localStream = stream;
          }
        } catch (err2) {
          console.error(err2);
          enableFallback('No camera access available');
        }
      }
    };

    startCamera();

    return () => {
      if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
      }
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
      const res = await fetch('/api/gate-camera/upload', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      const endTime = performance.now();
      const elapsed = ((endTime - startTime) / 1000).toFixed(1);

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
      console.error(err);
      setScanStatus(<span style={{ color: 'var(--color-danger)' }}>Upload failed. Check server.</span>);
    }
  };

  // WebRTC Viewfinder Manual Capture
  const handleCapture = () => {
    if (!useWebcam || !videoRef.current || !canvasRef.current) return;

    if (viewfinderContainerRef.current) {
      viewfinderContainerRef.current.style.opacity = 0.3;
      setTimeout(() => {
        if (viewfinderContainerRef.current) viewfinderContainerRef.current.style.opacity = 1;
      }, 150);
    }

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob((blob) => {
      if (blob) {
        uploadPhoto(blob);
      } else {
        setScanStatus('Error capturing frame.');
      }
    }, 'image/jpeg', 0.85);
  };

  // HTML5 Fallback file capture
  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    uploadPhoto(file);
    e.target.value = ''; // reset
  };

  const addHistoryItem = (plate, isMatch, elapsed) => {
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setHistory(prev => [
      { plate, isMatch, elapsed, time },
      ...prev.slice(0, 4)
    ]);
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
            <p style={{ fontSize: '0.8rem', lineHeight: 1.4 }}>Browsers block live video streams over non-secure HTTP networks. Use the manual capture button below.</p>
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

      {/* Uploads history */}
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

  const addLog = (cls, text) =>
    setLogs(prev => [...prev.slice(-80), { cls, text: `[${new Date().toLocaleTimeString()}] ${text}` }]);

  // Auto-scroll log
  useEffect(() => {
    if (logBoxRef.current) logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight;
  }, [logs]);

  // Poll status
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

  // Poll face DB
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

  // Poll detections
  useEffect(() => {
    const poll = async () => {
      try {
        const r = await fetch('/face/api/detections');
        const d = await r.json();
        setDetections(d.faces || []);
        (d.faces || []).forEach(f => {
          if (f.name !== 'Unknown')
            addLog('face-log-ok', `Verified: ${f.name} (${(f.score * 100).toFixed(1)}% confidence)`);
        });
      } catch (_) { }
    };
    const id = setInterval(poll, 1500);
    return () => clearInterval(id);
  }, []);

  // Register from photo upload
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

  // Register from webcam snapshot
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

  // Delete a registered person
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

      {/* ── LEFT: Live Feed ── */}
      <div className="face-panel">
        <div className="face-panel-title">Live Webcam — Face Detection &amp; Recognition</div>

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

        {/* Detected chips */}
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 8 }}>
            Detected Faces (real-time)
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, minHeight: 32 }}>
            {detections.length === 0
              ? <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>No face in frame</span>
              : detections.map((f, i) => (
                <div key={i} className={`face-chip ${f.name !== 'Unknown' ? 'known' : 'unknown'}`}>
                  {f.name !== 'Unknown' ? '✔' : '?'} {f.name}
                  <span style={{ opacity: .6, fontWeight: 400 }}>{(f.score * 100).toFixed(0)}%</span>
                </div>
              ))
            }
          </div>
        </div>
      </div>

      {/* ── RIGHT: Controls ── */}
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
