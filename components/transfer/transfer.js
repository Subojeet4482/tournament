/**
 * Transfer money by Player ID. Everything is checked and moved on the server (atomic, password re-verified);
 * the app only shows the recipient name and sends the request.
 */
import { api } from '../../js/core/api.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let timer = null, seq = 0;

Object.assign(window.app, {
    verifyRecipient: (pid) => {
        const statusEl = $('recipient-status'); window.app.recipientVerified = false; window.app.recipientUid = null; window.app.recipientPid = null;
        pid = String(pid || '').trim(); clearTimeout(timer); const my = ++seq;
        if(pid.length < 5){ statusEl.innerHTML = ''; return; }
        if(pid === String((window.db.user_data || {}).playerId || '')){ statusEl.innerHTML = "<span class='text-danger'>Cannot send to self</span>"; return; }
        if(!/^\d{5,10}$/.test(pid)){ statusEl.innerHTML = "<span class='text-danger'>Player ID has digits only</span>"; return; }
        statusEl.innerHTML = "<span class='text-muted'>Searching...</span>";
        timer = setTimeout(async () => {
            try {
                const r = await api.get('/wallet/recipient?playerId=' + encodeURIComponent(pid));
                if(my !== seq) return;
                if(r.found){ statusEl.innerHTML = `<span class="text-success"><i class="fa-solid fa-circle-check"></i> Found: <b>${esc(r.appName)}</b></span>`; window.app.recipientVerified = true; window.app.recipientPid = pid; }
                else statusEl.innerHTML = `<span class='text-danger'>${r.self ? 'Cannot send to self' : 'Not found!'}</span>`;
            } catch(e){ if(my === seq) statusEl.innerHTML = "<span class='text-danger'>Error. Try again.</span>"; }
        }, 350);
    },
    transfer: async () => {
        const A = window.app, toast = window.ui.toast;
        const pid = A.recipientPid, amount = parseFloat(($('tr-amount') || {}).value), note = (($('tr-note') || {}).value || '').trim(), pass = ($('tr-pass') || {}).value || '';
        if(!A.recipientVerified || !pid) return toast('Enter a valid Player ID first');
        if(!amount || amount < 10) return toast('Minimum transfer is ₹10');
        if(!pass) return toast('Enter your App Password');
        if(!A.rateLimit('transfer', 4000)) return;
        const btn = document.querySelector('#modal-transfer .btn-main'); const old = btn && btn.innerText;
        if(btn){ btn.disabled = true; btn.innerText = 'Sending...'; }
        try {
            const r = await api.post('/wallet/transfer', { playerId: pid, amount, note, password: pass });
            ['tr-uid', 'tr-amount', 'tr-note', 'tr-pass'].forEach((id) => { const e = $(id); if(e) e.value = ''; });
            const st = $('recipient-status'); if(st) st.innerHTML = '';
            A.recipientVerified = false; A.recipientPid = null;
            window.ui.closeModal();
            const msg = `₹${r.amount} sent to ${r.to}`;
            if(window.ui.notify) window.ui.notify({ type: 'success', title: 'Transfer successful', message: msg }); else toast(msg);
            A.endAction('transfer', true);
            A.fetchUserData(); A.fetchTransactions();
        } catch(e){
            A.endAction('transfer', false);
            toast(e.message || 'Transfer failed');
        } finally { if(btn){ btn.disabled = false; btn.innerText = old || 'Confirm & Send'; } }
    },
});
