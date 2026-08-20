import mongoose from 'mongoose';

const FaceLogSchema = new mongoose.Schema({
  faceKey: {
    type: String,
    required: true,
    // "flatNumber_memberName" or "Unknown"
  },
  name: {
    type: String,
    required: true,
  },
  flatNumber: {
    type: String,
    default: '-',
  },
  phone: {
    type: String,
    default: '-',
  },
  status: {
    type: String,
    enum: ['RECOGNIZED', 'UNKNOWN'],
    required: true,
  },
  photoPath: {
    type: String,
    required: true, // Live captured snapshot path (stored in uploads/face/)
  },
  profilePhotoUrl: {
    type: String,
    default: '/static/images/unknown_avatar.svg',
  },
  score: {
    type: Number,
    default: 0,
  },
  timestamp: {
    type: Date,
    default: Date.now,
  }
});

export default mongoose.model('FaceLog', FaceLogSchema);
