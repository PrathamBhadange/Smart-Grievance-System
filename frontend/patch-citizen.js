const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'citizen-dashboard.html');
let content = fs.readFileSync(filePath, 'utf8');

// 1. Add notification CSS if not present
if (!content.includes('.notif-bell')) {
    const cssToInsert = `
/* Notification Bell */
.notif-bell{position:relative;cursor:pointer;font-size:20px;padding:4px;}
.notif-badge{position:absolute;top:-4px;right:-6px;background:#e74c3c;color:white;font-size:10px;font-weight:700;width:18px;height:18px;border-radius:50%;display:flex;align-items:center;justify-content:center;}
.notif-panel{display:none;position:absolute;top:45px;right:0;background:white;width:340px;max-height:380px;overflow-y:auto;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,0.2);z-index:2000;}
.notif-panel.active{display:block;}
.notif-panel-header{padding:14px 18px;font-weight:700;font-size:14px;color:#2c3e50;border-bottom:1px solid #eee;display:flex;justify-content:space-between;align-items:center;}
.notif-panel-header button{background:none;border:none;color:#2c3e90;font-size:12px;font-weight:600;cursor:pointer;}
.notif-item{padding:12px 18px;border-bottom:1px solid #f5f5f5;font-size:13px;color:#555;cursor:pointer;transition:background 0.15s;}
.notif-item:hover{background:#f8f9fb;}
.notif-item.unread{background:#fef9e7;border-left:3px solid #f39c12;}
.notif-item.breach{border-left-color:#e74c3c;background:#fdf2f2;}
.notif-item .notif-time{font-size:11px;color:#aaa;margin-top:4px;}
.notif-empty{padding:30px;text-align:center;color:#999;font-size:13px;}
`;
    content = content.replace('</style>', cssToInsert + '\n</style>');
}

// 2. Add notification bell HTML
if (!content.includes('id="notifContainer"')) {
    const htmlToInsert = `
    <!-- Notification Bell -->
    <div style="position:relative;" id="notifContainer">
        <div class="notif-bell" onclick="toggleNotifPanel()">
            🔔<span class="notif-badge" id="notifBadge" style="display:none;">0</span>
        </div>
        <div class="notif-panel" id="notifPanel">
            <div class="notif-panel-header">
                <span>Notifications</span>
                <button onclick="markAllRead()">Dismiss</button>
            </div>
            <div id="notifList"><div class="notif-empty">No notifications</div></div>
        </div>
    </div>
    `;
    content = content.replace('<span id="userWelcome" style="font-size:15px;"></span>', '<span id="userWelcome" style="font-size:15px;"></span>\n' + htmlToInsert);
}

// 3. Add JS logic
if (!content.includes('function fetchNotifications()')) {
    const jsToInsert = `
// ============ NOTIFICATIONS ============

let notifData = [];
function fetchNotifications() {
    const list = document.getElementById('notifList');
    const badge = document.getElementById('notifBadge');
    
    if(!cachedComplaints) return;
    
    notifData = [];
    cachedComplaints.forEach(c => {
        if (!c.slaDeadline || ['Resolved','Closed'].includes(c.status)) return;
        const timeRemainingMs = new Date(c.slaDeadline) - new Date();
        const hoursRemaining = timeRemainingMs / (1000 * 60 * 60);
        
        if (hoursRemaining < 0) {
            notifData.push({ type: 'sla_breach', message: 'SLA Breach: Complaint ' + c.complaintId + ' exceeded SLA deadline!' });
        } else if (hoursRemaining <= 12) {
            notifData.push({ type: 'sla_warning', message: 'SLA Warning: Complaint ' + c.complaintId + ' deadline is near.' });
        }
    });
    
    // Sort, breach first
    notifData.sort((a,b) => a.type === 'sla_breach' ? -1 : 1);
    
    if(notifData.length === 0) {
        list.innerHTML = '<div class="notif-empty">No notifications</div>';
        badge.style.display = 'none';
        return;
    }
    
    let html = '';
    notifData.forEach(n => {
        const breachClass = n.type === 'sla_breach' ? 'breach' : '';
        html += '<div class="notif-item unread ' + breachClass + '">';
        html += '<div>' + n.message + '</div>';
        html += '<div class="notif-time">Just now</div>';
        html += '</div>';
    });
    list.innerHTML = html;
    
    badge.textContent = notifData.length;
    badge.style.display = 'flex';
}

function toggleNotifPanel() {
    const p = document.getElementById('notifPanel');
    if(p.classList.contains('active')) {
        p.classList.remove('active');
    } else {
        p.classList.add('active');
        fetchNotifications();
    }
}
function markAllRead() {
    document.getElementById('notifList').innerHTML = '<div class="notif-empty">No notifications</div>';
    document.getElementById('notifBadge').style.display = 'none';
}

// Call fetchNotifications after loading complaints
const oldRenderComplaintsList = window.renderComplaintsList;
window.renderComplaintsList = function(complaints, ...args) {
    if(oldRenderComplaintsList) oldRenderComplaintsList(complaints, ...args);
    fetchNotifications();
};

const originalFetchAllComplaints = fetchAllComplaints;
window.fetchAllComplaints = async function() {
    const res = await originalFetchAllComplaints.apply(this, arguments);
    fetchNotifications();
    return res;
}
`;
    content = content.replace('// ============ WARD TABLE ============', jsToInsert + '\n// ============ WARD TABLE ============');
}

fs.writeFileSync(filePath, content, 'utf8');
console.log('patched citizen dashboard');
