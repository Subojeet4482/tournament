/**
 * Online / offline presence on the backend.
 * The app sends a tiny heartbeat every 25s while the tab is visible (the server keeps it in memory, no database write).
 * Friends' status arrives with the friends list / profile calls and is stored here through presence.set().
 */
import { api } from './api.js';

window.presence = (function(){
    const HEARTBEAT_MS = 25 * 1000;
    const STALE_MS = 150 * 1000;           // status from a list is trusted for 2.5 min
    let hbTimer = null;
    const cache = new Map();               // uid -> { online, lastSeen(ms), t }

    async function beat(state){
        const uid = window.db && window.db.user_uid;
        if(!uid || !api.currentUser()) return;
        try { await api.chat.post('/presence/ping', { state: state || 'online' }); } catch(e){ /* silent */ }
    }
    function start(){
        stop();
        beat('online');
        hbTimer = setInterval(() => { if(document.visibilityState === 'visible') beat('online'); }, HEARTBEAT_MS);
    }
    function stop(){ if(hbTimer){ clearInterval(hbTimer); hbTimer = null; } }
    function set(uid, online, lastSeen){
        if(!uid) return;
        cache.set(uid, { online: !!online, lastSeen: Number(lastSeen) || 0, t: Date.now() });
        updateSelfBadge();
    }
    function isOnline(uid, userDoc){
        if(uid && uid === (window.db && window.db.user_uid)) return !!api.currentUser();
        const c = cache.get(uid);
        if(c) return c.online && (Date.now() - c.t) < STALE_MS;
        return userDoc ? (userDoc.online === true) : false;
    }
    function lastSeen(uid){ const c = cache.get(uid); return c && c.lastSeen ? new Date(c.lastSeen) : null; }
    function updateSelfBadge(){
        const st = document.getElementById('cp-status');
        if(!st) return;
        const on = isOnline(window.db.user_uid);
        st.innerHTML = on ? '<span style="color:#10b981;">● Online</span>' : '<span style="color:#94a3b8;">● Offline</span>';
    }

    // Tell the server we left (keepalive request survives the page closing)
    const goingOffline = () => { try { api.beacon('/presence/ping', { state: 'offline' }); } catch(e){} };
    window.addEventListener('pagehide', goingOffline);
    document.addEventListener('visibilitychange', () => { if(document.visibilityState === 'visible') beat('online'); });
    window.addEventListener('ff-auth', (e) => { if(!e.detail){ stop(); cache.clear(); } });

    return { start, stop, isOnline, lastSeen, beat, set };
})();

// Start presence right after login (and again after a re-login)
(function(){
    let started = false;
    setInterval(() => {
        const uid = window.db && window.db.user_uid;
        if(!started && uid){ started = true; try { window.presence.start(); } catch(e){ console.warn('presence start failed', e); } }
        if(started && !uid){ started = false; window.presence.stop(); }
    }, 1500);
})();
