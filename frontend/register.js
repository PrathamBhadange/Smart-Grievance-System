const API_BASE = 'https://smart-grievance-system-fvfk.onrender.com/api';

function togglePassword(fieldId) {
    const field = document.getElementById(fieldId);
    field.type = field.type === "password" ? "text" : "password";
}

document.getElementById("registerForm").addEventListener("submit", async function(e){
    e.preventDefault();
    
    const firstName = document.getElementById("firstName").value.trim();
    const middleName = document.getElementById("middleName").value.trim();
    const lastName = document.getElementById("lastName").value.trim();
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;
    const confirmPassword = document.getElementById("confirmPassword").value;
    const phone = document.getElementById("phone").value.trim();
    const mobile = document.getElementById("mobile").value.trim();
    const aadhar = document.getElementById("aadhar").value.trim();
    const location = document.getElementById("location").value.trim();

    // Additional Details
    const consumerNo = document.getElementById("consumerNo").value.trim();
    const licenseNo = document.getElementById("licenseNo").value.trim();
    const panNo = document.getElementById("panNo").value.trim();
    const propertyNo = document.getElementById("propertyNo").value.trim();
    const address = document.getElementById("address").value.trim();
    const pincode = document.getElementById("pincode").value.trim();

    const message = document.getElementById("message");
    
    // Build full name
    const fullName = [firstName, middleName, lastName].filter(Boolean).join(' ');

    // Validate required fields
    if (!firstName || !lastName) {
        message.style.color = "red";
        message.innerHTML = "First Name and Last Name are required!";
        return;
    }

    if (!email) {
        message.style.color = "red";
        message.innerHTML = "Email Address is required!";
        return;
    }

    // Validate passwords match
    if (password !== confirmPassword) {
        message.style.color = "red";
        message.innerHTML = "Passwords do not match!";
        return;
    }

    if (password.length < 6) {
        message.style.color = "red";
        message.innerHTML = "Password must be at least 6 characters!";
        return;
    }

    if (!mobile) {
        message.style.color = "red";
        message.innerHTML = "Mobile Number is required!";
        return;
    }

    // Validate Aadhar
    if (!/^\d{12}$/.test(aadhar)) {
        message.style.color = "red";
        message.innerHTML = "Aadhar number must be 12 digits!";
        return;
    }

    if (!location) {
        message.style.color = "red";
        message.innerHTML = "City / Location is required!";
        return;
    }

    // Validate PAN if provided
    if (panNo && !/^[A-Z]{5}\d{4}[A-Z]$/.test(panNo.toUpperCase())) {
        message.style.color = "red";
        message.innerHTML = "PAN No must be in format: ABCDE1234F";
        return;
    }

    // Validate Pincode if provided
    if (pincode && !/^\d{6}$/.test(pincode)) {
        message.style.color = "red";
        message.innerHTML = "Pincode must be 6 digits!";
        return;
    }

    message.style.color = "#555";
    message.innerHTML = "Registering...";

    try {
        const res = await fetch(API_BASE + '/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                fullName,
                firstName,
                middleName,
                lastName,
                email,
                phone,
                mobile,
                location,
                aadhar,
                role: 'user',
                password,
                consumerNo,
                licenseNo,
                panNo: panNo ? panNo.toUpperCase() : '',
                propertyNo,
                address,
                pincode
            })
        });

        const data = await res.json();

        if (res.ok) {
            message.style.color = "green";
            message.innerHTML = "Registration Successful! Redirecting to login...";
            setTimeout(() => {
                window.location.href = "login.html";
            }, 1500);
        } else {
            message.style.color = "red";
            message.innerHTML = data.error || "Registration failed!";
        }
    } catch(err) {
        message.style.color = "red";
        message.innerHTML = "Server unavailable. Please try again later.";
        console.error('Registration error:', err);
    }
});
