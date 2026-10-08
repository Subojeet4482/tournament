/**
 * Backend client. No Firebase SDK: login -> backend /auth/login -> custom token -> Firebase REST exchange -> ID token.
 * Every request carries "Authorization: Bearer <idToken>" and refreshes the token automatically.
 */
const CFG = window.FF_CONFIG || {};
export const BACKEND = String(CFG.BACKEND || '').replace(/\/+$/, '');
const KEY = CFG.FB_API_KEY || '';
const SK = 'ff_session';
let S = null;
try { S = JSON.parse(localStorage.getItem(SK) || 'null'); } catch (e) { S = null; }
const save = (s) => { S = s; try { s ? localStorage.setItem(SK, JSON.stringify(s)) : localStorage.removeItem(SK); } catch (e) {} };
const emit = () => window.dispatchEvent(new CustomEvent('ff-auth', { detail: api.currentUser() }));
const err = (code, message, extra) => Object.assign(new Error(message), { code, extra });
// Firestore Timestamps arrive as {_seconds,_nanoseconds}; the UI expects {seconds}
const revive = (k, v) => (v && typeof v === 'object' && '_seconds' in v ? { seconds: v._seconds, nanoseconds: v._nanoseconds || 0, toDate() { return new Date(v._seconds * 1000); }, toMillis() { return v._seconds * 1000; } } : v);

async function rest(url, init) {
    let r; try { r = await fetch(url, init); } catch (e) { throw err('network', 'Network error. Please check your internet connection.'); }
    const t = await r.text(); let j = {}; try { j = t ? JSON.parse(t, revive) : {}; } catch (e) {}
    return { r, j };
}
async function exchange(customToken) {
    const { r, j } = await rest('https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=' + KEY, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: customToken, returnSecureToken: true }) });
    if (!r.ok) {
        const why = (j && j.error && j.error.message) || ('HTTP ' + r.status);
        console.error('[login] Firebase token exchange failed:', why, '(check: API key referrers, Identity Toolkit API enabled, KEY64_1 project == FB_API_KEY project)');
        throw err('auth_unavailable', 'Login unavailable (' + String(why).split(' ')[0] + '). Please try again.');
    }
    return { idToken: j.idToken, refreshToken: j.refreshToken, exp: Date.now() + (+j.expiresIn || 3600) * 1000 };
}
let refreshing = null;
async function refresh() {
    if (!S || !S.refreshToken) throw err('bad_token', 'Session expired. Login again.');
    refreshing = refreshing || (async () => {
        const { r, j } = await rest('https://securetoken.googleapis.com/v1/token?key=' + KEY, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(S.refreshToken) });
        if (!r.ok) { api.logout(); throw err('bad_token', 'Session expired. Login again.'); }
        save({ ...S, idToken: j.id_token, refreshToken: j.refresh_token, exp: Date.now() + (+j.expires_in || 3600) * 1000 });
    })().finally(() => { refreshing = null; });
    return refreshing;
}
async function req(method, path, body, base) {
    const pub = path.startsWith('/auth/');
    for (let attempt = 0; attempt < 2; attempt++) {
        const h = {};
        if (body !== undefined) h['Content-Type'] = 'application/json';
        if (S && !pub) { if (S.exp - 60000 < Date.now()) await refresh(); h.Authorization = 'Bearer ' + S.idToken; }
        const { r, j } = await rest((base || BACKEND) + path, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
        if (r.ok && j.ok !== false) return j;
        const e = j && j.error ? err(j.error.code, j.error.message, j.error) : err('server_error', 'Server is busy. Please try again.');
        e.status = r.status;
        if (r.status === 401 && e.code === 'bad_token' && S && attempt === 0) { await refresh(); continue; }
        if (r.status === 401 && e.code === 'no_token') api.logout();
        throw e;
    }
}
const cache = {};
const mk = (base) => ({
    get: (p, ttl) => { if (!ttl) return req('GET', p, undefined, base); const c = cache[base + p]; if (c && Date.now() - c.t < ttl) return c.v; const v = req('GET', p, undefined, base); cache[base + p] = { v, t: Date.now() }; v.catch(() => delete cache[base + p]); return v; },
    post: (p, b) => req('POST', p, b || {}, base),
    put: (p, b) => req('PUT', p, b || {}, base),
    del: (p) => req('DELETE', p, undefined, base),
});
export const api = {
    ...mk(''),
    chat: mk(BACKEND + '/chat'),
    currentUser: () => (S ? { uid: S.uid, email: S.email || '', displayName: S.name || 'Player', providerData: [], metadata: {}, emailVerified: true } : null),
    login: async (email, password) => {
        const r = await req('POST', '/auth/login', { email, password });
        const t = await exchange(r.customToken);
        save({ uid: r.uid, email, name: 'Player', ...t });
        try { const me = await req('GET', '/me'); save({ ...S, name: (me.user && me.user.appName) || 'Player' }); } catch (e) {}
        emit();
    },
    googleLogin: async (accessToken) => {
        const r = await req('POST', '/auth/google', { accessToken });
        const t = await exchange(r.customToken);
        save({ uid: r.uid, email: '', name: 'Player', ...t });
        try { const me = await req('GET', '/me'); save({ ...S, email: (me.user && me.user.email) || '', name: (me.user && me.user.appName) || 'Player' }); } catch (e) {}
        emit(); return S.name;
    },
    // fire-and-forget request that survives page close (used for the "offline" presence ping)
    beacon: (path, body, base) => { try { if (!S) return; fetch((base || BACKEND + '/chat') + path, { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + S.idToken }, body: JSON.stringify(body || {}) }).catch(() => {}); } catch (e) {} },
    register: (name, email, phone, password) => req('POST', '/auth/register', { name, email, phone, password }),
    forgot: (email) => req('POST', '/auth/forgot', { email }),
    logout: () => { if (!S) return; save(null); emit(); },
    // password-reset link (oobCode) helpers, Firebase REST
    resetCheck: async (oobCode) => { const { r, j } = await rest('https://identitytoolkit.googleapis.com/v1/accounts:resetPassword?key=' + KEY, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ oobCode }) }); if (!r.ok) throw err('auth/invalid-action-code', 'This reset link is invalid or expired.'); return j.email; },
    resetConfirm: async (oobCode, newPassword) => { const { r } = await rest('https://identitytoolkit.googleapis.com/v1/accounts:resetPassword?key=' + KEY, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ oobCode, newPassword }) }); if (!r.ok) throw err('auth/invalid-action-code', 'This reset link is invalid or expired.'); },
};
window.api = api;
