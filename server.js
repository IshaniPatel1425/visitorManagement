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
import FaceLog from './models/FaceLog.js';

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
const FACE_SERVER_URL = process.env.FACE_SERVER_URL || 'http://localhost:5001';

// Middleware
app.use(cors());
app.use(express.json());

// Ensure upload folders exist
const uploadDirs = ['uploads/gate', 'uploads/profile', 'uploads/face', 'static/images'];
uploadDirs.forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Serve static assets
app.use('/static/uploads/gate', express.static(path.join(__dirname, 'uploads/gate')));
app.use('/static/uploads/profile', express.static(path.join(__dirname, 'uploads/profile')));
app.use('/static/uploads/face', express.static(path.join(__dirname, 'uploads/face')));
app.use('/static/images', express.static(path.join(__dirname, 'static/images')));

// Connect to MongoDB
mongoose.connect(MONGO_URI)
  .then(() => console.log('MongoDB Connected!'))
  .catch(err => {
    console.error('MongoDB Connection Error:', err.message);
    console.warn('WARNING: Ensure MongoDB is running locally at mongodb://127.0.0.1:27017/ or provide a MONGO_URI.');
  });

// ─── Multer Storage Configs ───────────────────────────────────────────────────
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
  filename: (req, file, cb) => {
    const id = req.query.id || 'new';
    cb(null, `profile_${id}_${uuidv4().substring(0, 8)}.jpg`);
  }
});
const uploadProfile = multer({ storage: storageProfile });

// Storage for individual family member photos
const storageMember = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/profile/'),
  filename: (req, file, cb) => {
    const safeName = (req.body.name || 'member').replace(/[^a-zA-Z0-9]/g, '_');
    cb(null, `member_${safeName}_${uuidv4().substring(0, 8)}.jpg`);
  }
});
const uploadMember = multer({ storage: storageMember });

// Storage for face event snapshots from Python face server
const storageFaceEvent = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/face/'),
  filename: (req, file, cb) => cb(null, `face_event_${Date.now()}.jpg`)
});
const uploadFaceEvent = multer({ storage: storageFaceEvent });

// ─── Helpers ─────────────────────────────────────────────────────────────────
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

/**
 * Register or update a face embedding in the Python face server.
 * @param {string} faceKey - Unique key like "506_Sai Patel"
 * @param {string} photoPath - Absolute path to the photo on disk
 * @returns {{ success: boolean, message: string }}
 */
async function registerFaceInPythonServer(faceKey, photoPath) {
  try {
    const { default: FormDataNode } = await import('form-data');
    const fetch = (await import('node-fetch')).default;

    const form = new FormDataNode();
    form.append('name', faceKey);
    form.append('photo', fs.createReadStream(photoPath));

    const response = await fetch(`${FACE_SERVER_URL}/register_photo`, {
      method: 'POST',
      body: form,
      headers: form.getHeaders(),
    });
    const result = await response.json();
    return result;
  } catch (err) {
    console.error('[FACE REG] Error registering face:', err.message);
    return { success: false, message: err.message };
  }
}

/**
 * Delete a face embedding from the Python face server.
 */
async function deleteFaceFromPythonServer(faceKey) {
  try {
    const fetch = (await import('node-fetch')).default;
    const response = await fetch(`${FACE_SERVER_URL}/delete_face/${encodeURIComponent(faceKey)}`, {
      method: 'DELETE',
    });
    const result = await response.json();
    return result;
  } catch (err) {
    console.error('[FACE DEL] Error deleting face:', err.message);
    return { success: false, message: err.message };
  }
}

// ─── WebSocket ────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`Socket client connected: ${socket.id}`);
  
  socket.on('video-stream-frame', (data) => {
    socket.broadcast.emit('video-stream-frame', data);
  });

  socket.on('disconnect', () => {
    console.log(`Socket client disconnected: ${socket.id}`);
  });
});

// ─── Default Assets ───────────────────────────────────────────────────────────
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

// ─── REST API Endpoints ───────────────────────────────────────────────────────

// 1. Get all residents
app.get('/api/residents/list', async (req, res) => {
  try {
    const list = await Resident.find({}, 'id flatNumber familyName');
    res.json(list.map(r => ({ id: r._id, flat_number: r.flatNumber, family_name: r.familyName })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Resident Login (by flat number)
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
      contact: resident.contact,
      photo_url: resident.photoUrl || '/static/images/unknown_avatar.svg',
      head_face_registered: resident.headFaceRegistered || false,
      family_members: resident.familyMembers || []
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Get Resident Profile (by ID)
app.get('/api/residents/profile', async (req, res) => {
  try {
    const resident = await Resident.findById(req.query.id);
    if (!resident) return res.status(404).json({ error: 'Resident not found' });
    res.json({
      id: resident._id,
      flat_number: resident.flatNumber,
      family_name: resident.familyName,
      contact: resident.contact,
      photo_url: resident.photoUrl || '/static/images/unknown_avatar.svg',
      head_face_registered: resident.headFaceRegistered || false,
      family_members: resident.familyMembers || []
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3b. Get Resident by Face Key (for Face Recognition Tab live details)
app.get('/api/residents/by-face-key', async (req, res) => {
  try {
    const { key } = req.query;
    if (!key || key === 'Unknown') return res.status(404).json({ error: 'Unknown face' });
    
    let flatNumber = '';
    let memberName = '';
    const underscoreIdx = key.indexOf('_');
    if (underscoreIdx !== -1) {
      flatNumber = key.substring(0, underscoreIdx);
      memberName = key.substring(underscoreIdx + 1);
    } else {
      memberName = key;
    }

    let resident = null;
    if (flatNumber) {
      resident = await Resident.findOne({ flatNumber });
    }
    if (!resident) {
      resident = await Resident.findOne({
        $or: [
          { familyName: new RegExp(`^${memberName}$`, 'i') },
          { 'familyMembers.name': new RegExp(`^${memberName}$`, 'i') }
        ]
      });
    }

    if (!resident) return res.status(404).json({ error: 'Resident not found for this face' });

    let phone = resident.contact || '-';
    let profilePhotoUrl = resident.photoUrl || '/static/images/unknown_avatar.svg';

    if (resident.familyName.toLowerCase() !== memberName.toLowerCase()) {
      const member = resident.familyMembers.find(m => m.name.toLowerCase() === memberName.toLowerCase());
      if (member) {
        phone = member.phone || '-';
        profilePhotoUrl = member.photoUrl || '/static/images/unknown_avatar.svg';
      }
    }

    res.json({
      name: memberName,
      flat: resident.flatNumber,
      phone: phone,
      profile_photo_url: profilePhotoUrl,
      flat_profile: {
        flat_number: resident.flatNumber,
        family_head: {
          name: resident.familyName,
          contact: resident.contact || '-',
          photo_url: resident.photoUrl || '/static/images/unknown_avatar.svg',
          face_registered: resident.headFaceRegistered || false
        },
        other_members: (resident.familyMembers || []).map(m => ({
          id: m._id,
          name: m.name,
          phone: m.phone,
          photo_url: m.photoUrl || '/static/images/unknown_avatar.svg'
        }))
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Save/Register Resident Profile (with optional photo upload)
app.post('/api/residents/profile', uploadProfile.single('photo'), async (req, res) => {
  try {
    const residentId = req.query.id;
    const { family_name, contact, flat_number } = req.body;
    
    let photoUrl = undefined;
    let photoAbsPath = undefined;
    if (req.file) {
      photoUrl = `/static/uploads/profile/${req.file.filename}`;
      photoAbsPath = path.join(__dirname, req.file.path);
    }

    if (residentId && residentId !== 'null' && residentId !== 'undefined') {
      // --- UPDATE EXISTING RESIDENT ---
      const existing = await Resident.findById(residentId);
      if (!existing) return res.status(404).json({ error: 'Resident not found' });

      let updateFields = { familyName: family_name, contact };
      if (photoUrl) updateFields.photoUrl = photoUrl;

      // If a new photo was uploaded, register face in Python server
      if (photoAbsPath) {
        const faceKey = `${existing.flatNumber}_${family_name.trim()}`;
        const faceResult = await registerFaceInPythonServer(faceKey, photoAbsPath);
        if (faceResult.success) {
          updateFields.headFaceKey = faceKey;
          updateFields.headFaceRegistered = true;
          console.log(`[FACE] Registered head face for ${faceKey}`);
        } else {
          console.warn(`[FACE] Could not register head face: ${faceResult.message}`);
          // Don't block save if face registration fails (e.g. no face in image)
        }
      }

      const updated = await Resident.findByIdAndUpdate(residentId, updateFields, { new: true });
      return res.json({
        id: updated._id,
        flat_number: updated.flatNumber,
        family_name: updated.familyName,
        contact: updated.contact,
        photo_url: updated.photoUrl || '/static/images/unknown_avatar.svg',
        head_face_registered: updated.headFaceRegistered || false,
        family_members: updated.familyMembers || []
      });
    } else {
      // --- CREATE NEW RESIDENT ---
      if (!flat_number) return res.status(400).json({ error: 'Flat number is required for new registration' });
      
      const existing = await Resident.findOne({ flatNumber: flat_number.trim() });
      if (existing) {
        return res.status(400).json({ error: `Flat ${flat_number} is already registered!` });
      }

      const newResident = new Resident({
        flatNumber: flat_number.trim(),
        familyName: family_name,
        contact,
        photoUrl: photoUrl || '/static/images/unknown_avatar.svg',
        headFaceRegistered: false,
        familyMembers: []
      });
      await newResident.save();

      // Register face if photo was uploaded
      if (photoAbsPath) {
        const faceKey = `${flat_number.trim()}_${family_name.trim()}`;
        const faceResult = await registerFaceInPythonServer(faceKey, photoAbsPath);
        if (faceResult.success) {
          await Resident.findByIdAndUpdate(newResident._id, {
            headFaceKey: faceKey,
            headFaceRegistered: true
          });
          newResident.headFaceRegistered = true;
          console.log(`[FACE] Registered head face for new resident ${faceKey}`);
        }
      }

      return res.json({
        id: newResident._id,
        flat_number: newResident.flatNumber,
        family_name: newResident.familyName,
        contact: newResident.contact,
        photo_url: newResident.photoUrl,
        head_face_registered: newResident.headFaceRegistered,
        family_members: []
      });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Detect Face Only (validate that a photo contains a face)
app.post('/api/residents/detect-face', uploadProfile.single('photo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: 'No photo uploaded' });
  const photoAbsPath = path.join(__dirname, req.file.path);

  try {
    const { default: FormDataNode } = await import('form-data');
    const fetch = (await import('node-fetch')).default;

    const form = new FormDataNode();
    form.append('photo', fs.createReadStream(photoAbsPath));

    const response = await fetch(`${FACE_SERVER_URL}/detect_face_only`, {
      method: 'POST',
      body: form,
      headers: form.getHeaders(),
    });
    const result = await response.json();

    if (!result.success) {
      // Clean up uploaded file if no face detected
      fs.unlinkSync(photoAbsPath);
      return res.json({ success: false, message: result.message || 'No face detected' });
    }

    res.json({
      success: true,
      faces_count: result.faces_count,
      photo_url: `/static/uploads/profile/${req.file.filename}`,
      photo_path: photoAbsPath
    });
  } catch (err) {
    // If Python server is down, be permissive
    console.warn('[DETECT] Python face server error, allowing upload:', err.message);
    res.json({
      success: true,
      faces_count: 1,
      photo_url: `/static/uploads/profile/${req.file.filename}`,
      photo_path: photoAbsPath
    });
  }
});

// 6. Add a Family Member (upload photo + register face)
app.post('/api/residents/member', uploadMember.single('photo'), async (req, res) => {
  try {
    const { id: residentId } = req.query;
    const { name, phone } = req.body;

    if (!residentId) return res.status(400).json({ error: 'Resident ID required' });
    if (!name || !phone) return res.status(400).json({ error: 'Name and phone are required' });
    if (!req.file) return res.status(400).json({ error: 'Member photo is required' });

    const resident = await Resident.findById(residentId);
    if (!resident) return res.status(404).json({ error: 'Resident not found' });

    // Check for duplicate name in this flat
    const dupMember = resident.familyMembers.find(
      m => m.name.toLowerCase() === name.trim().toLowerCase()
    );
    if (dupMember) {
      return res.status(400).json({ error: `A member named "${name}" is already registered in this flat.` });
    }

    const photoUrl = `/static/uploads/profile/${req.file.filename}`;
    const photoAbsPath = path.join(__dirname, req.file.path);
    const faceKey = `${resident.flatNumber}_${name.trim()}`;

    // Register face in Python server
    const faceResult = await registerFaceInPythonServer(faceKey, photoAbsPath);
    if (!faceResult.success) {
      // Clean up uploaded file
      try { fs.unlinkSync(photoAbsPath); } catch {}
      return res.status(400).json({
        error: `Face registration failed: ${faceResult.message}. Please ensure the photo shows a clear, well-lit face.`
      });
    }

    // Add member to resident's familyMembers array
    resident.familyMembers.push({
      name: name.trim(),
      phone: phone.trim(),
      photoUrl,
      faceKey
    });
    await resident.save();

    console.log(`[MEMBER] Added family member ${faceKey} to flat ${resident.flatNumber}`);
    res.json({
      success: true,
      member: resident.familyMembers[resident.familyMembers.length - 1],
      message: `${name} registered successfully with face recognition.`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. Delete a Family Member
app.delete('/api/residents/member/:memberId', async (req, res) => {
  try {
    const { id: residentId } = req.query;
    const { memberId } = req.params;

    if (!residentId) return res.status(400).json({ error: 'Resident ID required' });

    const resident = await Resident.findById(residentId);
    if (!resident) return res.status(404).json({ error: 'Resident not found' });

    const member = resident.familyMembers.id(memberId);
    if (!member) return res.status(404).json({ error: 'Member not found' });

    const faceKey = member.faceKey;
    const memberName = member.name;

    // Remove from MongoDB
    resident.familyMembers.pull({ _id: memberId });
    await resident.save();

    // Delete face from Python server
    await deleteFaceFromPythonServer(faceKey);

    console.log(`[MEMBER] Removed family member ${faceKey} from flat ${resident.flatNumber}`);
    res.json({ success: true, message: `${memberName} removed successfully.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 8. Get/Add resident vehicles and logs
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

// 9. Gate Logs history (ANPR)
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

// 10. Face Verification Logs
app.get('/api/face-logs', async (req, res) => {
  try {
    const logs = await FaceLog.find().sort({ timestamp: -1 }).limit(30);
    res.json(logs.map(l => ({
      id: l._id,
      name: l.name,
      flat_number: l.flatNumber,
      phone: l.phone,
      status: l.status,
      photo_path: l.photoPath,
      profile_photo_url: l.profilePhotoUrl,
      score: l.score,
      timestamp: l.timestamp
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/face-logs/clear', async (req, res) => {
  try {
    await FaceLog.deleteMany({});
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 11. Face Event Webhook (called by Python face_server.py when a face is detected)
app.post('/api/face-event', uploadFaceEvent.single('photo'), async (req, res) => {
  try {
    const { matched_key, score } = req.body;
    const photoPath = req.file ? `/static/uploads/face/${req.file.filename}` : '/static/images/unknown_avatar.svg';
    const scoreNum = parseFloat(score) || 0;

    if (!matched_key || matched_key === 'Unknown') {
      // ── STRANGER ALERT ──
      const faceLog = new FaceLog({
        faceKey: 'Unknown',
        name: 'Unknown Person',
        flatNumber: '-',
        phone: '-',
        status: 'UNKNOWN',
        photoPath,
        profilePhotoUrl: '/static/images/unknown_avatar.svg',
        score: scoreNum
      });
      await faceLog.save();

      const socketPayload = {
        status: 'UNKNOWN',
        name: 'Unknown Person',
        flat: '-',
        phone: '-',
        profile_photo_url: '/static/images/unknown_avatar.svg',
        live_photo_url: photoPath,
        score: scoreNum,
        log_id: faceLog._id
      };
      io.emit('new-face-scan', socketPayload);
      console.log(`[FACE EVENT] STRANGER ALERT emitted`);
      return res.json({ success: true, status: 'stranger_alert' });
    }

    // ── RECOGNIZED RESIDENT ──
    // matched_key format: "flatNumber_memberName"  e.g. "506_Sai Patel"
    const underscoreIdx = matched_key.indexOf('_');
    if (underscoreIdx === -1) {
      return res.status(400).json({ error: 'Invalid matched_key format. Expected: flatNumber_memberName' });
    }
    const flatNumber = matched_key.substring(0, underscoreIdx);
    const memberName = matched_key.substring(underscoreIdx + 1);

    // Find the full resident profile (including all members and vehicles)
    const resident = await Resident.findOne({ flatNumber });

    let phone = '-';
    let profilePhotoUrl = '/static/images/unknown_avatar.svg';
    let resolvedName = memberName;
    let isHead = false;

    if (resident) {
      // Check if it's the family head
      if (resident.familyName.toLowerCase() === memberName.toLowerCase()) {
        phone = resident.contact || '-';
        profilePhotoUrl = resident.photoUrl || '/static/images/unknown_avatar.svg';
        isHead = true;
      } else {
        // Check family members array
        const member = resident.familyMembers.find(
          m => m.name.toLowerCase() === memberName.toLowerCase()
        );
        if (member) {
          phone = member.phone || '-';
          profilePhotoUrl = member.photoUrl || '/static/images/unknown_avatar.svg';
        }
      }
    }

    // Build the full flat profile to send to the guard
    const flatProfile = resident ? {
      flat_number: resident.flatNumber,
      family_head: {
        name: resident.familyName,
        contact: resident.contact || '-',
        photo_url: resident.photoUrl || '/static/images/unknown_avatar.svg',
        face_registered: resident.headFaceRegistered || false
      },
      other_members: resident.familyMembers.map(m => ({
        id: m._id,
        name: m.name,
        phone: m.phone,
        photo_url: m.photoUrl || '/static/images/unknown_avatar.svg'
      }))
    } : null;

    const faceLog = new FaceLog({
      faceKey: matched_key,
      name: resolvedName,
      flatNumber,
      phone,
      status: 'RECOGNIZED',
      photoPath,
      profilePhotoUrl,
      score: scoreNum
    });
    await faceLog.save();

    const socketPayload = {
      status: 'RECOGNIZED',
      name: resolvedName,
      flat: flatNumber,
      phone,
      profile_photo_url: profilePhotoUrl,
      live_photo_url: photoPath,
      score: scoreNum,
      log_id: faceLog._id,
      // Full flat data for guard display
      flat_profile: flatProfile
    };
    io.emit('new-face-scan', socketPayload);
    console.log(`[FACE EVENT] Recognized: ${matched_key} (score: ${scoreNum.toFixed(3)})`);
    return res.json({ success: true, status: 'recognized' });

  } catch (err) {
    console.error('[FACE EVENT] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 12. Gate Camera snapshot upload (Node spawns Python EasyOCR process)
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

      const { isMatch, info, matchedPlate } = await checkRegisteredDbFuzzy(scannedPlate);
      const status = isMatch ? 'GRANTED' : 'DENIED';
      const resolvedPlate = isMatch ? matchedPlate : scannedPlate;

      const log = new GateLog({
        plateNumber: resolvedPlate,
        status,
        residentName: isMatch ? info.name : null,
        flatNumber: isMatch ? info.flat : null,
        photoPath: resolvedWebPath
      });
      await log.save();

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

// 13. Manual Entry Simulation Endpoint
app.post('/api/simulate', async (req, res) => {
  try {
    const { plate_number } = req.body;
    if (!plate_number) return res.status(400).json({ success: false, error: 'No plate number provided' });

    const cleanPlate = plate_number.toUpperCase().replace(/\s+/g, '');
    
    const { isMatch, info, matchedPlate } = await checkRegisteredDbFuzzy(cleanPlate);
    const status = isMatch ? 'GRANTED' : 'DENIED';
    const resolvedPlate = isMatch ? matchedPlate : cleanPlate;
    const dummyPhoto = '/static/images/simulated_car.svg';

    const log = new GateLog({
      plateNumber: resolvedPlate,
      status,
      residentName: isMatch ? info.name : null,
      flatNumber: isMatch ? info.flat : null,
      photoPath: dummyPhoto
    });
    await log.save();

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
