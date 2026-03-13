const mongoose = require('mongoose');

const complaintSchema = new mongoose.Schema({
    complaintId: {
        type: String,
        required: true,
        unique: true
    },
    category: {
        type: String,
        required: true
    },
    ward: {
        type: String,
        required: true
    },
    title: {
        type: String,
        required: true,
        trim: true
    },
    description: {
        type: String,
        required: true,
        trim: true
    },
    address: {
        type: String,
        trim: true,
        default: ''
    },
    image: {
        type: String,
        default: null
    },
    status: {
        type: String,
        enum: ['Pending', 'In Progress', 'Resolved', 'Escalated', 'Reopened', 'Closed'],
        default: 'Pending'
    },
    userEmail: {
        type: String,
        required: true,
        lowercase: true
    },
    date: {
        type: String,
        required: true
    },
    assignedOfficer: {
        type: String,
        default: null,
        lowercase: true
    },
    assignedOfficerName: {
        type: String,
        default: null
    },
    assignedOfficerDepartment: {
        type: String,
        default: null
    },
    slaStatus: {
        type: String,
        enum: ['within_sla', 'warning', 'breached', 'resolved', 'Within SLA', 'SLA Breached', 'Resolved', 'Escalated', 'Reopened'],
        default: 'within_sla'
    },
    slaDeadline: {
        type: Date,
        default: null
    },
    autoEscalated: {
        type: Boolean,
        default: false
    },
    escalationLevel: {
        type: Number,
        default: 0,
        min: 0,
        max: 3
    },
    resolvedWithinSLA: {
        type: Boolean,
        default: null
    },
    support_count: {
        type: Number,
        default: 0
    },
    supporters: {
        type: [String],
        default: []
    },
    // Resolution fields (set by admin/officer)
    afterImage: {
        type: String,
        default: null
    },
    resolutionNotes: {
        type: String,
        default: ''
    },
    // Reappeal fields
    reappeal_status: {
        type: Boolean,
        default: false
    },
    reappeal_reason: {
        type: String,
        default: ''
    },
    reappeal_comment: {
        type: String,
        default: ''
    },
    reappeal_image: {
        type: String,
        default: null
    },
    reappeal_count: {
        type: Number,
        default: 0
    },
    priority: {
        type: String,
        enum: ['Normal', 'High', 'Urgent'],
        default: 'Normal'
    },
    // Satisfaction fields
    userSatisfied: {
        type: Boolean,
        default: null
    },
    userSatisfactionFeedback: {
        type: String,
        default: null
    },
    satisfactionSubmittedAt: {
        type: Date,
        default: null
    },
    // Admin/Officer note for why it is pending
    pendingReason: {
        type: String,
        default: ''
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('Complaint', complaintSchema);
