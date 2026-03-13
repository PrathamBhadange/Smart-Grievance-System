const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'officer-dashboard.html');
let content = fs.readFileSync(filePath, 'utf8');

// Title & badges
content = content.replace('<title>JanConnect - Admin Dashboard</title>', '<title>JanConnect - Officer Dashboard</title>');
content = content.replace('<span class="admin-badge">ADMIN</span>', '<span class="admin-badge">OFFICER</span>');
content = content.replace('🛡️ Admin Panel — Welcome,', '👮 Officer Panel — Welcome,');
content = content.replace('🛡️ Admin Panel', '👮 Officer Panel');
content = content.replace('<div class="sidebar-username" id="sidebarUsername">Admin</div>', '<div class="sidebar-username" id="sidebarUsername">Officer</div>');
content = content.replace('<div class="sidebar-role">Administrator</div>', '<div class="sidebar-role">Field/Ward Officer</div>');

// Sidebar menu
const newSidebar = `
        <a class="sidebar-menu-item active" onclick="sidebarNavigate('dashboard')">
            <span class="menu-icon">🏠</span> Dashboard
        </a>
        <a class="sidebar-menu-item" onclick="sidebarNavigate('complaints')">
            <span class="menu-icon">📋</span> My Assigned Complaints
        </a>
        <a class="sidebar-menu-item" onclick="sidebarNavigate('sla-monitoring')">
            <span class="menu-icon">⏱️</span> SLA Alerts
        </a>
        <a class="sidebar-menu-item" onclick="sidebarNavigate('officer-performance')">
            <span class="menu-icon">👮</span> My Performance
        </a>
        <a class="sidebar-menu-item" onclick="toggleNotifPanel(); closeSidebar();">
            <span class="menu-icon">🔔</span> Notifications
        </a>
`;
// We will replace the whole sidebar menu content.
content = content.replace(/<div class="sidebar-menu">[\s\S]*?<\/div>\s*<div class="sidebar-footer">/, '<div class="sidebar-menu">' + newSidebar + '</div>\n    <div class="sidebar-footer">');

// Auth check
content = content.replace(/if\(!currentUser \|\| !userEmail \|\| userRole !== 'admin'\)\{/g, "if(!currentUser || !userEmail || (userRole !== 'officer' && userRole !== 'admin')){");

// Fetch endpoint
content = content.replace("const res = await fetch(API_BASE + '/complaints');", "const res = await fetch(API_BASE + '/complaints/assigned/' + userEmail);");

// Remove Assign Officer modal related stuff (since they only update, not assign)
// Wait, the officer needs "Update Status, Upload Work Evidence". The existing "Resolve Complaint" modal works for that.
// The officer doesn't need "Assign Complaints", "Department Analytics", "Reports/Downloads", "Registered Users", "Escalations" in the HTML body.
// Better let the script hide them:
content = content.replace('<div class="escalation-section" id="escalationSection">', '<div class="escalation-section" id="escalationSection" style="display:none;">');
content = content.replace('<!-- Reports / Downloads Section -->', '<!-- Reports / Downloads Section (Hidden for Officer) -->\n<div style="display:none;">');
content = content.replace('<!-- Registered Users Section -->', '</div><!-- Registered Users Section -->');
content = content.replace('<h3 data-lang-key="registered_users">👥 Registered Users</h3>', '<h3 data-lang-key="registered_users" style="display:none;">👥 Registered Users</h3>');
content = content.replace('<div id="usersList"></div>', '<div id="usersList" style="display:none;"></div>');
content = content.replace('<div class="box" style="margin-top:30px">', '<div class="box" style="margin-top:30px; display:none;">'); // Hide ward table

fs.writeFileSync(filePath, content, 'utf8');
console.log('Officer dashboard updated successfully.');
