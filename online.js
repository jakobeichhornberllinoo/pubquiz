// Online-Betrieb über Firebase – ohne eigenen Server.
// Aufbau in der Datenbank (Wurzel „pubquiz“):
//   rooms/CODE/meta            öffentlich: gibt es das Spiel?
//   rooms/CODE/keys/SCHLÜSSEL  nicht lesbar; wer den Schlüssel kennt, darf sich unter hosts/ eintragen
//   rooms/CODE/hosts/UID       Geräte von Moderation und Beamer
//   rooms/CODE/priv/{state,quiz}  Spielstand und Quiz mit Lösungen – nur für hosts
//   rooms/CODE/pub             was die Handys sehen (ohne Lösungen)
//   rooms/CODE/lead            welches Moderations-/Beamer-Fenster gerade rechnet
//   rooms/CODE/cmd, res        Befehle der Moderation und Antworten
//   rooms/CODE/in, out/UID     Anfragen der Handys (Anmelden, Buzzern) und Antworten
//   sets/ID, setsIndex/ID      Quiz-Sets (nur mit Admin-PIN, siehe editors/)
// Gerechnet wird in genau einem Fenster (lead). Fällt es aus, übernimmt nach 15 s ein anderes – der Spielstand liegt ja in der Datenbank.
(function () {
  const J = (s) => { try { return s ? JSON.parse(s) : null; } catch (e) { return null; } };
  const S = (o) => JSON.stringify(o == null ? {} : o);
  const R = (code, p) => `rooms/${code}${p ? '/' + p : ''}`;
  const rnd = () => Math.random().toString(36).slice(2, 10);
  const TAB = rnd(); // dieses Fenster
  const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // ohne 0/O und 1/I
  const page = (file, params) => new URL(file + (params ? '?' + new URLSearchParams(params) : ''), location.href).href;
  const err = (msg, extra) => Object.assign(new Error(msg), extra || {});
  const LEAD_MS = 15000;

  // Antwort auf eine Anfrage abwarten (Befehl der Moderation oder Anfrage eines Handys)
  function waitFor(db, path, match, ms, text) {
    return new Promise((resolve, reject) => {
      let off = null;
      const t = setTimeout(() => { if (off) off(); reject(err(text)); }, ms);
      off = db.on(path, (v) => { if (!v || !match(v)) return; clearTimeout(t); setTimeout(() => off && off(), 0); v.error ? reject(err(v.error)) : resolve(v); });
    });
  }

  // ---------- Moderation und Beamer ----------
  const hosts = {};
  function host(code, key, opts) {
    const id = code + (opts && opts.passive ? ':p' : '');
    hosts[id] = hosts[id] || startHost(code, key, opts || {});
    return hosts[id];
  }
  async function startHost(code, key, opts) {
    const db = await window.DB.init();
    const meta = await db.get(R(code, 'meta'));
    if (!meta) throw err('Spiel nicht gefunden – bitte den Link mit Raum-Code prüfen.', { noRoom: true, status: 404 });
    if (key) { try { await db.set(R(code, 'hosts/' + db.uid), key); } catch (e) { throw err('Schlüssel falsch', { status: 403 }); } }
    try { await db.get(R(code, 'priv/state')); } catch (e) { throw err('Schlüssel falsch', { status: 403 }); }

    const G = { state: null, quiz: null, flow: null, now: db.now, qv: 0, setId: null };
    const listeners = new Set();
    let leader = false;
    const payload = () => {
      const s = Object.assign({}, G.state); delete s.tokens;
      return { now: db.now(), joinUrl: page('team.html', { room: code }), state: s, quiz: G.quiz, flow: G.flow, online: true, room: code, key, ips: [], setId: G.setId, leader };
    };
    const emit = () => { if (G.state && G.quiz) listeners.forEach((fn) => fn(payload())); };
    // eingehender Stand: nur neuere Versionen übernehmen (das rechnende Fenster ist sich selbst voraus)
    db.on(R(code, 'priv/quiz'), (v) => {
      const d = J(v); if (!d || d.qv < G.qv) return;
      G.qv = d.qv; G.quiz = d.quiz; G.flow = window.Flow.buildFlow(d.quiz); G.setId = d.setId || null; emit();
    });
    db.on(R(code, 'priv/state'), (v) => {
      const s = J(v); if (!s || (G.state && (s._v || 0) < (G.state._v || 0))) return;
      G.state = window.Engine.loadState(s); emit();
    });

    // ---- rechnen (nur im führenden Fenster) ----
    let queue = Promise.resolve();
    const serial = (fn) => { queue = queue.then(fn).catch((e) => console.error(e)); return queue; };
    async function writeOut(extra, quizChanged) {
      G.state._v = (G.state._v || 0) + 1;
      const u = Object.assign({ 'priv/state': S(G.state), pub: S({ pub: window.Engine.publicState(G), joinUrl: page('team.html', { room: code }) }) }, extra);
      if (quizChanged) { G.qv++; u['priv/quiz'] = S({ qv: G.qv, quiz: G.quiz, setId: G.setId }); G.flow = window.Flow.buildFlow(G.quiz); }
      await db.update(R(code), u);
      emit();
    }
    async function runCmd(id, c) {
      if (!c) return;
      const b = J(c.b) || {};
      let out = {}; let error = null; let quizChanged = false;
      try {
        if (!window.Engine.host[c.a]) throw err('Unbekannte Aktion: ' + c.a);
        const q0 = G.quiz;
        out = window.Engine.host[c.a](G, b) || {};
        if (c.a === 'useQuiz' && b.setId) G.setId = b.setId;
        quizChanged = G.quiz !== q0;
      } catch (e) { error = e.message; }
      await writeOut({ ['cmd/' + id]: null, ['res/' + id]: error ? { error } : { ok: true, out: S(out) } }, quizChanged);
    }
    async function runIn(id, m) {
      if (!m) return;
      const b = J(m.b) || {}; b.at = m.at;
      let r = {}; let error = null; let changed = true;
      try {
        if (m.type === 'join') r = window.Engine.team.join(G, b);
        else if (m.type === 'whoami') { const t = window.Engine.teamOf(G, b.token); r = { teamId: t ? t.id : null }; changed = false; }
        else {
          const t = window.Engine.teamOf(G, b.token);
          if (!t) throw err('Nicht (mehr) angemeldet');
          if (!window.Engine.team[m.type]) throw err('unbekannt');
          r = Object.assign({ ok: true, teamId: t.id }, window.Engine.team[m.type](G, b, t, b.token) || {});
        }
      } catch (e) { error = e.message; changed = false; }
      const extra = { ['in/' + id]: null, ['out/' + m.uid]: error ? { rid: m.rid, error } : { rid: m.rid, r: S(r) } };
      if (changed) await writeOut(extra); else await db.update(R(code), extra);
    }
    let caughtUp = false;
    async function catchUp() { // beim Übernehmen: liegengebliebene Befehle und Anfragen abarbeiten
      const [cmds, ins] = await Promise.all([db.get(R(code, 'cmd')), db.get(R(code, 'in'))]);
      Object.entries(cmds || {}).forEach(([k, v]) => serial(() => runCmd(k, v)));
      Object.entries(ins || {}).sort((a, b) => (a[1].at || 0) - (b[1].at || 0)).forEach(([k, v]) => serial(() => runIn(k, v)));
      caughtUp = true;
    }
    if (!opts.passive) {
      db.onAdd(R(code, 'cmd'), (k, v) => { if (leader && caughtUp) serial(() => runCmd(k, v)); });
      db.onAdd(R(code, 'in'), (k, v) => { if (leader && caughtUp) serial(() => runIn(k, v)); });
      const claim = async () => {
        if (!G.state || !G.quiz) return; // erst rechnen, wenn der Stand geladen ist
        try {
          const now = db.now();
          const r = await db.tx(R(code, 'lead'), (cur) => (!cur || cur.tab === TAB || now - (cur.ts || 0) > LEAD_MS ? { tab: TAB, uid: db.uid, ts: now } : undefined));
          const was = leader; leader = r.committed;
          if (leader && !was) { caughtUp = false; await serial(() => {}); catchUp(); }
        } catch (e) { leader = false; }
      };
      setTimeout(claim, 300); setInterval(claim, 5000);
      // beim Schließen sofort freigeben, damit ein anderes Fenster ohne Wartezeit übernimmt
      window.addEventListener('pagehide', () => { if (leader) db.set(R(code, 'lead'), null); });
    }

    return {
      db, G,
      connect(fn) { listeners.add(fn); emit(); },
      isLeader: () => leader,
      async act(a, b) {
        const id = await db.push(R(code, 'cmd'), { a, b: S(b), uid: db.uid, at: db.TS });
        const v = await waitFor(db, R(code, 'res/' + id), () => true, 10000, 'Keine Antwort – ist der Beamer oder die Moderation online?');
        db.remove(R(code, 'res/' + id));
        return J(v.out) || {};
      },
    };
  }

  // ---------- Handys ----------
  const teams = {};
  function team(code) { teams[code] = teams[code] || startTeam(code); return teams[code]; }
  async function startTeam(code) {
    const db = await window.DB.init();
    return {
      connect(onData, onState) {
        // nur vollständige Stände anzeigen (das SDK zeigt abgelehnte Schreibversuche kurz lokal an)
        db.on(R(code, 'pub'), (v) => { const d = J(v); if (d && d.pub && d.pub.slide) { onState && onState(true); onData({ now: db.now(), pub: d.pub, joinUrl: d.joinUrl, online: true, room: code }); } }, () => onState && onState(false));
      },
      async call(type, b) {
        const rid = rnd();
        const answer = waitFor(db, R(code, 'out/' + db.uid), (v) => v.rid === rid, type === 'whoami' ? 5000 : 12000, 'Keine Antwort vom Quiz – ist der Beamer gerade offen?');
        await db.push(R(code, 'in'), { uid: db.uid, type, b: S(b), at: db.TS, rid });
        return J((await answer).r) || {};
      },
    };
  }
  async function roomExists(code) { const db = await window.DB.init(); return !!(await db.get(R(String(code).toUpperCase(), 'meta'))); }

  // ---------- Quiz-Sets (nur mit Admin-PIN) ----------
  async function editor() {
    const db = await window.DB.init();
    return !!(await db.get('editors/' + db.uid).catch(() => null));
  }
  async function login(pin) {
    const db = await window.DB.init();
    try { await db.set('editors/' + db.uid, String(pin)); } catch (e) { throw err('Admin-PIN falsch.', { status: 403 }); }
  }
  async function loadSet(id) { const db = await window.DB.init(); const q = J(await db.get('sets/' + id)); if (!q) throw err('Set nicht gefunden'); return window.QuizModel.normalize(q); }
  async function saveSet(id, quiz) {
    const db = await window.DB.init();
    const old = await db.get('sets/' + id);
    const u = {};
    if (old) u['setsPrev/' + id] = old; // letzte Version als Sicherung
    u['sets/' + id] = S(quiz);
    u['setsIndex/' + id] = { title: quiz.meta.name, questions: quiz.questions.length, rounds: quiz.rounds.length, cards: quiz.buzzer.reduce((n, c) => n + c.cards.length, 0), updated: db.TS };
    await db.update('', u);
  }
  async function listSets() {
    const db = await window.DB.init();
    const ix = (await db.get('setsIndex')) || {};
    return Object.entries(ix).map(([id, s]) => Object.assign({ id }, s)).sort((a, b) => (b.updated || 0) - (a.updated || 0));
  }
  async function newSetId(title) {
    const ix = (await (await window.DB.init()).get('setsIndex')) || {};
    const base = `${new Date().toISOString().slice(0, 7)}-${window.QuizModel.slug(title) || 'quiz'}`;
    let id = base; let n = 2; while (ix[id]) id = `${base}-${n++}`;
    return id;
  }
  async function createSet(title, quiz) {
    const q = window.QuizModel.normalize(quiz).quiz;
    q.meta.name = String(title || q.meta.name || 'Neues Quiz').trim().slice(0, 80);
    const id = await newSetId(q.meta.name);
    await saveSet(id, q);
    return id;
  }
  // Die Aktionen des Editors – dieselben Namen wie beim lokalen Server
  function setActions(session) {
    const QM = window.QuizModel;
    const active = () => session && session.G.setId;
    return {
      async sets() { return { sets: await listSets(), active: active() }; },
      async setGet(b) { if (session && b.id === active() && session.G.quiz) return { quiz: session.G.quiz, warnings: QM.normalize(session.G.quiz).warnings }; return loadSet(b.id); },
      async saveQuiz(b) {
        const id = b.id || active(); const r = QM.normalize(b.quiz);
        await saveSet(id, r.quiz);
        if (session && id === active()) await session.act('useQuiz', { quiz: r.quiz, reset: false });
        return { warnings: r.warnings, quiz: r.quiz };
      },
      async setActivate(b) { const q = (await loadSet(b.id)).quiz; await session.act('useQuiz', { quiz: q, reset: true, setId: b.id }); return {}; },
      async setCreate(b) {
        const from = b.from || 'blank';
        const base = from === 'blank' ? QM.blank() : from === 'example' ? QM.example() : (await loadSet(from)).quiz;
        return { id: await createSet(b.title || 'Neues Quiz', base) };
      },
      async setRename(b) { const q = (await loadSet(b.id)).quiz; q.meta.name = String(b.title || '').trim().slice(0, 80) || q.meta.name; await saveSet(b.id, q); return {}; },
      async setDelete(b) {
        if (b.id === active()) throw err('Das laufende Quiz kann nicht gelöscht werden. Erst ein anderes aktivieren.');
        const db = await window.DB.init();
        await db.update('', { ['setsTrash/' + b.id]: await db.get('sets/' + b.id), ['sets/' + b.id]: null, ['setsIndex/' + b.id]: null });
        return {};
      },
      async setImport(b) {
        let r;
        if (b.format === 'csv') r = QM.fromCsv(b.text);
        else { let j; try { j = JSON.parse(b.text); } catch (e) { throw err('Die Datei ist kein gültiges JSON.'); } r = QM.normalize(j); }
        return { id: await createSet(b.title || r.quiz.meta.name, r.quiz), warnings: r.warnings };
      },
      // Bilder liegen online direkt im Quiz (als Daten-URL, vom Editor verkleinert)
      async upload(b) { if (String(b.data || '').length > 1.5e6) throw err('Bild zu groß – bitte kleiner speichern.'); return { url: b.data }; },
      async pptxParse() { throw err('PowerPoint-Import geht nur im lokalen Betrieb (node server.js). Dort importieren, als JSON exportieren und hier über „Import“ hochladen.'); },
    };
  }

  // ---------- Spiele anlegen und verwalten (Admin) ----------
  async function createRoom(setId) {
    const db = await window.DB.init();
    const quiz = (await loadSet(setId)).quiz;
    let code;
    do { code = Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join(''); } while (await db.get(R(code, 'meta')));
    const b = new Uint8Array(12); crypto.getRandomValues(b);
    const key = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
    const G = { state: window.Engine.freshState(), quiz, flow: window.Flow.buildFlow(quiz), now: db.now };
    G.state._v = 1;
    await db.set(R(code), {
      meta: { created: db.TS, title: quiz.meta.name },
      keys: { [key]: true },
      hosts: { [db.uid]: key },
      priv: { state: S(G.state), quiz: S({ qv: 1, quiz, setId }) },
      pub: S({ pub: window.Engine.publicState(G), joinUrl: page('team.html', { room: code }) }),
    });
    await db.set('roomsIndex/' + code, { title: quiz.meta.name, setId, key, created: db.TS });
    return { code, key };
  }
  async function listRooms() {
    const db = await window.DB.init();
    const ix = (await db.get('roomsIndex')) || {};
    return Object.entries(ix).map(([code, r]) => Object.assign({ code }, r)).sort((a, b) => (b.created || 0) - (a.created || 0));
  }
  async function closeRoom(code) { const db = await window.DB.init(); await db.update('', { ['rooms/' + code]: null, ['roomsIndex/' + code]: null }); }

  window.Online = { host, team, roomExists, editor, login, setActions, createRoom, listRooms, closeRoom, listSets, createSet, page, tab: TAB };
})();
