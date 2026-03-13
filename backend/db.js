/**
 * db.js - MongoDB Atlas Connection
 * Connects to MongoDB Atlas and initializes models
 */

const mongoose = require('mongoose');

const connectDB = async () => {
    try {
        const mongoURI = process.env.MONGODB_URI;
        
        if (!mongoURI) {
            throw new Error('MONGODB_URI is not defined in environment variables');
        }

        await mongoose.connect(mongoURI);

        console.log('MongoDB Atlas connected successfully');
        return mongoose.connection;
    } catch (error) {
        console.error('MongoDB Connection Error:', error.message);
        process.exit(1);
    }
};

module.exports = connectDB;
