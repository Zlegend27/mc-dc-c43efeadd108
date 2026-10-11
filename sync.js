// Team sync (Firestore). Sets window.districtSync and fires "districtsync-ready".
// If Firebase can't load, a do-nothing stub is installed and every phone simply works on its own.
//
// What lives where (all paths are covered by the rules in firebase-sync/SETUP.md):
//   days/{YYYY-MM-DD}   todaySales, salesAt, salesMeta, tasks, texts     (one doc per day)
//   roster/current      stores[] with staff                              (edited via transactions)
//   roster/history      last 10 versions of the roster (for "restore")
//   roster/settings     ly, aov, hours, tz, ignored                      (shared; NOT templates)
// Message templates, minimums and the low-sales threshold deliberately stay on each phone.

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBv4dA3zhY9YogpFi1RYKeopUb10sL8LAc",
  authDomain: "district-texter.firebaseapp.com",
  projectId: "district-texter",
  storageBucket: "district-texter.firebasestorage.app",
  messagingSenderId: "736288733886",
  appId: "1:736288733886:web:dc630d72503f722d283cef"
};

// Opt-in real sign-in. While enabled:false everyone signs in anonymously exactly as before.
// To turn it on, follow "Stronger protection" in firebase-sync/SETUP.md first.
const TEAM_AUTH = { enabled: true, email: 'team@districttexter.example' };

const SDK = 'https://www.gstatic.com/firebasejs/10.13.0/';
const PENDING_KEY = 'districtTexter.pendingRosterOps.v1';
const PASS_KEY = 'districtTexter.teamPass.v1';
const BAD_CREDENTIAL = ['auth/wrong-password', 'auth/invalid-credential', 'auth/invalid-login-credentials', 'auth/user-not-found', 'auth/invalid-email'];
// Developer-only: set localStorage 'districtTexter.ns' to e.g. "t1-" to point the whole app at
// throwaway documents (days/t1-2026-01-01, roster/t1-current, …) instead of the real ones.
let NS = '';
try { NS = localStorage.getItem('districtTexter.ns') || ''; } catch (e) { NS = ''; }

function lsGet(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode / full */ } }

function makeStub(reason) {
  const noop = () => () => {};
  return {
    configured: false, status: 'local', reason: reason || '', ns: NS, needsPasscode: false,
    onStatus(cb) { cb('local'); return () => {}; },
    onDay: noop, onRoster: noop, onSettings: noop,
    setSalesBatch() {}, setTask() {}, logText() {}, patchSettings() {},
    rosterOp() { return Promise.resolve({ queued: false }); },
    getRosterHistory() { return Promise.resolve([]); },
    pendingCount() { return 0; }, retry() { return Promise.resolve(); },
    reconnect() { return Promise.resolve(false); }, signInWithPasscode() { return Promise.resolve(false); }
  };
}

if (!FIREBASE_CONFIG.projectId) {
  window.districtSync = makeStub('not configured');
  window.dispatchEvent(new Event('districtsync-ready'));
} else {
  try {
    const { initializeApp } = await import(SDK + 'firebase-app.js');
    const auth = await import(SDK + 'firebase-auth.js');
    const fsm = await import(SDK + 'firebase-firestore.js');
    const { doc, onSnapshot, setDoc, getDoc, runTransaction } = fsm;

    const app = initializeApp(FIREBASE_CONFIG);
    const authInst = auth.getAuth(app);
    let db;
    try {
      // Keeps unsent edits on the phone across app restarts, and shows cached data instantly.
      db = fsm.initializeFirestore(app, { localCache: fsm.persistentLocalCache({ tabManager: fsm.persistentMultipleTabManager() }) });
    } catch (e) { db = fsm.getFirestore(app); }

    // ---- truthful connection status ----
    let online = navigator.onLine !== false, serverSeen = false, inflight = 0, hadError = false, cachePending = false;
    const subs = new Set();
    const api = { configured: true, status: 'connecting', ns: NS, needsPasscode: false, authed: false };
    const pendingOps = () => lsGet(PENDING_KEY, []);
    function compute() {
      if (api.needsPasscode) return 'needs-passcode';
      if (!online) return 'offline';
      if (hadError) return 'error';
      if (!serverSeen) return 'connecting';
      if (inflight > 0 || cachePending || pendingOps().length) return 'saving';
      return 'live';
    }
    function emit() {
      const s = compute();
      if (s !== api.status) { api.status = s; subs.forEach(cb => { try { cb(s); } catch (e) { /* ignore */ } }); }
    }
    api.onStatus = (cb) => { subs.add(cb); cb(api.status); return () => subs.delete(cb); };
    async function tracked(fn) {
      inflight++; emit();
      try { const r = await fn(); hadError = false; return r; }
      catch (e) { hadError = true; console.error('districtSync write failed', e); throw e; }
      finally { inflight--; emit(); }
    }
    window.addEventListener('online', () => { online = true; emit(); flushPending(); });
    window.addEventListener('offline', () => { online = false; emit(); });

    // ---- sign-in (anonymous by default; shared passcode when TEAM_AUTH.enabled) ----
    async function authenticate() {
      await new Promise(r => { const un = auth.onAuthStateChanged(authInst, () => { un(); r(); }); });
      if (authInst.currentUser && (!TEAM_AUTH.enabled || !authInst.currentUser.isAnonymous)) { api.authed = true; return true; }
      if (TEAM_AUTH.enabled) {
        const pass = lsGet(PASS_KEY, '');
        if (!pass) { api.needsPasscode = true; emit(); return false; }
        try { await auth.signInWithEmailAndPassword(authInst, TEAM_AUTH.email, pass); }
        catch (e) {
          // The saved passcode no longer works (it was changed): ask again instead of failing silently forever.
          if (BAD_CREDENTIAL.indexOf(e && e.code) >= 0) {
            try { localStorage.removeItem(PASS_KEY); } catch (x) { /* ignore */ }
            api.needsPasscode = true; emit(); return false;
          }
          throw e;
        }
      } else {
        await auth.signInAnonymously(authInst);
      }
      api.authed = true; api.needsPasscode = false; return true;
    }
    let ready = authenticate().catch(err => { hadError = true; console.error('districtSync sign-in failed', err); return false; });
    api.reconnect = async () => { hadError = false; ready = authenticate().catch(err => { hadError = true; return false; }); const ok = await ready; emit(); return ok; };
    api.signInWithPasscode = async (pass) => {
      lsSet(PASS_KEY, pass);
      api.lastAuthError = '';
      try { await auth.signInWithEmailAndPassword(authInst, TEAM_AUTH.email, pass); api.authed = true; api.needsPasscode = false; hadError = false; emit(); return true; }
      catch (e) {
        api.lastAuthError = (e && e.code) || 'unknown';
        try { localStorage.removeItem(PASS_KEY); } catch (x) { /* ignore */ }
        api.needsPasscode = true; emit(); return false;
      }
    };

    const ref = (col, id) => doc(db, col, NS + id);
    function listen(r, cb, onErr) {
      return onSnapshot(r, { includeMetadataChanges: true }, snap => {
        if (!snap.metadata.fromCache) serverSeen = true;
        cachePending = snap.metadata.hasPendingWrites;
        hadError = false; emit();
        cb(snap.exists() ? snap.data() : null, snap.metadata);
      }, err => { hadError = true; console.error('districtSync listen failed', err); emit(); if (onErr) onErr(err); });
    }

    // ---- today's document ----
    api.onDay = (dateKey, cb, onErr) => listen(ref('days', dateKey), cb, onErr);
    // values: { mall: number|null }, atMap: { mall: ms } — the newer stamp wins when phones disagree.
    api.setSalesBatch = async (dateKey, values, atMap, by) => {
      await ready;
      const latest = Object.keys(atMap).reduce((m, k) => Math.max(m, atMap[k] || 0), 0) || Date.now();
      await tracked(() => setDoc(ref('days', dateKey), { todaySales: values, salesAt: atMap, salesMeta: { at: latest, by: by || '' } }, { merge: true }));
    };
    // Nested plain objects, not dotted keys: setDoc(..., {merge:true}) deep-merges objects, but
    // treats a dotted string as one literal field name.
    api.setTask = async (dateKey, taskKey, done, by) => {
      await ready;
      await tracked(() => setDoc(ref('days', dateKey), { tasks: { [taskKey]: { done, by, at: Date.now() } } }, { merge: true }));
    };
    api.logText = async (dateKey, personKey, kind, by) => {
      await ready;
      await tracked(() => setDoc(ref('days', dateKey), { texts: { [personKey]: { [kind]: { by: by || '', at: Date.now() } } } }, { merge: true }));
    };

    // ---- roster (transactions so a stale phone can never overwrite fresher edits) ----
    api.onRoster = (cb, onErr) => listen(ref('roster', 'current'), (d, m) => cb(d ? (d.stores || []) : [], m), onErr);
    async function runRosterOp(op, by) {
      await ready;
      const DT = window.DT;
      await tracked(() => runTransaction(db, async tx => {
        const curRef = ref('roster', 'current'), histRef = ref('roster', 'history');
        const cur = await tx.get(curRef), hist = await tx.get(histRef);
        const before = cur.exists() ? (cur.data().stores || []) : [];
        const after = DT.applyRosterOp(before, op);
        if (JSON.stringify(after) === JSON.stringify(before)) return;
        const versions = hist.exists() ? (hist.data().versions || []) : [];
        versions.unshift({ at: Date.now(), by: by || '', count: before.length, people: DT.countPeople(before), stores: before });
        tx.set(histRef, { versions: versions.slice(0, 10) });
        tx.set(curRef, { stores: after, updatedAt: Date.now(), updatedBy: by || '' });
      }));
    }
    async function flushPending() {
      if (!online || !api.authed) return;
      let q = pendingOps();
      while (q.length) {
        try { await runRosterOp(q[0].op, q[0].by); q.shift(); lsSet(PENDING_KEY, q); }
        catch (e) { break; }
      }
      emit();
    }
    api.rosterOp = async (op, by) => {
      const q = pendingOps();
      if (!online || q.length || !api.authed) { q.push({ op, by }); lsSet(PENDING_KEY, q); emit(); flushPending(); return { queued: true }; }
      try { await runRosterOp(op, by); return { queued: false }; }
      catch (e) { q.push({ op, by }); lsSet(PENDING_KEY, q); emit(); return { queued: true, error: true }; }
    };
    api.pendingCount = () => pendingOps().length;
    api.retry = async () => { hadError = false; if (!api.authed) await api.reconnect(); await flushPending(); emit(); };
    api.getRosterHistory = async () => {
      await ready;
      const s = await getDoc(ref('roster', 'history'));
      return s.exists() ? (s.data().versions || []) : [];
    };

    // ---- shared settings (LY, AOV, hours, time zones, hidden stores) ----
    api.onSettings = (cb, onErr) => listen(ref('roster', 'settings'), (d, m) => cb(d || {}, m), onErr);
    api.patchSettings = async (patch) => {
      await ready;
      await tracked(() => setDoc(ref('roster', 'settings'), patch, { merge: true }));
    };

    window.districtSync = api;
    await ready;
    emit();
    window.dispatchEvent(new Event('districtsync-ready'));
    flushPending();
  } catch (err) {
    console.error('districtSync failed to initialize, falling back to local-only', err);
    window.districtSync = makeStub('could not load');
    window.dispatchEvent(new Event('districtsync-ready'));
  }
}
