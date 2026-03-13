const API_BASE = 'https://smart-grievance-system-noiq.onrender.com/api';
let profilePhotoBase64 = null;
let govtIdBase64 = null;

function togglePassword(id) {
    const f = document.getElementById(id);
    f.type = f.type === 'password' ? 'text' : 'password';
}

// Mobile validation
document.getElementById('mobile').addEventListener('input', function() {
    this.value = this.value.replace(/\D/g,'');
    const hint = document.getElementById('mobileHint');
    if (this.value.length === 10 && /^[6-9]/.test(this.value)) {
        hint.textContent = '✓ Valid mobile number'; hint.className = 'input-hint ok';
    } else if (this.value.length > 0) {
        hint.textContent = 'Must be 10 digits starting with 6-9'; hint.className = 'input-hint error';
    } else {
        hint.textContent = 'Enter 10-digit mobile number'; hint.className = 'input-hint';
    }
});

// Photo upload
function handlePhotoUpload(event, previewId, areaId) {
    const file = event.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { alert('Please select a valid image file.'); return; }
    if (file.size > 2 * 1024 * 1024) { alert('Photo must be under 2MB.'); return; }
    const reader = new FileReader();
    reader.onload = function(e) {
        profilePhotoBase64 = e.target.result;
        document.getElementById(previewId).src = profilePhotoBase64;
        document.getElementById(areaId).classList.add('has-photo');
    };
    reader.readAsDataURL(file);
}

// Document upload
function handleDocUpload(event, nameElId) {
    const file = event.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { alert('File must be under 5MB.'); return; }
    const nameEl = document.getElementById(nameElId);
    nameEl.textContent = '✓ ' + file.name;
    nameEl.style.display = 'block';
    const reader = new FileReader();
    reader.onload = e => { govtIdBase64 = e.target.result; };
    reader.readAsDataURL(file);
}

document.getElementById('adminRegisterForm').addEventListener('submit', async function(e) {
    e.preventDefault();

    const roleSelect = document.getElementById('roleSelect').value;
    const firstName = document.getElementById('firstName').value.trim();
    const middleName = document.getElementById('middleName').value.trim();
    const lastName = document.getElementById('lastName').value.trim();
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    const phone = document.getElementById('phone').value.trim();
    const mobile = document.getElementById('mobile').value.trim();
    const employeeId = document.getElementById('employeeId').value.trim();
    const designation = document.getElementById('designation').value;
    const officeLocation = document.getElementById('officeLocation').value.trim();
    const cityDistrict = document.getElementById('cityDistrict').value.trim();
    const jurisdiction = document.getElementById('jurisdiction').value.trim();
    const officeAddress = document.getElementById('officeAddress').value.trim();

    const fullName = [firstName, middleName, lastName].filter(Boolean).join(' ');
    const message = document.getElementById('message');

    function showMsg(msg, isError) {
        message.style.color = isError ? '#c0392b' : '#27ae60';
        message.textContent = msg;
    }

    // Validations
    if (!firstName || !lastName) return showMsg('First Name and Last Name are required!', true);
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showMsg('Enter a valid email address!', true);
    if (password !== confirmPassword) return showMsg('Passwords do not match!', true);
    if (password.length < 6) return showMsg('Password must be at least 6 characters!', true);
    if (!/^[6-9]\d{9}$/.test(mobile)) return showMsg('Enter a valid 10-digit mobile number!', true);
    if (!employeeId) return showMsg('Employee ID is required!', true);
    if (!designation) return showMsg('Please select a Designation!', true);
    if (!officeLocation) return showMsg('Office Location is required!', true);
    if (!cityDistrict) return showMsg('City / District is required!', true);
    if (!govtIdBase64) return showMsg('Government ID Card is required!', true);

    showMsg('Registering account...', false);
    const btn = document.getElementById('submitBtn');
    btn.disabled = true;

    try {
        const res = await fetch(API_BASE + '/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                fullName, firstName, middleName, lastName, email,
                phone, mobile, location: cityDistrict,
                aadhar: '', role: roleSelect, password,
                employeeId, designation,
                officeLocation, cityDistrict, jurisdiction, officeAddress,
                profilePhoto: profilePhotoBase64 || null,
                govtIdCard: govtIdBase64 || null
            })
        });
        const data = await res.json();
        if (res.ok) {
            showMsg(`✅ ${roleSelect === 'admin' ? 'Admin' : 'Officer'} Registration Successful! Redirecting to login...`, false);
            setTimeout(() => { window.location.href = 'login.html'; }, 1800);
        } else {
            showMsg(data.error || 'Registration failed!', true);
            btn.disabled = false;
        }
    } catch (err) {
        showMsg('Server unavailable. Please try again later.', true);
        btn.disabled = false;
    }
});
