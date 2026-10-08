# Backend connection (no Firebase SDK in the panel)
- Backend URL + Firebase web key + Google client id: `js/config.js`
- All requests go through `js/core/api.js` (token refresh, error handling).
- `js/core/firebase.js` is only a thin compatibility layer so old modules still load.
- Chat (friends, requests, DMs, groups, music box, reactions, edit/delete, forward, report, block, discover, search,
  profile, photos, online status) runs on the backend through `pages/chat/backend.js` (loaded last in `js/modules.js`).
- Online status: `js/core/presence.js` sends a heartbeat every 25 s (kept in server memory, no database writes).
- Transfer by Player ID: `components/transfer/transfer.js` -> `/wallet/recipient`, `/wallet/transfer` (server checks password + moves money).

## Setup checklist
1. Redeploy the backend zip (`chat-render-final-v7.zip`).
2. Render env `ALLOWED_ORIGINS` = this panel's domain (e.g. https://your-panel.netlify.app).
3. Google Cloud > Credentials > the Firebase **Browser key** > HTTP referrers: allow the same domain.
4. Google login:
   - Firebase console > Authentication > Sign-in method > enable **Google**.
   - Copy its **Web client ID** into `GOOGLE_CLIENT_ID` in `js/config.js`.
   - Google Cloud > Credentials > that OAuth client > **Authorized JavaScript origins**: add the panel domain.
   Leave `GOOGLE_CLIENT_ID` empty to hide the feature (the button then says it is not set up).
5. Optional admin settings (config doc): `transferEnabled` (false = pause), `transferMin` (default 10), `transferMax` (default 5000).

## Notes
- Photos in chats / avatars are stored as small compressed images inside Firestore (no Storage bucket needed).
  Videos, audio files, documents and voice notes are not supported yet (the app says so).
- Match join is still one slot per join (that is how the original join screen works).
