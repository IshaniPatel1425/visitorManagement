import mongoose from 'mongoose';

const VehicleSchema = new mongoose.Schema({
  plateNumber: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    trim: true,
  },
  resident: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Resident',
    required: true,
  },
  makeModel: {
    type: String,
  },
  color: {
    type: String,
  }
});

export default mongoose.model('Vehicle', VehicleSchema);
