require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const http = require('http');
const WebSocket = require('ws');

// MongoDB Atlas imports
const connectDB = require('./db');
const User = require('./models/User');
const Complaint = require('./models/Complaint');
const Notification = require('./models/Notification');
const EscalationHistory = require('./models/EscalationHistory');

const app = express();
const PORT = process.env.PORT || 5000;

// Create HTTP server with Express app
const server = http.createServer(app);

// Create WebSocket server
const wss = new WebSocket.Server({ server });

// Track connected WebSocket clients by role/email
const wsConnections = {
    admins: new Set(),
    officers: new Map(),
    users: new Map()
};

// Connect to MongoDB Atlas
connectDB();

// ============ MIDDLEWARE ============

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve frontend static files
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// ============ SLA RULES (Category-Based) ============

const SLA_RULES = {
    'Sanitation':     { hours: 12, label: '12 hours' },
    'Garbage':        { hours: 12, label: '12 hours' },
    'Water Supply':   { hours: 24, label: '24 hours' },
    'Water leak':     { hours: 24, label: '24 hours' },
    'Electricity':    { hours: 48, label: '48 hours' },
    'Streetlight':    { hours: 48, label: '48 hours' },
    'Roads & Infra':  { hours: 72, label: '72 hours' },
    'Road damage':    { hours: 72, label: '72 hours' },
    'Public Safety':  { hours: 24, label: '24 hours' },
    'Other':          { hours: 48, label: '48 hours' }
};

const ESCALATION_CHAIN = [
    { level: 0, role: 'Assigned Officer' },
    { level: 1, role: 'Ward Supervisor' },
    { level: 2, role: 'Department Head' },
    { level: 3, role: 'Commissioner' }
];

// ============ CATEGORY-TO-DEPARTMENT MAPPING ============

const CATEGORY_DEPARTMENT_MAP = {
    'Sanitation': 'Sanitation',
    'Garbage': 'Sanitation',
    'Water Supply': 'Water Supply',
    'Water leak': 'Water Supply',
    'Electricity': 'Electricity',
    'Streetlight': 'Electricity',
    'Roads & Infra': 'Civil Engineering',
    'Road damage': 'Civil Engineering',
    'Public Safety': 'Public Safety',
    'Other': 'General'
};

// ============ AUTO-ASSIGNMENT FUNCTION ============

async function autoAssignOfficer(complaintId, category, ward) {
    try {
        // Get the required department from category mapping
        const requiredDepartment = CATEGORY_DEPARTMENT_MAP[category] || 'General';

        // Find available officers from the required department
        const availableOfficers = await User.find({
            role: { $in: ['officer', 'admin'] },
            department: requiredDepartment,
            isAvailable: true
        });

        if (availableOfficers.length === 0) {
            // No available officers in the required department
            console.log(`No available officers in ${requiredDepartment} for complaint ${complaintId}`);
            return null;
        }

        // Select officer with least assigned complaints (load balancing)
        const allComplaints = await Complaint.find({});
        let selectedOfficer = availableOfficers[0];
        let minAssignments = allComplaints.filter(c => c.assignedOfficer === selectedOfficer.email).length;

        for (const officer of availableOfficers) {
            const officerAssignments = allComplaints.filter(c => c.assignedOfficer === officer.email).length;
            if (officerAssignments < minAssignments) {
                minAssignments = officerAssignments;
                selectedOfficer = officer;
            }
        }

        // Update complaint with auto-assigned officer
        const updatedComplaint = await Complaint.findOneAndUpdate(
            { complaintId },
            {
                assignedOfficer: selectedOfficer.email,
                assignedOfficerName: selectedOfficer.fullName,
                assignedOfficerDepartment: selectedOfficer.department,
                status: 'In Progress'
            },
            { new: true }
        );

        // Broadcast notification to assigned officer
        broadcastNotification({
            type: 'complaint_assigned',
            complaintId: complaintId,
            category: category,
            message: `👤 Auto-Assigned: ${complaintId} assigned to you (${requiredDepartment})`,
            targetRole: 'officer',
            read: false,
            createdAt: new Date().toISOString()
        }, 'officer', selectedOfficer.email);

        console.log(`Auto-assigned complaint ${complaintId} to ${selectedOfficer.fullName}`);
        return updatedComplaint;

    } catch (err) {
        console.error('Auto-assign error:', err);
        return null;
    }
}

function getSlaHours(category) {
    return (SLA_RULES[category] || SLA_RULES['Other']).hours;
}



// ============ SLA AUTO-ESCALATION ============

// Function to check and auto-escalate complaints after SLA breach
async function checkAndAutoEscalateComplaints() {
    try {
        const now = new Date();

        const allComplaints = await Complaint.find({});

        let escalatedCount = 0;
        let warningCount = 0;
        for (const complaint of allComplaints) {
            if (['Resolved', 'Closed'].includes(complaint.status)) continue;
            if (!complaint.slaDeadline) continue;

            const deadline = new Date(complaint.slaDeadline);
            const timeRemaining = deadline - now;
            const hoursRemaining = timeRemaining / (1000 * 60 * 60);

            // WARNING: less than 2 hours remaining
            if (hoursRemaining > 0 && hoursRemaining <= 2 && complaint.slaStatus !== 'warning') {
                await Complaint.findOneAndUpdate(
                    { _id: complaint._id },
                    { slaStatus: 'warning' },
                    { new: true }
                );
                // Create warning notification
                const warningNotif = {
                    type: 'sla_warning',
                    complaintId: complaint.complaintId,
                    category: complaint.category,
                    message: '⏰ SLA Warning: Complaint ' + complaint.complaintId + ' nearing deadline (' + Math.round(hoursRemaining * 60) + 'min remaining)',
                    targetRole: 'admin',
                    read: false,
                    createdAt: new Date().toISOString()
                };
                broadcastNotification(warningNotif, 'admin');
                
                // Also warn the assigned officer
                if (complaint.assignedOfficer) {
                    const officerNotif = {
                        type: 'sla_warning',
                        complaintId: complaint.complaintId,
                        category: complaint.category,
                        message: '⏰ SLA Warning: ' + complaint.complaintId + ' - ' + Math.round(hoursRemaining * 60) + 'min remaining',
                        targetRole: 'officer',
                        read: false,
                        createdAt: new Date().toISOString()
                    };
                    broadcastNotification(officerNotif, 'officer', complaint.assignedOfficer);
                }
                warningCount++;
            }

            // BREACHED: deadline passed
            if (deadline < now && complaint.slaStatus !== 'breached') {
                const currentLevel = complaint.escalationLevel || 0;
                const newLevel = Math.min(currentLevel + 1, 3);
                const escalationTarget = ESCALATION_CHAIN[newLevel] || ESCALATION_CHAIN[3];

                await Complaint.findOneAndUpdate(
                    { _id: complaint._id },
                    {
                        status: 'Escalated',
                        slaStatus: 'breached',
                        autoEscalated: true,
                        escalationLevel: newLevel
                    },
                    { new: true }
                );

                // Log escalation history
                EscalationHistory.create({
                    complaintId: complaint.complaintId,
                    fromLevel: currentLevel,
                    toLevel: newLevel,
                    escalatedTo: escalationTarget.role,
                    reason: 'SLA deadline breached',
                    delayHours: Math.round(Math.abs(hoursRemaining))
                });

                // Create breach notification with real-time broadcast
                const breachNotif = {
                    type: 'sla_breach',
                    complaintId: complaint.complaintId,
                    category: complaint.category,
                    message: '🚨 SLA BREACH: Complaint ' + complaint.complaintId + ' exceeded SLA. Escalated to ' + escalationTarget.role,
                    targetRole: 'admin',
                    read: false,
                    createdAt: new Date().toISOString()
                };
                broadcastNotification(breachNotif, 'admin');
                
                // Also notify the assigned officer
                if (complaint.assignedOfficer) {
                    const officerBreachNotif = {
                        type: 'sla_breach',
                        complaintId: complaint.complaintId,
                        category: complaint.category,
                        message: '🚨 SLA BREACH: ' + complaint.complaintId + ' - Escalated to ' + escalationTarget.role,
                        targetRole: 'officer',
                        read: false,
                        createdAt: new Date().toISOString()
                    };
                    broadcastNotification(officerBreachNotif, 'officer', complaint.assignedOfficer);
                }

                escalatedCount++;
            }
        }

        if (escalatedCount > 0 || warningCount > 0) {
            console.log(`✅ SLA check: ${escalatedCount} escalated, ${warningCount} warnings`);
        }
    } catch (err) {
        console.error('Error in SLA auto-escalation check:', err);
    }
}

// Run SLA check every 2 minutes (120000 ms)
setInterval(checkAndAutoEscalateComplaints, 2 * 60 * 1000);

// Run initial check on startup (after 5 seconds)
setTimeout(checkAndAutoEscalateComplaints, 5000);

// ============ WEBSOCKET CONNECTIONS ============

// Handle WebSocket connections
wss.on('connection', (ws, req) => {
    const urlParams = new URLSearchParams(req.url.split('?')[1]);
    const userEmail = urlParams.get('email');
    const userRole = urlParams.get('role');

    if (!userEmail || !userRole) {
        ws.close();
        return;
    }

    console.log(`✅ WebSocket connected: ${userEmail} (${userRole})`);

    // Register connection
    if (userRole === 'admin') {
        wsConnections.admins.add(ws);
    } else if (userRole === 'officer') {
        if (!wsConnections.officers.has(userEmail)) {
            wsConnections.officers.set(userEmail, new Set());
        }
        wsConnections.officers.get(userEmail).add(ws);
    } else if (userRole === 'user') {
        if (!wsConnections.users.has(userEmail)) {
            wsConnections.users.set(userEmail, new Set());
        }
        wsConnections.users.get(userEmail).add(ws);
    }

    // Handle client messages
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            if (data.type === 'ping') {
                ws.send(JSON.stringify({ type: 'pong' }));
            }
        } catch (err) {
            console.error('WebSocket message error:', err);
        }
    });

    // Handle disconnection
    ws.on('close', () => {
        console.log(`❌ WebSocket disconnected: ${userEmail}`);
        if (userRole === 'admin') {
            wsConnections.admins.delete(ws);
        } else if (userRole === 'officer') {
            const officerSet = wsConnections.officers.get(userEmail);
            if (officerSet) officerSet.delete(ws);
        } else if (userRole === 'user') {
            const userSet = wsConnections.users.get(userEmail);
            if (userSet) userSet.delete(ws);
        }
    });
});

// Broadcast notification function
async function broadcastNotification(notification, targetRole = null, targetEmail = null) {
    const message = JSON.stringify({
        type: 'notification',
        notification: notification
    });

    if (targetRole === 'admin') {
        // Send to all admin connections
        wsConnections.admins.forEach(ws => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(message);
            }
        });
    } else if (targetRole === 'officer' && targetEmail) {
        // Send to specific officer
        const officerSet = wsConnections.officers.get(targetEmail);
        if (officerSet) {
            officerSet.forEach(ws => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(message);
                }
            });
        }
    } else if (targetRole === 'user' && targetEmail) {
        // Send to specific user
        const userSet = wsConnections.users.get(targetEmail);
        if (userSet) {
            userSet.forEach(ws => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(message);
                }
            });
        }
    }

    // Also save to database
    try {
        await Notification.create(notification);
    } catch (err) {
        console.error('Error saving notification:', err);
    }
}

// ============ OTP STORE (in-memory) ============
// Maps mobile -> { otp, expiresAt, aadhar }
const otpStore = new Map();

// ============ AUTH ROUTES ============

// Register
app.post('/api/register', async (req, res) => {
    try {
        const {
            fullName, firstName, middleName, lastName,
            email, phone, mobile, location, aadhar, role, password,
            consumerNo, licenseNo, panNo, propertyNo, address, pincode,
            houseStreet, areaLocality, city, state,
            profilePhoto, govtIdCard, employeeIdCard,
            // Admin/Officer fields
            employeeId, department, designation, officeLocation,
            cityDistrict, jurisdiction, officeAddress,
            wardNumber, zone, assignedLocality
        } = req.body;

        // Validation
        if (!fullName || !email || !password) {
            return res.status(400).json({ error: 'All required fields must be filled.' });
        }

        // For citizen, aadhar is required
        if (role === 'user' && !aadhar) {
            return res.status(400).json({ error: 'Aadhaar number is required for citizen registration.' });
        }

        // For admin or officer, employee ID and designation are required
        if (role === 'admin' || role === 'officer') {
            if (!employeeId || !designation) {
                return res.status(400).json({ error: 'Employee ID and Designation are required.' });
            }
            if (role === 'officer' && !department) {
                return res.status(400).json({ error: 'Department is required for Officer registration.' });
            }
            if (role === 'admin' && !req.body.govtIdCard) {
                return res.status(400).json({ error: 'Government ID Card is required for Admin registration.' });
            }
            if (role === 'officer' && !req.body.employeeIdCard) {
                return res.status(400).json({ error: 'Employee ID Card is required for Officer registration.' });
            }
            // Employee ID uniqueness check
            const existingEmpId = await User.findOne({ employeeId: employeeId });
            if (existingEmpId) {
                return res.status(400).json({ error: 'Employee ID already registered! Each employee ID must be unique.' });
            }
        }

        // Check if email already exists
        const existingUser = await User.findOne({ email: email.toLowerCase() });
        if (existingUser) {
            return res.status(400).json({ error: 'Email already registered!' });
        }

        // Hash password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Create user
        User.create({
            fullName,
            firstName: firstName || '',
            middleName: middleName || '',
            lastName: lastName || '',
            email: email.toLowerCase(),
            phone: phone || '',
            mobile: mobile || '',
            location: location || '',
            aadhar: aadhar || '',
            role: role || 'user',
            password: hashedPassword,
            consumerNo: consumerNo || '',
            licenseNo: licenseNo || '',
            panNo: panNo || '',
            propertyNo: propertyNo || '',
            address: address || '',
            pincode: pincode || '',
            houseStreet: houseStreet || '',
            areaLocality: areaLocality || '',
            city: city || '',
            state: state || '',
            profilePhoto: profilePhoto || null,
            govtIdCard: govtIdCard || null,
            employeeIdCard: employeeIdCard || null,
            // Admin/Officer-specific
            employeeId: employeeId || '',
            department: department || '',
            designation: designation || '',
            officeLocation: officeLocation || '',
            cityDistrict: cityDistrict || '',
            jurisdiction: jurisdiction || '',
            officeAddress: officeAddress || '',
            wardNumber: wardNumber || '',
            zone: zone || '',
            assignedLocality: assignedLocality || ''
        });

        res.status(201).json({ message: 'Registration successful!' });

    } catch (err) {
        console.error('Register error:', err);
        res.status(500).json({ error: 'Server error. Please try again.' });
    }
});

// ============ OTP ROUTES ============

// Send OTP via Fast2SMS (real SMS to registered mobile number)
app.post('/api/send-otp', async (req, res) => {
    try {
        const { mobile, aadhar } = req.body;

        if (!mobile || !/^[6-9]\d{9}$/.test(mobile)) {
            return res.status(400).json({ error: 'Invalid mobile number.' });
        }
        if (!aadhar || !/^\d{12}$/.test(aadhar)) {
            return res.status(400).json({ error: 'Invalid Aadhaar number.' });
        }

        // Generate 6-digit OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes

        // Store OTP
        otpStore.set(mobile, { otp, expiresAt, aadhar, verified: false });

        console.log(`[OTP] Mobile: ${mobile} | Aadhaar: ${aadhar.slice(-4)} | OTP: ${otp} | Expires: ${new Date(expiresAt).toLocaleTimeString()}`);

        const fast2smsKey = process.env.FAST2SMS_API_KEY;
        let smsSent = false;
        let smsError = null;

        // Try to send real SMS via Fast2SMS if API key is configured
        if (fast2smsKey && fast2smsKey !== 'YOUR_FAST2SMS_API_KEY_HERE') {
            try {
                const https = require('https');
                const smsUrl = `https://www.fast2sms.com/dev/bulkV2?authorization=${fast2smsKey}&variables_values=${otp}&route=otp&numbers=${mobile}`;

                await new Promise((resolve, reject) => {
                    https.get(smsUrl, (resp) => {
                        let data = '';
                        resp.on('data', chunk => data += chunk);
                        resp.on('end', () => {
                            try {
                                const parsed = JSON.parse(data);
                                if (parsed.return === true) {
                                    smsSent = true;
                                    console.log(`[OTP SMS] Sent successfully to ${mobile}`);
                                } else {
                                    smsError = parsed.message || 'SMS gateway error';
                                    console.warn(`[OTP SMS] Failed: ${smsError}`);
                                }
                            } catch(e) { smsError = 'SMS parse error'; }
                            resolve();
                        });
                        resp.on('error', (e) => { smsError = e.message; resolve(); });
                    }).on('error', (e) => { smsError = e.message; resolve(); });
                });
            } catch (smsErr) {
                smsError = smsErr.message;
                console.warn('[OTP SMS] Exception:', smsErr.message);
            }
        }

        if (smsSent) {
            res.json({ message: `OTP sent to mobile number ****${mobile.slice(-4)}. Please check your SMS.` });
        } else {
            // Fallback: return OTP in response for demo/dev mode
            console.log(`[OTP DEMO] SMS not sent (${smsError || 'No API key'}). Returning OTP in response for demo.`);
            res.json({
                message: `OTP sent to mobile number ****${mobile.slice(-4)} linked to your Aadhaar.`,
                demoOtp: otp  // DEV/DEMO ONLY
            });
        }

    } catch (err) {
        console.error('Send OTP error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
});

// Verify OTP
app.post('/api/verify-otp', async (req, res) => {
    try {
        const { mobile, otp } = req.body;

        if (!mobile || !otp) {
            return res.status(400).json({ error: 'Mobile and OTP are required.' });
        }

        const record = otpStore.get(mobile);

        if (!record) {
            return res.status(400).json({ error: 'OTP not found. Please request a new OTP.' });
        }

        if (Date.now() > record.expiresAt) {
            otpStore.delete(mobile);
            return res.status(400).json({ error: 'OTP has expired. Please request a new OTP.' });
        }

        if (record.otp !== otp.trim()) {
            return res.status(400).json({ error: 'Incorrect OTP. Please try again.' });
        }

        // Mark as verified
        record.verified = true;
        otpStore.set(mobile, record);

        res.json({ verified: true, message: 'Mobile number verified successfully!' });

    } catch (err) {
        console.error('Verify OTP error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
});

// Login
app.post('/api/login', async (req, res) => {
    try {
        const { email, password, role } = req.body;

        if (!email || !password || !role) {
            return res.status(400).json({ error: 'All fields are required.' });
        }

        // Find user
        const user = await User.findOne({ email: email.toLowerCase() });
        if (!user) {
            return res.status(400).json({ error: 'Invalid credentials or role mismatch!' });
        }

        // Check role
        if (user.role !== role) {
            return res.status(400).json({ error: 'Invalid credentials or role mismatch!' });
        }

        // Check password
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ error: 'Invalid credentials or role mismatch!' });
        }

        // Return user data (without password)
        const userData = {
            fullName: user.fullName,
            email: user.email,
            phone: user.phone,
            location: user.location,
            aadhar: user.aadhar,
            role: user.role
        };

        res.json({ message: 'Login successful!', user: userData });

    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Server error. Please try again.' });
    }
});

// ============ COMPLAINT ROUTES ============

// Check for duplicate complaint
app.post('/api/complaints/check-duplicate', async (req, res) => {
    try {
        const { category, ward } = req.body;

        if (!category || !ward) {
            return res.status(400).json({ error: 'Category and ward are required.' });
        }

        // 24 hours ago
        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

        // Get all complaints and filter manually for the complex query
        const allComplaints = await Complaint.find({
            category: category,
            ward: ward
        });

        // Filter for: not closed/resolved, created within 24h
        const existingComplaint = allComplaints
            .filter(c => !['Closed', 'Resolved'].includes(c.status))
            .filter(c => new Date(c.createdAt) >= yesterday)
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];

        if (existingComplaint) {
            return res.json({
                duplicate: true,
                complaint: {
                    complaint_id: existingComplaint.complaintId,
                    id: existingComplaint.complaintId,
                    title: existingComplaint.title,
                    description: existingComplaint.description,
                    created_at: existingComplaint.createdAt,
                    status: existingComplaint.status,
                    category: existingComplaint.category,
                    ward: existingComplaint.ward,
                    support_count: existingComplaint.support_count
                }
            });
        }

        // No duplicate found
        res.json({ duplicate: false });

    } catch (err) {
        console.error('Duplicate check error:', err);
        res.status(500).json({ error: 'Server error during duplicate check.' });
    }
});

// Support an existing complaint (increment support_count, add citizen to supporters)
app.post('/api/complaints/:complaintId/support', async (req, res) => {
    try {
        const { complaintId } = req.params;
        const { citizenEmail } = req.body;

        if (!citizenEmail) {
            return res.status(400).json({ error: 'Citizen email is required.' });
        }

        const complaint = await Complaint.findOne({ complaintId });
        if (!complaint) {
            return res.status(404).json({ error: 'Complaint not found.' });
        }

        // Check if user already supported this complaint
        if (complaint.supporters && complaint.supporters.includes(citizenEmail.toLowerCase())) {
            return res.status(400).json({ error: 'You have already supported this complaint.' });
        }

        // Add supporter and increment count
        const updatedComplaint = await Complaint.findOneAndUpdate(
            { complaintId },
            {
                $inc: { support_count: 1 },
                $push: { supporters: citizenEmail.toLowerCase() }
            },
            { new: true }
        );

        res.json({
            message: 'Support added successfully!',
            support_count: updatedComplaint.support_count
        });

    } catch (err) {
        console.error('Support error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
});

// File a new complaint
app.post('/api/complaints', async (req, res) => {
    try {
        const { category, ward, title, description, address, image, userEmail } = req.body;

        if (!category || !ward || !title || !description || !address || !image || !userEmail) {
            return res.status(400).json({ error: 'All fields are required including address and image.' });
        }

        const complaintId = 'SG-' + new Date().getFullYear() + Math.random().toString(9).substring(2, 11);
        const date = new Date().toLocaleDateString('en-IN');
        const slaHours = getSlaHours(category);
        const slaDeadline = new Date(Date.now() + slaHours * 60 * 60 * 1000).toISOString();

        // Check for area alerts: multiple complaints in the same ward
        const activeComplaintsInWard = await Complaint.countDocuments({
            ward: ward,
            status: { $in: ['Pending', 'In Progress', 'Escalated', 'Reopened'] }
        });

        let initialPriority = 'Normal';
        if (activeComplaintsInWard >= 5) {
            initialPriority = 'Urgent';
        } else if (activeComplaintsInWard >= 3) {
            initialPriority = 'High';
        }

        let complaint = await Complaint.create({
            complaintId,
            category,
            ward,
            title,
            description,
            address: address || '',
            image: image || null,
            status: 'Pending',
            userEmail: userEmail.toLowerCase(),
            date,
            slaDeadline,
            slaStatus: 'within_sla',
            autoEscalated: false,
            escalationLevel: 0,
            resolvedWithinSLA: null,
            support_count: 0,
            supporters: [],
            assignedOfficer: null,
            assignedOfficerName: null,
            assignedOfficerDepartment: null,
            afterImage: null,
            resolutionNotes: '',
            reappeal_status: false,
            reappeal_reason: '',
            reappeal_comment: '',
            reappeal_image: null,
            reappeal_count: 0,
            priority: initialPriority,
            userSatisfied: null,
            userSatisfactionFeedback: null,
            satisfactionSubmittedAt: null
        });

        // Attempt to auto-assign officer
        const autoAssignedComplaint = await autoAssignOfficer(complaintId, category, ward);
        if (autoAssignedComplaint) {
            complaint = autoAssignedComplaint;
        }

        // Broadcast notification for new complaint to admins
        broadcastNotification({
            type: 'complaint_filed',
            complaintId: complaintId,
            category: category,
            message: `📧 New Complaint: ${complaintId} - ${title} (${category})`,
            targetRole: 'admin',
            read: false,
            createdAt: new Date().toISOString()
        }, 'admin');

        // Broadcast early alert if high area density
        if (activeComplaintsInWard >= 3) {
            broadcastNotification({
                type: 'area_alert',
                complaintId: complaintId,
                category: 'Area Alert',
                message: `⚠️ Area Alert: Spike in issues. ${activeComplaintsInWard + 1} active complaints in ${ward}. Priority escalated.`,
                targetRole: 'admin',
                read: false,
                createdAt: new Date().toISOString()
            }, 'admin');
        }

        res.status(201).json({
            message: 'Complaint filed successfully!',
            complaint: complaint,
            autoAssigned: autoAssignedComplaint ? true : false
        });

    } catch (err) {
        console.error('Complaint error:', err);
        res.status(500).json({ error: 'Server error. Please try again.' });
    }
});

// Get complaints for a specific user
app.get('/api/complaints/user/:email', async (req, res) => {
    try {
        const email = req.params.email.toLowerCase();
        const result = await Complaint.find({ userEmail: email });

        // Sort by createdAt descending
        const sorted = result.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        res.json(sorted);

    } catch (err) {
        console.error('Get complaints error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
});

// Get single complaint by ID
app.get('/api/complaints/:complaintId', async (req, res) => {
    try {
        const { complaintId } = req.params;
        const complaint = await Complaint.findOne({ complaintId });

        if (!complaint) {
            return res.status(404).json({ error: 'Complaint not found.' });
        }

        res.json(complaint);

    } catch (err) {
        console.error('Get complaint error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
});

// Get complaints assigned to an officer
app.get('/api/complaints/assigned/:email', async (req, res) => {
    try {
        const email = req.params.email.toLowerCase();
        // Since it's a localDb find might not support complex logic, we'll fetch all and filter
        const allComplaints = await Complaint.find({});
        const myAssigned = allComplaints.filter(c => c.assignedOfficer && c.assignedOfficer.toLowerCase() === email);
        
        // Sort by createdAt descending
        const sorted = myAssigned.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        res.json(sorted);
    } catch (err) {
        console.error('Get assigned complaints error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
});

// Get ALL complaints (admin)
app.get('/api/complaints', async (req, res) => {
    try {
        const result = await Complaint.find({});

        // Sort by createdAt descending
        const sorted = result.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        res.json(sorted);

    } catch (err) {
        console.error('Get all complaints error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
});

// Update complaint status (admin)
app.patch('/api/complaints/:complaintId/status', async (req, res) => {
    try {
        const { complaintId } = req.params;
        const { status, pendingReason } = req.body;

        const validStatuses = ['Pending', 'In Progress', 'Resolved', 'Escalated', 'Reopened', 'Closed'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ error: 'Invalid status.' });
        }

        const complaint = await Complaint.findOne({ complaintId });
        if (!complaint) {
            return res.status(404).json({ error: 'Complaint not found.' });
        }

        // Check if trying to change status FROM "Resolved" 
        if (complaint.status === 'Resolved' && status !== 'Resolved') {
            if (status !== 'Reopened' && (complaint.userSatisfied === null || complaint.userSatisfied === false)) {
                return res.status(400).json({ 
                    error: 'Cannot modify a resolved complaint until the user confirms satisfaction. Please wait for user feedback.',
                    requiresUserConfirmation: true,
                    userSatisfied: complaint.userSatisfied
                });
            }
        }
        
        let finalPendingReason = complaint.pendingReason;
        if (status === 'Pending' && pendingReason !== undefined) {
            finalPendingReason = pendingReason;
        } else if (status !== 'Pending') {
            finalPendingReason = '';
        }

        // Determine SLA status
        let slaStatus = complaint.slaStatus;
        if (complaint.slaDeadline) {
            const now = new Date();
            const deadline = new Date(complaint.slaDeadline);
            if (now > deadline && !['Resolved', 'Escalated', 'Closed'].includes(status)) {
                slaStatus = 'breached';
            }
        }

        // Calculate resolvedWithinSLA if resolving
        let resolvedWithinSLA = complaint.resolvedWithinSLA;
        if (status === 'Resolved' && complaint.slaDeadline) {
            resolvedWithinSLA = new Date() <= new Date(complaint.slaDeadline);
        }

        const updatedComplaint = await Complaint.findOneAndUpdate(
            { complaintId },
            { 
                status,
                slaStatus: ['Resolved', 'Closed'].includes(status) ? 'resolved' : slaStatus,
                resolvedWithinSLA: resolvedWithinSLA,
                pendingReason: finalPendingReason
            },
            { new: true }
        );

        // Broadcast status update notifications
        broadcastNotification({
            type: 'complaint_status_changed',
            complaintId: complaintId,
            category: complaint.category,
            message: `🔄 Status Update: Your complaint ${complaintId} is now "${status}"`,
            targetRole: 'user',
            targetEmail: complaint.userEmail,
            read: false,
            createdAt: new Date().toISOString()
        }, 'user', complaint.userEmail);

        broadcastNotification({
            type: 'complaint_status_changed',
            complaintId: complaintId,
            category: complaint.category,
            message: `🔄 ${complaintId} status changed to "${status}"`,
            targetRole: 'admin',
            read: false,
            createdAt: new Date().toISOString()
        }, 'admin');

        // Notify assigned officer about status change
        if (complaint.assignedOfficer) {
            broadcastNotification({
                type: 'complaint_status_changed',
                complaintId: complaintId,
                category: complaint.category,
                message: `🔄 ${complaintId} status changed to "${status}"`,
                targetRole: 'officer',
                targetEmail: complaint.assignedOfficer,
                read: false,
                createdAt: new Date().toISOString()
            }, 'officer', complaint.assignedOfficer);
        }

        res.json({
            message: 'Status updated successfully!',
            complaint: updatedComplaint
        });

    } catch (err) {
        console.error('Update status error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
});

// Assign officer to complaint (admin)
app.patch('/api/complaints/:complaintId/assign', async (req, res) => {
    try {
        const { complaintId } = req.params;
        const { officerEmail } = req.body;

        if (!officerEmail) {
            return res.status(400).json({ error: 'Officer email is required.' });
        }

        // Find the officer
        const officer = await User.findOne({ email: officerEmail.toLowerCase() });
        if (!officer || (officer.role !== 'admin' && officer.role !== 'officer')) {
            return res.status(404).json({ error: 'Officer not found or invalid role.' });
        }

        // Check officer availability
        const availabilityWarning = !officer.isAvailable ? 'Officer is currently marked unavailable. Assignment will proceed.' : null;

        // Update complaint with officer info
        const complaint = await Complaint.findOneAndUpdate(
            { complaintId },
            { 
                assignedOfficer: officer.email,
                assignedOfficerName: officer.fullName,
                assignedOfficerDepartment: officer.department,
                status: 'In Progress'
            },
            { new: true }
        );

        if (!complaint) {
            return res.status(404).json({ error: 'Complaint not found.' });
        }

        // Broadcast notification to officer
        broadcastNotification({
            type: 'complaint_assigned',
            complaintId: complaintId,
            category: complaint.category,
            message: `👤 New Assignment: ${complaintId} - ${complaint.title} assigned to you`,
            targetRole: 'officer',
            targetEmail: officer.email,
            read: false,
            createdAt: new Date().toISOString()
        }, 'officer', officer.email);

        // Notify the citizen about officer assignment
        broadcastNotification({
            type: 'officer_assigned',
            complaintId: complaintId,
            category: complaint.category,
            message: `👤 Officer Assigned: ${officer.fullName} (${officer.department}) is now working on your complaint`,
            targetRole: 'user',
            targetEmail: complaint.userEmail,
            read: false,
            createdAt: new Date().toISOString()
        }, 'user', complaint.userEmail);

        // Also notify admins about the assignment
        broadcastNotification({
            type: 'complaint_assigned',
            complaintId: complaintId,
            category: complaint.category,
            message: `✅ Assignment: ${complaintId} assigned to ${officer.fullName}`,
            targetRole: 'admin',
            read: false,
            createdAt: new Date().toISOString()
        }, 'admin');

        res.json({
            message: 'Officer assigned successfully!',
            complaint: complaint,
            warning: availabilityWarning
        });

    } catch (err) {
        console.error('Assign officer error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
});

// ============ RESOLVE / REAPPEAL / CLOSE ROUTES ============

// Admin resolves complaint with after-image and notes
app.patch('/api/complaints/:complaintId/resolve', async (req, res) => {
    try {
        const { complaintId } = req.params;
        const { afterImage, resolutionNotes } = req.body;

        const complaint = await Complaint.findOne({ complaintId });
        if (!complaint) {
            return res.status(404).json({ error: 'Complaint not found.' });
        }

        // Update complaint with resolution details
        const updatedComplaint = await Complaint.findOneAndUpdate(
            { complaintId },
            {
                status: 'Resolved',
                afterImage: afterImage || null,
                resolutionNotes: resolutionNotes || '',
                slaStatus: 'resolved',
                resolvedWithinSLA: complaint.slaDeadline ? new Date() <= new Date(complaint.slaDeadline) : null
            },
            { new: true }
        );

        // Broadcast resolution notification
        broadcastNotification({
            type: 'complaint_resolved',
            complaintId: complaintId,
            category: complaint.category,
            message: `✅ Resolved: Your complaint ${complaintId} has been resolved. Please review and provide your feedback.`,
            targetRole: 'user',
            targetEmail: complaint.userEmail,
            read: false,
            createdAt: new Date().toISOString()
        }, 'user', complaint.userEmail);

        broadcastNotification({
            type: 'complaint_resolved',
            complaintId: complaintId,
            category: complaint.category,
            message: `✅ ${complaintId} marked as Resolved`,
            targetRole: 'admin',
            read: false,
            createdAt: new Date().toISOString()
        }, 'admin');

        // Notify assigned officer about resolution
        if (complaint.assignedOfficer) {
            broadcastNotification({
                type: 'complaint_resolved',
                complaintId: complaintId,
                category: complaint.category,
                message: `✅ Your complaint ${complaintId} has been marked as Resolved`,
                targetRole: 'officer',
                targetEmail: complaint.assignedOfficer,
                read: false,
                createdAt: new Date().toISOString()
            }, 'officer', complaint.assignedOfficer);
        }

        res.json({
            message: 'Complaint marked as Resolved!',
            complaint: updatedComplaint
        });

    } catch (err) {
        console.error('Resolve error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
});

// Citizen reappeals (reopens) a resolved complaint
app.post('/api/complaints/:complaintId/reappeal', async (req, res) => {
    try {
        const { complaintId } = req.params;
        const { reappeal_reason, reappeal_comment, reappeal_image } = req.body;

        const complaint = await Complaint.findOne({ complaintId });
        if (!complaint) {
            return res.status(404).json({ error: 'Complaint not found.' });
        }

        // Only allow reappeal if status is Resolved
        if (complaint.status !== 'Resolved') {
            return res.status(400).json({ error: 'Only resolved complaints can be reappealed.' });
        }

        // Reset SLA timer for reappealed complaint (category-based)
        const slaHours = getSlaHours(complaint.category || 'Other');
        const newSlaDeadline = new Date(Date.now() + slaHours * 60 * 60 * 1000).toISOString();

        // Update complaint with reappeal info and reopen it
        const updatedComplaint = await Complaint.findOneAndUpdate(
            { complaintId },
            {
                status: 'Reopened',
                reappeal_status: true,
                reappeal_reason: reappeal_reason || '',
                reappeal_comment: reappeal_comment || '',
                reappeal_image: reappeal_image || null,
                $inc: { reappeal_count: 1 },
                slaDeadline: newSlaDeadline,
                slaStatus: 'within_sla',
                autoEscalated: false,
                escalationLevel: 0,
                resolvedWithinSLA: null
            },
            { new: true }
        );

        // Broadcast re-appeal notification to admin
        broadcastNotification({
            type: 'reappeal_filed',
            complaintId: complaintId,
            category: complaint.category,
            message: `🔁 Re-appeal Filed: ${complaintId} reopened by citizen - "${reappeal_reason}"`,
            targetRole: 'admin',
            read: false,
            createdAt: new Date().toISOString()
        }, 'admin');

        // Broadcast re-appeal notification to officer
        if (complaint.assignedOfficer) {
            broadcastNotification({
                type: 'reappeal_filed',
                complaintId: complaintId,
                category: complaint.category,
                message: `🔁 Citizen reopened: ${complaintId} - "${reappeal_reason}"`,
                targetRole: 'officer',
                targetEmail: complaint.assignedOfficer,
                read: false,
                createdAt: new Date().toISOString()
            }, 'officer', complaint.assignedOfficer);
        }

        // Notify the user that their reappeal has been acknowledged
        broadcastNotification({
            type: 'reappeal_filed',
            complaintId: complaintId,
            category: complaint.category,
            message: `🔁 Your re-appeal has been received and is being reviewed`,
            targetRole: 'user',
            targetEmail: complaint.userEmail,
            read: false,
            createdAt: new Date().toISOString()
        }, 'user', complaint.userEmail);

        res.json({
            message: 'Complaint reappealed successfully!',
            complaint: updatedComplaint
        });

    } catch (err) {
        console.error('Reappeal error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
});

// Citizen confirms resolution (closes complaint)
app.post('/api/complaints/:complaintId/close', async (req, res) => {
    try {
        const { complaintId } = req.params;

        const complaint = await Complaint.findOne({ complaintId });
        if (!complaint) {
            return res.status(404).json({ error: 'Complaint not found.' });
        }

        // Only allow close if status is Resolved
        if (complaint.status !== 'Resolved') {
            return res.status(400).json({ error: 'Only resolved complaints can be closed.' });
        }

        // Update complaint status to Closed
        const updatedComplaint = await Complaint.findOneAndUpdate(
            { complaintId },
            {
                status: 'Closed',
                slaStatus: 'resolved'
            },
            { new: true }
        );

        res.json({
            message: 'Complaint closed successfully!',
            complaint: updatedComplaint
        });

    } catch (err) {
        console.error('Close error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
});

// Submit user satisfaction feedback
app.post('/api/complaints/:complaintId/satisfaction', async (req, res) => {
    try {
        const { complaintId } = req.params;
        const { satisfied, feedback } = req.body;

        if (satisfied === undefined || satisfied === null) {
            return res.status(400).json({ error: 'Satisfaction status is required.' });
        }

        const complaint = await Complaint.findOne({ complaintId });
        if (!complaint) {
            return res.status(404).json({ error: 'Complaint not found.' });
        }

        // Only allow satisfaction submission if complaint is in Resolved or In Progress status
        if (!['In Progress', 'Resolved'].includes(complaint.status)) {
            return res.status(400).json({ error: 'Satisfaction can only be submitted for In Progress or Resolved complaints.' });
        }

        const updatedComplaint = await Complaint.findOneAndUpdate(
            { complaintId },
            {
                userSatisfied: satisfied === true || satisfied === 'true',
                userSatisfactionFeedback: feedback || null,
                satisfactionSubmittedAt: new Date().toISOString()
            },
            { new: true }
        );

        res.json({
            message: 'Satisfaction feedback submitted successfully!',
            complaint: updatedComplaint
        });

    } catch (err) {
        console.error('Submit satisfaction error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
});

// Get SLA info for a complaint
app.get('/api/complaints/:complaintId/sla', async (req, res) => {
    try {
        const { complaintId } = req.params;
        const complaint = await Complaint.findOne({ complaintId });

        if (!complaint) {
            return res.status(404).json({ error: 'Complaint not found.' });
        }

        const now = new Date();
        const slaDeadline = new Date(complaint.slaDeadline);
        const timeRemaining = slaDeadline - now; // in milliseconds
        const isExpired = timeRemaining <= 0;

        let displayStatus = complaint.slaStatus;
        if (isExpired && !['Resolved', 'Escalated', 'Closed'].includes(complaint.status)) {
            displayStatus = 'SLA Breached';
        }

        res.json({
            complaintId: complaint.complaintId,
            status: complaint.status,
            slaDeadline: complaint.slaDeadline,
            timeRemainingMs: Math.max(0, timeRemaining),
            slaStatus: displayStatus,
            autoEscalated: complaint.autoEscalated,
            isExpired: isExpired
        });

    } catch (err) {
        console.error('Get SLA info error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
});

// Delete a complaint (user)
app.delete('/api/complaints/:complaintId', async (req, res) => {
    try {
        const { complaintId } = req.params;
        const { userEmail } = req.body;

        if (!userEmail) {
            return res.status(400).json({ error: 'User email is required.' });
        }

        // Find complaint
        const complaint = await Complaint.findOne({ complaintId });
        if (!complaint) {
            return res.status(404).json({ error: 'Complaint not found.' });
        }

        // Verify user is the one who filed the complaint
        if (complaint.userEmail !== userEmail.toLowerCase()) {
            return res.status(403).json({ error: 'You can only delete your own complaints.' });
        }

        // Allow deletion only if status is Pending
        if (complaint.status !== 'Pending') {
            return res.status(400).json({ error: 'Only pending complaints can be deleted.' });
        }

        // Delete complaint
        await Complaint.findOneAndDelete({ complaintId });

        res.json({ message: 'Complaint deleted successfully!' });

    } catch (err) {
        console.error('Delete complaint error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
});

// ============ USER ROUTES (ADMIN) ============

// Get all users (admin)
app.get('/api/users', async (req, res) => {
    try {
        const allUsers = await User.find({});

        // Remove password field from results
        const sanitized = allUsers.map(u => {
            const { password, ...rest } = u;
            return rest;
        });

        // Sort by createdAt descending
        sanitized.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        res.json(sanitized);

    } catch (err) {
        console.error('Get users error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
});

// Get all officers (admin and officer users)
app.get('/api/officers', async (req, res) => {
    try {
        const allUsers = await User.find({});
        const officers = allUsers.filter(u => u.role === 'admin' || u.role === 'officer');

        const formatted = officers
            .sort((a, b) => (a.fullName || '').localeCompare(b.fullName || ''))
            .map(o => ({
                email: o.email,
                fullName: o.fullName,
                department: o.department,
                designation: o.designation,
                employeeId: o.employeeId,
                isAvailable: o.isAvailable,
                availabilityUpdatedAt: o.availabilityUpdatedAt
            }));

        res.json(formatted);

    } catch (err) {
        console.error('Get officers error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
});

// ============ OFFICER AVAILABILITY ROUTES ============

// Officer toggles their availability status
app.patch('/api/officers/:officerEmail/availability', async (req, res) => {
    try {
        const { officerEmail } = req.params;
        const { isAvailable } = req.body;

        if (typeof isAvailable !== 'boolean') {
            return res.status(400).json({ error: 'isAvailable must be a boolean value.' });
        }

        const officer = await User.findOneAndUpdate(
            { email: officerEmail.toLowerCase(), role: { $in: ['officer', 'admin'] } },
            {
                isAvailable: isAvailable,
                availabilityUpdatedAt: new Date()
            },
            { new: true }
        );

        if (!officer) {
            return res.status(404).json({ error: 'Officer not found.' });
        }

        // Broadcast notification to admins about availability change
        broadcastNotification({
            type: 'officer_availability_changed',
            message: `🔄 ${officer.fullName} is now ${isAvailable ? 'available' : 'unavailable'}`,
            targetRole: 'admin',
            read: false,
            createdAt: new Date().toISOString()
        }, 'admin');

        res.json({
            message: `Availability status updated to ${isAvailable ? 'available' : 'unavailable'}!`,
            officer: {
                email: officer.email,
                fullName: officer.fullName,
                isAvailable: officer.isAvailable,
                availabilityUpdatedAt: officer.availabilityUpdatedAt
            }
        });

    } catch (err) {
        console.error('Update availability error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
});

// Get available officers for a specific department
app.get('/api/officers/available/:department', async (req, res) => {
    try {
        const { department } = req.params;
        const allUsers = await User.find({});
        const availableOfficers = allUsers.filter(u => 
            (u.role === 'admin' || u.role === 'officer') && 
            u.department === department && 
            u.isAvailable === true
        );

        const formatted = availableOfficers
            .sort((a, b) => (a.fullName || '').localeCompare(b.fullName || ''))
            .map(o => ({
                email: o.email,
                fullName: o.fullName,
                department: o.department,
                designation: o.designation,
                employeeId: o.employeeId,
                isAvailable: o.isAvailable
            }));

        res.json(formatted);

    } catch (err) {
        console.error('Get available officers error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
});

// ============ NOTIFICATION ROUTES ============

// Get notifications for admin
app.get('/api/notifications', async (req, res) => {
    try {
        const allNotifs = await Notification.find({ targetRole: 'admin' });
        const sorted = allNotifs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        res.json(sorted.slice(0, 50)); // Return last 50
    } catch (err) {
        console.error('Get notifications error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
});

// Mark notification as read
app.patch('/api/notifications/:id/read', async (req, res) => {
    try {
        const { id } = req.params;
        const updated = await Notification.findOneAndUpdate(
            { _id: id },
            { read: true },
            { new: true }
        );
        res.json({ message: 'Marked as read', notification: updated });
    } catch (err) {
        res.status(500).json({ error: 'Server error.' });
    }
});

// Mark all notifications as read
app.patch('/api/notifications/read-all', async (req, res) => {
    try {
        const allNotifs = await Notification.find({ read: false });
        for (const n of allNotifs) {
            await Notification.findOneAndUpdate(
                { _id: n._id },
                { read: true },
                { new: true }
            );
        }
        res.json({ message: 'All notifications marked as read' });
    } catch (err) {
        res.status(500).json({ error: 'Server error.' });
    }
});

// ============ ESCALATION HISTORY ============

app.get('/api/escalations', async (req, res) => {
    try {
        const history = await EscalationHistory.find({});
        const sorted = history.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        res.json(sorted);
    } catch (err) {
        res.status(500).json({ error: 'Server error.' });
    }
});

// ============ OFFICER PERFORMANCE ============

app.get('/api/officer-performance', async (req, res) => {
    try {
        const allComplaints = await Complaint.find({});
        const allUsers = await User.find({});
        const officers = allUsers.filter(u => u.role === 'admin' || u.role === 'officer');

        const performance = officers.map(officer => {
            const assigned = allComplaints.filter(c => c.assignedOfficer === officer.email);
            const total = assigned.length;
            const resolved = assigned.filter(c => ['Resolved', 'Closed'].includes(c.status)).length;
            const resolvedWithinSLA = assigned.filter(c => c.resolvedWithinSLA === true).length;
            const breached = assigned.filter(c => c.slaStatus === 'breached').length;
            const pending = assigned.filter(c => ['Pending', 'In Progress'].includes(c.status)).length;
            const score = resolved > 0 ? Math.round((resolvedWithinSLA / resolved) * 100) : 0;

            return {
                email: officer.email,
                fullName: officer.fullName,
                department: officer.department || 'N/A',
                designation: officer.designation || 'N/A',
                totalComplaints: total,
                resolved,
                resolvedWithinSLA,
                breached,
                pending,
                slaComplianceScore: score
            };
        });

        // Sort by total complaints descending
        performance.sort((a, b) => b.totalComplaints - a.totalComplaints);
        res.json(performance);
    } catch (err) {
        console.error('Officer performance error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
});

// ============ PUBLIC TRANSPARENCY STATS ============

app.get('/api/transparency', async (req, res) => {
    try {
        const allComplaints = await Complaint.find({});

        // Group by category (acting as department)
        const departments = {};
        allComplaints.forEach(c => {
            const dept = c.category || 'Other';
            if (!departments[dept]) {
                departments[dept] = { total: 0, resolved: 0, resolvedWithinSLA: 0, delayed: 0, breached: 0 };
            }
            departments[dept].total++;
            if (['Resolved', 'Closed'].includes(c.status)) {
                departments[dept].resolved++;
                if (c.resolvedWithinSLA === true) departments[dept].resolvedWithinSLA++;
                else departments[dept].delayed++;
            }
            if (c.slaStatus === 'breached') departments[dept].breached++;
        });

        const result = Object.keys(departments).map(dept => {
            const d = departments[dept];
            return {
                department: dept,
                totalComplaints: d.total,
                resolved: d.resolved,
                resolvedWithinSLA: d.resolvedWithinSLA,
                delayed: d.delayed,
                breached: d.breached,
                slaCompliance: d.resolved > 0 ? Math.round((d.resolvedWithinSLA / d.resolved) * 100) : 0
            };
        });

        res.json(result);
    } catch (err) {
        console.error('Transparency error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
});

// ============ SLA RULES INFO ============

app.get('/api/sla-rules', (req, res) => {
    res.json(SLA_RULES);
});

// ============ INDIVIDUAL OFFICER PERFORMANCE ============

app.get('/api/officer-performance/:email', async (req, res) => {
    try {
        const email = req.params.email.toLowerCase();
        const allComplaints = await Complaint.find({});
        const assigned = allComplaints.filter(c => c.assignedOfficer && c.assignedOfficer.toLowerCase() === email);

        const total = assigned.length;
        const resolved = assigned.filter(c => ['Resolved', 'Closed'].includes(c.status)).length;
        const resolvedWithinSLA = assigned.filter(c => c.resolvedWithinSLA === true).length;
        const breached = assigned.filter(c => c.slaStatus === 'breached').length;
        const pending = assigned.filter(c => ['Pending', 'In Progress', 'Reopened'].includes(c.status)).length;
        const escalated = assigned.filter(c => c.status === 'Escalated').length;
        const slaComplianceScore = resolved > 0 ? Math.round((resolvedWithinSLA / resolved) * 100) : 0;

        // Average resolution time (hours) for resolved complaints
        let avgResolutionHours = 0;
        const resolvedList = assigned.filter(c => ['Resolved', 'Closed'].includes(c.status) && c.createdAt && c.satisfactionSubmittedAt);
        if (resolvedList.length > 0) {
            const totalHours = resolvedList.reduce((sum, c) => {
                const diff = new Date(c.satisfactionSubmittedAt) - new Date(c.createdAt);
                return sum + (diff / (1000 * 60 * 60));
            }, 0);
            avgResolutionHours = Math.round(totalHours / resolvedList.length);
        }

        // Nearing SLA (<2 hours)
        const nearingSLA = assigned.filter(c => {
            if (!c.slaDeadline || ['Resolved','Closed'].includes(c.status)) return false;
            const hoursLeft = (new Date(c.slaDeadline) - new Date()) / (1000 * 60 * 60);
            return hoursLeft > 0 && hoursLeft <= 2;
        }).length;

        res.json({ email, total, resolved, resolvedWithinSLA, breached, pending, escalated, slaComplianceScore, avgResolutionHours, nearingSLA, complaints: assigned });
    } catch (err) {
        console.error('Individual officer performance error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
});

// ============ ASSIGNMENT AUDIT TRAIL ============

app.get('/api/complaints/audit/assignments', async (req, res) => {
    try {
        const allComplaints = await Complaint.find({});
        const assigned = allComplaints
            .filter(c => c.assignedOfficer)
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
            .map(c => ({
                complaintId: c.complaintId,
                title: c.title,
                category: c.category,
                ward: c.ward,
                status: c.status,
                slaStatus: c.slaStatus,
                assignedOfficer: c.assignedOfficer,
                assignedOfficerName: c.assignedOfficerName,
                assignedOfficerDepartment: c.assignedOfficerDepartment,
                createdAt: c.createdAt,
                slaDeadline: c.slaDeadline,
                priority: c.priority,
                escalationLevel: c.escalationLevel,
                autoEscalated: c.autoEscalated
            }));
        res.json(assigned);
    } catch (err) {
        res.status(500).json({ error: 'Server error.' });
    }
});

// ============ DEPARTMENT ANALYTICS ============

app.get('/api/analytics/department', async (req, res) => {
    try {
        const allComplaints = await Complaint.find({});

        // By category (department)
        const byCategory = {};
        allComplaints.forEach(c => {
            const cat = c.category || 'Other';
            if (!byCategory[cat]) byCategory[cat] = { total: 0, resolved: 0, pending: 0, escalated: 0, breached: 0, withinSLA: 0 };
            byCategory[cat].total++;
            if (['Resolved','Closed'].includes(c.status)) byCategory[cat].resolved++;
            else if (c.status === 'Pending' || c.status === 'In Progress') byCategory[cat].pending++;
            if (c.status === 'Escalated') byCategory[cat].escalated++;
            if (c.slaStatus === 'breached') byCategory[cat].breached++;
            if (c.resolvedWithinSLA === true) byCategory[cat].withinSLA++;
        });

        // SLA trend by month (last 6 months)
        const now = new Date();
        const monthlyTrend = [];
        for (let i = 5; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const monthStr = d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
            const monthComplaints = allComplaints.filter(c => {
                const cd = new Date(c.createdAt);
                return cd.getFullYear() === d.getFullYear() && cd.getMonth() === d.getMonth();
            });
            const resolvedMonthly = monthComplaints.filter(c => ['Resolved','Closed'].includes(c.status));
            const withinSLAMonthly = resolvedMonthly.filter(c => c.resolvedWithinSLA === true);
            monthlyTrend.push({
                month: monthStr,
                total: monthComplaints.length,
                resolved: resolvedMonthly.length,
                slaCompliance: resolvedMonthly.length > 0 ? Math.round((withinSLAMonthly.length / resolvedMonthly.length) * 100) : 0
            });
        }

        // Officers workload
        const allUsers = await User.find({});
        const officers = allUsers.filter(u => u.role === 'admin' || u.role === 'officer');
        const officerWorkload = officers.map(o => {
            const oComplaints = allComplaints.filter(c => c.assignedOfficer === o.email);
            return {
                name: o.fullName,
                email: o.email,
                activeComplaints: oComplaints.filter(c => !['Resolved','Closed'].includes(c.status)).length,
                totalAssigned: oComplaints.length
            };
        }).filter(o => o.totalAssigned > 0);

        res.json({
            byCategory: Object.entries(byCategory).map(([cat, d]) => ({ category: cat, ...d, slaCompliance: d.resolved > 0 ? Math.round((d.withinSLA / d.resolved) * 100) : 0 })),
            monthlyTrend,
            officerWorkload,
            totalComplaints: allComplaints.length,
            totalResolved: allComplaints.filter(c => ['Resolved','Closed'].includes(c.status)).length,
            totalEscalated: allComplaints.filter(c => c.status === 'Escalated').length,
            totalBreached: allComplaints.filter(c => c.slaStatus === 'breached').length
        });
    } catch (err) {
        console.error('Department analytics error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
});

// ============ OFFICER NOTIFICATIONS ============

app.get('/api/notifications/officer/:email', async (req, res) => {
    try {
        const email = req.params.email.toLowerCase();
        const allNotifs = await Notification.find({});
        // Officer notifications: new assignments, SLA warnings for their complaints
        const allComplaints = await Complaint.find({});
        const officerComplaints = allComplaints.filter(c => c.assignedOfficer && c.assignedOfficer.toLowerCase() === email);

        const officerComplaintIds = officerComplaints.map(c => c.complaintId);
        const relevantNotifs = allNotifs
            .filter(n => officerComplaintIds.includes(n.complaintId) || (n.targetRole === 'officer' && (n.targetEmail === email || !n.targetEmail)))
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
            .slice(0, 50);

        // Also generate real-time SLA alerts for officer's complaints
        const slaAlerts = [];
        officerComplaints.forEach(c => {
            if (!c.slaDeadline || ['Resolved','Closed'].includes(c.status)) return;
            const hoursLeft = (new Date(c.slaDeadline) - new Date()) / (1000 * 60 * 60);
            if (hoursLeft < 0) {
                slaAlerts.push({ type: 'sla_breach', complaintId: c.complaintId, category: c.category, message: `🚨 SLA BREACHED: ${c.complaintId} - ${c.category}`, read: false, createdAt: new Date().toISOString() });
            } else if (hoursLeft <= 2) {
                slaAlerts.push({ type: 'sla_warning', complaintId: c.complaintId, category: c.category, message: `⏰ SLA Warning: ${c.complaintId} - ${Math.round(hoursLeft * 60)} min remaining`, read: false, createdAt: new Date().toISOString() });
            }
        });

        // Check for reopened complaints assigned to this officer
        const reopenedComplaints = officerComplaints.filter(c => c.status === 'Reopened');
        reopenedComplaints.forEach(c => {
            slaAlerts.push({ type: 'reappeal_filed', complaintId: c.complaintId, category: c.category, message: `🔁 Citizen reopened: ${c.complaintId} - ${c.title}`, read: false, createdAt: c.createdAt });
        });

        res.json([...slaAlerts, ...relevantNotifs]);
    } catch (err) {
        res.status(500).json({ error: 'Server error.' });
    }
});

// ============ USER NOTIFICATIONS ============

app.get('/api/notifications/user/:email', async (req, res) => {
    try {
        const email = req.params.email.toLowerCase();
        const allNotifs = await Notification.find({});
        const allComplaints = await Complaint.find({});
        
        // User's complaints
        const userComplaints = allComplaints.filter(c => c.userEmail && c.userEmail.toLowerCase() === email);
        const userComplaintIds = userComplaints.map(c => c.complaintId);

        // Get notifications for user's complaints
        const relevantNotifs = allNotifs
            .filter(n => userComplaintIds.includes(n.complaintId))
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
            .slice(0, 50);

        // Generate status and update notifications for user's complaints
        const statusUpdates = [];
        userComplaints.forEach(c => {
            if (c.status === 'In Progress') {
                statusUpdates.push({
                    type: 'complaint_status_changed',
                    complaintId: c.complaintId,
                    category: c.category,
                    message: `✏️ Update: ${c.complaintId} is now being worked on by ${c.assignedOfficerName || 'an officer'}`,
                    read: false,
                    createdAt: c.createdAt
                });
            }
            if (c.status === 'Resolved') {
                statusUpdates.push({
                    type: 'complaint_resolved',
                    complaintId: c.complaintId,
                    category: c.category,
                    message: `✅ Resolved: ${c.complaintId} has been resolved - Please review and provide feedback`,
                    read: false,
                    createdAt: c.createdAt
                });
            }
            if (c.status === 'Closed') {
                statusUpdates.push({
                    type: 'complaint_closed',
                    complaintId: c.complaintId,
                    category: c.category,
                    message: `✔️ Closed: ${c.complaintId} - Thank you for using JanConnect`,
                    read: false,
                    createdAt: c.createdAt
                });
            }
        });

        res.json([...statusUpdates, ...relevantNotifs]);
    } catch (err) {
        console.error('Get user notifications error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
});

// Delete notification
app.delete('/api/notifications/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await Notification.findByIdAndDelete(id);
        res.json({ message: 'Notification deleted' });
    } catch (err) {
        res.status(500).json({ error: 'Server error.' });
    }
});

// Delete all old notifications (older than 7 days)
app.delete('/api/notifications/cleanup/old', async (req, res) => {
    try {
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const result = await Notification.deleteMany({ createdAt: { $lt: sevenDaysAgo }, read: true });
        res.json({ message: 'Old notifications cleaned up', deletedCount: result.deletedCount });
    } catch (err) {
        res.status(500).json({ error: 'Server error.' });
    }
});

// ============ SEED TEST DATA ============

app.post('/api/seed', async (req, res) => {
    try {
        const now = new Date();
        const seedComplaints = [
            {
                complaintId: 'SG-TEST-001',
                category: 'Sanitation',
                ward: 'Ward 14 – Koregaon Park',
                title: 'Garbage not collected for 3 days',
                description: 'Garbage bins overflowing near the main road.',
                address: 'Near Koregaon Park main chowk',
                image: null,
                status: 'Pending',
                userEmail: 'test@citizen.com',
                date: now.toLocaleDateString('en-IN'),
                slaDeadline: new Date(now.getTime() + 10 * 60 * 60 * 1000).toISOString(), // 10h from now — within SLA
                slaStatus: 'within_sla',
                autoEscalated: false,
                escalationLevel: 0,
                resolvedWithinSLA: null,
                support_count: 3,
                supporters: [],
                assignedOfficer: null,
                assignedOfficerName: null,
                assignedOfficerDepartment: null,
                afterImage: null,
                resolutionNotes: '',
                reappeal_status: false,
                reappeal_reason: '',
                reappeal_comment: '',
                reappeal_image: null,
                reappeal_count: 0,
                priority: 'Normal',
                userSatisfied: null,
                userSatisfactionFeedback: null,
                satisfactionSubmittedAt: null
            },
            {
                complaintId: 'SG-TEST-002',
                category: 'Water Supply',
                ward: 'Ward 7 – Shivajinagar',
                title: 'Water pipe burst on main road',
                description: 'Major water leak causing road flooding.',
                address: 'Shivajinagar bus stop area',
                image: null,
                status: 'In Progress',
                userEmail: 'test@citizen.com',
                date: now.toLocaleDateString('en-IN'),
                slaDeadline: new Date(now.getTime() + 1.5 * 60 * 60 * 1000).toISOString(), // 1.5h — near deadline
                slaStatus: 'warning',
                autoEscalated: false,
                escalationLevel: 0,
                resolvedWithinSLA: null,
                support_count: 7,
                supporters: [],
                assignedOfficer: 'ravi@officer.gov',
                assignedOfficerName: 'Ravi Kumar',
                assignedOfficerDepartment: 'Water Dept',
                afterImage: null,
                resolutionNotes: '',
                reappeal_status: false,
                reappeal_reason: '',
                reappeal_comment: '',
                reappeal_image: null,
                reappeal_count: 0,
                priority: 'High',
                userSatisfied: null,
                userSatisfactionFeedback: null,
                satisfactionSubmittedAt: null
            },
            {
                complaintId: 'SG-TEST-003',
                category: 'Roads & Infra',
                ward: 'Ward 3 – Peth Area',
                title: 'Pothole causing accidents',
                description: 'Large pothole on main highway junction.',
                address: 'Peth area highway crossing',
                image: null,
                status: 'Escalated',
                userEmail: 'test@citizen.com',
                date: new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000).toLocaleDateString('en-IN'),
                slaDeadline: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(), // breached 24h ago
                slaStatus: 'breached',
                autoEscalated: true,
                escalationLevel: 2,
                resolvedWithinSLA: null,
                support_count: 15,
                supporters: [],
                assignedOfficer: 'suresh@officer.gov',
                assignedOfficerName: 'Suresh Patil',
                assignedOfficerDepartment: 'Road Dept',
                afterImage: null,
                resolutionNotes: '',
                reappeal_status: false,
                reappeal_reason: '',
                reappeal_comment: '',
                reappeal_image: null,
                reappeal_count: 0,
                priority: 'Critical',
                userSatisfied: null,
                userSatisfactionFeedback: null,
                satisfactionSubmittedAt: null
            },
            {
                complaintId: 'SG-TEST-004',
                category: 'Electricity',
                ward: 'Ward 21 – Cidco',
                title: 'Streetlight not working',
                description: 'Multiple streetlights on Cidco road are off.',
                address: 'Cidco N-4 road',
                image: null,
                status: 'Resolved',
                userEmail: 'test@citizen.com',
                date: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toLocaleDateString('en-IN'),
                slaDeadline: new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString(),
                slaStatus: 'resolved',
                autoEscalated: false,
                escalationLevel: 0,
                resolvedWithinSLA: true,
                support_count: 2,
                supporters: [],
                assignedOfficer: 'anita@officer.gov',
                assignedOfficerName: 'Anita Desai',
                assignedOfficerDepartment: 'Electrical Dept',
                afterImage: null,
                resolutionNotes: 'All streetlights repaired and tested.',
                reappeal_status: false,
                reappeal_reason: '',
                reappeal_comment: '',
                reappeal_image: null,
                reappeal_count: 0,
                priority: 'Normal',
                userSatisfied: true,
                userSatisfactionFeedback: 'Good work',
                satisfactionSubmittedAt: now.toISOString()
            },
            {
                complaintId: 'SG-TEST-005',
                category: 'Public Safety',
                ward: 'Ward 10 – Nashik Road',
                title: 'Broken railing on bridge',
                description: 'Safety railing on pedestrian bridge is broken.',
                address: 'Nashik Road railway bridge',
                image: null,
                status: 'Pending',
                userEmail: 'test@citizen.com',
                date: now.toLocaleDateString('en-IN'),
                slaDeadline: new Date(now.getTime() + 20 * 60 * 60 * 1000).toISOString(), // within SLA
                slaStatus: 'within_sla',
                autoEscalated: false,
                escalationLevel: 0,
                resolvedWithinSLA: null,
                support_count: 5,
                supporters: [],
                assignedOfficer: null,
                assignedOfficerName: null,
                assignedOfficerDepartment: null,
                afterImage: null,
                resolutionNotes: '',
                reappeal_status: false,
                reappeal_reason: '',
                reappeal_comment: '',
                reappeal_image: null,
                reappeal_count: 0,
                priority: 'High',
                userSatisfied: null,
                userSatisfactionFeedback: null,
                satisfactionSubmittedAt: null
            }
        ];

        // Add seed complaints
        let addedCount = 0;
        for (const sc of seedComplaints) {
            const exists = await Complaint.findOne({ complaintId: sc.complaintId });
            if (!exists) {
                await Complaint.create(sc);
                addedCount++;
            }
        }

        // Add seed escalation history
        const existingEsc = await EscalationHistory.find({ complaintId: 'SG-TEST-003' });
        if (existingEsc.length === 0) {
            await EscalationHistory.create({
                complaintId: 'SG-TEST-003',
                fromLevel: 0,
                toLevel: 1,
                escalatedTo: 'Ward Supervisor',
                reason: 'SLA deadline breached',
                delayHours: 24
            });
            await EscalationHistory.create({
                complaintId: 'SG-TEST-003',
                fromLevel: 1,
                toLevel: 2,
                escalatedTo: 'Department Head',
                reason: 'SLA still breached after 48 hours',
                delayHours: 48
            });
        }

        // Add seed notifications
        const existingNotifs = await Notification.find({ complaintId: 'SG-TEST-002' });
        if (existingNotifs.length === 0) {
            await Notification.create({
                type: 'sla_warning',
                complaintId: 'SG-TEST-002',
                category: 'Water Supply',
                message: 'SLA Warning: Complaint SG-TEST-002 nearing deadline',
                targetRole: 'admin',
                read: false
            });
            await Notification.create({
                type: 'sla_breach',
                complaintId: 'SG-TEST-003',
                category: 'Roads & Infra',
                message: 'SLA Breach: Complaint SG-TEST-003 exceeded SLA. Escalated to Department Head',
                targetRole: 'admin',
                read: false
            });
        }

        // Add mock officers so they show up in Performance charts
        const mockOfficers = [
            { email: 'ravi@officer.gov', fullName: 'Ravi Kumar', role: 'officer', department: 'Water Dept', designation: 'Field Officer', password: '123' },
            { email: 'suresh@officer.gov', fullName: 'Suresh Patil', role: 'officer', department: 'Road Dept', designation: 'Senior Officer', password: '123' },
            { email: 'anita@officer.gov', fullName: 'Anita Desai', role: 'officer', department: 'Electrical Dept', designation: 'Supervisor', password: '123' }
        ];

        for (const o of mockOfficers) {
            const exists = await User.findOne({ email: o.email });
            if (!exists) {
                await User.create(o);
            }
        }

        res.json({ message: `Seed data added: ${addedCount} complaints, escalation history, and notifications.` });
    } catch (err) {
        console.error('Seed error:', err);
        res.status(500).json({ error: 'Server error during seeding.' });
    }
});

// ============ CATCH-ALL: Serve frontend ============

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'frontend', 'login.html'));
});

// ============ START SERVER ============

server.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`🔗 WebSocket available at ws://localhost:${PORT}`);
    console.log('📁 MongoDB Atlas connected and ready!');
    console.log(`📂 Data directory: ${path.join(__dirname, 'data')}`);
});