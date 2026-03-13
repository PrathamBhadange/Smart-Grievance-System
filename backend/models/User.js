const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    fullName: {
        type: String,
        required: true,
        trim: true
    },
    firstName: {
        type: String,
        trim: true
    },
    middleName: {
        type: String,
        trim: true,
        default: ''
    },
    lastName: {
        type: String,
        trim: true
    },
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true
    },
    phone: {
        type: String,
        trim: true,
        default: ''
    },
    mobile: {
        type: String,
        trim: true,
        default: ''
    },
    location: {
        type: String,
        trim: true,
        default: ''
    },
    aadhar: {
        type: String,
        trim: true,
        default: ''
    },
    role: {
        type: String,
        enum: ['user', 'admin', 'officer'],
        default: 'user'
    },
    password: {
        type: String,
        required: true
    },
    // Additional Details
    consumerNo: {
        type: String,
        trim: true,
        default: ''
    },
    licenseNo: {
        type: String,
        trim: true,
        default: ''
    },
    panNo: {
        type: String,
        trim: true,
        default: ''
    },
    propertyNo: {
        type: String,
        trim: true,
        default: ''
    },
    address: {
        type: String,
        trim: true,
        default: ''
    },
    pincode: {
        type: String,
        trim: true,
        default: ''
    },
    // Admin-specific fields
    employeeId: {
        type: String,
        trim: true,
        default: ''
    },
    department: {
        type: String,
        trim: true,
        default: ''
    },
    designation: {
        type: String,
        trim: true,
        default: ''
    },
    officeLocation: {
        type: String,
        trim: true,
        default: ''
    },
    jurisdiction: {
        type: String,
        trim: true,
        default: ''
    },
    officeAddress: {
        type: String,
        trim: true,
        default: ''
    },
    // Officer availability status
    isAvailable: {
        type: Boolean,
        default: true
    },
    availabilityUpdatedAt: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('User', userSchema);
