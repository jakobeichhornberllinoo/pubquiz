// Datenbank für den Online-Betrieb: Firebase Realtime Database (Spark-Tarif reicht) mit anonymer Anmeldung.
// Für die Tests gibt es einen Nachbau („dev“), der dieselbe Schnittstelle über den Test-Server anbietet.
// Alle Pfade sind relativ zum Wurzelordner des Quiz in der Datenbank (Standard: „pubquiz“).
(function () {
  const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
  const TS = { '.sv': 'timestamp' }; // Zeitstempel des Servers

  async function firebase(cfg, root) {
    const [app, auth, db] = await Promise.all([import(SDK + 'firebase-app.js'), import(SDK + 'firebase-auth.js'), import(SDK + 'firebase-database.js')]);
    const fa = app.getApps().length ? app.getApp() : app.initializeApp(cfg);
    const A = auth.getAuth(fa);
    const user = A.currentUser || (await new Promise((res, rej) => {
      const off = auth.onAuthStateChanged(A, (u) => { if (u) { off(); res(u); } });
      auth.signInAnonymously(A).catch(rej);
    }));
    const D = db.getDatabase(fa);
    const r = (p) => db.ref(D, root + (p ? '/' + p : ''));
    let offset = 0;
    db.onValue(db.ref(D, '.info/serverTimeOffset'), (s) => { offset = s.val() || 0; });
    let online = true;
    db.onValue(db.ref(D, '.info/connected'), (s) => { online = !!s.val(); });
    return {
      uid: user.uid,
      TS: db.serverTimestamp(),
      now: () => Date.now() + offset,
      connected: () => online,
      get: async (p) => (await db.get(r(p))).val(),
      set: (p, v) => db.set(r(p), v),
      update: (p, v) => db.update(r(p), v),
      remove: (p) => db.remove(r(p)),
      push: async (p, v) => (await db.push(r(p), v)).key,
      on: (p, cb, err) => db.onValue(r(p), (s) => cb(s.val()), err),
      onAdd: (p, cb) => db.onChildAdded(r(p), (s) => cb(s.key, s.val())),
      tx: async (p, fn) => { const t = await db.runTransaction(r(p), fn, { applyLocally: false }); return { committed: t.committed, value: t.snapshot.val() }; },
      onDisconnectRemove: (p) => db.onDisconnect(r(p)).remove(),
    };
  }

  // Nachbau für Tests: spricht per HTTP und Server-Sent Events mit tests/pages-server.js
  async function dev(root) {
    let uid = '';
    try { uid = localStorage.getItem('dev_uid') || ''; } catch (e) { /* */ }
    if (!uid) { uid = 'u' + Math.random().toString(36).slice(2, 12); try { localStorage.setItem('dev_uid', uid); } catch (e) { /* */ } }
    const full = (p) => root + (p ? '/' + p : '');
    const call = async (op, body) => {
      const r = await fetch('/__db/' + op, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-uid': uid }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw Object.assign(new Error(j.error || 'PERMISSION_DENIED'), { code: j.code || 'PERMISSION_DENIED' });
      return j;
    };
    // eine Live-Verbindung je Seite, alle Abos laufen darüber (wie bei Firebase selbst)
    const cid = Math.random().toString(36).slice(2, 10);
    const handlers = {};
    const es = new EventSource(`/__db/stream?cid=${cid}&uid=${uid}`);
    es.onmessage = (ev) => { const d = JSON.parse(ev.data); const h = handlers[d.sid]; if (h) h(d); };
    await new Promise((r) => { es.onopen = r; });
    let sids = 0;
    const sub = (path, mode, cb, err) => {
      const sid = String(++sids);
      handlers[sid] = (d) => { if (d.error) { delete handlers[sid]; if (err) err(new Error(d.error)); return; } cb(d); };
      call('watch', { cid, sid, path: full(path), mode });
      return () => { delete handlers[sid]; call('unwatch', { cid, sid }).catch(() => {}); };
    };
    const t0 = await (await fetch('/__db/time')).json();
    const offset = t0.now - Date.now();
    return {
      uid, TS,
      now: () => Date.now() + offset,
      connected: () => true,
      get: async (p) => (await call('get', { path: full(p) })).value,
      set: (p, v) => call('set', { path: full(p), value: v }),
      update: (p, v) => call('update', { path: full(p), value: v }),
      remove: (p) => call('set', { path: full(p), value: null }),
      push: async (p, v) => (await call('push', { path: full(p), value: v })).key,
      on: (p, cb, err) => sub(p, 'value', (d) => cb(d.value), err),
      onAdd: (p, cb) => sub(p, 'child', (d) => cb(d.key, d.value)),
      tx: async (p, fn) => {
        for (let i = 0; i < 20; i++) {
          const cur = await call('txget', { path: full(p) });
          const next = fn(cur.value);
          if (next === undefined) return { committed: false, value: cur.value };
          const r = await call('txset', { path: full(p), value: next, ver: cur.ver });
          if (r.ok) return { committed: true, value: next };
        }
        throw new Error('Transaktion fehlgeschlagen');
      },
      onDisconnectRemove: (p) => call('ondisc', { path: full(p) }),
    };
  }

  let ready = null;
  window.DB = {
    // einmal je Seite verbinden
    init() {
      const cfg = window.QUIZ_CONFIG || {};
      const root = cfg.root || 'pubquiz';
      ready = ready || (cfg.dev ? dev(root) : firebase(cfg.firebase, root));
      return ready;
    },
  };
})();
