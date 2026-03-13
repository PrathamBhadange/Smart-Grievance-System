const mongoose = require('mongoose');

const escalationHistorySchema = new mongoose.Schema({
    complaintId: {
        type: String,
        required: true
    },
    fromLevel: {
        type: Number,
        required: true,
        min: 0,
        max: 3
    },
    toLevel: {
        type: Number,
        required: true,
        min: 0,
        max: 3
    },
    escalatedTo: {
        type: String,
        required: true
    },
    reason: {
        type: String,
        default: ''
    },
    delayHours: {
        type: Number,
        default: 0
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('EscalationHistory', escalationHistorySchema);
