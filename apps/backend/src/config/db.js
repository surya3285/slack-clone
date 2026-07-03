const mongoose = require('mongoose');

async function connectDB() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    throw new Error('MONGO_URI is not set');
  }
  await mongoose.connect(uri);
  console.log('connected to MongoDB');
}

module.exports = connectDB;
