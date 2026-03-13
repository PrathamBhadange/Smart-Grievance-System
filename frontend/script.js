const API_BASE = 'https://smart-grievance-system-noiq.onrender.com/api';

function togglePassword(fieldId) {
    const field = document.getElementById(fieldId);
    field.type = field.type === "password" ? "text" : "password";
}

document.getElementById("loginForm").addEventListener("submit", async function(e){
    e.preventDefault();
    
    const email = document.getElementById("email").value;
    const password = document.getElementById("password").value;
    const role = document.getElementById("role").value;
    const message = document.getElementById("message");
    
    message.style.color = "#555";
    message.innerHTML = "Logging in...";

    try {
        const res = await fetch(API_BASE + '/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, role })
        });

        const data = await res.json();

        if(res.ok){
            message.style.color = "green";
            message.innerHTML = "Login Successful! Redirecting...";
            
            // Store user info in localStorage for session
            localStorage.setItem('currentUser', JSON.stringify(data.user));
            localStorage.setItem('userEmail', data.user.email);
            localStorage.setItem('userRole', data.user.role);
            
            // Redirect based on role
            setTimeout(() => {
                if(role === "admin"){
                    window.location.href = "admin-dashboard.html";
                } else if(role === "officer"){
                    window.location.href = "officer-portal.html";
                } else {
                    window.location.href = "citizen-dashboard.html";
                }
            }, 1000);
        } else {
            message.style.color = "red";
            message.innerHTML = data.error || "Login failed!";
        }
    } catch(err) {
        message.style.color = "red";
        message.innerHTML = "Server unavailable. Please try again later.";
        console.error('Login error:', err);
    }
});
