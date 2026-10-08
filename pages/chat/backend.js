/**
 * Chat on the backend (no Firestore / Firebase SDK).
 * Loaded AFTER enhancements.js and fixes.js. It replaces every window.chat method that used to talk to Firestore:
 * social state, world chat, friends + requests + search + discover, DMs, groups (+members, music box), reactions /
 * edit / delete / forward / report, block list, profile save + photos.  The old modules still provide the UI pieces
 * (message bubbles, sheets, tabs); this file only provides the data.
 */
import { api } from '../../js/core/api.js';

(function(){
  const C = window.chat; if(!C){ console.warn('[chat-backend] chat missing'); return; }
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const attr = (s) => String(s || '').replace(/[\\'"<>&`]/g, '');
  const toast = (m) => { try{ window.ui.toast(m); }catch(e){ console.log(m); } };
  const errMsg = (e) => (e && e.message) || 'Something went wrong';
  const me = () => window.db && window.db.user_uid;
  const replay = (el, cls) => { if(!el) return; el.classList.remove('sub-in','sub-out'); void el.offsetWidth; el.classList.add(cls); clearTimeout(el._rpT); el._rpT = setTimeout(() => el.classList.remove(cls), 600); };
  const setHtml = (el, h) => { if(!el || el._h === h) return; el._h = h; el.innerHTML = h; };
  const EMPTY = (ic, t, s) => `<div class="empty-state"><i class="fa-solid fa-${ic}"></i><div style="font-weight:700;color:var(--text-main);">${t}</div>${s ? `<div style="font-size:.78rem;margin-top:4px;">${s}</div>` : ''}</div>`;
  const avHtml = (u) => { const p = u && (u.photoUrl || u.photoURL); return p ? `<img src="${esc(p)}" alt="">` : esc((((u && (u.appName || u.name)) || 'U')[0] || 'U').toUpperCase()); };
  const blobToDataUrl = (b) => new Promise((res, rej) => { const f = new FileReader(); f.onload = () => res(f.result); f.onerror = () => rej(new Error('Could not read the image')); f.readAsDataURL(b); });
  const visible = () => document.visibilityState === 'visible';
  const flyBtn = (sel) => { const b = document.querySelector(sel + ' .cc-send'); if(b){ b.classList.remove('fly'); void b.offsetWidth; b.classList.add('fly'); } };
  const sheet = () => document.querySelector('.cx-sheet');
  const fmtSeen = (ms) => {
    if(!ms) return 'offline';
    const d = new Date(ms), t = d.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
    return 'last seen ' + (d.toDateString() === new Date().toDateString() ? 'today ' + t : d.toLocaleDateString([], {day:'numeric', month:'short'}) + ' ' + t);
  };

  /* ===================================================================== social state */
  const EMPTY_SOC = { friends:[], outgoing:[], blocked:[], pinnedFriends:[], muted:[], pinnedChats:[], archived:[], incoming:[], groups:[] };
  window.db = window.db || {};
  window.db.social = { ...EMPTY_SOC };
  C._me = {};
  const socialFields = () => {
    const s = window.db.social, p = C._me || {}, o = { friends:s.friends, outgoingReq:s.outgoing, blockList:s.blocked, pinnedFriends:s.pinnedFriends, muted:s.muted, pinnedChats:s.pinnedChats, archived:s.archived, joinedGroups:s.groups };
    if(p.appName){ o.name = p.appName; o.username = p.username; o.bio = p.bio; o.privacy = p.privacy; o.photoURL = p.photoUrl; o.coverURL = p.coverURL; }
    return o;
  };
  C._socialFields = socialFields;
  const applySocial = () => { window.db.user_data = Object.assign(window.db.user_data || {}, socialFields()); };
  // the live poll replaces user_data every few seconds: keep the chat fields on it
  if(window.app && window.app.applyUserDoc && !window.app._socialWrap){
    const orig = window.app.applyUserDoc; window.app._socialWrap = true;
    window.app.applyUserDoc = (d) => orig(Object.assign({}, d, socialFields()));
  }
  let syncing = null, lastSync = 0, syncedFor = null;
  C.syncSocial = function(force){
    if(!me()) return Promise.resolve();
    if(syncing) return syncing;
    if(!force && syncedFor === me() && Date.now() - lastSync < 20000) return Promise.resolve();
    syncing = (async () => {
      try{
        const r = await api.chat.get('/social/me');
        window.db.social = { ...EMPTY_SOC, ...(r.social || {}) }; C._me = r.profile || {};
        syncedFor = me(); lastSync = Date.now(); applySocial();
      }catch(e){ console.warn('[chat] social sync', e.message); }
      finally{ syncing = null; }
    })();
    return syncing;
  };
  window.addEventListener('ff-auth', (e) => {
    if(!e.detail){ window.db.social = { ...EMPTY_SOC }; C._me = {}; syncedFor = null; lastSync = 0; Object.keys(AV).forEach(k => delete AV[k]); fCache.t = 0; fCache.v = null; }
  });
  setInterval(() => { if(me() && syncedFor !== me() && !syncing) C.syncSocial(true); }, 1500);   // first load after login / page refresh
  setInterval(() => { if(me() && visible() && !$('page-chat')?.classList.contains('hidden') && $('page-chat')?.offsetParent) C.syncSocial(); }, 30000);

  /* ===================================================================== avatars + message shape */
  const AV = {};
  async function loadAvatars(uids){
    const need = [...new Set(uids)].filter(u => u && !(u in AV));
    for(let i = 0; i < need.length; i += 40){
      const part = need.slice(i, i + 40);
      try{ const r = await api.chat.get('/avatars?uids=' + part.join(',')); part.forEach(u => AV[u] = (r.avatars || {})[u] || ''); }
      catch(e){ part.forEach(u => AV[u] = ''); }
    }
  }
  setInterval(() => Object.keys(AV).forEach(k => delete AV[k]), 300000);
  const toMsg = (m) => ({ ...m, photoURL: (m.uid === me() ? (C._me && C._me.photoUrl) : '') || AV[m.uid] || '', createdAt: { seconds: Math.floor((m.createdAt || 0) / 1000) } });
  const sigOf = (list) => list.map(m => m.id + (m.edited ? 'e' : '') + (m.pinned ? 'p' : '') + (m.deleted ? 'd' : '') + JSON.stringify(m.reactions || {}) + (AV[m.uid] ? 1 : 0)).join('|');

  let cfgLoaded = false;
  async function loadChatCfg(){
    if(cfgLoaded) return; cfgLoaded = true;
    try{ const i = await api.chat.get('/world/info', 60000); window._chatCfg = Object.assign(window._chatCfg || {}, { maxLen: i.maxLen || 300, cooldown: i.cooldownSec || 2, mediaOn: i.mediaOn !== false }); }
    catch(e){ cfgLoaded = false; }
  }

  /* ===================================================================== hub / presence */
  C.setPresence = function(on){ if(window.presence) window.presence.beat(on === false ? 'offline' : 'online'); };
  C._refreshHub = async function(){
    const u = window.db.user_data || {}, av = $('ch-av'), hi = $('ch-hi'); if(!av || !hi) return;
    const nm = u.name || u.appName || window.db.user_name || 'Player';
    hi.textContent = 'Hey, ' + nm + ' 👋'; av.innerHTML = avHtml({ photoUrl: u.photoURL || u.photoUrl, appName: nm });
    if(!me()) return;
    await C.syncSocial();
    const n = (window.db.social.incoming || []).length, b = $('hub-req-badge');
    if(b){ b.textContent = n > 9 ? '9+' : n; b.classList.toggle('hidden', !n); }
  };
  const _onOpen = C.onOpen ? C.onOpen.bind(C) : null;
  C.onOpen = function(){ loadChatCfg(); C.syncSocial(true); return _onOpen ? _onOpen() : undefined; };

  /* ===================================================================== world chat */
  C.streamWorld = function(){
    if(C._unsubs.world){ try{ C._unsubs.world(); }catch(e){} }
    const box = $('wc-messages'), pb = $('wc-pinned'); if(!box) return;
    box._init = false; box._seen = null; box.innerHTML = C._skelMsgs(); if(pb) pb.classList.add('hidden');
    let sig = '', busy = false, dead = false;
    const pull = async () => {
      if(busy || dead || !visible()) return; busy = true;
      try{
        const r = await api.chat.get('/world/messages'), list = r.messages || [];
        await loadAvatars(list.map(m => m.uid));
        const s = sigOf(list); if(s === sig) return; sig = s;
        const items = list.map(toMsg);
        C._renderList(box, items, 'world', EMPTY('comments', 'Be the first to say hi', 'World chat is open to everyone 🌍'));
        const pins = items.filter(m => m.pinned && !m.deleted);
        if(pb){ if(pins.length){ const p = pins[pins.length - 1]; pb.classList.remove('hidden'); pb.innerHTML = `<i class="fa-solid fa-thumbtack"></i> <b>${esc(p.name || '')}</b>: ${esc((p.text || '').slice(0, 90))}`; } else pb.classList.add('hidden'); }
      }catch(e){ if(!box._init) box.innerHTML = EMPTY('triangle-exclamation', 'Could not load messages', esc(errMsg(e))); }
      finally{ busy = false; }
    };
    pull(); const t = setInterval(pull, 3500);
    C._unsubs.world = () => { dead = true; clearInterval(t); };
    C._pullWorld = () => { sig = ''; return pull(); };
  };
  C.sendWorld = async function(){
    const inp = $('wc-input'); if(!inp) return; const text = inp.value.trim(); if(!text) return;
    inp.value = ''; const body = { text };
    if(C._replyTo && C._replyTo.wc){ body.replyTo = { mid: C._replyTo.wc.mid, text: C._replyTo.wc.text }; C.cancelReply('wc'); }
    flyBtn('#wc-composer');
    try{ await api.chat.post('/world/send', body); C._pullWorld && C._pullWorld(); }
    catch(e){ inp.value = text; toast(errMsg(e)); }
  };

  /* ===================================================================== friends / chats lists */
  const fCache = { t: 0, v: null, p: null };
  C._friendsList = function(force){
    if(!force && fCache.v && Date.now() - fCache.t < 5000) return Promise.resolve(fCache.v);
    if(fCache.p) return fCache.p;
    fCache.p = api.chat.get('/friends').then(r => {
      fCache.v = r.friends || []; fCache.t = Date.now();
      fCache.v.forEach(f => window.presence && window.presence.set(f.uid, f.online, f.lastSeen));
      return fCache.v;
    }).finally(() => { fCache.p = null; });
    return fCache.p;
  };
  const dropFriends = () => { fCache.t = 0; };
  const lastText = (f) => f.last ? ((f.last.uid === me() ? 'You: ' : '') + (f.last.text || '')) : 'Say hi 👋';
  const chatRow = (f) => `<div class="friend-item" onclick="chat.openDM('${attr(f.uid)}','${attr(f.appName)}')">
      <div class="fi-avatar">${avHtml(f)}</div>
      <div class="fi-body"><div class="fi-name">${esc(f.appName)} ${f.online ? '<span class="fi-online-dot"></span>' : ''}${f.pinned || f.chatPinned ? '<i class="fa-solid fa-thumbtack fr-pin-badge"></i>' : ''}${f.muted ? ' <i class="fa-solid fa-bell-slash" style="font-size:.7rem;opacity:.6"></i>' : ''}</div><div class="fi-sub">${esc(lastText(f))}</div></div>
      ${f.unread && !f.muted ? `<span style="background:var(--primary);color:#fff;border-radius:10px;padding:2px 8px;font-size:.7rem;font-weight:700;">${f.unread > 99 ? '99+' : f.unread}</span>` : ''}
    </div>`;
  C.loadFriends = async function(){
    const box = $('fc-dm'); if(!box || !me()) return;
    if(!box.children.length){ box._h = null; box.innerHTML = C._skelRows(4); }
    try{
      const all = await C._friendsList(), list = all.filter(f => !f.archived);
      if(!all.length){ setHtml(box, EMPTY('user-plus', 'No friends yet', 'Add friends from Find Friend')); return; }
      if(!list.length){ setHtml(box, EMPTY('box-archive', 'All chats are archived')); return; }
      list.sort((a, b) => (b.chatPinned ? 1 : 0) - (a.chatPinned ? 1 : 0) || (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || ((b.last ? b.last.at : 0) - (a.last ? a.last.at : 0)));
      setHtml(box, list.map(chatRow).join(''));
    }catch(e){ setHtml(box, EMPTY('triangle-exclamation', 'Could not load chats', esc(errMsg(e)))); }
  };
  C.streamFriends = function(){
    if(C._unsubs.friends){ try{ C._unsubs.friends(); }catch(e){} }
    C.loadFriends(); C._refreshHub();
    const t = setInterval(() => { if(visible()){ dropFriends(); C.loadFriends(); } }, 8000);
    C._unsubs.friends = () => clearInterval(t);
  };
  C.loadArchived = async function(){
    const box = $('fc-archived'); if(!box) return;
    try{
      const list = (await C._friendsList()).filter(f => f.archived);
      setHtml(box, list.length ? list.map(chatRow).join('') : EMPTY('box-archive', 'No archived chats', 'Archive a chat from its ⋮ menu'));
    }catch(e){ setHtml(box, EMPTY('triangle-exclamation', 'Could not load', esc(errMsg(e)))); }
  };
  C.loadGroups = async function(){
    const box = $('fc-groups'); if(!box) return;
    if(!box.children.length) box.innerHTML = C._skelRows(3);
    try{
      const r = await api.chat.get('/groups/mine'), gs = r.groups || [];
      setHtml(box, gs.length ? gs.map(g => `<div class="friend-item" onclick="chat.openGroup('${attr(g.id)}','${attr(g.name)}')">
          <div class="fi-avatar" style="background:linear-gradient(135deg,#f59e0b,#f43f5e);">${esc((g.name || 'G')[0].toUpperCase())}</div>
          <div class="fi-body"><div class="fi-name">${esc(g.name)} ${g.role === 'owner' ? '<span class="cx-role owner">Owner</span>' : g.role === 'admin' ? '<span class="cx-role">Admin</span>' : ''}</div><div class="fi-sub">${g.last ? esc((g.last.name ? g.last.name + ': ' : '') + g.last.text) : g.memberCount + ' members'}</div></div>
        </div>`).join('') : EMPTY('users', 'No groups', 'Discover new ones!'));
    }catch(e){ setHtml(box, EMPTY('triangle-exclamation', 'Could not load groups', esc(errMsg(e)))); }
  };
  C.loadFriendList = async function(){
    const box = $('fs-friends'); if(!box) return;
    if(!box.children.length) box.innerHTML = C._skelRows(3);
    try{
      const list = await C._friendsList(true);
      setHtml(box, list.length ? list.map(f => `<div class="friend-item">
          <div class="fi-avatar" style="cursor:pointer;" onclick="chat.openProfileById('${attr(f.uid)}')">${avHtml(f)}</div>
          <div class="fi-body" style="cursor:pointer;" onclick="chat.openProfileById('${attr(f.uid)}')"><div class="fi-name">${esc(f.appName)}</div><div class="fi-sub">@${esc(f.username || f.uid.slice(0, 8))} · ${f.online ? '<span style="color:#10b981;">online</span>' : 'offline'}</div></div>
          <button class="fi-action outline" onclick="chat.openDM('${attr(f.uid)}','${attr(f.appName)}')">Message</button>
        </div>`).join('') : EMPTY('user-group', 'No friends yet', 'Search by username and tap Add'));
    }catch(e){ setHtml(box, EMPTY('triangle-exclamation', 'Could not load friends', esc(errMsg(e)))); }
  };

  // own profile friends strip
  C._doProfileFriends = async function(){
    const grid = $('cp-friends-grid'), cnt = $('cp-friends-count'); if(!grid) return;
    const ids = (window.db.social.friends || []);
    if(cnt) cnt.textContent = '(' + ids.length + ')';
    if(!ids.length){ setHtml(grid, EMPTY('user-group', 'No friends yet', 'Search &amp; add friends to start chatting')); return; }
    if(!grid.children.length){ grid._h = null; grid.innerHTML = C._skelRows(Math.min(ids.length, 3)); }
    try{
      const list = (await C._friendsList()).slice(), pins = window.db.social.pinnedFriends || [];
      list.sort((a, b) => (pins.includes(a.uid) ? 0 : 1) - (pins.includes(b.uid) ? 0 : 1));
      setHtml(grid, list.slice(0, 80).map(f => {
        const pinned = pins.includes(f.uid), nm = attr(f.appName);
        return `<div class="fr-row" data-uid="${attr(f.uid)}">
          <div class="fr-av">${avHtml(f)}<span class="fr-dot ${f.online ? 'on' : 'off'}"></span></div>
          <div class="fr-body" onclick="chat.openProfileById('${attr(f.uid)}')">
            <div class="fr-name">${esc(f.appName)}${pinned ? '<i class="fa-solid fa-thumbtack fr-pin-badge" title="Pinned"></i>' : ''}</div>
            <div class="fr-sub">@${esc(f.username || f.uid.slice(0, 6))} · ${f.online ? '<span style="color:#10b981;">online</span>' : 'offline'}</div>
          </div>
          <button class="fr-act" title="Message" onclick="chat.openDM('${attr(f.uid)}','${nm}')"><i class="fa-solid fa-comment"></i></button>
          <button class="fr-act dots" title="More" onclick="chat._friendMenu(event,'${attr(f.uid)}','${nm}',${pinned})"><i class="fa-solid fa-ellipsis-vertical"></i></button>
        </div>`;
      }).join('') || EMPTY('user-group', 'No friends'));
    }catch(e){ setHtml(grid, EMPTY('triangle-exclamation', 'Could not load friends', esc(errMsg(e)))); }
  };

  /* ===================================================================== search / requests */
  let sT = null, sSeq = 0;
  const relBtn = (u) => {
    const s = window.db.social, id = u.uid, nm = attr(u.appName);
    if(s.friends.includes(id)) return `<button class="fi-action outline" onclick="chat.openDM('${attr(id)}','${nm}')">Message</button>`;
    if(s.outgoing.includes(id)) return `<button class="fi-action outline" onclick="chat.cancelRequest('${attr(id)}')">Cancel</button>`;
    if((s.incoming || []).includes(id)) return `<button class="fi-action primary" onclick="chat.acceptRequest('${attr(id)}')">Accept</button>`;
    return `<button class="fi-action primary" onclick="chat.sendRequest('${attr(id)}')">Add</button>`;
  };
  const userRow = (u, sub) => `<div class="friend-item">
      <div class="fi-avatar" style="cursor:pointer;" onclick="chat.openProfileById('${attr(u.uid)}')">${avHtml(u)}</div>
      <div class="fi-body" style="cursor:pointer;" onclick="chat.openProfileById('${attr(u.uid)}')"><div class="fi-name">${esc(u.appName || 'User')}</div>
      <div class="fi-sub">@${esc(u.username || u.uid.slice(0, 8))} ${sub || ''}</div></div>
      ${relBtn(u)}
    </div>`;
  const NOQ = '<div class="empty-state"><i class="fa-solid fa-magnifying-glass"></i><div>Type 2+ chars to search</div></div>';
  C.searchUsers = function(q){
    clearTimeout(sT); const box = $('fs-results'); if(!box) return;
    const v = (q || '').trim().toLowerCase().replace(/^@/, '');
    if(v.length < 2){ sSeq++; box.innerHTML = NOQ; return; }
    box.innerHTML = '<div class="empty-state">Searching...</div>';
    sT = setTimeout(() => doSearch(v), 320);
  };
  async function doSearch(v){
    const box = $('fs-results'), my = ++sSeq; if(!box) return;
    try{
      const r = await api.chat.get('/search?q=' + encodeURIComponent(v)); if(my !== sSeq) return;
      const list = (r.users || []).filter(u => u.uid !== me());
      box.innerHTML = list.length ? list.map(u => userRow(u, u.online ? '<span style="color:#10b981;">● online</span>' : '<span style="color:var(--text-muted);">● offline</span>')).join('') : '<div class="empty-state"><i class="fa-solid fa-user-slash"></i><div>No users found</div></div>';
    }catch(e){ if(my === sSeq) box.innerHTML = `<div class="empty-state"><i class="fa-solid fa-circle-exclamation"></i><div>${esc(errMsg(e))}</div></div>`; }
  }
  const rerenderSearch = () => { const i = $('fs-input'); const v = i && i.value.trim(); if(v && v.length >= 2) doSearch(v.toLowerCase().replace(/^@/, '')); };
  const paintBtn = (uid, html) => document.querySelectorAll(`[onclick="chat.sendRequest('${uid}')"],[onclick="chat.cancelRequest('${uid}')"],[onclick="chat.acceptRequest('${uid}')"]`).forEach(b => { b.outerHTML = html; });

  C.sendRequest = async function(uid){
    const s = window.db.social;
    if(s.friends.includes(uid)) return toast('Already friends');
    if(s.outgoing.includes(uid)) return toast('Request already sent');
    try{
      const r = await api.chat.post('/friends/request', { to: uid });
      if(r.status === 'friends'){ if(!s.friends.includes(uid)) s.friends.push(uid); s.incoming = (s.incoming || []).filter(x => x !== uid); toast('You are now friends 🎉'); }
      else { s.outgoing.push(uid); toast('Request sent'); }
      applySocial(); dropFriends(); rerenderSearch();
      document.querySelectorAll(`[onclick="chat.sendRequest('${uid}')"]`).forEach(b => { b.removeAttribute('onclick'); b.textContent = r.status === 'friends' ? 'Friends ✓' : 'Sent ✓'; b.className = 'fi-action outline done'; b.disabled = true; });
    }catch(e){ toast(errMsg(e)); }
  };
  C.sendFriendRequest = (uid) => C.sendRequest(uid);
  C.cancelRequest = async function(uid){
    try{
      await api.chat.post('/friends/cancel', { to: uid });
      const s = window.db.social; s.outgoing = s.outgoing.filter(x => x !== uid); applySocial();
      toast('Request cancelled'); if($('fs-requests') && !$('fs-requests').classList.contains('hidden')) C.loadRequests(); rerenderSearch();
    }catch(e){ toast(errMsg(e)); }
  };
  C.acceptRequest = async function(a, b){
    const from = b || a;
    try{
      await api.chat.post('/friends/accept', { from });
      const s = window.db.social; if(!s.friends.includes(from)) s.friends.push(from); s.incoming = (s.incoming || []).filter(x => x !== from); applySocial(); dropFriends();
      toast('Friend added'); C.loadRequests(); C._refreshHub(); rerenderSearch();
    }catch(e){ toast(errMsg(e)); }
  };
  C.rejectRequest = async function(a, b){
    const from = b || a;
    try{
      await api.chat.post('/friends/reject', { from });
      const s = window.db.social; s.incoming = (s.incoming || []).filter(x => x !== from); applySocial();
      toast('Request removed'); C.loadRequests(); C._refreshHub();
    }catch(e){ toast(errMsg(e)); }
  };
  const head = (t) => `<div style="padding:10px 14px 6px;font-weight:800;font-size:0.82rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;">${t}</div>`;
  C.loadRequests = async function(){
    const box = $('fs-requests'); if(!box) return;
    if(!box.children.length) box.innerHTML = '<div class="empty-state">Loading...</div>';
    try{
      const r = await api.chat.get('/friends/requests'), inc = r.incoming || [], out = r.outgoing || [];
      window.db.social.incoming = inc.map(u => u.uid); window.db.social.outgoing = out.map(u => u.uid);
      let h = head(`Incoming (${inc.length})`);
      h += inc.length ? inc.map(u => `<div class="friend-item">
          <div class="fi-avatar" style="cursor:pointer;" onclick="chat.openProfileById('${attr(u.uid)}')">${avHtml(u)}</div>
          <div class="fi-body" style="cursor:pointer;" onclick="chat.openProfileById('${attr(u.uid)}')"><div class="fi-name">${esc(u.appName)}</div><div class="fi-sub">@${esc(u.username || u.uid.slice(0, 8))}</div></div>
          <button class="fi-action primary" onclick="chat.acceptRequest('${attr(u.uid)}')">Accept</button>
          <button class="fi-action danger" style="margin-left:4px;" onclick="chat.rejectRequest('${attr(u.uid)}')">Reject</button>
        </div>`).join('') : '<div class="empty-state" style="padding:16px;"><i class="fa-solid fa-inbox"></i><div>No new requests</div></div>';
      h += head(`Sent (${out.length})`);
      h += out.length ? out.map(u => `<div class="friend-item">
          <div class="fi-avatar" style="cursor:pointer;" onclick="chat.openProfileById('${attr(u.uid)}')">${avHtml(u)}</div>
          <div class="fi-body"><div class="fi-name">${esc(u.appName)}</div><div class="fi-sub">@${esc(u.username || u.uid.slice(0, 8))}</div></div>
          <button class="fi-action outline" onclick="chat.cancelRequest('${attr(u.uid)}')">Cancel</button>
        </div>`).join('') : '<div class="empty-state" style="padding:16px;"><i class="fa-solid fa-paper-plane"></i><div>No pending sent requests</div></div>';
      setHtml(box, h); applySocial();
      const b = $('hub-req-badge'); if(b){ b.textContent = inc.length > 9 ? '9+' : inc.length; b.classList.toggle('hidden', !inc.length); }
    }catch(e){ setHtml(box, EMPTY('triangle-exclamation', 'Could not load requests', esc(errMsg(e)))); }
  };

  /* ===================================================================== block / unblock / report / friend actions */
  async function doBlock(uid){
    await api.chat.post('/block', { uid });
    const s = window.db.social;
    s.friends = s.friends.filter(x => x !== uid); s.pinnedFriends = s.pinnedFriends.filter(x => x !== uid); s.outgoing = s.outgoing.filter(x => x !== uid);
    if(!s.blocked.includes(uid)) s.blocked.push(uid);
    applySocial(); dropFriends();
    if(C._thread && C._thread.peer === uid) C.closeThread();
    C.renderProfile && C.renderProfile(); C.loadFriends();
  }
  C.blockUser = async function(uid){
    if(!confirm('Block this user? They will be removed as a friend and cannot message you.')) return;
    try{ await doBlock(uid); toast('User blocked'); }catch(e){ toast(errMsg(e)); }
  };
  C._blockFriend = C.blockUser;
  C.unblockUser = async function(uid){
    try{
      await api.chat.post('/unblock', { uid });
      const s = window.db.social; s.blocked = s.blocked.filter(x => x !== uid); applySocial();
      toast('Unblocked'); window.closeSheet && window.closeSheet(); C.renderProfile && C.renderProfile();
    }catch(e){ toast(errMsg(e)); }
  };
  C.reportUser = async function(uid, reason){
    try{ await api.chat.post('/report', { type: 'user', target: uid, reason }); toast('Reported. Thank you.'); }catch(e){ toast(errMsg(e)); }
  };
  C.reportMessage = async function(ctx, mid, reason){
    try{
      const t = C._thread, el = document.querySelector(`.msg-row[data-mid="${mid}"] .msg-text`);
      await api.chat.post('/report', { type: 'message', target: mid, scope: ctx === 'world' ? 'world' : (t && t.type), ref: ctx === 'world' ? '' : (t && (t.peer || t.id)), reason, text: el ? el.innerText : '' });
      toast('Reported');
    }catch(e){ toast(errMsg(e)); }
  };
  C._togglePinFriend = async function(uid){
    try{
      const r = await api.chat.post('/friends/pin', { uid }); window.db.social.pinnedFriends = r.pinnedFriends || []; applySocial(); dropFriends();
      toast(r.pinned ? 'Pinned' : 'Unpinned'); C._renderProfileFriends();
    }catch(e){ toast(errMsg(e)); }
  };
  C._removeFriend = async function(uid){
    if(!confirm('Remove this friend?')) return;
    try{
      await api.chat.post('/friends/remove', { uid });
      const s = window.db.social; s.friends = s.friends.filter(x => x !== uid); s.pinnedFriends = s.pinnedFriends.filter(x => x !== uid); applySocial(); dropFriends();
      toast('Friend removed'); C.renderProfile();
    }catch(e){ toast(errMsg(e)); }
  };
  C.openBlockList = async function(){
    const openSheet = window.openSheet;
    openSheet('<div style="padding:14px;font-weight:800;font-size:1rem;"><i class="fa-solid fa-ban"></i> Blocked Users</div><div id="bl-list" style="padding:0 8px 20px;">Loading...</div>');
    try{
      const r = await api.chat.get('/blocked'), us = r.users || [], el = $('bl-list'); if(!el) return;
      el.innerHTML = us.length ? us.map(u => `<div class="friend-item"><div class="fi-avatar">${avHtml(u)}</div>
        <div class="fi-body"><div class="fi-name">${esc(u.appName)}</div><div class="fi-sub">@${esc(u.username || u.uid.slice(0, 8))}</div></div>
        <button class="fi-action outline" onclick="chat.unblockUser('${attr(u.uid)}')">Unblock</button></div>`).join('')
        : `<div style="padding:30px 20px;text-align:center;color:var(--text-muted);"><i class="fa-solid fa-ban" style="font-size:2.4rem;margin-bottom:12px;opacity:.5;"></i><div style="font-weight:700;color:var(--text-main);">No blocked users</div><div style="font-size:0.8rem;margin-top:6px;">Blocked users can't message you.</div></div>`;
    }catch(e){ const el = $('bl-list'); if(el) el.innerHTML = esc(errMsg(e)); }
  };

  /* ===================================================================== profile cards */
  C.openProfileById = async function(uid){
    if(!uid) return;
    if(uid === me()){ C.openSub && C.openSub('profile'); return; }
    try{
      const u = (await api.chat.get('/profile/' + encodeURIComponent(uid), 8000)).profile, nm = esc(u.appName || 'User');
      const bio = esc(u.bio || '') || 'No bio yet.', uname = esc(u.username || uid.slice(0, 8));
      const online = u.online ? '<span style="color:#10b981;font-weight:700;">● Online</span>' : '<span style="color:var(--text-muted);">Offline</span>';
      const seen = u.lastSeen ? new Date(u.lastSeen).toLocaleString() : '—';
      let friendBtn = '';
      if(u.isFriend) friendBtn = '';
      else if(u.requested) friendBtn = '<button class="tpq" data-act="cancel"><i class="fa-solid fa-clock"></i>Requested</button>';
      else if(u.incomingRequest) friendBtn = '<button class="tpq" data-act="accept"><i class="fa-solid fa-user-check"></i>Accept</button>';
      else friendBtn = '<button class="tpq" data-act="request"><i class="fa-solid fa-user-plus"></i>Add</button>';
      const blockBtn = u.blockedByMe ? '<button class="tpq" data-act="unblock"><i class="fa-solid fa-unlock"></i>Unblock</button>' : '<button class="tpq danger" data-act="block"><i class="fa-solid fa-ban"></i>Block</button>';
      const body = u.locked ? `
          <div style="margin-top:14px;padding:12px;background:var(--bg-input);border-radius:12px;text-align:center;font-size:0.82rem;color:var(--text-muted);"><i class="fa-solid fa-lock"></i> This profile is private. Send a friend request to see details and chat.</div>
          <div class="tp-quick" style="margin-top:10px;">${friendBtn}${blockBtn}</div>`
        : `<div class="tp-bio">${bio}</div>
          <div style="display:flex;justify-content:space-around;margin-top:12px;font-size:0.8rem;">
            <div><b>${u.friendCount || 0}</b><div style="color:var(--text-muted);font-size:0.7rem;">Friends</div></div>
            <div>${online}<div style="color:var(--text-muted);font-size:0.7rem;">Status</div></div>
          </div>
          <div style="text-align:center;font-size:0.7rem;color:var(--text-muted);margin-top:8px;">Last seen: ${esc(seen)}</div>
          <div class="tp-quick" style="margin-top:14px;">
            ${u.blockedByMe ? '' : '<button class="tpq" data-act="message"><i class="fa-solid fa-message"></i>Message</button>'}${friendBtn}${blockBtn}
            <button class="tpq danger" data-act="report"><i class="fa-solid fa-flag"></i>Report</button>
          </div>`;
      window.openSheet(`<div class="th-profile-card"><div class="tp-avatar">${avHtml(u)}</div><div class="tp-name">${nm}${u.isVerified ? ' <i class="fa-solid fa-circle-check" style="color:#1d9bf0;"></i>' : ''}</div><div class="tp-uname">@${uname}${u.locked ? ' <i class="fa-solid fa-lock"></i>' : ''}</div>${body}</div>`);
      sheet().querySelectorAll('[data-act]').forEach(el => el.onclick = () => {
        const a = el.dataset.act; window.closeSheet();
        if(a === 'message') C.openDM(uid, u.appName || 'User');
        else if(a === 'request') C.sendRequest(uid);
        else if(a === 'cancel') C.cancelRequest(uid);
        else if(a === 'accept') C.acceptRequest(uid);
        else if(a === 'block') C.blockUser(uid);
        else if(a === 'unblock') C.unblockUser(uid);
        else if(a === 'report'){ const r = prompt('Reason'); if(r) C.reportUser(uid, r); }
      });
    }catch(e){ toast(e.code === 'not_found' ? 'User not found' : errMsg(e)); }
  };
  C.openContactProfile = async function(){
    const t = C._thread; if(!t) return;
    if(t.type === 'group'){ C.openMembers(t.id); return; }
    try{
      const u = (await api.chat.get('/profile/' + encodeURIComponent(t.peer), 8000)).profile;
      const muted = window.db.social.muted.includes(t.id);
      window.openSheet(`<div class="th-profile-card"><div class="tp-avatar">${avHtml(u)}</div><div class="tp-name">${esc(u.appName || 'User')}</div><div class="tp-uname">@${esc(u.username || t.peer.slice(0, 8))}</div><div class="tp-bio">${u.locked ? 'Private profile' : (esc(u.bio || '') || 'No bio yet.')}</div>
        <div class="tp-quick">
          <button class="tpq" data-act="voice"><i class="fa-solid fa-phone"></i>Voice</button>
          <button class="tpq" data-act="video"><i class="fa-solid fa-video"></i>Video</button>
          <button class="tpq" data-act="mute"><i class="fa-solid fa-bell-slash"></i>${muted ? 'Unmute' : 'Mute'}</button>
          <button class="tpq" data-act="search"><i class="fa-solid fa-magnifying-glass"></i>Search</button>
          <button class="tpq danger" data-act="block"><i class="fa-solid fa-ban"></i>Block</button>
        </div></div>`);
      sheet().querySelectorAll('[data-act]').forEach(el => el.onclick = () => {
        const a = el.dataset.act; window.closeSheet();
        if(a === 'voice' || a === 'video') C.startCall(a); else if(a === 'mute') C.muteThread(); else if(a === 'search') C.searchThread(); else if(a === 'block') C.blockUser(t.peer);
      });
    }catch(e){ toast(errMsg(e)); }
  };

  /* ===================================================================== profile edit / photos */
  C._saveEditProfile = async function(){
    const name = $('ep-name').value.trim(), username = $('ep-username').value.trim().toLowerCase(), bio = $('ep-bio').value.trim(), privacy = $('ep-priv').value || 'public';
    const cur = C._me || {};
    if(!name){ toast('Name required'); return; }
    if(!/^[a-z0-9]{5,20}$/.test(username)){ toast('Username: 5-20 chars, letters & numbers only'); return; }
    if((bio.match(/\S+/g) || []).length > 100){ toast('Bio: max 100 words'); return; }
    try{
      if(name !== cur.appName){ await api.put('/me/profile', { appName: name }); }
      if(username !== (cur.username || '')){ await api.chat.post('/profile/username', { username }); }
      await api.chat.put('/profile', { bio, privacy });
      Object.assign(C._me, { appName: name, username, bio, privacy }); window.db.user_name = name;
      applySocial(); window.closeSheet(); C.renderProfile(); C.syncSocial(true);
      window.app && window.app.fetchUserData && window.app.fetchUserData();
      toast('Profile updated');
    }catch(e){ toast(errMsg(e)); C.syncSocial(true); }
  };
  C.uploadProfileImage = function(kind){
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
    inp.onchange = async () => {
      const f = inp.files[0]; if(!f) return;
      if(!/^image\//.test(f.type)){ toast('Only image files allowed'); return; }
      if(f.size > 15 * 1024 * 1024){ toast('File too large (>15MB). Choose a smaller image.'); return; }
      const cover = kind === 'cover'; toast('Compressing...');
      try{
        const blob = await C._compressImage(f, cover ? 1000 : 200, cover ? 140 * 1024 : 22 * 1024);
        if(!blob || blob.size > (cover ? 145 : 23) * 1024){ toast('Image is too detailed. Try a simpler picture.'); return; }
        const url = await blobToDataUrl(blob); toast('Uploading...');
        await api.chat.put('/profile', cover ? { coverURL: url } : { photoUrl: url });
        if(!cover){ api.put('/me/profile', { photoUrl: url }).then(() => window.app && window.app.fetchUserData && window.app.fetchUserData()).catch(() => {}); }
        C._me[cover ? 'coverURL' : 'photoUrl'] = url; AV[me()] = cover ? AV[me()] : url; applySocial();
        C.renderProfile(); if(!cover && $('ep-name')) C.openEditProfile();
        toast(cover ? 'Cover updated' : 'Photo updated');
      }catch(e){ toast(errMsg(e)); }
    };
    inp.click();
  };

  /* ===================================================================== discover + groups lifecycle */
  C.loadDiscover = async function(t){
    const box = $('dc-' + t); if(!box) return;
    box.innerHTML = '<div class="empty-state">Loading...</div>';
    try{
      if(t === 'people'){
        const r = await api.chat.get('/discover/people', 15000), us = r.users || [];
        box.innerHTML = us.length ? us.map(u => userRow(u)).join('') : '<div class="empty-state">No suggestions</div>'; return;
      }
      const r = await api.chat.get('/groups/discover?sort=' + (t === 'trending' ? 'trending' : 'new'), 10000), gs = r.groups || [];
      box.innerHTML = gs.length ? gs.map(g => `<div class="friend-item">
          <div class="fi-avatar" style="background:linear-gradient(135deg,#0ea5e9,#4f46e5);">${esc((g.name || 'G')[0].toUpperCase())}</div>
          <div class="fi-body"><div class="fi-name">${esc(g.name)}</div><div class="fi-sub">${g.memberCount} members${g.desc ? ' · ' + esc(g.desc) : ''}</div></div>
          ${g.joined ? `<button class="fi-action outline" onclick="chat.openGroup('${attr(g.id)}','${attr(g.name)}')">Open</button>` : `<button class="fi-action primary" onclick="chat.joinGroup('${attr(g.id)}')">Join</button>`}
        </div>`).join('') : '<div class="empty-state"><i class="fa-solid fa-users-slash"></i><div>No public groups yet</div></div>';
    }catch(e){ box.innerHTML = '<div class="empty-state">' + esc(errMsg(e)) + '</div>'; }
  };
  C.joinGroup = async function(gid, invite){
    try{
      const r = await api.chat.post('/groups/' + encodeURIComponent(gid) + '/join', invite ? { invite: true } : {});
      toast('Joined ' + (r.name || 'group')); if(!window.db.social.groups.includes(gid)) window.db.social.groups.push(gid);
      const act = document.querySelector('#chat-sub-discover .chat-tab.active'); C.loadDiscover(act && act.dataset.dctab ? act.dataset.dctab : 'public');
      return r;
    }catch(e){ toast(errMsg(e)); }
  };
  C._autoJoin = async function(gid){
    try{
      const r = await api.chat.post('/groups/' + encodeURIComponent(gid) + '/join', { invite: true });
      history.replaceState(null, '', location.pathname); toast('Joined ' + (r.name || 'group'));
      if(window.nav && window.nav.goto){ window.nav.goto('chat', document.querySelectorAll('.nav-item')[2]); setTimeout(() => C.openGroup(gid, r.name), 400); }
    }catch(e){ history.replaceState(null, '', location.pathname); toast(errMsg(e)); }
  };
  C.openNewGroup = function(){
    const m = C._openModal(`
      <h3><i class="fa-solid fa-users"></i> Create Group</h3>
      <input class="cx-input" id="ng-name" placeholder="Group name" maxlength="40">
      <input class="cx-input" id="ng-desc" placeholder="Description (optional)" maxlength="120">
      <label class="cx-toggle"><input type="checkbox" id="ng-public"> <span>Public — anyone can find &amp; join</span></label>
      <div class="cx-btn-row"><button class="cx-btn o" id="ng-cancel">Cancel</button><button class="cx-btn p" id="ng-create">Create</button></div>`);
    m.querySelector('#ng-cancel').onclick = () => m.remove();
    m.querySelector('#ng-create').onclick = async () => {
      const name = m.querySelector('#ng-name').value.trim(), desc = m.querySelector('#ng-desc').value.trim(), pub = m.querySelector('#ng-public').checked;
      if(name.length < 2){ toast('Group name needs 2+ characters'); return; }
      try{ const r = await api.chat.post('/groups', { name, desc, public: pub }); toast('Group created'); m.remove(); C.loadGroups(); C.openGroup(r.id, name); }
      catch(e){ toast(errMsg(e)); }
    };
  };
  C.openMembers = async function(gid){
    try{
      const r = await api.chat.get('/groups/' + encodeURIComponent(gid) + '?members=1'), g = r.group, ms = r.members || [];
      const isOwner = g.role === 'owner', isAdm = isOwner || g.role === 'admin';
      const rows = ms.map(u => {
        const roleLbl = u.role === 'owner' ? '<span class="cx-role owner">Owner</span>' : u.role === 'admin' ? '<span class="cx-role">Admin</span>' : '';
        let ctrls = '';
        if(isAdm && u.uid !== me() && u.role !== 'owner' && !(u.role === 'admin' && !isOwner)){
          if(isOwner) ctrls = u.role === 'admin' ? `<button class="cx-btn o" data-demote="${attr(u.uid)}" style="padding:6px 10px;font-size:0.72rem;">Demote</button>` : `<button class="cx-btn o" data-promote="${attr(u.uid)}" style="padding:6px 10px;font-size:0.72rem;">Make admin</button>`;
          ctrls += `<button class="cx-btn o" data-kick="${attr(u.uid)}" style="padding:6px 10px;font-size:0.72rem;color:var(--danger);">Kick</button>`;
        }
        return `<div class="cx-member"><div class="fi-avatar" style="width:38px;height:38px;" onclick="chat.openProfileById('${attr(u.uid)}')">${avHtml(u)}</div>
          <div style="flex:1;min-width:0;"><div style="font-weight:700;font-size:0.85rem;">${esc(u.appName)} ${roleLbl}</div><div style="font-size:0.7rem;color:var(--text-muted);">@${esc(u.username || u.uid.slice(0, 8))}</div></div>
          <div style="display:flex;gap:6px;">${ctrls}</div></div>`;
      }).join('');
      window.openSheet(`<div style="font-weight:800;padding:4px 8px 10px;">Members (${g.memberCount})</div>` + rows);
      const act = async (fn, okMsg) => { try{ await fn(); toast(okMsg); window.closeSheet(); }catch(e){ toast(errMsg(e)); } };
      const base = '/groups/' + encodeURIComponent(gid);
      sheet().querySelectorAll('[data-kick]').forEach(el => el.onclick = () => { if(confirm('Kick this user?')) act(() => api.chat.post(base + '/kick', { uid: el.dataset.kick }), 'Kicked'); });
      sheet().querySelectorAll('[data-promote]').forEach(el => el.onclick = () => act(() => api.chat.post(base + '/role', { uid: el.dataset.promote, admin: true }), 'Promoted'));
      sheet().querySelectorAll('[data-demote]').forEach(el => el.onclick = () => act(() => api.chat.post(base + '/role', { uid: el.dataset.demote, admin: false }), 'Demoted'));
    }catch(e){ toast(errMsg(e)); }
  };
  C.openAddSong = function(gid){
    const m = C._openModal(`
      <h3><i class="fa-solid fa-music"></i> Add song</h3>
      <input class="cx-input" id="as-title" placeholder="Song title" maxlength="80">
      <input class="cx-input" id="as-url" placeholder="Direct audio URL (.mp3)">
      <div style="font-size:0.72rem;color:var(--text-muted);margin-bottom:8px;">Paste a public MP3/audio URL. Everyone in the group can play it.</div>
      <div class="cx-btn-row"><button class="cx-btn o" id="as-cancel">Cancel</button><button class="cx-btn p" id="as-play">Play now</button></div>`);
    m.querySelector('#as-cancel').onclick = () => m.remove();
    m.querySelector('#as-play').onclick = async () => {
      const title = m.querySelector('#as-title').value.trim() || 'Untitled', url = m.querySelector('#as-url').value.trim();
      if(!/^https?:\/\//i.test(url)){ toast('Enter valid URL'); return; }
      try{ await api.chat.post('/groups/' + encodeURIComponent(gid) + '/song', { title, url }); toast('Playing'); m.remove(); C._pullThread && C._pullThread(); }
      catch(e){ toast(errMsg(e)); }
    };
  };

  /* ===================================================================== thread (DM + group) */
  const noteFrom = () => {
    if(!$('chat-sub-thread').classList.contains('hidden')) return;
    const v = [...document.querySelectorAll('#page-chat .chat-sub-view')].find(x => !x.classList.contains('hidden'));
    C._threadFrom = v ? v.id.replace('chat-sub-', '') : 'friends';
  };
  const enter = () => { $('chat-hub').classList.add('hidden'); $('page-chat').classList.add('in-sub'); };
  let mbAudio = null;
  function stopThread(){
    ['thread', 'peer'].forEach(k => { if(C._unsubs[k]){ try{ C._unsubs[k](); }catch(e){} delete C._unsubs[k]; } });
    if(mbAudio){ try{ mbAudio.pause(); }catch(e){} mbAudio = null; }
    const mb = $('cx-mb'); if(mb) mb.remove();
  }
  function showThread(name, letter){
    document.querySelectorAll('.chat-sub-view').forEach(v => v.classList.add('hidden'));
    $('chat-sub-thread').classList.remove('hidden');
    $('th-name').textContent = name; $('th-avatar').textContent = letter;
  }
  function decorate(kind, id, name){
    const av = $('th-avatar'), st = $('th-status'), peer = $('th-peer');
    const set = (u) => { av.innerHTML = avHtml(u || { appName: name }) + '<span class="th-online-dot"></span>'; };
    set(null); peer.classList.remove('online'); st.className = 'th-status-lbl';
    if(kind === 'group'){ st.textContent = 'Group · tap for members'; return; }
    st.textContent = '';
    const tick = async () => {
      if(!C._thread || C._thread.peer !== id) return;
      try{
        const p = (await api.chat.get('/profile/' + encodeURIComponent(id), 15000)).profile;
        if(!C._thread || C._thread.peer !== id) return;
        set(p); peer.classList.toggle('online', !!p.online); st.textContent = p.locked ? '' : (p.online ? 'online' : fmtSeen(p.lastSeen));
        if(p.appName) $('th-name').textContent = p.appName;
        window.presence && window.presence.set(id, p.online, p.lastSeen);
      }catch(e){}
    };
    tick(); const t = setInterval(tick, 20000); C._unsubs.peer = () => clearInterval(t);
  }
  function renderMusic(np){
    const body = $('th-messages'); let mb = $('cx-mb');
    if(!np || !np.url){ if(mb) mb.remove(); if(mbAudio){ mbAudio.pause(); mbAudio = null; } return; }
    const key = np.url + '|' + np.startAt;
    if(mb && mb._key === key) return;
    if(mbAudio){ mbAudio.pause(); mbAudio = null; }
    if(mb) mb.remove();
    mb = document.createElement('div'); mb.id = 'cx-mb'; mb.className = 'cx-music-box'; mb._key = key;
    body.parentNode.insertBefore(mb, body);
    const t = C._thread, canStop = t && (np.byUid === me() || t.role === 'owner' || t.role === 'admin');
    mb.innerHTML = `<div class="mb-ic" id="mb-play"><i class="fa-solid fa-play"></i></div>
      <div class="mb-info"><div class="mb-title">${esc(np.title || 'Untitled')}</div><div class="mb-sub">Added by ${esc(np.by || 'someone')}</div><div class="cx-music-bar"><span id="mb-bar"></span></div></div>
      <div class="mb-ic" id="mb-stop" title="${canStop ? 'Stop for everyone' : 'Stop for me'}"><i class="fa-solid fa-xmark"></i></div>`;
    const btn = mb.querySelector('#mb-play'), bar = mb.querySelector('#mb-bar');
    btn.onclick = () => {
      if(mbAudio && !mbAudio.paused){ mbAudio.pause(); btn.innerHTML = '<i class="fa-solid fa-play"></i>'; return; }
      if(!mbAudio || mbAudio._src !== np.url){
        if(mbAudio) mbAudio.pause();
        mbAudio = new Audio(np.url); mbAudio._src = np.url;
        mbAudio.ontimeupdate = () => { if(mbAudio && mbAudio.duration) bar.style.width = (100 * mbAudio.currentTime / mbAudio.duration) + '%'; };
        mbAudio.onended = () => { btn.innerHTML = '<i class="fa-solid fa-play"></i>'; bar.style.width = '0%'; };
      }
      mbAudio.play().then(() => btn.innerHTML = '<i class="fa-solid fa-pause"></i>').catch(e => toast('Play blocked: ' + e.message));
    };
    mb.querySelector('#mb-stop').onclick = async () => {
      if(mbAudio){ mbAudio.pause(); mbAudio = null; }
      if(canStop){ try{ await api.chat.post('/groups/' + encodeURIComponent(t.id) + '/song', { clear: true }); }catch(e){ toast(errMsg(e)); } }
      mb.remove();
    };
  }
  const THREAD_FATAL = ['not_member', 'you_blocked', 'blocked_by', 'no_group', 'not_found', 'private'];
  function startPoll(){
    const t0 = C._thread, box = $('th-messages'); if(!t0 || !box) return;
    box._init = false; box._seen = null; box.innerHTML = C._skelMsgs();
    let sig = '', busy = false, dead = false, errs = 0, first = true;
    const pull = async () => {
      if(busy || dead || !visible() || C._thread !== t0) return; busy = true;
      try{
        const path = t0.type === 'dm' ? `/dm/${encodeURIComponent(t0.peer)}/messages?read=${first ? 2 : 1}` : `/groups/${encodeURIComponent(t0.id)}/messages`;
        const r = await api.chat.get(path); if(C._thread !== t0) return;
        errs = 0; first = false;
        const list = r.messages || []; await loadAvatars(list.map(m => m.uid));
        if(t0.type === 'group' && r.group){ t0.role = r.group.role; t0.groupName = r.group.name; renderMusic(r.group.nowPlaying); }
        const s = sigOf(list); if(s === sig) return; sig = s;
        C._renderList(box, list.map(toMsg), 'thread', EMPTY('comment-dots', 'Say hi 👋', 'Start the conversation'));
      }catch(e){
        errs++;
        if(THREAD_FATAL.includes(e.code)){ toast(errMsg(e)); dead = true; C.closeThread(); return; }
        if(!box._init && errs > 1) box.innerHTML = EMPTY('triangle-exclamation', 'Could not load chat', esc(errMsg(e)));
      }finally{ busy = false; }
    };
    pull(); const t = setInterval(pull, 3000);
    C._unsubs.thread = () => { dead = true; clearInterval(t); };
    C._pullThread = () => { sig = ''; return pull(); };
  }
  C.openDM = async function(uid, name){
    noteFrom(); enter(); stopThread();
    C._thread = { type: 'dm', id: C._chatId(me(), uid), peer: uid, peerName: name };
    showThread(name || 'Chat', ((name || 'U')[0] || 'U').toUpperCase());
    decorate('dm', uid, name); startPoll(); replay($('chat-sub-thread'), 'sub-in');
  };
  C.openGroup = async function(gid, name){
    noteFrom(); enter(); stopThread();
    C._thread = { type: 'group', id: gid, groupName: name };
    showThread(name || 'Group', ((name || 'G')[0] || 'G').toUpperCase());
    decorate('group', gid, name); startPoll(); replay($('chat-sub-thread'), 'sub-in');
  };
  C.closeThread = function(){
    stopThread(); C._thread = null;
    const to = C._threadFrom; C._threadFrom = null;
    $('chat-sub-thread').classList.add('hidden');
    if(to && to !== 'friends' && $('chat-sub-' + to)){ $('chat-sub-friends').classList.add('hidden'); C.openSub(to); }
    else { $('chat-sub-friends').classList.remove('hidden'); replay($('chat-sub-friends'), 'sub-out'); dropFriends(); C.loadFriends(); }
  };
  C.sendThread = async function(){
    const t = C._thread; if(!t) return;
    const inp = $('th-input'), text = inp.value.trim(); if(!text) return;
    inp.value = ''; const body = { text };
    if(C._replyTo && C._replyTo.th){ body.replyTo = { mid: C._replyTo.th.mid, text: C._replyTo.th.text }; C.cancelReply('th'); }
    flyBtn('#chat-sub-thread .chat-composer');
    try{ await api.chat.post(t.type === 'dm' ? `/dm/${encodeURIComponent(t.peer)}/send` : `/groups/${encodeURIComponent(t.id)}/send`, body); C._pullThread && C._pullThread(); }
    catch(e){ inp.value = text; toast(errMsg(e)); }
  };
  C.sendFile = async function(ctx, file){
    const t = C._thread;
    if(ctx === 'world'){ toast('World Chat is text-only'); return; }
    if(!file || !t) return;
    if(!/^image\//.test(file.type)){ toast('Only photos can be sent for now'); return; }
    if(file.size > 15 * 1024 * 1024){ toast('Photo too large (max 15MB)'); return; }
    toast('Sending photo...');
    try{
      const blob = await C._compressImage(file, 1024, 140 * 1024);
      if(!blob || blob.size > 150 * 1024) throw new Error('Photo is too heavy. Try another one.');
      const url = await blobToDataUrl(blob);
      await api.chat.post(t.type === 'dm' ? `/dm/${encodeURIComponent(t.peer)}/send` : `/groups/${encodeURIComponent(t.id)}/send`, { type: 'image', url, fileName: file.name });
      C._pullThread && C._pullThread();
    }catch(e){ toast(errMsg(e)); }
    ['th-file', 'th-cam', 'th-gallery'].forEach(id => { const i = $(id); if(i) i.value = ''; });
  };

  /* ===================================================================== message actions */
  const scopeBody = (ctx, extra) => {
    if(ctx === 'world') return { scope: 'world', ...extra };
    const t = C._thread; if(!t) throw new Error('Open a chat first');
    return t.type === 'dm' ? { scope: 'dm', peer: t.peer, ...extra } : { scope: 'group', gid: t.id, ...extra };
  };
  const refresh = (ctx) => ctx === 'world' ? (C._pullWorld && C._pullWorld()) : (C._pullThread && C._pullThread());
  C.toggleReaction = async function(ctx, mid, emoji){
    try{ await api.chat.post('/msg/react', scopeBody(ctx, { mid, emoji })); refresh(ctx); }catch(e){ toast(errMsg(e)); }
  };
  C._editMsg = async function(ctx, mid){
    const el = document.querySelector(`.msg-row[data-mid="${mid}"] .msg-text`), cur = el ? el.innerText : '';
    const text = prompt('Edit message (only once):', cur); if(text == null || !text.trim() || text.trim() === cur) return;
    try{ await api.chat.post('/msg/edit', scopeBody(ctx, { mid, text: text.trim() })); refresh(ctx); toast('Edited'); }catch(e){ toast(errMsg(e)); }
  };
  C._softDelete = async function(ctx, mid){
    if(!confirm('Delete this message?')) return;
    try{ await api.chat.post('/msg/delete', scopeBody(ctx, { mid })); refresh(ctx); }catch(e){ toast(errMsg(e)); }
  };
  C._adminPin = async function(ctx, mid, pin){
    try{ await api.chat.post('/admin/world/action', { id: mid, op: pin === false ? 'unpin' : 'pin' }); refresh('world'); toast(pin === false ? 'Unpinned' : 'Pinned'); }catch(e){ toast(errMsg(e)); }
  };
  C._adminHardDel = async function(ctx, mid){
    if(!confirm('Delete for everyone?')) return;
    try{ await api.chat.post('/admin/world/action', { id: mid, op: 'delete' }); refresh('world'); }catch(e){ toast(errMsg(e)); }
  };
  C.openForward = async function(ctx, mid){
    const el = document.querySelector(`.msg-row[data-mid="${mid}"] .msg-text`), text = el ? el.innerText : '';
    if(!text){ toast('Only text messages can be forwarded'); return; }
    let html = '<div style="padding:6px 0;font-weight:800;">Forward to...</div>';
    try{
      const list = await C._friendsList();
      if(!list.length){ window.openSheet(html + '<div style="padding:20px;text-align:center;color:var(--text-muted);">No friends</div>'); return; }
      window.openSheet(html + list.map(f => `<div class="cx-act" data-fw="${attr(f.uid)}"><div class="fi-avatar" style="width:34px;height:34px;">${avHtml(f)}</div>${esc(f.appName)}</div>`).join(''));
      sheet().querySelectorAll('[data-fw]').forEach(row => row.onclick = async () => {
        try{ await api.chat.post(`/dm/${encodeURIComponent(row.dataset.fw)}/send`, { text: '↪️ ' + text.slice(0, 280), forwarded: true }); toast('Forwarded'); window.closeSheet(); }catch(e){ toast(errMsg(e)); }
      });
    }catch(e){ toast(errMsg(e)); }
  };

  /* ===================================================================== thread menus */
  C.muteThread = async function(){
    const t = C._thread; if(!t) return;
    if(t.type !== 'dm'){ toast('Muting is only for direct chats'); return; }
    const on = !window.db.social.muted.includes(t.id);
    try{
      await api.chat.post('/chatpref', { peer: t.peer, op: on ? 'mute' : 'unmute' });
      const s = window.db.social; s.muted = on ? [...s.muted, t.id] : s.muted.filter(x => x !== t.id); applySocial(); dropFriends();
      toast(on ? 'Muted' : 'Unmuted');
    }catch(e){ toast(errMsg(e)); }
  };
  const pref = async (key, op, okMsg) => {
    const t = C._thread; if(!t) return;
    try{
      await api.chat.post('/chatpref', { peer: t.peer, op });
      const s = window.db.social, on = !op.startsWith('un'); s[key] = on ? [...new Set([...s[key], t.id])] : s[key].filter(x => x !== t.id); applySocial(); dropFriends();
      toast(okMsg); if(key === 'archived' && on) C.closeThread();
    }catch(e){ toast(errMsg(e)); }
  };
  C.threadMenu = async function(){
    const t = C._thread; if(!t) return;
    const close = () => window.closeSheet(), s = window.db.social;
    let acts;
    if(t.type === 'dm'){
      const muted = s.muted.includes(t.id), pinned = s.pinnedChats.includes(t.id), arch = s.archived.includes(t.id);
      acts = [
        { ic: 'user', lbl: 'View contact', fn: () => { close(); C.openContactProfile(); } },
        { ic: 'magnifying-glass', lbl: 'Search in chat', fn: () => { close(); C.searchThread(); } },
        { ic: 'images', lbl: 'Media, links & files', fn: () => { close(); C.openMediaFiles && C.openMediaFiles(); } },
        { ic: 'bell-slash', lbl: muted ? 'Unmute notifications' : 'Mute notifications', fn: () => { close(); C.muteThread(); } },
        { ic: 'thumbtack', lbl: pinned ? 'Unpin chat' : 'Pin chat', fn: () => { close(); pref('pinnedChats', pinned ? 'unpin' : 'pin', pinned ? 'Unpinned' : 'Pinned'); } },
        { ic: 'box-archive', lbl: arch ? 'Unarchive chat' : 'Archive chat', fn: () => { close(); pref('archived', arch ? 'unarchive' : 'archive', arch ? 'Unarchived' : 'Archived'); } },
        { ic: 'eraser', lbl: 'Clear chat (my view)', fn: () => { close(); C.clearThreadUI(); } },
        { ic: 'ban', lbl: 'Block user', cls: 'danger', fn: () => { close(); C.blockUser(t.peer); } },
        { ic: 'flag', lbl: 'Report user', cls: 'danger', fn: () => { close(); const r = prompt('Reason'); if(r) C.reportUser(t.peer, r); } },
      ];
    }else{
      let g; try{ g = (await api.chat.get('/groups/' + encodeURIComponent(t.id))).group; }catch(e){ toast(errMsg(e)); return; }
      const isOwner = g.role === 'owner', isAdm = isOwner || g.role === 'admin', base = '/groups/' + encodeURIComponent(t.id);
      acts = [
        { ic: 'users', lbl: 'Members', fn: () => { close(); C.openMembers(t.id); } },
        { ic: 'link', lbl: 'Copy invite link', fn: () => { close(); C.copyInviteLink(t.id); } },
        { ic: 'share-nodes', lbl: 'Share invite', fn: () => { close(); C.shareInviteLink(t.id, g.name); } },
        { ic: 'music', lbl: 'Add song to music box', fn: () => { close(); C.openAddSong(t.id); } },
        { ic: 'magnifying-glass', lbl: 'Search in chat', fn: () => { close(); C.searchThread(); } },
      ];
      if(isAdm){
        acts.push({ ic: 'sliders', lbl: g.public ? 'Make private' : 'Make public', cls: 'admin', fn: async () => { close(); try{ await api.chat.put(base, { public: !g.public }); toast('Updated'); }catch(e){ toast(errMsg(e)); } } });
        acts.push({ ic: 'pen', lbl: 'Rename group', cls: 'admin', fn: async () => { close(); const n = prompt('Group name', g.name); if(!n || n.trim() === g.name) return; try{ await api.chat.put(base, { name: n.trim() }); $('th-name').textContent = n.trim(); t.groupName = n.trim(); toast('Renamed'); }catch(e){ toast(errMsg(e)); } } });
      }
      if(!isOwner) acts.push({ ic: 'right-from-bracket', lbl: 'Leave group', cls: 'danger', fn: async () => { close(); if(!confirm('Leave group?')) return; try{ await api.chat.post(base + '/leave'); window.db.social.groups = window.db.social.groups.filter(x => x !== t.id); toast('Left'); C.closeThread(); }catch(e){ toast(errMsg(e)); } } });
      if(isOwner) acts.push({ ic: 'trash', lbl: 'Delete group', cls: 'danger', fn: async () => { close(); if(!confirm('Delete group forever?')) return; try{ await api.chat.del(base); toast('Deleted'); C.closeThread(); }catch(e){ toast(errMsg(e)); } } });
    }
    window.openSheet(acts.map((a, i) => `<div class="cx-act ${a.cls || ''}" data-i="${i}"><i class="fa-solid fa-${a.ic}"></i>${a.lbl}</div>`).join(''));
    sheet().querySelectorAll('.cx-act').forEach(el => el.onclick = () => acts[+el.dataset.i].fn());
  };

  console.log('[chat-backend] loaded');
})();
