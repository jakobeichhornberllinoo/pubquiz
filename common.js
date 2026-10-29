// Gemeinsame Helfer für Beamer, Moderation und Handys
(function () {
  const C = {};
  C.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  C.icon = (n, cls) => `<span class="ic ${cls || ''}">${(window.ICONS || {})[n] || ''}</span>`;
  C.offset = 0;
  // Online (Firebase, siehe online.js): Raum-Code aus ?room=CODE. Lokal leer.
  C.online = !!window.QUIZ_CONFIG;
  C.room = (new URLSearchParams(location.search).get('room') || '').toUpperCase();
  C.sk = (name) => name + (C.room ? '_' + C.room : ''); // Speicher-Schlüssel je Raum
  C.key = () => {
    const u = new URLSearchParams(location.search).get('key');
    if (u) { try { localStorage.setItem(C.sk('asium_key'), u); } catch (e) { /* */ } return u; }
    try { return localStorage.getItem(C.sk('asium_key')) || ''; } catch (e) { return ''; }
  };
  C.withRoom = (url) => (C.room ? url + (url.includes('?') ? '&' : '?') + 'room=' + C.room : url);
  const PASSIVE = new URLSearchParams(location.search).has('preview'); // Vorschau rechnet online nie selbst
  const onlineHost = () => window.Online.host(C.room, C.key(), { passive: PASSIVE });

  C.connect = (role, onData, onState) => {
    if (C.online) {
      const s = role === 'team' ? window.Online.team(C.room) : onlineHost();
      s.then((x) => x.connect((d) => { C.offset = d.now - Date.now(); onState && onState(true); onData(d); }, onState))
        .catch((e) => { onState && onState(false); C.toast(e.message, true); });
      return;
    }
    let es = null;
    let lastMsg = Date.now();
    const open = () => {
      const k = C.key();
      es = new EventSource(`/events?role=${role}` + (role !== 'team' ? `&key=${encodeURIComponent(k)}` : ''));
      es.onmessage = (ev) => {
        lastMsg = Date.now();
        const d = JSON.parse(ev.data);
        C.offset = d.now - Date.now();
        onState && onState(true);
        onData(d);
      };
      es.onerror = () => { onState && onState(false); };
    };
    open();
    // Watchdog: Handys schlafen ein – dann neu verbinden
    setInterval(() => {
      if (es && es.readyState === 2) { open(); }
      if (Date.now() - lastMsg > 40000) { try { es.close(); } catch (e) { /* */ } lastMsg = Date.now(); open(); }
    }, 5000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && Date.now() - lastMsg > 3000) { try { es.close(); } catch (e) { /* */ } open(); }
    });
  };
  // Dieselben Aufrufe wie beim lokalen Server; online gehen sie an Firebase
  async function onlineApi(path, body) {
    if (path === '/api/check') { await onlineHost(); return { ok: true }; }
    if (path === '/api/whoami') return (await window.Online.team(C.room)).call('whoami', body);
    if (path.startsWith('/api/team/')) return (await window.Online.team(C.room)).call(path.slice(10), body);
    if (path.startsWith('/api/host/')) return C.host(path.slice(10), body);
    throw new Error('Online nicht verfügbar');
  }
  C.api = async (path, body) => {
    if (C.online) return onlineApi(path, body);
    const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-host-key': C.key() }, body: JSON.stringify(body || {}) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || 'Fehler'), { status: r.status });
    return j;
  };
  C.host = async (action, body) => {
    if (!C.online) return C.api('/api/host/' + action, body);
    const s = await onlineHost();
    const sets = window.Online.setActions(s);
    return sets[action] ? sets[action](body || {}) : s.act(action, body || {});
  };
  // Adresse einer Seite (lokal /host, online host.html)
  C.page = (name, params) => {
    const file = C.online ? { host: 'host.html', screen: 'screen.html', team: 'team.html' }[name] : { host: '/host', screen: '/screen', team: '/' }[name];
    return file + (params ? '?' + new URLSearchParams(params) : '');
  };
  C.timerLeft = (t) => {
    if (!t) return 0;
    if (t.endsAt) return Math.max(0, (t.endsAt - (Date.now() + C.offset)) / 1000);
    return t.left == null ? t.dur || 0 : t.left;
  };
  C.fmt = (s) => { s = Math.ceil(s); return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : String(s); };
  C.pad2 = (n) => String(n).padStart(2, '0');
  C.cardKey = (cat, i) => `b:${cat}:${i}`;
  C.cardOf = (quiz, key) => {
    if (!key) return null;
    const [, ck, ci] = key.split(':');
    const cat = quiz.buzzer.find((c) => c.key === ck);
    return cat ? { cat, card: cat.cards[Number(ci)], i: Number(ci) } : null;
  };
  C.teamName = (state, id) => { const t = state.teams.find((x) => x.id === id); return t ? t.name : '?'; };
  C.teamColor = (state, id) => { const t = state.teams.find((x) => x.id === id); return t ? t.color : '#fff'; };
  // kleine Töne (WebAudio), damit nichts geladen werden muss
  let ac = null;
  C.beep = (kind) => {
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      if (ac.state === 'suspended') ac.resume();
      const seq = { buzz: [[880, 0, 0.12], [1320, 0.1, 0.25]], open: [[660, 0, 0.1], [990, 0.09, 0.18]], end: [[440, 0, 0.25], [330, 0.22, 0.5]], ok: [[660, 0, 0.12], [880, 0.1, 0.12], [1320, 0.2, 0.3]], wrong: [[220, 0, 0.35]] }[kind] || [[600, 0, 0.1]];
      seq.forEach(([f, start, dur]) => {
        const o = ac.createOscillator(), g = ac.createGain();
        o.type = kind === 'wrong' ? 'sawtooth' : 'triangle'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, ac.currentTime + start);
        g.gain.exponentialRampToValueAtTime(0.35, ac.currentTime + start + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + start + dur);
        o.connect(g); g.connect(ac.destination); o.start(ac.currentTime + start); o.stop(ac.currentTime + start + dur + 0.05);
      });
    } catch (e) { /* kein Ton möglich */ }
  };
  C.toast = (msg, bad) => {
    let el = document.getElementById('toast');
    if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); }
    el.textContent = msg; el.className = 'show' + (bad ? ' bad' : '');
    clearTimeout(el._t); el._t = setTimeout(() => { el.className = ''; }, 2600);
  };
  window.C = C;
})();
