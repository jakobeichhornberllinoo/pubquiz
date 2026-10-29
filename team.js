// Handy-Ansicht der Teams: Anmelden, mitlesen, buzzern
(function () {
  const { esc, icon } = window.C;
  const $ = (id) => document.getElementById(id);
  const LET = 'ABCDEFGH';
  let P = null; // öffentlicher Spielstand
  let token = null; let teamId = null;
  let pending = false; // Buzz unterwegs
  let wake = null;
  try { token = localStorage.getItem(window.C.sk('asium_token')); teamId = localStorage.getItem(window.C.sk('asium_team')); } catch (e) { /* */ }

  const store = () => { try { localStorage.setItem(window.C.sk('asium_token'), token || ''); localStorage.setItem(window.C.sk('asium_team'), teamId || ''); } catch (e) { /* */ } };
  const keepAwake = async () => { try { if ('wakeLock' in navigator && !wake) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } } catch (e) { /* */ } };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && teamId) keepAwake(); });

  async function check() {
    if (!token) return;
    try { const r = await window.C.api('/api/whoami', { token }); if (!r.teamId) { token = null; teamId = null; store(); } else { teamId = r.teamId; store(); } } catch (e) { /* offline: behalten */ }
  }

  // ---------- Anmelden ----------
  $('jform').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('jname').value.trim();
    try {
      const r = await window.C.api('/api/team/join', { name });
      token = r.token; teamId = r.teamId; store(); keepAwake(); render();
      if (navigator.vibrate) navigator.vibrate(60);
    } catch (err) { window.C.toast(err.message, true); }
  });
  $('jteams').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-team]'); if (!b) return;
    if (!confirm(`Dem Team „${b.dataset.name}“ beitreten?`)) return;
    try { const r = await window.C.api('/api/team/join', { teamId: b.dataset.team }); token = r.token; teamId = r.teamId; store(); keepAwake(); render(); } catch (err) { window.C.toast(err.message, true); }
  });
  $('leave').addEventListener('click', async (e) => {
    e.preventDefault();
    if (!confirm('Dieses Handy vom Team abmelden? Das Team und seine Punkte bleiben erhalten.')) return;
    try { await window.C.api('/api/team/leave', { token }); } catch (err) { /* */ }
    token = null; teamId = null; store(); render();
  });

  // ---------- Buzzer ----------
  async function buzz() {
    if (pending || !token) return;
    pending = true;
    if (navigator.vibrate) navigator.vibrate(90);
    try {
      const r = await window.C.api('/api/team/buzz', { token });
      if (r.status === 'early') { window.C.toast('Zu früh gedrückt – für diese Karte seid ihr raus.', true); if (navigator.vibrate) navigator.vibrate([60, 60, 200]); }
    } catch (err) { window.C.toast(err.message, true); }
    pending = false;
  }
  $('game').addEventListener('pointerdown', (e) => { if (e.target.closest('#bz')) { e.preventDefault(); buzz(); } });
  $('game').addEventListener('contextmenu', (e) => { if (e.target.closest('#bz')) e.preventDefault(); }); // langes Drücken: kein Menü

  // ---------- Darstellung ----------
  function meCard(me, rankList) {
    const sc = P.phoneScores && me.pts != null ? `<div class="sc"><b>${me.pts}</b><span>Punkte · Platz ${me.rank}</span></div>` : '';
    return `<div class="me" style="--tc:${me.color}"><div><div class="nm">${esc(me.name)}</div><div class="sub">Euer Team${me.members > 1 ? ` · ${me.members} Handys` : ''}</div></div>${sc}</div>`;
  }
  function timerHtml() { return `<div class="ptimer" id="pt"><span class="sky">${icon('clock')}</span><div class="tb"><i id="ptf"></i></div><b id="ptn"></b></div>`; }
  function ranking(me) {
    if (!P.phoneScores) return '';
    const l = P.teams.filter((t) => t.pts != null).slice().sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
    if (!l.length) return '';
    return `<div class="panel"><div class="lab">ZWISCHENSTAND</div><div class="rank">${l.map((t) => `<div class="r ${t.id === me.id ? 'mine' : ''}"><span class="n">${t.rank}.</span><span class="dot" style="--tc:${t.color}"></span><span>${esc(t.name)}</span><b>${t.pts}</b></div>`).join('')}</div></div>`;
  }
  const rest = (ic, h, p) => `<div class="panel rest">${icon(ic)}<h2>${esc(h)}</h2><p>${esc(p)}</p></div>`;
  function body(me) {
    const s = P.slide;
    const b = P.buzz;
    if (P.pause) return `<div class="panel idle">${icon('clock')}<h2>Pause – Getränke holen!</h2><div class="pcd" id="pcd"></div></div>` + ranking(me);
    // Siegerehrung: das eigene Team wird gefeiert
    const mine = (P.podium || []).find((x) => x.team === me.id);
    if (s.type === 'ceremony' && mine) {
      return `<div class="panel winner" style="--tc:${me.color}">${icon(mine.special ? 'star' : mine.place === 1 ? 'crown' : 'trophy')}
        <div class="pl">${mine.special ? 'SONDERPREIS' : `PLATZ ${mine.place}`}</div><div class="aw">${esc(mine.award || '')}</div><p>Kommt nach vorne!</p></div>`;
    }
    // Ohne Spiegelung ruhen die Handys während der Hauptrunden
    if (!P.mirror && (s.type === 'q' || s.type === 'a')) return rest('mobile', 'Handy weglegen', 'Fragen stehen auf dem Beamer, Antworten kommen auf den Zettel. Wir sehen uns im Buzzer-Finale.');
    if (s.type === 'q') {
      let opts = '';
      if (s.opts) opts = `<div class="popts">${s.opts.map((o, i) => `<div class="popt"><span class="l">${LET[i]}</span>${esc(o)}</div>`).join('')}</div>`;
      else if (s.items && s.items.length) opts = `<div class="popts">${s.items.map((o, i) => `<div class="popt"><span class="l">${LET[i]}</span>${esc(o)}</div>`).join('')}</div>`;
      return `<div class="panel"><div class="lab">FRAGE ${s.no} VON ${s.total} · ${esc(s.cat)}</div><div class="q">${esc(s.q)}</div>${opts}
        ${s.bonusQ ? `<div class="hint2"><b class="mag">BONUS</b> ${esc(s.bonusQ)}</div>` : ''}
        ${s.unit ? `<div class="hint2">${icon('pen')} ${esc(s.unit)}</div>` : ''}${timerHtml()}
        <div class="hint2">${icon('pen')} Antwort auf euren Zettel schreiben.</div></div>`;
    }
    if (s.type === 'a') {
      return `<div class="panel"><div class="lab">LÖSUNG ZU FRAGE ${s.no}</div><div class="q">${esc(s.q)}</div>
        ${s.answer ? `<div class="pans"><small>LÖSUNG</small>${esc(s.answer)}</div>` : '<div class="hint2">Die Lösung kommt gleich auf dem Beamer …</div>'}</div>` + ranking(me);
    }
    if (s.type === 'board' || s.type === 'buzzintro') {
      if (!b.card) {
        return `<div class="panel wake"><div class="lab">BUZZER-FINALE</div><div class="q">${s.type === 'board' ? 'Die nächste Karte wird gewählt …' : 'Gleich geht’s los!'}</div>
          <div class="buzzwrap"><button class="bigbuzz wait" disabled>BUZZER</button><div class="bstate">Bereit halten<small>Erst drücken, wenn auf dem Beamer „Frei!“ steht.</small></div></div></div>` + ranking(me);
      }
      const c = b.card;
      const head = `<div class="lab">${esc(c.cat)} · ${c.pts} ${c.pts === 1 ? 'PUNKT' : 'PUNKTE'}</div>` +
        (c.hints ? c.hints.map((h, i) => `<div class="hint2"><b class="sky">${i + 1}</b> ${esc(h)}</div>`).join('') : `<div class="q">${esc(c.q || '')}</div>`);
      let btn; let st;
      const qi = b.queue.findIndex((x) => x.team === me.id);
      if (b.reveal) {
        btn = '';
        st = `<div class="pans" style="width:100%"><small>LÖSUNG</small>${esc(c.answer || '')}</div>`;
        if (b.judged && b.judged.ok) st += `<div class="bstate" style="margin-top:6px">${b.judged.team === me.id ? 'Richtig! Punkte für euch 🎉' : `Punkte für ${esc((P.teams.find((t) => t.id === b.judged.team) || {}).name || '')}`}</div>`;
      } else if (b.early.includes(me.id)) {
        btn = '<button class="bigbuzz out" disabled>RAUS</button>'; st = 'Zu früh gedrückt<small>Für diese Karte seid ihr raus.</small>';
      } else if (b.wrong.includes(me.id)) {
        btn = '<button class="bigbuzz out" disabled>RAUS</button>'; st = 'Leider falsch<small>−1 Punkt. Für diese Karte seid ihr raus.</small>';
      } else if (qi === 0) {
        btn = '<button class="bigbuzz done" disabled>IHR!</button>'; st = 'Ihr seid dran!<small>Antwortet laut – die Moderation entscheidet.</small>';
      } else if (qi > 0) {
        btn = `<button class="bigbuzz done" disabled>#${qi + 1}</button>`; st = `Platz ${qi + 1} in der Reihe<small>Ihr kommt dran, wenn die Teams vor euch falsch liegen.</small>`;
      } else if (b.open) {
        btn = '<button class="bigbuzz armed" id="bz">BUZZ!</button>'; st = 'FREI! Jetzt drücken!';
      } else {
        btn = '<button class="bigbuzz wait" id="bz">WARTEN</button>'; st = 'Noch nicht drücken!<small>Wer vor „Frei!“ drückt, ist für diese Karte raus.</small>';
      }
      return `<div class="panel">${head}<div class="buzzwrap">${btn}<div class="bstate">${st}</div></div></div>`;
    }
    const handyWeg = 'Ihr braucht das Handy erst im Buzzer-Finale wieder. Es meldet sich dann mit Vibration.';
    const idle = {
      title: ['users', 'Gleich geht’s los', 'Schaut nach vorne – die Moderation startet gleich.'],
      eil: ['bell', 'Eilmeldung', 'Schaut nach vorne.'],
      join: ['check', 'Ihr seid angemeldet!', 'Weitere Handys eures Teams können noch beitreten. Danach: Handy weglegen.'],
      rules: ['mobile', 'Handy weglegen', handyWeg],
      points: ['mobile', 'Handy weglegen', handyWeg],
      go: ['mobile', 'Handy weglegen – los geht’s!', 'Zettel und Stift bereit? Wir sehen uns im Buzzer-Finale.'],
      div: ['mobile', s.name ? `Runde ${s.round}: ${s.name}` : 'Neue Runde', handyWeg],
      score: ['trophy', 'Zwischenstand', 'Schaut auf den Beamer.'],
      tie_q: ['pen', 'Stechfrage', 'Nur bei Gleichstand – Zahl auf den Zettel.'],
      tie_a: ['pen', 'Stechfrage', 'Die Auflösung läuft vorne.'],
      final: ['trophy', 'Der Endstand …', 'Spannung! Schaut nach vorne.'],
      ceremony: ['trophy', 'Siegerehrung', 'Applaus für alle Teams!'],
      thanks: ['crown', 'Danke fürs Mitspielen!', 'Mehr von ASIUM: Vorträge, Exkursionen, Stammtische.'],
    }[s.type] || ['eye', 'Schaut nach vorne', ''];
    const calm = idle[0] === 'mobile';
    return (calm ? rest(idle[0], idle[1], idle[2]) : `<div class="panel idle">${icon(idle[0])}<h2>${esc(idle[1])}</h2><p>${esc(idle[2])}</p></div>`) + (['score', 'join'].includes(s.type) ? ranking(me) : '');
  }

  let lastHtml = '';
  function render() {
    if (!P) return;
    const me = teamId && P.teams.find((t) => t.id === teamId);
    if (teamId && !me) { // Team evtl. noch nicht im Stand oder gelöscht -> beim Server nachfragen
      clearTimeout(render._t); render._t = setTimeout(() => check().then(render), 800);
      return;
    }
    $('join').hidden = !!me; $('game').hidden = !me; $('foot').hidden = !me;
    if (!me) {
      $('jform').hidden = !P.joinOpen; $('jclosed').hidden = P.joinOpen;
      const html = P.teams.map((t) => `<button class="tbtn" data-team="${t.id}" data-name="${esc(t.name)}"><span class="dot" style="--tc:${t.color}"></span>${esc(t.name)}<small>beitreten</small></button>`).join('') || '<div class="small">Noch keine Teams angemeldet.</div>';
      if ($('jteams').innerHTML !== html) $('jteams').innerHTML = html;
      lastHtml = '';
      return;
    }
    const html = meCard(me) + body(me);
    if (html !== lastHtml) { $('game').innerHTML = html; lastHtml = html; }
  }

  function tick() {
    const pc = $('pcd');
    if (pc && P && P.pause) { const l = Math.max(0, Math.ceil((P.pause.until - (Date.now() + window.C.offset)) / 1000)); pc.textContent = `${Math.floor(l / 60)}:${String(l % 60).padStart(2, '0')}`; }
    const el = $('pt');
    if (el && P) {
      const left = window.C.timerLeft(P.timer); const dur = P.timer.dur || 60;
      $('ptf').style.width = `${Math.max(0, Math.min(100, (left / dur) * 100))}%`;
      $('ptn').textContent = window.C.fmt(left);
      el.classList.toggle('low', left <= 10);
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  let prevOpen = false, prevFirst = null, prevType = null, prevPodium = false;
  const vib = (p) => { if (navigator.vibrate) navigator.vibrate(p); };
  window.FX.init(document.body);
  (async () => {
    // Online: gibt es das Spiel zu diesem Code (noch)?
    if (window.C.room) {
      const ok = !window.C.online || await window.Online.roomExists(window.C.room).catch(() => true);
      if (!ok) {
        $('join').hidden = true; $('game').hidden = false;
        $('game').innerHTML = `<div class="panel idle">${icon('flag')}<h2>Spiel nicht gefunden</h2><p>Den Code ${esc(window.C.room)} gibt es nicht (mehr). Bitte den QR-Code auf dem Beamer noch einmal scannen.</p><a class="btn pri big" href="index.html">Code eingeben</a></div>`;
        return;
      }
    }
    await check();
    startLive();
  })();
  function startLive() {
    window.C.connect('team', (d) => {
      P = d.pub;
      // Vibration, wenn das Buzzer-Finale beginnt, „Frei!“ kommt oder man dran ist
      const b = P.buzz;
      const t = P.slide.type;
      const finale = t === 'buzzintro' || t === 'board';
      if (finale && prevType && !['buzzintro', 'board'].includes(prevType)) vib([200, 100, 200, 100, 400]);
      document.body.classList.toggle('buzzing', finale);
      if (b.open && !prevOpen) vib(150);
      const f = b.queue.length ? b.queue[0].team : null;
      if (f === teamId && prevFirst !== teamId) vib([100, 50, 100]);
      // Siegerehrung: Konfetti in Teamfarbe, sobald das eigene Team aufgedeckt ist
      const me = teamId && P.teams.find((x) => x.id === teamId);
      const won = !!(me && (P.podium || []).some((x) => x.team === teamId));
      if (won && !prevPodium && prevType) { vib([300, 100, 300, 100, 600]); window.FX.confetti([me.color, '#fff', '#FFC93C'], 160); }
      prevOpen = b.open; prevFirst = f; prevType = t; prevPodium = won;
      render();
    }, (ok) => $('offline').classList.toggle('on', !ok));
  }
})();
