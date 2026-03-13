// ============ NOTIFICATION PANEL SYSTEM ============
// Real-time notification management for all portals

class NotificationPanel {
    constructor(containerId) {
        this.containerId = containerId;
        this.notifications = [];
        this.unreadCount = 0;
        this.currentUser = JSON.parse(localStorage.getItem('currentUser')) || {};
        this.ws = null;
        this.notificationAPI = `/api/notifications/${this.currentUser.role}/${this.currentUser.email}`;
        
        this.init();
    }

    async init() {
        this.loadNotifications();
        this.setupWebSocket();
        this.setupUIHandlers();
        // Refresh notifications every 30 seconds
        setInterval(() => this.loadNotifications(), 30000);
    }

    async loadNotifications() {
        try {
            const response = await fetch(this.notificationAPI);
            if (!response.ok) throw new Error('Failed to fetch notifications');
            
            this.notifications = await response.json();
            this.unreadCount = this.notifications.filter(n => !n.read).length;
            this.renderNotifications();
            this.updateBadge();
        } catch (err) {
            console.error('Error loading notifications:', err);
        }
    }

    setupWebSocket() {
        try {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = `wss://smart-grievance-system-noiq.onrender.com?email=${this.currentUser.email}&role=${this.currentUser.role}`;
            
            this.ws = new WebSocket(wsUrl);
            
            this.ws.onopen = () => {
                console.log('✅ WebSocket connected for notifications');
            };
            
            this.ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    if (data.type === 'notification' && data.notification) {
                        this.addNotification(data.notification);
                    }
                } catch (err) {
                    console.error('WebSocket message error:', err);
                }
            };
            
            this.ws.onerror = (error) => {
                console.error('WebSocket error:', error);
            };
            
            this.ws.onclose = () => {
                console.log('❌ WebSocket disconnected');
                // Reconnect after 5 seconds
                setTimeout(() => this.setupWebSocket(), 5000);
            };
        } catch (err) {
            console.error('WebSocket setup error:', err);
        }
    }

    addNotification(notification) {
        // Check if notification already exists
        const exists = this.notifications.some(n => 
            n.complaintId === notification.complaintId && 
            n.type === notification.type &&
            Math.abs(new Date(n.createdAt) - new Date(notification.createdAt)) < 1000
        );
        
        if (!exists) {
            this.notifications.unshift(notification);
            this.unreadCount++;
            this.renderNotifications();
            this.updateBadge();
            this.showToast(notification);
        }
    }

    setupUIHandlers() {
        const container = document.getElementById(this.containerId);
        if (!container) return;

        // Mark as read
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('mark-read-btn')) {
                const notifId = e.target.dataset.id;
                this.markAsRead(notifId);
            }
            if (e.target.classList.contains('delete-notification-btn')) {
                const notifId = e.target.dataset.id;
                this.deleteNotification(notifId);
            }
            if (e.target.classList.contains('mark-all-read-btn')) {
                this.markAllAsRead();
            }
            if (e.target.classList.contains('view-complaint-btn')) {
                const complaintId = e.target.dataset.complaintId;
                this.viewComplaint(complaintId);
            }
        });
    }

    async markAsRead(notifId) {
        try {
            const response = await fetch(`/api/notifications/${notifId}/read`, { method: 'PATCH' });
            if (response.ok) {
                const notification = this.notifications.find(n => n._id === notifId);
                if (notification) {
                    notification.read = true;
                    this.unreadCount = Math.max(0, this.unreadCount - 1);
                    this.renderNotifications();
                    this.updateBadge();
                }
            }
        } catch (err) {
            console.error('Error marking notification as read:', err);
        }
    }

    async markAllAsRead() {
        try {
            const response = await fetch('/api/notifications/read-all', { method: 'PATCH' });
            if (response.ok) {
                this.notifications.forEach(n => n.read = true);
                this.unreadCount = 0;
                this.renderNotifications();
                this.updateBadge();
            }
        } catch (err) {
            console.error('Error marking all as read:', err);
        }
    }

    async deleteNotification(notifId) {
        try {
            const response = await fetch(`/api/notifications/${notifId}`, { method: 'DELETE' });
            if (response.ok) {
                this.notifications = this.notifications.filter(n => n._id !== notifId);
                this.renderNotifications();
            }
        } catch (err) {
            console.error('Error deleting notification:', err);
        }
    }

    viewComplaint(complaintId) {
        if (this.currentUser.role === 'user') {
            window.location.href = `complaint-detail.html?id=${complaintId}`;
        } else if (this.currentUser.role === 'officer') {
            window.location.href = `officer-dashboard.html?complaintId=${complaintId}`;
        } else if (this.currentUser.role === 'admin') {
            window.location.href = `admin-dashboard.html?complaintId=${complaintId}`;
        }
    }

    renderNotifications() {
        const container = document.getElementById(this.containerId);
        if (!container) return;

        if (this.notifications.length === 0) {
            container.innerHTML = '<div class="notification-empty">No notifications yet</div>';
            return;
        }

        const html = this.notifications.map(notif => this.createNotificationHTML(notif)).join('');
        container.innerHTML = `
            <div class="notification-header">
                <h3>Notifications (${this.unreadCount})</h3>
                <button class="mark-all-read-btn" title="Mark all as read">✓ Mark all</button>
            </div>
            <div class="notification-list">
                ${html}
            </div>
        `;
    }

    createNotificationHTML(notif) {
        const timeAgo = this.getTimeAgo(new Date(notif.createdAt));
        const readClass = notif.read ? 'read' : 'unread';
        const iconMap = {
            'complaint_filed': '📧',
            'complaint_assigned': '👤',
            'complaint_status_changed': '🔄',
            'complaint_resolved': '✅',
            'complaint_closed': '✔️',
            'officer_assigned': '👷',
            'sla_warning': '⏰',
            'sla_breach': '🚨',
            'reappeal_filed': '🔁',
            'escalation_alert': '⬆️',
            'status_changed': '🔄',
            'review_request': '📋'
        };

        const icon = iconMap[notif.type] || '📢';

        return `
            <div class="notification-item ${readClass}" data-id="${notif._id}">
                <div class="notification-icon">${icon}</div>
                <div class="notification-content">
                    <div class="notification-title">${notif.message}</div>
                    <div class="notification-meta">
                        <span class="notification-time">${timeAgo}</span>
                        <span class="notification-complaint-id">${notif.complaintId}</span>
                    </div>
                </div>
                <div class="notification-actions">
                    ${!notif.read ? '<button class="mark-read-btn" data-id="${notif._id}" title="Mark as read">✓</button>' : ''}
                    <button class="view-complaint-btn" data-complaint-id="${notif.complaintId}" title="View complaint">→</button>
                    <button class="delete-notification-btn" data-id="${notif._id}" title="Delete">✕</button>
                </div>
            </div>
        `;
    }

    getTimeAgo(date) {
        const seconds = Math.floor((new Date() - date) / 1000);
        
        if (seconds < 60) return 'just now';
        if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
        if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago';
        return Math.floor(seconds / 86400) + 'd ago';
    }

    updateBadge() {
        const badge = document.getElementById('notification-badge');
        if (badge) {
            badge.textContent = this.unreadCount;
            badge.style.display = this.unreadCount > 0 ? 'inline-block' : 'none';
        }
    }

    showToast(notification) {
        const toast = document.createElement('div');
        toast.className = 'notification-toast';
        toast.innerHTML = `
            <span class="toast-icon">${this.getIconForType(notification.type)}</span>
            <span class="toast-message">${notification.message}</span>
        `;
        document.body.appendChild(toast);

        setTimeout(() => toast.classList.add('show'), 100);
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 5000);
    }

    getIconForType(type) {
        const iconMap = {
            'complaint_filed': '📧',
            'complaint_assigned': '👤',
            'complaint_status_changed': '🔄',
            'complaint_resolved': '✅',
            'officer_assigned': '👷',
            'sla_warning': '⏰',
            'sla_breach': '🚨',
            'reappeal_filed': '🔁'
        };
        return iconMap[type] || '📢';
    }

    close() {
        if (this.ws) this.ws.close();
    }
}

// Initialize notification panel when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    const container = document.querySelector('[data-notification-panel]');
    if (container) {
        window.notificationPanel = new NotificationPanel('notification-panel');
    }
});

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (window.notificationPanel) {
        window.notificationPanel.close();
    }
});
