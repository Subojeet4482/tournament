/**
 * Register: backend creates the account + sends the verification mail. The user verifies, then logs in
 * (the profile is created on first login). Unverified accounts are cleaned up by the backend daily job.
 */
import { api } from '../../js/core/api.js';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const showSent = (email) => {
    const box = $('auth-verify'); if (!box) return;
    box.dataset.vs = 'ok';
    $('av-ico').querySelector('i').className = 'fa-solid fa-envelope';
    $('av-title').innerText = 'Verify your email';
    $('av-text').innerHTML = 'We sent a verification link to <b>' + esc(email) + '</b>.<br>Open it, then come back and login. <b>Check Spam too.</b>';
    $('av-btn').innerText = 'Go to Login';
    $('av-mail').classList.toggle('hidden', !/@(gmail|googlemail)\.com$/i.test(email || ''));
    $('auth-card').classList.add('is-verify');
};

Object.assign(window.auth, {
    _verifyReset: () => { const c = $('auth-card'); if (c) c.classList.remove('is-verify'); },
    verifyAction: () => {
        $('auth-card').classList.remove('is-verify');
        const em = $('reg-email').value; window.auth.switch('login'); if (em) $('login-email').value = em;
        $('reg-pass').value = '';
        setTimeout(() => $('login-pass') && $('login-pass').focus(), 500);
    },
    register: async () => {
        const nameEl = $('reg-name'), phoneEl = $('reg-phone'), emailEl = $('reg-email'), passEl = $('reg-pass'), btn = $('btn-register');
        const name = nameEl.value.trim(), email = emailEl.value.trim(), phone = phoneEl.value.trim(), pass = passEl.value;
        if (!name || !email || !pass || !phone) { window.auth._fail([!name && nameEl, !phone && phoneEl, !email && emailEl, !pass && passEl]); return window.ui.toast('Please fill in all the fields to create your account.'); }
        if (phone.replace(/\D/g, '').length < 10) { window.auth._fail([phoneEl]); return window.ui.toast('Please enter a valid 10-digit phone number.'); }
        if (pass.length < 8) { window.auth._fail([passEl]); return window.ui.toast('Password must be at least 8 characters.'); }
        window.auth._busy(btn, true, 'Creating account...');
        try {
            await api.register(name, email, phone, pass);
            window.auth._busy(btn, false);
            showSent(email);
        } catch (e) {
            window.auth._busy(btn, false); window.auth._fail([emailEl, passEl]);
            window.ui.toast(e.message || 'Registration failed');
        }
    },
});
