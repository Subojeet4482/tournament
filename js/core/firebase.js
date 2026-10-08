/**
 * COMPAT LAYER (no Firebase SDK). Old modules still import these names from here.
 *  - Auth calls are mapped to the backend (api.js).
 *  - Direct Firestore/Storage access no longer exists: reads return empty snapshots, writes throw "not available".
 * Ported modules import { api } from './api.js' directly; only un-ported chat extras (friends, DMs, discover) still touch this.
 */
import { api } from './api.js';

const NA = () => { const e = new Error('This feature is not available yet'); e.code = 'not_available'; throw e; };
const emptySnap = { empty: true, docs: [], size: 0, forEach() {}, exists: () => false, data: () => undefined, metadata: { fromCache: false } };

export const appInstance = {};
export const authService = { get currentUser() { return api.currentUser(); } };
export const dbService = {}; export const storageService = {};

// ---- auth -> backend ----
export const signInWithEmailAndPassword = async (a, email, pass) => { await api.login(email, pass); return { user: api.currentUser() }; };
export const signOut = async () => api.logout();
export const sendPasswordResetEmail = async (a, email) => { await api.forgot(email); };
export const onAuthStateChanged = (a, cb) => { const h = (e) => cb(e.detail); window.addEventListener('ff-auth', h); Promise.resolve().then(() => cb(api.currentUser())); return () => window.removeEventListener('ff-auth', h); };
export const verifyPasswordResetCode = async (a, code) => api.resetCheck(code);
export const confirmPasswordReset = async (a, code, pw) => api.resetConfirm(code, pw);
export const updateProfile = async () => {};
export const getAuth = () => authService;
export const GoogleAuthProvider = class { setCustomParameters() {} };
export const signInWithPopup = async () => { throw Object.assign(new Error('Google login is not available. Please use email & password.'), { code: 'not_available' }); };
export const signInWithRedirect = signInWithPopup;
export const getRedirectResult = async () => null;
export const createUserWithEmailAndPassword = async () => NA();
export const sendEmailVerification = async () => NA();
export const deleteUser = async () => NA();
export const EmailAuthProvider = { credential: () => ({}) };
export const reauthenticateWithCredential = async () => NA();

// ---- firestore / storage (removed) ----
export const getFirestore = () => dbService; export const getStorage = () => storageService;
export const collection = (...a) => ({ path: a.slice(1).join('/') }); export const collectionGroup = collection;
export const doc = (...a) => ({ path: a.slice(1).join('/'), id: String(a[a.length - 1] || '') });
export const query = (c) => c; export const where = () => ({}); export const orderBy = () => ({}); export const limit = () => ({});
export const serverTimestamp = () => Date.now(); export const increment = (n) => n; export const arrayUnion = (...a) => a; export const arrayRemove = (...a) => a;
export const getDocs = async () => emptySnap; export const getDoc = async () => emptySnap;
export const onSnapshot = (q, cb) => { setTimeout(() => { try { typeof cb === 'function' && cb(emptySnap); } catch (e) {} }, 0); return () => {}; };
export const setDoc = async () => NA(); export const updateDoc = async () => NA(); export const addDoc = async () => NA(); export const deleteDoc = async () => NA();
export const runTransaction = async () => NA(); export const writeBatch = () => ({ set() {}, update() {}, delete() {}, commit: async () => NA() });
export const sRef = () => ({}); export const uploadBytes = async () => NA(); export const getDownloadURL = async () => NA(); export const deleteObject = async () => NA();
