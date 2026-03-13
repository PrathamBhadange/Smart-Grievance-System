const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
    type: {
        type: String,
        enum: [
            'sla_warning', 'sla_breach', 'complaint_assigned', 'complaint_resolved', 'reappeal_filed',
            'complaint_filed', 'status_changed', 'officer_assigned', 'complaint_updated',
            'review_request', 'escalation_alert', 'assignment_alert'
        ],
        required: true
    },
    complaintId: {
        type: String,
        required: true
    },
    category: {
        type: String,
        default: ''
    },
    message: {
        type: String,
        required: true
    },
    targetRole: {
        type: String,
        enum: ['admin', 'officer', 'user', 'all'],
        default: 'admin'
    },
    targetEmail: {
        type: String,
        default: null
    },
    read: {
        type: Boolean,
        default: false
    },
    eventData: {
        oldValue: String,
        newValue: String,
        fieldChanged: String,
        changedBy: String,
        changedByRole: String
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('Notification', notificationSchema);
