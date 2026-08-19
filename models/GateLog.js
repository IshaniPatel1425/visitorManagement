import mongoose from 'mongoose';

const GateLogSchema = new mongoose.Schema({
  plateNumber: {
    type: String,
    required: true,
    uppercase: true,
  },
  status: {
    type: String,
    enum: ['GRANTED', 'DENIED'],
    required: true,
  },
  residentName: {
    type: String,
  },
  flatNumber: {
    type: String,
  },
  photoPath: {
    type: String,
  },
  timestamp: {
    type: Date,
    default: Date.now,
  }
});

export default mongoose.model('GateLog', GateLogSchema);
