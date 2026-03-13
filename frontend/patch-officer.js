const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'officer-dashboard.html');
let html = fs.readFileSync(file, 'utf8');

const target = `<a class="sidebar-menu-item" onclick="sidebarNavigate('complaints')">
            <span class="menu-icon">📋</span> My Assigned Complaints
        </a>`;

const insert = `
        <a class="sidebar-menu-item" onclick="sidebarNavigate('update-status')">
            <span class="menu-icon">🔄</span> Update Status
        </a>
        <a class="sidebar-menu-item" onclick="sidebarNavigate('upload-evidence')">
            <span class="menu-icon">📸</span> Upload Work Evidence
        </a>`;

if(html.includes(target) && !html.includes('Update Status')) {
    html = html.replace(target, target + insert);
    fs.writeFileSync(file, html, 'utf8');
    console.log('patched officer html');
} else {
    console.log('could not find target or already patched');
}
