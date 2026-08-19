import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import mongoose from 'mongoose';
import multer from 'multer';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

// Models
import Resident from './models/Resident.js';
import Vehicle from './models/Vehicle.js';
import GateLog from './models/GateLog.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/gate_guard';

// Middleware
app.use(cors());
app.use(express.json());

// Ensure upload folders exist
const uploadDirs = ['uploads/gate', 'uploads/profile', 'static/images'];
uploadDirs.forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Serve static assets
app.use('/static/uploads/gate', express.static(path.join(__dirname, 'uploads/gate')));
app.use('/static/uploads/profile', express.static(path.join(__dirname, 'uploads/profile')));
app.use('/static/images', express.static(path.join(__dirname, 'static/images')));

// Connect to MongoDB
mongoose.connect(MONGO_URI)
  .then(() => console.log('MongoDB Connected!'))
  .catch(err => {
    console.error('MongoDB Connection Error:', err.message);
    console.warn('WARNING: Ensure MongoDB is running locally at mongodb://127.0.0.1:27017/ or provide a MONGO_URI.');
  });

// Setup Multer Storage for file uploads
const storageGate = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/gate/'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `${uuidv4()}${ext}`);
  }
});
const uploadGate = multer({ storage: storageGate });

const storageProfile = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/profile/'),
  filename: (req, file, cb) => cb(null, `profile_${req.query.id}_${uuidv4().substring(0, 8)}.jpg`)
});
const uploadProfile = multer({ storage: storageProfile });

// Helper to generate UUIDs
function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Levenshtein (edit) distance algorithm for fuzzy matching
function getEditDistance(s1, s2) {
  if (s1.length > s2.length) {
    let temp = s1; s1 = s2; s2 = temp;
  }
  let distances = [];
  for (let i = 0; i <= s1.length; i++) distances.push(i);
  for (let i2 = 0; i2 < s2.length; i2++) {
    let distances_ = [i2 + 1];
    for (let i1 = 0; i1 < s1.length; i1++) {
      if (s1[i1] === s2[i2]) {
        distances_.push(distances[i1]);
      } else {
        distances_.push(1 + Math.min(distances[i1], distances[i1 + 1], distances_[distances_.length - 1]));
      }
    }
    distances = distances_;
  }
  return distances[distances.length - 1];
}

// Fuzzy Database Matcher
async function checkRegisteredDbFuzzy(plateText) {
  if (!plateText) return { isMatch: false, info: null, matchedPlate: null };

  const cleanScanned = plateText.toUpperCase().replace(/\s+/g, '');
  const vehicles = await Vehicle.find().populate('resident');

  // 1. Exact Match Pass
  for (let veh of vehicles) {
    const cleanReg = veh.plateNumber.toUpperCase().replace(/\s+/g, '');
    if (cleanReg === cleanScanned) {
      return {
        isMatch: true,
        info: {
          name: veh.resident.familyName,
          flat: veh.resident.flatNumber,
          contact: veh.resident.contact,
          photo_url: veh.resident.photoUrl || '/static/images/unknown_avatar.svg',
          model: veh.makeModel,
          color: veh.color
        },
        matchedPlate: veh.plateNumber
      };
    }
  }

  // 2. Fuzzy Match Pass (edit distance <= 2 for standard plates)
  let bestVeh = null;
  let minDist = 999;

  for (let veh of vehicles) {
    const cleanReg = veh.plateNumber.toUpperCase().replace(/\s+/g, '');
    const dist = getEditDistance(cleanReg, cleanScanned);
    if (dist < minDist) {
      minDist = dist;
      bestVeh = veh;
    }
  }

  const maxAllowed = cleanScanned.length >= 8 ? 2 : 1;
  if (minDist <= maxAllowed && bestVeh) {
    console.log(`[FUZZY] Scanned '${cleanScanned}' resolved to registered '${bestVeh.plateNumber}' (Distance: ${minDist})`);
    return {
      isMatch: true,
      info: {
        name: bestVeh.resident.familyName,
        flat: bestVeh.resident.flatNumber,
        contact: bestVeh.resident.contact,
        photo_url: bestVeh.resident.photoUrl || '/static/images/unknown_avatar.svg',
        model: bestVeh.makeModel,
        color: bestVeh.color
      },
      matchedPlate: bestVeh.plateNumber
    };
  }

  return { isMatch: false, info: null, matchedPlate: null };
}

// WebSocket connection logs
io.on('connection', (socket) => {
  console.log(`Socket client connected: ${socket.id}`);
  
  socket.on('video-stream-frame', (data) => {
    socket.broadcast.emit('video-stream-frame', data);
  });

  socket.on('disconnect', () => {
    console.log(`Socket client disconnected: ${socket.id}`);
  });
});

// Create default assets on startup (avatars, simulated car)
function createDefaultAssets() {
  const avatars = {
    "avatar1.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="#4f46e5"/><circle cx="50" cy="40" r="18" fill="#e0e7ff"/><path d="M22 78c0-12 12-16 28-16s28 4 28 16v4H22v-4z" fill="#e0e7ff"/></svg>`,
    "avatar2.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="#059669"/><circle cx="50" cy="40" r="18" fill="#d1fae5"/><path d="M22 78c0-12 12-16 28-16s28 4 28 16v4H22v-4z" fill="#d1fae5"/></svg>`,
    "avatar3.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="#db2777"/><circle cx="50" cy="40" r="18" fill="#fce7f3"/><path d="M22 78c0-12 12-16 28-16s28 4 28 16v4H22v-4z" fill="#fce7f3"/></svg>`,
    "avatar4.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="#d97706"/><circle cx="50" cy="40" r="18" fill="#fef3c7"/><path d="M22 78c0-12 12-16 28-16s28 4 28 16v4H22v-4z" fill="#fef3c7"/></svg>`,
    "unknown_avatar.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="#4b5563"/><circle cx="50" cy="40" r="18" fill="#f3f4f6"/><path d="M22 78c0-12 12-16 28-16s28 4 28 16v4H22v-4z" fill="#f3f4f6"/><text x="50" y="43" fill="#4b5563" font-size="16" font-family="sans-serif" font-weight="bold" text-anchor="middle">?</text></svg>`,
    "simulated_car.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 120"><rect width="200" height="120" rx="10" fill="#1e293b"/><path d="M30 70 l15-25 h110 l15 25 h15 v20 h-170 v-20 z" fill="#3b82f6"/><path d="M48 65 l11-16 h35 v16 z" fill="#93c5fd"/><path d="M100 49 h40 l11 16 h-51 z" fill="#93c5fd"/><circle cx="60" cy="90" r="18" fill="#0f172a"/><circle cx="60" cy="90" r="8" fill="#64748b"/><circle cx="140" cy="90" r="18" fill="#0f172a"/><circle cx="140" cy="90" r="8" fill="#64748b"/><rect x="80" y="80" width="40" height="12" rx="2" fill="#eab308"/><text x="100" y="89" fill="#0f172a" font-size="7" font-family="monospace" font-weight="bold" text-anchor="middle">SIMULATED</text></svg>`
  };
  Object.entries(avatars).forEach(([filename, content]) => {
    const dest = path.join('static/images', filename);
    if (!fs.existsSync(dest)) {
      fs.writeFileSync(dest, content);
    }
  });
}
createDefaultAssets();

// --- REST API Endpoints ---

// 1. Get all residents
app.get('/api/residents/list', async (req, res) => {
  try {
    const list = await Resident.find({}, 'id flatNumber familyName');
    res.json(list.map(r => ({ id: r._id, flat_number: r.flatNumber, family_name: r.familyName })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Get/Save resident profile details
app.get('/api/residents/login', async (req, res) => {
  try {
    const { flat } = req.query;
    if (!flat) return res.status(400).json({ error: 'Flat number is required' });
    
    const resident = await Resident.findOne({ flatNumber: flat.trim() });
    if (!resident) return res.status(404).json({ error: 'Flat profile not found' });
    
    res.json({
      id: resident._id,
      flat_number: resident.flatNumber,
      family_name: resident.familyName,
      family_members: resident.familyMembers || '',
      contact: resident.contact,
      photo_url: resident.photoUrl || '/static/images/unknown_avatar.svg'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/residents/profile', async (req, res) => {
  try {
    const resident = await Resident.findById(req.query.id);
    if (!resident) return res.status(404).json({ error: 'Resident not found' });
    res.json({
      id: resident._id,
      flat_number: resident.flatNumber,
      family_name: resident.familyName,
      family_members: resident.familyMembers || '',
      contact: resident.contact,
      photo_url: resident.photoUrl || '/static/images/unknown_avatar.svg'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/residents/profile', uploadProfile.single('photo'), async (req, res) => {
  try {
    const residentId = req.query.id;
    const { family_name, contact, flat_number, family_members } = req.body;
    
    let photoUrl = undefined;
    if (req.file) {
      photoUrl = `/static/uploads/profile/${req.file.filename}`;
    }

    if (residentId && residentId !== 'null' && residentId !== 'undefined') {
      // Update existing
      let updateFields = { familyName: family_name, contact, familyMembers: family_members };
      if (photoUrl) updateFields.photoUrl = photoUrl;
      const updated = await Resident.findByIdAndUpdate(residentId, updateFields, { new: true });
      return res.json(updated);
    } else {
      // Create new
      if (!flat_number) return res.status(400).json({ error: 'Flat number is required for new registration' });
      
      const existing = await Resident.findOne({ flatNumber: flat_number.trim() });
      if (existing) {
        return res.status(400).json({ error: `Flat ${flat_number} is already registered!` });
      }

      const newResident = new Resident({
        flatNumber: flat_number.trim(),
        familyName: family_name,
        contact,
        familyMembers: family_members,
        photoUrl: photoUrl || '/static/images/unknown_avatar.svg'
      });
      await newResident.save();
      return res.json({
        id: newResident._id,
        flat_number: newResident.flatNumber,
        family_name: newResident.familyName,
        family_members: newResident.familyMembers || '',
        contact: newResident.contact,
        photo_url: newResident.photoUrl
      });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Get/Add resident vehicles and logs
app.get('/api/residents/vehicles', async (req, res) => {
  try {
    const residentId = req.query.id;
    const vehicles = await Vehicle.find({ resident: residentId });
    
    // Get logs matching the resident's vehicles
    const plates = vehicles.map(v => v.plateNumber);
    const logs = await GateLog.find({ plateNumber: { $in: plates } }).sort({ timestamp: -1 });

    res.json({
      vehicles: vehicles.map(v => ({ plate_number: v.plateNumber, make_model: v.makeModel, color: v.color })),
      logs: logs.map(l => ({ id: l._id, plate_number: l.plateNumber, status: l.status, timestamp: l.timestamp }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/residents/vehicles', async (req, res) => {
  try {
    const residentId = req.query.id;
    const { plate_number, make_model, color } = req.body;
    const cleanPlate = plate_number.toUpperCase().replace(/\s+/g, '');

    const existing = await Vehicle.findOne({ plateNumber: cleanPlate });
    if (existing) {
      return res.status(400).json({ error: `Vehicle with plate ${cleanPlate} is already registered!` });
    }

    const newVeh = new Vehicle({
      plateNumber: cleanPlate,
      resident: residentId,
      makeModel: make_model,
      color
    });
    await newVeh.save();
    res.json(newVeh);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Gate Logs history
app.get('/api/logs', async (req, res) => {
  try {
    const logs = await GateLog.find().sort({ timestamp: -1 }).limit(20);
    res.json(logs.map(l => ({
      id: l._id,
      plate_number: l.plateNumber,
      status: l.status,
      timestamp: l.timestamp,
      resident_name: l.residentName || 'Unknown Visitor',
      flat_number: l.flatNumber || '-',
      photo_path: l.photoPath || '/static/images/simulated_car.svg'
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/logs/clear', async (req, res) => {
  try {
    await GateLog.deleteMany({});
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Gate Camera snapshot upload (Node spawns Python EasyOCR process)
app.post('/api/gate-camera/upload', uploadGate.single('photo'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'No photo uploaded' });
  }

  const filePath = path.join(__dirname, req.file.path);
  const webPath = `/static/uploads/gate/${req.file.filename}`;

  console.log(`[CAMERA] Spawning Python OCR for file: ${filePath}`);
  
  // Spawn python child process to run anpr_cli.py
  const pythonProcess = spawn('python', ['anpr_cli.py', filePath], {
    env: { ...process.env, OMP_NUM_THREADS: '1', MKL_NUM_THREADS: '1' }
  });

  let stdoutData = '';
  let stderrData = '';

  pythonProcess.stdout.on('data', (data) => {
    stdoutData += data.toString();
  });

  pythonProcess.stderr.on('data', (data) => {
    stderrData += data.toString();
  });

  pythonProcess.on('close', async (code) => {
    if (code !== 0) {
      console.error(`ANPR CLI process exited with code ${code}. Error:`, stderrData);
      return res.status(500).json({ success: false, error: 'OCR processing failure' });
    }

    try {
      const jsonMatch = stdoutData.match(/\{.*\}/);
      if (!jsonMatch) {
        throw new Error("Could not find valid JSON object in ANPR CLI output. Raw output was: " + stdoutData);
      }
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.error) {
        return res.status(500).json({ success: false, error: parsed.error });
      }

      const scannedPlate = parsed.plate || 'UNKNOWN';
      console.log(`[OCR] Extracted plate: '${scannedPlate}'`);

      // If a JPG frame was extracted from a video upload, update the webPath
      let resolvedWebPath = webPath;
      if (fs.existsSync(filePath + '.jpg')) {
        resolvedWebPath = `${webPath}.jpg`;
        console.log(`[VIDEO] Using extracted frame for layout: ${resolvedWebPath}`);
      }

      // Run Mongoose Lookup (Exact and Fuzzy matching)
      const { isMatch, info, matchedPlate } = await checkRegisteredDbFuzzy(scannedPlate);
      const status = isMatch ? 'GRANTED' : 'DENIED';
      const resolvedPlate = isMatch ? matchedPlate : scannedPlate;

      // Log transaction to MongoDB
      const log = new GateLog({
        plateNumber: resolvedPlate,
        status,
        residentName: isMatch ? info.name : null,
        flatNumber: isMatch ? info.flat : null,
        photoPath: resolvedWebPath
      });
      await log.save();

      // Broadcast payload to react dashboard via Socket.io
      const socketPayload = {
        plate: resolvedPlate,
        status,
        name: isMatch ? info.name : 'Unknown Visitor',
        flat: isMatch ? info.flat : '-',
        contact: isMatch ? info.contact : '-',
        photo_url: isMatch ? info.photo_url : '/static/images/unknown_avatar.svg',
        model: isMatch ? info.model : '-',
        color: isMatch ? info.color : '-',
        photo_path: resolvedWebPath
      };
      
      io.emit('new-scan', socketPayload);
      console.log(`[SOCKET] Emitted new-scan event for: ${resolvedPlate}`);

      res.json({
        success: true,
        status: isMatch ? 'match' : 'no_match',
        plate: resolvedPlate
      });

    } catch (err) {
      console.error('Error handling ANPR callback:', err);
      res.status(500).json({ success: false, error: 'Database logging error' });
    }
  });
});

// 6. Manual Entry Simulation Endpoint
app.post('/api/simulate', async (req, res) => {
  try {
    const { plate_number } = req.body;
    if (!plate_number) return res.status(400).json({ success: false, error: 'No plate number provided' });

    const cleanPlate = plate_number.toUpperCase().replace(/\s+/g, '');
    
    // Fuzzy matching database query
    const { isMatch, info, matchedPlate } = await checkRegisteredDbFuzzy(cleanPlate);
    const status = isMatch ? 'GRANTED' : 'DENIED';
    const resolvedPlate = isMatch ? matchedPlate : cleanPlate;
    const dummyPhoto = '/static/images/simulated_car.svg';

    // Log to MongoDB
    const log = new GateLog({
      plateNumber: resolvedPlate,
      status,
      residentName: isMatch ? info.name : null,
      flatNumber: isMatch ? info.flat : null,
      photoPath: dummyPhoto
    });
    await log.save();

    // Broadcast to Guard via Socket.io
    const socketPayload = {
      plate: resolvedPlate,
      status,
      name: isMatch ? info.name : 'Unknown Visitor',
      flat: isMatch ? info.flat : '-',
      contact: isMatch ? info.contact : '-',
      photo_url: isMatch ? info.photo_url : '/static/images/unknown_avatar.svg',
      model: isMatch ? info.model : '-',
      color: isMatch ? info.color : '-',
      photo_path: dummyPhoto
    };
    
    io.emit('new-scan', socketPayload);
    console.log(`[SIMULATE] Emitted new-scan event for: ${resolvedPlate}`);

    res.json({
      success: true,
      status: isMatch ? 'match' : 'no_match',
      plate: resolvedPlate
    });

  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// For Production: serve static frontend files if built
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, 'dist')));
  app.get('*', (req, res) => {
    res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
  });
}

// Start Node Web server
server.listen(PORT, () => {
  console.log(`Node Express Server running on: http://localhost:${PORT}`);
});
