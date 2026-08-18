import mongoose from 'mongoose';

const ResidentSchema = new mongoose.Schema({
  flatNumber: {
    type: String,
    required: true,
    unique: true, // Each flat has one primary profile
  },
  familyName: {
    type: String,
    required: true,
  },
  familyMembers: {
    type: String, // Comma-separated names of family members
  },
  contact: {
    type: String,
  },
  photoUrl: {
    type: String,
  }
});

export default mongoose.model('Resident', ResidentSchema);
