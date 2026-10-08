/**
 * Deposit: UPI + crypto, UTR verification polling.
 */
import { api } from '../../js/core/api.js';

Object.assign(window.app, {
    switchDepositTab: (tab) => {
        document.getElementById('dep-upi-section').style.display = tab==='upi'?'block':'none';
        document.getElementById('dep-crypto-section').style.display = tab==='crypto'?'block':'none';
        document.getElementById('dep-tab-upi').classList.toggle('active', tab==='upi');
        document.getElementById('dep-tab-crypto').classList.toggle('active', tab==='crypto');
    },
    _activeDepositPolls: {},
    deposit: async (method) => {
        if(method==='upi'){
            return window.app.depositUPI();
        }
        const amt=document.getElementById('dep-crypto-amount').value;
        const trx=document.getElementById('dep-crypto-hash').value.trim();
        if(!amt) return window.ui.toast(window.msg.deposit.enterAmount());
        if(!trx) return window.ui.toast(window.msg.deposit.needHash());
        if(!window.app.rateLimit('deposit',60000)) return;
        const btn=document.querySelector(`#modal-deposit .btn-main[onclick*="deposit('crypto')"]`); if(btn) btn.disabled=true;
        window.ui.toast("Processing...");
        try {
            await api.post('/wallet/deposit/crypto',{amount:parseFloat(amt),hash:trx});
            window.ui.closeModal(); window.ui.toast(window.msg.deposit.cryptoSent());
            window.app.endAction('deposit',true);
            window.app.fetchTransactions();
        } catch(e){ window.app.endAction('deposit',false); window.ui.toast("Error: "+e.message); }
        finally { if(btn) btn.disabled=false; }
    },
    depositUPI: async () => {
        const amt=parseFloat(document.getElementById('dep-amount').value);
        const utr=document.getElementById('dep-utr').value.trim();
        if(!amt || isNaN(amt)) return window.ui.toast(window.msg.deposit.enterAmount());
        if(amt < 5) return window.ui.toast(window.msg.deposit.minAmount());
        if(!utr || utr.length < 6) return window.ui.toast(window.msg.deposit.badUtr());
        if(!window.app.rateLimit('deposit_'+utr,15000)) return;
        const uid=window.db.user_uid;
        if(!uid){ window.app.endAction('deposit_'+utr,false); return window.ui.toast(window.msg.deposit.needLogin()); }
        const btn=document.querySelector(`#modal-deposit .btn-main[onclick*="deposit('upi')"]`);
        if(btn) btn.disabled=true;
        try {
            await api.post('/wallet/deposit',{utr,amount:amt});   // creates the pending request + transaction on the server
        } catch(e){
            window.app.endAction('deposit_'+utr,false);
            if(btn) btn.disabled=false;
            return window.ui.toast(e.message||window.msg.deposit.submitFailed());
        }
        if(btn) btn.disabled=false;
        try { document.getElementById('dep-amount').value=''; document.getElementById('dep-utr').value=''; } catch(_){}
        window.ui.closeModal();
        window.app.fetchTransactions();
        window.app.startDepositPoll(utr, amt, uid, {overlay:true});
    },
    // One server-side check: the backend matches the UTR + amount against the bank mail and credits the wallet atomically.
    // Returns {status: 'success'|'failed'|'gone'|'notfound', amount?}
    _checkFampay: async (utr, amt, uid) => {
        const r=await api.post('/wallet/deposit/check',{utr});
        if(r.status==='expired'||r.status==='mismatch'||r.status==='rejected') return {...r,status:'failed'};
        if(r.status==='pending'||r.status==='processing') return {...r,status:'notfound'};
        return r;
    },
    startDepositPoll: (utr, amt, uid, opts) => {
        opts=opts||{};
        if(window.app._activeDepositPolls[utr]) {
            if(opts.overlay) window.app._showVerifyOverlay(window.msg.deposit.alreadyChecking.title,window.msg.deposit.alreadyChecking.sub,'loading');
            return;
        }
        window.app._activeDepositPolls[utr] = true;
        let lastSeen=null;
        const finish=()=>{ delete window.app._activeDepositPolls[utr]; };

        const onSuccess=async (received)=>{
            try { await window.app.fetchUserData(); } catch(_){}
            try { await window.app.fetchTransactions(); } catch(_){}
            if(window.app.fetchNotifications) window.app.fetchNotifications();
            if(opts.overlay){ const m=window.msg.deposit.success(received); window.app._showVerifyOverlay(m.title,m.sub,'success'); }
        };
        const onFail=async ()=>{
            const F=window.msg.deposit.fail(amt, utr, lastSeen);
            try { await window.app.fetchTransactions(); } catch(_){}
            if(opts.overlay) window.app._showVerifyOverlay(F.title,F.sub,'fail'); else window.ui.toast(F.toast);
        };
        const check=async ()=>{
            try { const res=await window.app._checkFampay(utr, amt, uid); lastSeen=res; return res; } catch(_){ return null; }
        };

        // FOREGROUND phase: ~10s with an overlay (5 checks)
        const runForeground = async () => {
            window.app._showVerifyOverlay(window.msg.deposit.verifying.title,window.msg.deposit.verifying.sub,'loading');
            const timer=document.getElementById('dvo-timer'); let remaining=10;
            const tick=setInterval(()=>{ remaining--; if(timer && remaining>=0) timer.innerText='Checking... '+remaining+'s'; }, 1000);
            for(const wait of [1000,2000,2000,2000,2000]){
                await new Promise(r=>setTimeout(r,wait));
                const res=await check(); if(!res) continue;
                if(res.status==='success'){ clearInterval(tick); await onSuccess(res.amount); finish(); return; }
                if(res.status==='gone'){ clearInterval(tick); window.app._hideVerifyOverlay(); finish(); return; }
                if(res.status==='failed'){ clearInterval(tick); await onFail(); finish(); return; }
            }
            clearInterval(tick);
            window.app._hideVerifyOverlay();
            window.ui.toast(window.msg.deposit.processingToast());
            runBackground();
        };
        // BACKGROUND phase: every 10s, 5 more checks. The request stays "pending" on the server for 24h,
        // so a late bank mail can still be credited by re-opening the app.
        const runBackground = () => {
            let attempts=0;
            const iv=setInterval(async ()=>{
                attempts++;
                const res=await check();
                if(res && res.status==='success'){ clearInterval(iv); await onSuccess(res.amount); finish(); return; }
                if(res && (res.status==='gone'||res.status==='failed')){ clearInterval(iv); if(res.status==='failed') await onFail(); finish(); return; }
                if(attempts>=5){ clearInterval(iv); await onFail(); finish(); }
            }, 10000);
        };
        if(opts.overlay) runForeground(); else runBackground();
    },
});
