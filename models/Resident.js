import mongoose from 'mongoose';

const FamilyMemberSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  phone: {
    type: String,
    required: true,
    trim: true,
  },
  photoUrl: {
    type: String,
    required: true,
  },
  faceKey: {
    type: String,
    required: true, // Format: "flatNumber_memberName" e.g. "506_Sai Patel"
  }
}, { _id: true });

const ResidentSchema = new mongoose.Schema({
  flatNumber: {
    type: String,
    required: true,
    unique: true, // Each flat has one primary profile
    trim: true,
  },
  familyName: {
    type: String,
    required: true,
    trim: true,
  },
  contact: {
    type: String,
    trim: true,
  },
  photoUrl: {
    type: String,
  },
  // faceKey for the family head (flatNumber_familyName)
  headFaceKey: {
    type: String,
  },
  // Whether the family head's face has been registered in the Python server
  headFaceRegistered: {
    type: Boolean,
    default: false,
  },
  // Array of structured family members with face data
  familyMembers: [FamilyMemberSchema],
}, {
  timestamps: true,
});

export default mongoose.model('Resident', ResidentSchema);
