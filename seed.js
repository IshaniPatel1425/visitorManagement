import mongoose from 'mongoose';
import Resident from './models/Resident.js';
import Vehicle from './models/Vehicle.js';
import GateLog from './models/GateLog.js';
import dotenv from 'dotenv';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/gate_guard';

async function seedDatabase() {
  console.log(`Connecting to MongoDB at: ${MONGO_URI}`);
  try {
    await mongoose.connect(MONGO_URI);
    console.log('MongoDB connected successfully!');

    // Clear existing data
    await Resident.deleteMany({});
    await Vehicle.deleteMany({});
    await GateLog.deleteMany({});
    console.log('Cleared existing collections.');

    // Seed Residents
    const residentsData = [
      { flatNumber: '420', familyName: 'Ishani Patel', contact: '+91 98765 43210', photoUrl: '/static/images/avatar1.svg' },
      { flatNumber: '420', familyName: 'Hema Patel', contact: '+91 98765 43211', photoUrl: '/static/images/avatar2.svg' },
      { flatNumber: '118', familyName: 'Tanvi Sharma', contact: '+91 98765 43212', photoUrl: '/static/images/avatar3.svg' },
      { flatNumber: '119', familyName: 'Amit Sharma', contact: '+91 98765 43213', photoUrl: '/static/images/avatar4.svg' },
      { flatNumber: '506', familyName: 'Sai Patel', contact: '+91 99999 88888', photoUrl: '/static/images/avatar1.svg' }
    ];

    const seededResidents = await Resident.insertMany(residentsData);
    console.log(`Seeded ${seededResidents.length} residents.`);

    // Seed Vehicles
    const vehiclesData = [
      { plateNumber: 'MH12AB1234', resident: seededResidents[0]._id, makeModel: 'Honda City', color: 'White' },
      { plateNumber: 'MH14CD5678', resident: seededResidents[1]._id, makeModel: 'Hyundai i20', color: 'Silver' },
      { plateNumber: 'GJ01EF9012', resident: seededResidents[2]._id, makeModel: 'Maruti Swift', color: 'Red' },
      { plateNumber: 'HR98AA0000', resident: seededResidents[4]._id, makeModel: 'Fortuner', color: 'Black' }
    ];

    const seededVehicles = await Vehicle.insertMany(vehiclesData);
    console.log(`Seeded ${seededVehicles.length} vehicles.`);

    console.log('Database seeding complete!');
    process.exit(0);
  } catch (error) {
    console.error('Error seeding database:', error);
    process.exit(1);
  }
}

seedDatabase();
