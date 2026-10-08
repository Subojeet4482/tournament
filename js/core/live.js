/**
 * LIVE wallet sync by polling the backend (no reload needed).
 *  - users/{uid}            -> balance, stats, drawer, header, wallet update turant
 *  - users/{uid}/transactions -> wallet + history list live update
 * Top-right toast (6s, close button):
 *  - Deposit / admin balance add  -> "Deposit Credited"
 *  - Withdrawal status -> success -> "Withdrawal Successful"
 */
import { api } from './api.js';

window.live = (function () {
    let tUser = null, tMatch = null, uid = null;
    const stop = () => { clearInterval(tUser); clearInterval(tMatch); tUser = tMatch = null; uid = null; };
    const visible = () => document.visibilityState === 'visible';

    // ---- balance + transactions (every 6s) ----
    function watchUser(id) {
        let prev = null;            // last known {dep, wd}
        const seen = new Map();     // trxId -> normalized status
        let first = true;
        const tick = async () => {
            if (uid !== id || !visible()) return;
            try {
                const [me, hist] = await Promise.all([api.get('/me'), api.get('/wallet/history?limit=50')]);
                if (uid !== id) return;
                const d = me.user;
                const dep = Number(d.depositBalance !== undefined ? d.depositBalance : (d.balance || 0)) || 0;
                const wd = Number(d.withdrawBalance || 0) || 0;
                window.app.applyUserDoc(d);
                if (prev) {
                    const dDep = +(dep - prev.dep).toFixed(2), dWd = +(wd - prev.wd).toFixed(2);
                    // toast only when the total increased (no toast for deposit<->withdraw transfers)
                    if (dDep + dWd > 0) {
                        const L = window.msg.live;
                        if (dDep > 0 && dWd <= 0) { const m = L.depositCredited(dDep); window.ui.notify({ type: 'success', title: m.title, message: m.body, sound: 'notification' }); }
                        else if (dWd > 0 && dDep <= 0) { const m = L.balanceCredited(dWd); window.ui.notify({ type: 'success', title: m.title, message: m.body, sound: 'notification' }); }
                        else { const m = L.depositCredited(dDep + dWd); window.ui.notify({ type: 'success', title: m.title, message: m.body, sound: 'notification' }); }
                    }
                }
                prev = { dep, wd };

                const list = (hist.items || []).map((t) => ({ ...t, _id: t.id, _ms: t.createdAt || Date.parse(t.date) || 0 }));
                list.sort((a, b) => (b._ms || 0) - (a._ms || 0));
                window.db.trx = list;
                list.forEach((t) => {
                    const st = window.msg.normStatus(t.status), was = seen.get(t._id);
                    seen.set(t._id, st);
                    if (first || (was === undefined && st !== 'success')) return;
                    if (String(t.type).toLowerCase() === 'withdraw' && st === 'success' && was !== 'success') {
                        const m = window.msg.live.withdrawPaid(t);
                        window.ui.notify({ type: 'success', title: m.title, message: m.body, sound: 'withdrawal' });
                    }
                });
                first = false;
                try { window.app.renderWallet(); } catch (e) {}
                const wh = document.getElementById('modal-wallet-history');
                if (wh && wh.classList.contains('active')) { try { window.app.renderWH(); } catch (e) {} }
            } catch (e) { /* offline / cold start: next tick retries */ }
        };
        tick(); tUser = setInterval(tick, 6000);
    }

    // ---- matches (every 15s): room id/password, result, player count ----
    function watchMatches(id) {
        const known = new Map(); let first = true;
        const tick = async () => {
            if (uid !== id || !visible()) return;
            let list; try { list = await window.app._loadMatches(); } catch (e) { return; }
            if (uid !== id) return;
            const joinedIds = window.db.joined_ids || [], fresh = [];
            list.forEach((m) => {
                const room = !!(m.roomId && m.roomPass), prev = known.get(m.id);
                known.set(m.id, { room, status: m.status });
                if (first || !prev || !joinedIds.includes(m.id)) return;
                if (room && !prev.room && m.status !== 'completed') {
                    fresh.push(m.id);
                    window.ui.notify({ type: 'info', title: 'Room ID & Password Ready', message: (m.title || 'Your match') + ' — open My Matches to copy.', sound: 'notification' });
                }
                if (m.status === 'completed' && prev.status !== 'completed') {
                    const won = m.winnerUid === id;
                    if (won) window.ui.notify({ type: 'success', title: 'Winner Winner! 🏆', message: `You won ₹${Number(m.prize) || 0} in ${m.title || 'the match'}.`, sound: 'notification' });
                    else window.ui.notify({ type: 'info', title: 'Match Finished', message: (m.title || 'Match') + ' result is in History.' });
                }
            });
            first = false;
            try { if (window.app.renderMatches) window.app.renderMatches(); } catch (e) {}
            const pg = document.getElementById('page-matches');
            if (pg && !pg.classList.contains('hidden')) { try { window.app.renderMyMatches(); } catch (e) {} }
        };
        tick(); tMatch = setInterval(tick, 15000);
    }

    function start(id) {
        if (!id) return;
        if (uid === id && tUser) return;
        stop(); uid = id;
        watchUser(id); watchMatches(id);
    }
    document.addEventListener('visibilitychange', () => { if (visible() && uid) { const id = uid; stop(); start(id); } });
    if (window.db && window.db.user_uid) start(window.db.user_uid);
    return { start, stop };
})();
