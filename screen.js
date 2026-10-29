// Beamer-Ansicht: zeigt die aktuelle Folie, reagiert live auf Moderation und Handys, spielt Töne und Effekte
(function () {
  const $ = (id) => document.getElementById(id);
  const stage = $('stage');
  const content = $('content');
  const ovl = $('ovl');
  const buzzfx = $('buzzfx');
  let D = null;
  let lastHtml = '', lastOvl = '';
  let lastSlide = -1;
  let seen = new Set();
  let lastQr = '';
  const PREVIEW = new URLSearchParams(location.search).has('preview');
  const DRAFT = new URLSearchParams(location.search).has('draft'); // Editor-Vorschau: Entwurf kommt per postMessage
  if (PREVIEW) { $('help').style.display = 'none'; document.body.classList.add('preview'); } else window.FX.init(stage, 1600, 900);
  const prev = { first: null, open: false, judged: null, timerDone: false, sec: null, teams: 0, slide: -1, step: 0, ping: 0, pause: false };

  function fit() {
    const s = Math.min(window.innerWidth / 1600, window.innerHeight / 900);
    stage.style.left = '50%'; stage.style.top = '50%';
    stage.style.transform = `translate(-50%, -50%) scale(${s})`;
    stage.style.transformOrigin = 'center center';
  }
  window.addEventListener('resize', fit); fit();

  // ---------- Effekte: Töne, Konfetti, Überspringen ----------
  const snd = (name, arg) => { if (!PREVIEW) window.SFX.play(name, arg); };
  const timers = new Set();
  const later = (ms, fn) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); };
  let busyUntil = 0; // solange eine lange Animation läuft, überspringt ein Tastendruck nur sie
  const busy = (ms) => { if (!PREVIEW && !window.FX.reduce) busyUntil = Math.max(busyUntil, Date.now() + ms); };
  function skip() {
    busyUntil = 0;
    timers.forEach((t) => { clearTimeout(t); }); timers.clear();
    window.SFX.stopAll(); window.FX.clear();
    content.classList.add('instant');
    const bars = content.querySelector('.bars[data-flip]'); if (bars) flipGo(bars);
    buzzfx.classList.remove('on');
  }
  const teamColors = (ids) => ids.map((id) => window.C.teamColor(D.state, id));

  // ---------- Text darf nie überlaufen: zu lange Texte stufenweise verkleinern ----------
  const over = (el) => el.scrollHeight > el.clientHeight + 2 || el.scrollWidth > el.clientWidth + 2;
  const FIT = '.qt, .qsmall, .opt, .ans strong, .fact p, .hint, .otile b, .pod b, .eilrow span, .rname, .ybox span, .bq > .qt';
  function fitText(root) {
    root.querySelectorAll(FIT).forEach((el) => {
      let fs = parseFloat(getComputedStyle(el).fontSize); let n = 0;
      while (over(el) && fs > 16 && n++ < 40) { fs -= 2; el.style.fontSize = fs + 'px'; }
    });
  }
  window.__overflow = () => [...content.querySelectorAll(FIT)].filter(over).map((el) => el.className + ': ' + el.textContent.slice(0, 40));

  // ---------- Zwischenstand: Teams ziehen von ihrem alten Platz auf den neuen ----------
  let flipDone = -1;
  function flipGo(bars) {
    bars.querySelectorAll('.bar').forEach((r) => { r.style.transform = ''; });
    bars.classList.add('go'); flipDone = D ? D.state.slide : flipDone;
  }
  function setupFlip(isNew) {
    const bars = content.querySelector('.bars[data-flip]'); if (!bars) return;
    if (!isNew || PREVIEW || window.FX.reduce || flipDone === D.state.slide) { bars.classList.add('go'); return; }
    const rows = [...bars.querySelectorAll('.bar')];
    const pitch = rows.length > 1 ? rows[1].offsetTop - rows[0].offsetTop : 0;
    rows.forEach((r) => { r.style.transition = 'none'; r.style.transform = `translateY(${(Number(r.dataset.from) - Number(r.dataset.to)) * pitch}px)`; });
    void bars.offsetWidth;
    rows.forEach((r) => { r.style.transition = ''; });
    snd('drumroll', 1.5); busy(2700);
    later(1500, () => { snd('hit'); flipGo(bars); });
  }

  // ---------- Zeichnen ----------
  function draw() {
    if (!D) return;
    const st = D.state;
    const item = D.flow[st.slide];
    window.SFX.set(st.settings.volume, st.settings.muted);
    $('muted').classList.toggle('on', !!st.settings.muted && !PREVIEW);
    const ctx = { quiz: D.quiz, flow: D.flow, state: st, joinUrl: D.joinUrl, room: D.online ? D.room : null };
    const r = window.Render.slide(ctx);
    stage.className = 'bg-' + r.bg;
    const isNew = st.slide !== lastSlide;
    if (isNew) { seen = new Set(); lastSlide = st.slide; }
    if (r.html !== lastHtml) {
      content.classList.remove('instant');
      content.innerHTML = r.html;
      lastHtml = r.html;
      content.querySelectorAll('[data-k]').forEach((el) => {
        const k = el.getAttribute('data-k');
        if (seen.has(k)) el.classList.add('noanim');
        seen.add(k);
      });
      lastQr = '';
      fitText(content);
      if (item.type === 'score') setupFlip(isNew);
    }
    const o = window.Render.gate(ctx) + window.Render.pause(ctx);
    if (o !== lastOvl) { ovl.innerHTML = o; lastOvl = o; }
    const qr = $('qr');
    if (qr && qr.dataset.url !== lastQr) {
      lastQr = qr.dataset.url;
      const q = window.qrcode(0, 'M'); q.addData(lastQr); q.make();
      qr.innerHTML = q.createSvgTag({ cellSize: 8, margin: 0, scalable: true });
    }
    if (!PREVIEW) cues(st, item, isNew);
    prev.slide = st.slide; prev.step = st.step;
  }

  // Töne und Effekte bei Zustandswechseln
  let primed = false;
  function cues(st, item, isNew) {
    const list = () => window.Flow.ranking(st, D.quiz);
    if (!primed) { // erster Stand nach dem Laden: nichts nachträglich abspielen
      primed = true;
      const bz = st.buzz;
      Object.assign(prev, { teams: st.teams.length, first: bz.queue.length ? bz.queue[0].team + ':' + bz.queue[0].t : null, open: bz.open, judged: bz.judged ? JSON.stringify(bz.judged) + bz.card : null, ping: st.ping, pause: !!st.pause });
      return;
    }
    if (isNew) {
      if (item.type === 'div') { snd('whoosh'); later(300, () => snd('news')); busy(1300); }
      if (item.type === 'final' && st.teams.length) { [0, 1, 2].forEach((s) => later(s * 1000, () => snd('tock'))); later(3000, () => snd('whoosh')); busy(3000); }
      if (item.type === 'board' && prev.slide !== st.slide) snd('whoosh');
    } else if (st.step > prev.step) {
      if (item.type === 'eil') snd('tock');
      if (item.type === 'a' && st.step === 1) snd('ok');
      if (item.type === 'a' && st.step > 1) snd('pop');
      if (item.type === 'final') {
        const l = list(); const n = l.length;
        const has1 = (s) => l.slice(Math.max(0, n - s)).some((e) => e.rank === 1);
        if (has1(st.step) && !has1(prev.step)) {
          snd('drumroll', 1.8); busy(2600);
          later(1800, () => { snd('hit'); snd('fanfare'); window.FX.confetti(teamColors(l.filter((e) => e.rank === 1).map((e) => e.id)), 200); });
        } else snd('hit');
      }
      if (item.type === 'ceremony') {
        const pods = content.querySelectorAll('.podium > *');
        const at = (i) => { const el = pods[i]; if (!el) return { x: 800, y: 600 }; return { x: el.offsetLeft + el.offsetWidth / 2, y: 900 - 170 - 200 }; };
        const groups = []; list().forEach((e) => { const g = groups.find((x) => x.rank === e.rank); if (g) g.ids.push(e.id); else groups.push({ rank: e.rank, ids: [e.id] }); });
        if (st.step === 1 || st.step === 2) {
          const g = groups[st.step === 1 ? 2 : 1];
          snd('hit'); if (g) later(300, () => window.FX.confetti(teamColors(g.ids), 70, at(st.step === 1 ? 2 : 0)));
        }
        if (st.step === 3) {
          snd('drumroll', 1.8); busy(3000);
          later(1800, () => { snd('fanfare'); const g = groups[0]; window.FX.confetti(g ? teamColors(g.ids) : null, 260); later(600, () => window.FX.confetti(g ? teamColors(g.ids) : null, 160, at(1))); });
        }
        if (st.step === 4) snd('pop');
      }
    }
    // neue Teams bei der Anmeldung
    if (item.type === 'join' && st.teams.length > prev.teams) snd('pop');
    prev.teams = st.teams.length;
    // Buzzer
    const bz = st.buzz;
    const first = bz.queue.length ? bz.queue[0].team + ':' + bz.queue[0].t : null;
    if (first && first !== prev.first) {
      const id = bz.queue[0].team; const col = window.C.teamColor(st, id);
      snd('buzz');
      buzzfx.style.setProperty('--tc', col);
      buzzfx.innerHTML = `<small>ES BUZZERT</small><b>${window.C.esc(window.C.teamName(st, id))}</b>`;
      buzzfx.classList.remove('on'); void buzzfx.offsetWidth; buzzfx.classList.add('on');
      window.FX.burst(800, 450, col, 110);
      const f = $('flash'); f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
    }
    if (bz.open && !prev.open && !first) snd('open');
    const j = bz.judged ? JSON.stringify(bz.judged) + bz.card : null;
    if (j && j !== prev.judged) {
      snd(bz.judged.ok ? 'ok' : 'wrong');
      if (bz.judged.ok) window.FX.confetti([window.C.teamColor(st, bz.judged.team), '#fff'], 90, { x: 800, y: 760 });
    }
    prev.first = first; prev.open = bz.open; prev.judged = j;
    if (st.ping !== prev.ping) snd('fanfare'); // Test-Ton aus der Moderation
    prev.ping = st.ping;
    if (!!st.pause !== prev.pause) { if (st.pause) snd('whoosh'); prev.pause = !!st.pause; }
  }

  // Zeitbalken, letzte 10 Sekunden ticken, Gong bei 0; Pausen-Countdown
  function tick() {
    if (D) {
      const t = D.state.timer;
      const el = $('timer');
      if (el) {
        const left = window.C.timerLeft(t);
        const dur = t.dur || 60;
        $('tfill').style.width = `${Math.max(0, Math.min(100, (left / dur) * 100))}%`;
        $('tnum').textContent = window.C.fmt(left);
        el.classList.toggle('low', left <= 10 && left > 0);
        const done = left <= 0.05 && (t.endsAt || t.left === 0);
        el.classList.toggle('done', !!done);
        const sec = Math.ceil(left);
        if (t.endsAt && left > 0 && left <= 10 && sec !== prev.sec) snd(sec <= 3 ? 'tock' : 'tick');
        prev.sec = sec;
        if (done && t.endsAt && !prev.timerDone) snd('gong');
        prev.timerDone = !!done;
      }
      const pc = $('pcount');
      if (pc && D.state.pause) pc.textContent = window.C.fmt(Math.max(0, (D.state.pause.until - (Date.now() + window.C.offset)) / 1000)).replace(/^(\d+)$/, '0:$1').replace(/:(\d)$/, ':0$1');
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // ---------- Steuerung per Tastatur / Presenter ----------
  const act = (a, b) => window.C.host(a, b).catch((e) => window.C.toast(e.message, true));
  document.addEventListener('keydown', (e) => {
    if (!D || PREVIEW || e.target.tagName === 'INPUT') return;
    const k = e.key;
    const st = D.state;
    if (k === 'f' || k === 'F') { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(() => {}); return; }
    if (k === 'm' || k === 'M') { act('settings', { muted: !st.settings.muted }); return; }
    if (k === 'h' || k === 'H') { $('help').style.display = $('help').style.display === 'none' ? '' : 'none'; return; }
    if (Date.now() < busyUntil && !['Shift', 'Control', 'Alt', 'Meta'].includes(k)) { e.preventDefault(); skip(); return; }
    if (['ArrowRight', 'PageDown', ' ', 'Enter', 'ArrowDown'].includes(k)) { e.preventDefault(); act('next'); }
    else if (['ArrowLeft', 'PageUp', 'Backspace', 'ArrowUp'].includes(k)) { e.preventDefault(); act('prev'); }
    else if (k === 't' || k === 'T') { const t = st.timer; act('timer', { cmd: t.endsAt ? 'pause' : 'start' }); }
    else if (k === 'p' || k === 'P') act('pause', {});
    else if (k === 'b' || k === 'B') act('buzzOpen');
    else if (k === 'r' || k === 'R') act('judge', { ok: true });
    else if (k === 'w' || k === 'W') act('judge', { ok: false });
    else if (k === 'a' || k === 'A') act('revealCard');
    else if (k === 'Escape') act('closeCard');
  });
  content.addEventListener('click', (e) => {
    const c = e.target.closest('[data-card]');
    if (c && D && !D.state.used[c.dataset.card]) act('card', { card: c.dataset.card });
  });
  // Ton freischalten (Browser erlauben Audio erst nach einer Interaktion)
  const unlock = () => { window.SFX.unlock(); window.removeEventListener('keydown', unlock); window.removeEventListener('click', unlock); };
  window.addEventListener('keydown', unlock); window.addEventListener('click', unlock);

  async function start() {
    if (DRAFT) {
      window.addEventListener('message', (e) => { if (e.origin === location.origin && e.data && e.data.quiz) { D = e.data; draw(); } });
      return;
    }
    try { await window.C.api('/api/check'); } catch (e) {
      const p = $('pin'); p.classList.add('on');
      if (e.noRoom) { p.firstElementChild.textContent = 'Spiel nicht gefunden – Link mit Raum-Code prüfen.'; return; }
      $('pinBtn').onclick = () => { location.href = window.C.withRoom(window.C.page('screen', { key: $('pinIn').value.trim() })); };
      return;
    }
    window.C.connect('screen', (d) => { D = d; draw(); }, (ok) => $('conn').classList.toggle('on', !ok && !PREVIEW));
  }
  setTimeout(() => $('help').classList.add('hide'), 12000);
  start();
})();
