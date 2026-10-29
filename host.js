// Moderationsansicht: Steuerung, Punkte, Buzzer, Teams, Fragen
(function () {
  const { esc, icon } = window.C;
  const F = window.Flow;
  const $ = (id) => document.getElementById(id);
  const LET = 'ABCDEFGH';
  let D = null;
  let tab = 'live';
  try { tab = localStorage.getItem('asium_tab') || 'live'; } catch (e) { /* */ }
  let pointsQ = null; // gewählte Frage im Punkte-Tab
  let showPreview = window.innerWidth >= 900;

  const act = (a, b) => window.C.host(a, b).catch((e) => window.C.toast(e.message, true));
  const TABS = [['live', 'Live'], ['points', 'Punkte'], ['buzz', 'Buzzer'], ['teams', 'Teams'], ['flow', 'Ablauf'], ['edit', 'Fragen'], ['setup', 'Setup']];

  // ---------- Kopfzeile ----------
  $('prev').innerHTML = icon('left'); $('next').innerHTML = icon('right');
  $('prev').onclick = () => act('prev'); $('next').onclick = () => act('next');
  document.addEventListener('keydown', (e) => {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); act('next'); }
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); act('prev'); }
  });

  function head() {
    const st = D.state; const it = D.flow[st.slide];
    const max = F.maxStep(D.quiz, it, st.teams.length);
    $('lbl').textContent = `${st.slide + 1}/${D.flow.length} · ${it.label}`;
    let sub = max ? `Klick ${st.step}/${max}` : '';
    if (it.type === 'board' && st.buzz.card) { const co = window.C.cardOf(D.quiz, st.buzz.card); sub = `Karte: ${co.cat.name} · ${co.card.pts} P`; }
    const nxt = D.flow[F.stepIndex(D.flow, st, D.quiz, st.slide, 1)];
    const gate = st.gate ? '⚠ Zwischenstand wartet auf Punkte' : '';
    $('st').textContent = [gate, sub, !gate && st.step >= max && nxt && !(it.type === 'board' && st.buzz.card) ? `Weiter: ${nxt.label}` : ''].filter(Boolean).join('  ·  ');
    // Timer, dazu immer Pause und Ton
    const t = st.timer;
    let row = '';
    if (it.type === 'q' || it.type === 'tie_q') {
      row = `<span class="sky">${icon('clock')}</span><span class="tt" id="tt"></span>
        <button class="btn sm ${t.endsAt ? '' : 'pri'}" data-t="${t.endsAt ? 'pause' : 'start'}">${t.endsAt ? icon('pause') + ' Stopp' : icon('play') + ' Start'}</button>
        <button class="btn sm" data-t="add">+15 s</button><button class="btn sm" data-t="reset">${icon('redo')}</button>`;
    }
    row += `<span class="grow"></span><button class="btn sm ${st.pause ? 'pri' : 'ghost'}" data-pause="1">${st.pause ? 'Pause beenden' : 'Pause'}</button>
      <button class="btn sm ghost" data-mute="1" title="Ton an/aus (M am Beamer)">${st.settings.muted ? '🔇' : '🔊'}</button>`;
    if ($('trow').innerHTML !== row) $('trow').innerHTML = row;
  }
  $('trow').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.t) act('timer', { cmd: b.dataset.t, sec: 15 });
    if (b.dataset.pause) act('pause', {});
    if (b.dataset.mute) act('settings', { muted: !D.state.settings.muted });
  });
  setInterval(() => { const el = $('tt'); if (el && D) el.textContent = window.C.fmt(window.C.timerLeft(D.state.timer)); }, 250);

  function tabs() {
    $('tabs').innerHTML = TABS.map(([k, l]) => `<button data-tab="${k}" class="${tab === k ? 'on' : ''}">${l}</button>`).join('');
  }
  $('tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]'); if (!b) return;
    if (tab === 'edit' && b.dataset.tab !== 'edit' && window.Editor.dirty() && !confirm('Im Editor gibt es ungespeicherte Änderungen. Trotzdem wechseln? (Sie bleiben erhalten, bis du zurückkommst.)')) return;
    tab = b.dataset.tab; try { localStorage.setItem('asium_tab', tab); } catch (x) { /* */ }
    render(true);
  });

  // ---------- Bausteine ----------
  function curQuestion() {
    const it = D.flow[D.state.slide];
    if (it.type === 'q' || it.type === 'a') return F.question(D.quiz, it.no);
    // sonst: letzte Frage vor der aktuellen Folie
    for (let i = D.state.slide; i >= 0; i--) { const f = D.flow[i]; if (f.type === 'q' || f.type === 'a') return F.question(D.quiz, f.no); }
    return D.quiz.questions[0];
  }
  function solutionText(q) {
    if (q.type === 'mc' || q.type === 'tf' || q.type === 'img') return `${LET[q.correct]}) ${q.opts[q.correct]}`;
    if (q.type === 'order') return `${q.answerLetters} (${q.orderIdx.map((i) => q.items[i].t + ' ' + q.items[i].y).join(', ')})`;
    return q.answer;
  }
  function qBox(q, withNote) {
    return `<div class="box"><h3>FRAGE ${q.no} · ${esc(q.cat)} · ${q.pts} P${q.bonus ? ` + ${q.bonus} Bonus` : ''}</h3><div class="qq">${esc(q.q)}</div>
      <div class="sol"><b>Lösung:</b> ${esc(solutionText(q))}${q.bonusQ ? `<br><b>Bonus:</b> ${esc(q.bonusQ)} → ${esc(q.bonusA)}` : ''}</div>
      ${withNote && q.note ? `<div class="note">${icon('bulb')} ${esc(q.note)}</div>` : ''}</div>`;
  }
  function valuesFor(q) {
    const max = F.maxPoints(q);
    return [...Array(max + 1).keys()];
  }
  function scoreBox(q) {
    const key = 'q' + q.no; const sc = D.state.scores[key] || {};
    const tot = F.totals(D.state, D.quiz);
    const vals = valuesFor(q);
    const done = D.state.teams.filter((t) => sc[t.id] !== undefined).length;
    const hint = q.type === 'est' ? 'Schätzfrage: nächstes Team 2, zweitnächstes 1 (+ Bonus).' : q.bonus ? `Hauptantwort ${q.pts}, mit Bonus ${q.pts + q.bonus}.` : '';
    return `<div class="box"><h3>PUNKTE FRAGE ${q.no} · ${done}/${D.state.teams.length} EINGETRAGEN</h3>${hint ? `<div class="small">${hint}</div>` : ''}
      ${D.state.teams.map((t) => `<div class="srow"><div class="tn"><span class="dot" style="--tc:${t.color}"></span><span>${esc(t.name)}</span></div>
        <div class="vals">${vals.map((v) => `<button data-sc="${key}|${t.id}|${v}" class="${sc[t.id] === v ? 'on' : ''} ${v === 0 ? 'zero' : ''}">${v}</button>`).join('')}</div>
        <span class="tot">${tot[t.id]}</span></div>`).join('') || '<div class="small">Noch keine Teams.</div>'}</div>`;
  }
  function buzzBox() {
    const st = D.state; const bz = st.buzz;
    const rows = Math.max(0, ...D.quiz.buzzer.map((c) => c.cards.length));
    const grid = `<div class="bgrid" style="grid-template-columns:repeat(${Math.max(1, D.quiz.buzzer.length)}, 1fr)">${D.quiz.buzzer.map((c) => `<div class="bh">${esc(c.name)}</div>`).join('')}
      ${[...Array(rows).keys()].map((i) => D.quiz.buzzer.map((c) => {
        if (!c.cards[i]) return '<span></span>';
        const k = `b:${c.key}:${i}`; const u = st.used[k];
        if (u) return `<button class="used" data-free="${k}">${u.team ? esc(window.C.teamName(st, u.team)) : '–'}</button>`;
        return `<button data-card="${k}" class="${bz.card === k ? 'act' : ''}">${c.cards[i].pts}</button>`;
      }).join('')).join('')}</div><div class="small" style="margin-top:8px">Karte antippen = auf dem Beamer öffnen. Gespielte Karte antippen = wieder freigeben.</div>`;
    if (!bz.card) return `<div class="box"><h3>BUZZER · KARTE WÄHLEN</h3>${grid}</div>`;
    const { cat, card } = window.C.cardOf(D.quiz, bz.card);
    const q = card.type === 'who' ? card.hints.map((h, i) => `<div style="opacity:${i < bz.hint ? 1 : 0.45}">${i + 1}. ${esc(h)}</div>`).join('') : esc(card.q);
    const queue = bz.queue.map((x, i) => `<div class="qrow ${i === 0 ? 'first' : ''}" style="--tc:${window.C.teamColor(st, x.team)}"><span class="pos">${i + 1}.</span><span class="dot" style="--tc:${window.C.teamColor(st, x.team)}"></span>${esc(window.C.teamName(st, x.team))}</div>`).join('');
    const locked = bz.out.map((id) => `<span class="btn sm ghost" data-unlock="${id}">${esc(window.C.teamName(st, id))} ${bz.early.includes(id) ? '(zu früh)' : '(falsch)'} · entsperren</span>`).join(' ');
    let ctl = '';
    if (bz.reveal) ctl = `<button class="btn pri" data-b="closeCard">${icon('home')} Zurück zum Board</button>`;
    else {
      if (bz.queue.length) ctl += `<button class="btn ok" data-b="ok">${icon('check')} Richtig +${card.pts}</button><button class="btn bad" data-b="wrong">${icon('times')} Falsch −1</button>`;
      if (!bz.open) ctl += `<button class="btn pri" data-b="buzzOpen">${icon('bell')} Frei! (Buzzer an)</button>`;
      else ctl += `<button class="btn" data-b="buzzClose">${icon('lock')} Buzzer sperren</button>`;
      if (card.type === 'who' && bz.hint < card.hints.length) ctl += `<button class="btn" data-b="hint">${icon('plus')} Nächster Hinweis</button>`;
      ctl += `<button class="btn" data-b="revealCard">${icon('eye')} Auflösen (ohne Punkte)</button><button class="btn ghost" data-b="closeCard">Abbrechen</button>`;
    }
    return `<div class="box"><h3>${esc(cat.name).toUpperCase()} · ${card.pts} ${card.pts === 1 ? 'PUNKT' : 'PUNKTE'} · ${bz.open ? '<span style="color:#36D399">BUZZER OFFEN</span>' : 'BUZZER ZU'}</h3>
      <div class="qq">${q}</div><div class="sol"><b>Lösung:</b> ${esc(card.answer)}</div>
      ${queue || (bz.open ? '<div class="small" style="margin-top:10px">Warte auf den ersten Buzz …</div>' : '')}
      <div class="bctl">${ctl}</div>${locked ? `<div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">${locked}</div>` : ''}</div>
      <details class="box"><summary class="small">Kartenübersicht</summary><div style="margin-top:10px">${grid}</div></details>`;
  }
  // Punkte-Pflicht: zeigt, was in der Runde noch fehlt
  function roundBox(round, open) {
    const st = D.state;
    if (!st.teams.length) return '';
    const m = F.missingScores(st, D.quiz, round);
    const gate = st.gate && st.gate.round === round;
    if (!m.missing.length) return `<div class="box okbox"><h3>RUNDE ${round} · ALLE PUNKTE DA</h3><div class="small">${gate ? 'Mit ▶ geht es zum Zwischenstand.' : 'Der Zwischenstand kann kommen.'}</div></div>`;
    const list = m.missing.map((x) => `<button class="miss" data-pq="${x.no}"><b>Frage ${x.no}</b> ${x.teams.map((id) => esc(window.C.teamName(st, id))).join(', ')}</button>`).join('');
    return `<div class="box ${gate ? 'gatebox' : ''}"><h3>RUNDE ${round} · ${m.teamsDone}/${m.teams} TEAMS KOMPLETT${st.overrides[round] ? ' · FREIGEGEBEN' : ''}</h3>
      ${gate ? '<div class="qq">Der Zwischenstand wartet, bis alle Punkte eingetragen sind.</div>' : ''}
      ${open || gate ? `<div class="misslist">${list}</div>` : `<div class="small">Noch offen: ${m.missing.map((x) => 'Frage ' + x.no).join(', ')}</div>`}
      <div class="bctl"><button class="btn" data-fill="${round}">Rest als 0 eintragen</button><button class="btn ghost" data-over="${round}">Trotzdem weiter</button></div></div>`;
  }
  // Stechfrage: gleichauf liegende Teams in Platzreihenfolge antippen
  function tieBox() {
    const st = D.state;
    const ties = F.podiumTies(st, D.quiz, { raw: true });
    if (!ties.length) return `<div class="box"><h3>STECHFRAGE</h3><div class="small">Kein Gleichstand auf Platz 1–3. Die Stechfrage wird automatisch übersprungen.</div></div>`;
    const ord = st.tieOrder || [];
    return `<div class="box"><h3>STECHFRAGE · WER LIEGT NÄHER?</h3><div class="small">Teams in der Reihenfolge antippen, wie nah ihre Schätzung ist (nächste zuerst). Das entscheidet die Plätze, Punkte ändern sich nicht.</div>
      ${ties.map((g) => `<div class="tiegrp"><b>Gleichstand auf Platz ${g.rank} (${g.teams[0].pts} P)</b>${g.teams.map((e) => {
        const i = ord.indexOf(e.id);
        return `<button class="btn sm ${i >= 0 ? 'pri' : ''}" data-tie="${e.id}"><span class="dot" style="--tc:${e.color}"></span>${esc(e.name)}${i >= 0 ? ` · ${i + 1}.` : ''}</button>`;
      }).join('')}</div>`).join('')}
      <div class="bctl"><button class="btn ghost" data-tiereset="1">Reihenfolge zurücksetzen</button></div></div>`;
  }
  function rankBox() {
    const r = F.ranking(D.state, D.quiz);
    return `<div class="box"><h3>GESAMTSTAND</h3>${r.map((e) => `<div class="srow"><span class="pos muted" style="width:24px">${e.rank}.</span><div class="tn"><span class="dot" style="--tc:${e.color}"></span><span>${esc(e.name)}</span></div><span class="tot">${e.pts}</span></div>`).join('') || '<div class="small">Noch keine Teams.</div>'}</div>`;
  }

  // ---------- Tabs ----------
  const V = {};
  V.liveLeft = () => (showPreview ? `<div class="preview" id="pv"><iframe src="${window.C.withRoom(window.C.page('screen', { preview: 1 }))}" id="pvf" tabindex="-1"></iframe></div>` : '') +
    `<div style="margin:8px 0 14px"><button class="btn sm ghost" id="pvt">${showPreview ? 'Vorschau ausblenden' : 'Beamer-Vorschau einblenden'}</button></div>`;
  V.liveRight = () => {
    const st = D.state; const it = D.flow[st.slide];
    const gateTop = st.gate ? roundBox(st.gate.round, true) : '';
    if (it.type === 'q' || it.type === 'a') {
      const q = F.question(D.quiz, it.no);
      const rq = D.quiz.questions.filter((x) => x.round === q.round);
      const last = rq.length && rq[rq.length - 1].no === q.no;
      return gateTop + qBox(q, true) + scoreBox(q) + (st.gate ? '' : roundBox(q.round, last && it.type === 'a'));
    }
    if (it.type === 'final' || it.type === 'ceremony') return (F.podiumTies(st, D.quiz).length ? tieBox() : '') + rankBox();
    if (it.type === 'board' || it.type === 'buzzintro') return buzzBox() + rankBox();
    if (it.type === 'join') return `<div class="box"><h3>ANMELDUNG</h3><div class="small">Handys: <span class="link">${esc(D.joinUrl)}</span></div><div style="margin-top:8px">${st.teams.length} Teams angemeldet.</div></div>` + V.teams();
    if (it.type === 'tie_q' || it.type === 'tie_a') return `<div class="box"><h3>STECHFRAGE</h3><div class="qq">${esc(D.quiz.tiebreak.q)}</div><div class="sol"><b>Lösung:</b> ${esc(D.quiz.tiebreak.answer)}</div><div class="note">${esc(D.quiz.tiebreak.note || '')}</div></div>` + tieBox() + rankBox();
    if (it.type === 'board' && !st.buzz.card && F.needsTiebreak(st, D.quiz)) return buzzBox() + `<div class="box"><h3>HINWEIS</h3><div class="small">Nach dem Buzzer-Finale gibt es Gleichstand auf dem Podest – ▶ führt dann zur Stechfrage.</div></div>` + rankBox();
    if (it.type === 'spare') { const sp = D.quiz.spare[it.idx]; return `<div class="box"><h3>ERSATZFRAGE</h3><div class="qq">${esc(sp.q)}</div><div class="sol"><b>Lösung:</b> ${esc(sp.answer)}</div></div>` + rankBox(); }
    return gateTop + rankBox() + `<div class="box"><h3>TIPP</h3><div class="small">Weiter mit ▶ (oder Pfeiltaste / Presenter am Laptop). Punkte trägst du auf den Fragen- und Lösungsfolien direkt hier ein – der Beamer zeigt sie im Zwischenstand automatisch.</div></div>`;
  };
  V.points = () => {
    const q = pointsQ ? F.question(D.quiz, pointsQ) : curQuestion();
    return `<select class="qsel" id="psel">${D.quiz.questions.map((x) => `<option value="${x.no}" ${x.no === q.no ? 'selected' : ''}>Frage ${x.no}: ${esc(x.q.slice(0, 60))}${x.q.length > 60 ? '…' : ''}</option>`).join('')}</select>` + qBox(q, false) + scoreBox(q) + roundBox(q.round, true) + rankBox();
  };
  V.buzz = () => buzzBox() + rankBox();
  V.teams = () => {
    const tot = F.totals(D.state, D.quiz);
    return `<div class="box"><h3>TEAMS (${D.state.teams.length})</h3>${D.state.teams.map((t) => `<div class="trm"><span class="dot" style="--tc:${t.color}"></span>
      <input value="${esc(t.name)}" data-rename="${t.id}"><span class="small">${t.members || 0} 📱</span>
      <button class="btn sm" data-adj="${t.id}|-1">−1</button><button class="btn sm" data-adj="${t.id}|1">+1</button><span class="pts">${tot[t.id]}</span>
      <button class="btn sm ghost" data-del="${t.id}" title="Team löschen">${icon('trash')}</button></div>`).join('') || '<div class="small">Noch keine Teams.</div>'}
      <div class="trm"><input id="newTeam" placeholder="Team ohne Handy hinzufügen"><button class="btn sm pri" id="addTeam">${icon('plus')} Hinzufügen</button></div>
      <div class="small" style="margin-top:8px">±1 sind Sonderpunkte (z. B. für Kreativität oder Abzug fürs Googeln). Umbenennen: Namen ändern und Feld verlassen.</div></div>
      <div class="box"><h3>EINSTELLUNGEN</h3>
      <div class="tog"><span>Erwartete Teams <span class="small">(Zähler auf dem Beamer)</span></span><input class="num" type="number" min="1" max="30" id="expT" value="${D.state.settings.expectedTeams || 6}"></div>
      <div class="tog"><span>Neue Teams dürfen sich anmelden</span><button class="sw ${D.state.settings.joinOpen ? 'on' : ''}" data-set="joinOpen"></button></div>
      <div class="tog"><span>Punktestand auf den Handys zeigen <span class="small">(beim Endstand automatisch aus)</span></span><button class="sw ${D.state.settings.phoneScores ? 'on' : ''}" data-set="phoneScores"></button></div>
      <div class="tog"><span>Fragen auch auf die Handys spiegeln <span class="small">(Standard: aus, Handys ruhen bis zum Buzzer-Finale)</span></span><button class="sw ${D.state.settings.mirrorQuestions ? 'on' : ''}" data-set="mirrorQuestions"></button></div></div>`;
  };
  V.flow = () => {
    let sec = '';
    return `<div class="box"><h3>ABLAUF – ANTIPPEN ZUM SPRINGEN</h3><div class="flist">${D.flow.map((f, i) => {
      let h = '';
      const s = f.type === 'div' ? `Runde ${f.round}` : f.type === 'buzzintro' ? 'Buzzer-Finale' : f.type === 'tie_q' ? 'Finale' : f.type === 'spare' && sec !== 'Reserve' ? 'Reserve' : i === 0 ? 'Intro' : null;
      if (s && s !== sec) { sec = s; h = `<button class="sec" disabled>${esc(s.toUpperCase())}</button>`; }
      return h + `<button data-goto="${i}" class="${i === D.state.slide ? 'on' : ''}">${i + 1}. ${esc(f.label)}</button>`;
    }).join('')}</div></div>`;
  };
  // Online: Raum-Code und Links mit Schlüssel statt WLAN-Adressen
  function onlineBox() {
    const p = { room: D.room, key: D.key || window.C.key() };
    const abs = (f) => window.Online.page(f, p);
    return `<div class="box"><h3>SPIEL ${esc(D.room)}</h3>
      <div class="small">Handys (QR-Code auf dem Beamer): <span class="link">${esc(D.joinUrl)}</span></div>
      <div class="small" style="margin-top:6px">Beamer: <span class="link">${esc(abs('screen.html'))}</span></div>
      <div class="small" style="margin-top:6px">Moderation (z. B. zweites Handy): <span class="link">${esc(abs('host.html'))}</span></div>
      <div class="small" style="margin-top:10px">Die beiden unteren Links enthalten den Schlüssel dieses Spiels – nur an das Moderationsteam geben. Verloren? Unter <span class="link">${esc(window.Online.page('neu.html'))}</span> mit der Admin-PIN wieder öffnen.</div>
      <div class="small" style="margin-top:6px">Gerechnet wird in einem der offenen Beamer- oder Moderationsfenster (gerade: ${window.Online && D.leader ? 'diesem' : 'einem anderen'}). Schließt es, übernimmt ein anderes nach spätestens 15 Sekunden.</div></div>`;
  }
  V.setup = () => {
    if (D.online) return onlineBox() + V.setupRest();
    const base = `${location.protocol}//${location.host}`;
    const ips = (D.ips || []).map((x) => `http://${x.ip}:${D.port}`);
    const cur = D.state.settings.joinHost;
    const key = D.key || window.C.key();
    return `<div class="box"><h3>ADRESSE FÜR DIE HANDYS (QR-CODE)</h3><div class="small">Aktuell: <span class="link">${esc(D.joinUrl)}</span></div>
      <div class="small" style="margin:8px 0">Die Handys müssen im selben WLAN sein wie dieser Laptop. Klappt der QR-Code nicht, andere Adresse wählen oder einen Handy-Hotspot nutzen.</div>
      ${['', ...ips].map((u) => `<div class="tog"><span class="link">${u || 'Automatisch'}</span><button class="sw ${cur === u ? 'on' : ''}" data-jh="${esc(u)}"></button></div>`).join('')}
      <div class="trm"><input id="jhIn" placeholder="eigene Adresse, z. B. http://192.168.1.20:8080" value="${ips.includes(cur) ? '' : esc(cur)}"><button class="btn sm" id="jhSet">Übernehmen</button></div></div>
      <div class="box"><h3>LINKS</h3><div class="small">Beamer: <span class="link">${esc(base)}/screen?key=${esc(key)}</span></div>
      <div class="small" style="margin-top:6px">Moderation (z. B. zweites Handy): <span class="link">${esc(ips[0] || base)}/host?key=${esc(key)}</span></div>
      <div class="small" style="margin-top:6px">PIN: <b>${esc(key)}</b></div></div>` + V.setupRest();
  };
  V.setupRest = () => `
      <div class="box"><h3>TON (SPIELT AM BEAMER-LAPTOP)</h3>
      <div class="tog"><span>Lautstärke</span><input type="range" min="0" max="100" step="5" id="vol" value="${Math.round((D.state.settings.volume == null ? 0.8 : D.state.settings.volume) * 100)}"></div>
      <div class="tog"><span>Stumm <span class="small">(Taste M am Beamer)</span></span><button class="sw ${D.state.settings.muted ? 'on' : ''}" data-set="muted"></button></div>
      <div class="bctl"><button class="btn" id="ping">Test-Ton abspielen</button></div>
      <div class="small">Der Beamer-Browser darf erst Ton abspielen, wenn dort einmal eine Taste gedrückt oder geklickt wurde.</div></div>
      <div class="box"><h3>NEUSTART</h3><div class="small">Der Spielstand wird laufend gespeichert und übersteht auch einen Neustart des Servers.</div>
      <div class="bctl"><button class="btn" id="rsKeep">Punkte zurücksetzen (Teams behalten)</button><button class="btn bad" id="rsAll">Alles zurücksetzen</button></div></div>`;

  // ---------- Quiz-Editor (eigene Datei editor.js) ----------
  V.edit = () => '<div id="ed" class="ed2"></div>';

  // ---------- Klicks im Hauptbereich ----------
  $('main').addEventListener('click', async (e) => {
    if (e.target.closest('#ed')) return; // der Editor kümmert sich selbst
    const el = e.target.closest('button, [data-unlock]'); if (!el) return;
    const d = el.dataset;
    if (d.sc) {
      const [key, team, v] = d.sc.split('|');
      const cur = (D.state.scores[key] || {})[team];
      act('score', { key, team, value: cur === Number(v) ? null : Number(v) });
    } else if (d.card) act('card', { card: d.card });
    else if (d.free) { if (confirm('Diese Karte wieder freigeben? Ihre Buzzer-Punkte werden gelöscht.')) act('freeCard', { card: d.free }); }
    else if (d.b) {
      if (d.b === 'ok') act('judge', { ok: true });
      else if (d.b === 'wrong') act('judge', { ok: false });
      else if (d.b === 'hint') act('hint', { d: 1 });
      else act(d.b);
    } else if (d.unlock) act('unlock', { team: d.unlock });
    else if (d.adj) { const [team, delta] = d.adj.split('|'); act('adjust', { team, delta: Number(delta) }); }
    else if (d.del) { const t = D.state.teams.find((x) => x.id === d.del); if (t && confirm(`Team „${t.name}“ wirklich löschen? Seine Punkte verschwinden.`)) act('removeTeam', { id: d.del }); }
    else if (d.set) act('settings', { [d.set]: !D.state.settings[d.set] });
    else if (d.fill) act('fillZero', { round: Number(d.fill) });
    else if (d.over) { if (confirm('Zwischenstand zeigen, obwohl noch Punkte fehlen? Leere Felder zählen dann wie 0.')) act('override', { round: Number(d.over) }); }
    else if (d.pq) { pointsQ = Number(d.pq); tab = 'points'; render(true); }
    else if (d.tie) act('tiePick', { team: d.tie });
    else if (d.tiereset) act('tieReset');
    else if (el.id === 'ping') act('ping');
    else if (d.goto) act('goto', { to: Number(d.goto) });
    else if (d.jh !== undefined) act('settings', { joinHost: d.jh });
    else if (el.id === 'addTeam') { const n = $('newTeam').value.trim(); if (n) { await act('addTeam', { name: n }); } }
    else if (el.id === 'jhSet') act('settings', { joinHost: $('jhIn').value.trim() });
    else if (el.id === 'pvt') { showPreview = !showPreview; render(true); }
    else if (el.id === 'rsKeep') { if (confirm('Alle Punkte löschen und zum Anfang springen? Teams bleiben.')) act('reset', { keepTeams: true }); }
    else if (el.id === 'rsAll') { if (confirm('Wirklich ALLES zurücksetzen – Teams, Punkte, Ablauf?')) act('reset', { keepTeams: false }); }
  });
  $('main').addEventListener('change', (e) => {
    if (e.target.closest('#ed')) return; // der Editor kümmert sich selbst
    if (e.target.id === 'psel') { pointsQ = Number(e.target.value); render(true); }
    if (e.target.dataset.rename) { const n = e.target.value.trim(); if (n) act('renameTeam', { id: e.target.dataset.rename, name: n }); }
    if (e.target.id === 'expT') act('settings', { expectedTeams: Number(e.target.value) });
    if (e.target.id === 'vol') act('settings', { volume: Number(e.target.value) / 100 });
  });
  $('main').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.id === 'newTeam') $('addTeam').click();
    if (e.key === 'Enter' && e.target.dataset.rename) e.target.blur();
  });

  // ---------- Rendern ----------
  let lastMain = ''; let liveBuilt = false;
  function render(force) {
    if (!D) return;
    head(); tabs();
    if (tab === 'edit' && !force && lastMain) return; // Editor nicht bei jedem Update neu zeichnen
    const a = document.activeElement;
    if (!force && a && $('main').contains(a) && ['INPUT', 'TEXTAREA', 'SELECT'].includes(a.tagName)) return;
    if (tab === 'live') {
      if (force || !liveBuilt || !$('liveRight')) {
        $('main').innerHTML = `<div class="cols"><div class="left">${V.liveLeft()}</div><div id="liveRight"></div></div>`;
        liveBuilt = true; lastMain = '';
        fitPreview();
      }
      const html = V.liveRight();
      if (html !== lastMain) { $('liveRight').innerHTML = html; lastMain = html; }
      return;
    }
    liveBuilt = false;
    const html = (V[tab] || V.liveRight)();
    if (html !== lastMain || force) { $('main').innerHTML = html; lastMain = html; if (tab === 'edit') window.Editor.mount($('ed')); }
  }
  function fitPreview() { const pv = $('pv'); const f = $('pvf'); if (pv && f) f.style.transform = `scale(${pv.clientWidth / 1600})`; }
  window.addEventListener('resize', fitPreview);

  async function start() {
    try { await window.C.api('/api/check'); } catch (e) {
      $('pinGate').hidden = false;
      if (e.noRoom) { $('pinGate').querySelector('p').textContent = 'Spiel nicht gefunden. Bitte den Link mit Raum-Code prüfen oder unter neu.html ein Spiel anlegen.'; $('pinIn').hidden = true; $('pinBtn').hidden = true; return; }
      $('pinBtn').onclick = () => { const k = $('pinIn').value.trim(); location.href = window.C.withRoom(window.C.page('host', { key: k })); };
      $('pinIn').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') $('pinBtn').click(); });
      return;
    }
    $('app').hidden = false;
    window.C.connect('host', (d) => { D = d; render(); }, (ok) => $('offline').classList.toggle('on', !ok));
  }
  start();
})();
