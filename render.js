// Rendert die Beamer-Folien (1600 × 900 px Bühne) im ASIUM-Navy-Design
(function () {
  const { esc, icon, pad2 } = window.C;
  const LET = 'ABCDEFGH';

  // ---------- Bausteine ----------
  const hdr = (num, label, sub, chips = []) => `
    <div class="hdr"><div class="hnum">${esc(num)}</div><div class="hsep"></div>
      <div class="hlab"><b>${esc(label)}</b><span>${esc(sub)}</span></div>
      <div class="chips">${chips.map((c) => `<span class="chip ${c.k || ''}">${esc(c.t)}</span>`).join('')}</div></div>`;
  const rv = (k, html, extra = '') => `<div class="rv ${extra}" data-k="${esc(k)}">${html}</div>`;
  const rva = (k, html) => rv(k, html, 'abs');
  const fact = (txt) => `<div class="fact">${icon('bulb', 'bulb')}<div><b>DAS WUSSTET IHR NOCH NICHT</b><p>${esc(txt)}</p></div></div>`;
  const timer = () => `<div class="timer" id="timer"><span class="tic">${icon('clock')}</span><div class="tbar"><i id="tfill"></i></div><span class="tnum" id="tnum"></span></div>`;
  const ptsTxt = (p) => `${p} ${p === 1 ? 'PUNKT' : 'PUNKTE'}`;
  const qsize = (s) => { const l = (s || '').length; return l <= 50 ? 'q-xl' : l <= 90 ? 'q-l' : l <= 130 ? 'q-m' : 'q-s'; };

  // Optionen: auf der Frage gestaffelt einblenden, auf der Lösung fallen die falschen weg
  const optCls = (q, mode, i) => (mode === 'a1' ? (i === q.correct ? 'ok' : 'dim') : mode === 'q' ? 'stag' : '');
  const optLen = (q) => Math.max(0, ...(q.opts || []).map((o) => o.length));
  function optGrid(q, mode) { // mode: 'q' | 'a0' | 'a1'
    const L = optLen(q);
    const size = L > 60 ? 'xlong' : L > 34 ? 'long' : '';
    return `<div class="opts ${size} ${mode !== 'q' ? 'small' : ''}">${q.opts.map((o, i) =>
      `<div class="opt ${optCls(q, mode, i)}" style="--i:${i}" data-k="o${i}${mode === 'a1' ? 'r' : ''}"><span class="let">${LET[i]}</span><span>${esc(o)}</span></div>`).join('')}</div>`;
  }
  function optStack(q, mode) {
    return `<div class="ostack ${optLen(q) > 40 ? 'long' : ''}">${q.opts.map((o, i) =>
      `<div class="opt ${optCls(q, mode, i)}" style="--i:${i}" data-k="s${i}${mode === 'a1' ? 'r' : ''}"><span class="let">${LET[i]}</span><span>${esc(o)}</span></div>`).join('')}</div>`;
  }
  const bonusBar = (q, showA) => `<div class="bonus"><div class="bl"><b>BONUS</b><span>+${q.bonus || 1} Punkt</span></div><div class="bq">${showA ? `<small>${esc(q.bonusQ)}</small><strong>${esc(q.bonusA)}</strong>` : esc(q.bonusQ)}</div></div>`;
  const answerCard = (txt, label = 'LÖSUNG') => `<div class="ans"><b>${label}</b><strong class="${(txt || '').length > 40 ? 'smaller' : ''}">${esc(txt)}</strong></div>`;

  // ---------- Folien ----------
  const S = {};
  S.title = ({ quiz }) => { const t = quiz.intro.title; return `<div class="title-wrap">
    <div class="tl"><div class="kick">${esc(t.kicker)}</div><div class="big mag">${esc(t.title)}</div><div class="tsub">${esc(t.sub)}</div>
    <div class="tmeta">${esc(t.meta)}</div><div class="tmeta sky b">${quiz.questions.length} Fragen  ·  ${quiz.rounds.length} Runden  ·  Buzzer-Finale</div></div>
    <img class="cheers" src="img/cheers.png" alt=""></div>`; };

  S.eil = ({ quiz, state }) => hdr('00', 'EILMELDUNG', 'zum Auftakt') + `<h1 class="h1">${esc(quiz.intro.eilTitle || 'Heute Abend')}</h1>
    <div class="eil">${quiz.intro.eil.map((l, i) => (state.step > i ? rv('e' + i, `<div class="eilrow"><b>${esc(l[0]).toUpperCase()}</b><span>${esc(l[1])}</span></div>`) : `<div class="eilrow ghost"></div>`)).join('')}</div>`;

  S.join = ({ state, joinUrl, quiz, room }) => {
    const teams = state.teams;
    const exp = state.settings.expectedTeams || 6;
    const count = teams.length >= exp ? `<b>${teams.length}</b> Teams – alle da!` : `<b>${teams.length}</b> von ${exp} erwarteten Teams`;
    // Online: kurze Adresse plus Code zum Abtippen; lokal: die WLAN-Adresse
    const short = room ? joinUrl.replace(/^https?:\/\//, '').replace(/team\.html\?room=.*$/, '') : joinUrl.replace(/^https?:\/\//, '');
    return hdr('01', 'TEAMFINDUNG', 'Anmeldung per Handy') + `<div class="join">
      <div class="qrcard"><div id="qr" data-url="${esc(joinUrl)}"></div><div class="qurl">${esc(short)}</div>${room ? `<div class="qcode">Code <b>${esc(room)}</b></div>` : ''}</div>
      <div class="jr"><h1 class="h1 nm">QR-Code scannen, Teamnamen eintragen</h1>
        <p class="soft">${room ? 'Oder die Adresse öffnen und den Code eingeben.' : 'Gleiches WLAN wie der Quiz-Laptop.'} Mehrere Handys pro Team? Einfach dem Team beitreten.</p>
        <div class="jcount">${count}</div>
        <div class="jteams">${teams.map((t) => rv('t' + t.id, `<span class="jt" style="--tc:${t.color}"><i></i>${esc(t.name)}${t.members > 1 ? `<small>${t.members}</small>` : ''}</span>`, 'inl fly')).join('') || '<span class="muted it">Noch niemand angemeldet …</span>'}</div>
        <div class="ideas"><b>Ideen:</b> ${quiz.intro.teamIdeas.slice(0, 4).map(esc).join('  ·  ')}</div></div></div>`;
  };

  S.rules = ({ quiz }) => hdr('02', 'SPIELREGELN', 'kurz & knapp') + `<div class="g2">${[
    ['list', `${quiz.questions.length} Fragen in ${quiz.rounds.length} ${quiz.rounds.length === 1 ? 'Runde' : 'Runden'}`, 'Nach jeder Frage folgt die Lösung, nach jeder Runde ein Zwischenstand.'],
    ['users', 'Ein Team, eine Antwort', 'Einigt euch gemeinsam. Eine Person schreibt die Antwort auf den Zettel.'],
    ['clock', 'Die Uhr läuft mit', 'Unten läuft ein Zeitbalken – auch auf euren Handys. Ist er leer: Zettel abgeben.'],
    ['mobile', 'Handy weg – bis zum Finale', 'Angemeldet seid ihr. Im Buzzer-Finale weckt es euch. Googeln gilt als Cyberangriff.'],
  ].map((r) => `<div class="rcard"><span class="circ sky">${icon(r[0])}</span><b>${r[1]}</b><p>${r[2]}</p></div>`).join('')}</div>`;

  S.points = () => hdr('03', 'PUNKTE', 'so wird gezählt') + `<h1 class="h1">Wer wie viele Punkte bekommt</h1><div class="ptab">${[
    ['1', 'Normale Frage', 'richtige Antwort'], ['+1', 'Bonusfrage', 'nur nach richtiger Hauptantwort'],
    ['2 / 1', 'Schätzfrage', 'nächstes Team / zweitnächstes Team'], ['2', 'Reihenfolge', 'nur komplett richtig'],
    ['1–3', 'Buzzer-Finale', 'Kartenwert, bei falscher Antwort −1'],
  ].map((r) => `<div class="prow"><span class="pv">${r[0]}</span><b>${r[1]}</b><span>${r[2]}</span></div>`).join('')}</div>`;

  S.go = () => `<div class="center-wrap"><img class="cheers sm" src="img/cheers.png" alt=""><div class="huge">Let’s Go!</div><div class="sky b tsub2">Runde 1 beginnt</div></div>`;

  S.div = ({ quiz, item }) => {
    const r = quiz.rounds.find((x) => x.no === item.round);
    const qs = quiz.questions.filter((q) => q.round === r.no);
    const range = `FRAGEN ${qs[0] ? qs[0].no : ''}–${qs.length ? qs[qs.length - 1].no : ''}`;
    const tick = `+++ RUNDE ${r.no}: ${esc(r.name).toUpperCase()} +++ ${range} +++ ${esc(r.sub)} `;
    return `<div class="divw" data-k="div${r.no}"><div class="bn"><span class="bn-tag">BREAKING NEWS</span><div class="bn-tick"><span>${tick.repeat(4)}</span></div></div>
      <div class="dl"><div class="rk">RUNDE ${r.no}</div><div class="rname">${esc(r.name)}</div><div class="rsub">${esc(r.sub)}</div>
      <span class="chip cat lg">${range}  ·  ${qs.length} FRAGEN</span></div><div class="dnum">${r.no}</div></div>`;
  };

  function qHeader(q, quiz, sol) {
    return hdr(pad2(q.no), sol ? 'LÖSUNG' : 'FRAGE', `von ${quiz.questions.length}`, [{ t: q.cat, k: 'cat' }, { t: ptsTxt(q.pts || 1), k: 'pts' }]);
  }

  S.q = ({ quiz, item }) => {
    const q = window.Flow.question(quiz, item.no);
    if (!q) return '';
    let body = '';
    if (q.type === 'img') {
      body = `<div class="imgq"><div><h1 class="qt q-m">${esc(q.q)}</h1>${optStack(q, 'q')}</div><img src="${esc(q.img || 'img/bnd.png')}" alt=""></div>`;
      return qHeader(q, quiz) + body + timer();
    }
    body = `<h1 class="qt ${qsize(q.q)}">${esc(q.q)}</h1>`;
    if (q.type === 'mc' || q.type === 'tf') body += optGrid(q, 'q');
    else if (q.type === 'order') body += `<div class="order">${q.items.map((it, i) => `<div class="otile"><span class="let lg">${LET[i]}</span><b>${esc(it.t)}</b></div>`).join('')}</div>`;
    else {
      const hint = q.type === 'est' ? `<div class="ybox">${icon('pen')}<div><b>SCHÄTZFRAGE</b><span>${esc(q.unit || 'Zahl notieren')} – das nächste Team bekommt 2 Punkte, das zweitnächste 1.</span></div></div>`
        : `<div class="ybox">${icon('pen')}<div><b>EURE ANTWORT</b><span>Gemeinsam einigen, aufschreiben, abgeben.</span></div></div>`;
      body += hint;
      if (q.bonusQ) body += bonusBar(q, false);
    }
    return qHeader(q, quiz) + body + timer();
  };

  S.a = ({ quiz, item, state }) => {
    const q = window.Flow.question(quiz, item.no);
    if (!q) return '';
    const st = state.step;
    const bonusStep = q.bonusQ ? 2 : 99;
    const factStep = 1 + (q.bonusQ ? 1 : 0) + 1;
    let body = `<div class="qsmall">${esc(q.q)}</div>`;
    if (q.type === 'img') {
      body += `<div class="imgq a"><div>${optStack(q, st >= 1 ? 'a1' : 'a0')}</div><img src="${esc(q.img || 'img/bnd.png')}" alt=""></div>`;
    } else if (q.type === 'mc' || q.type === 'tf') {
      body += optGrid(q, st >= 1 ? 'a1' : 'a0');
    } else if (q.type === 'order') {
      body += `<div class="order sm">${q.items.map((it, i) => `<div class="otile sm"><span class="let">${LET[i]}</span><b>${esc(it.t)}</b></div>`).join('')}</div>`;
      if (st >= 1) body += rva('ord', `<div class="order res">${q.orderIdx.map((ix, k) => `<div class="otile ok"><span class="rank">${k + 1}</span><b>${esc(q.items[ix].t)}</b><small>${esc(q.items[ix].y)}</small><em>${LET[ix]}</em></div>`).join('')}</div>`);
      else body += `<div class="order res ghost"></div>`;
    } else {
      body += st >= 1 ? rva('ans', answerCard(q.answer)) : `<div class="ans ghost"><b>LÖSUNG</b><strong>?</strong></div>`;
      if (q.bonusQ) body += st >= bonusStep ? rva('bon', bonusBar(q, true)) : bonusBar(q, false);
    }
    if (q.fact) body += st >= factStep ? rva('fact', fact(q.fact)) : '';
    return qHeader(q, quiz, true) + `<div class="aslide">${body}</div>`;
  };

  // Zwischenstand: Balken starten beim Stand der Vorrunde und ziehen um (screen.js spielt die Bewegung ab)
  function bars(list, prevList) {
    const m = Math.max(1, list[0].pts, prevList ? prevList[0].pts : 0);
    const w = (p) => Math.max(2, (Math.max(0, p) / m) * 100);
    return `<div class="bars ${list.length > 7 ? 'tight' : ''}" data-flip="1">${list.map((e, i) => {
      const pi = prevList ? prevList.findIndex((x) => x.id === e.id) : i;
      const pe = prevList ? prevList[pi] : null;
      const d = pe ? pe.rank - e.rank : 0;
      const mv = d > 0 ? `<span class="mv up">▲${d}</span>` : d < 0 ? `<span class="mv down">▼${-d}</span>` : prevList ? '<span class="mv same">=</span>' : '';
      return `<div class="bar" data-k="b${e.id}" data-from="${pi}" data-to="${i}"><span class="brk">${e.rank}</span><span class="bnm">${esc(e.name)}</span>
        <div class="btrack"><i style="--from:${pe ? w(pe.pts) : 0}%;--to:${w(e.pts)}%;--tc:${e.color}"></i></div>${mv}<span class="bpt">${e.pts}</span></div>`;
    }).join('')}</div>`;
  }
  S.score = ({ quiz, state, item }) => {
    const list = window.Flow.ranking(state, quiz, item.round);
    const prevList = item.round > 1 ? window.Flow.ranking(state, quiz, item.round - 1) : null;
    return hdr('R' + item.round, 'PUNKTETAFEL', 'Zwischenstand') + `<h1 class="h1">Zwischenstand nach Runde ${item.round}</h1>` +
      (list.length ? bars(list, prevList) : '<p class="muted it">Noch keine Teams angemeldet.</p>');
  };

  S.buzzintro = () => hdr('04', 'BUZZER', 'das Finale') + `<h1 class="h1">Jetzt wird gebuzzert – auf euren Handys</h1>
    <p class="lead">Vier Kategorien, je drei Karten mit steigendem Wert. Wer zuerst buzzert, antwortet.</p><div class="g2 sm">${[
    ['hand', 'Erst nach „Frei!“', 'Wer zu früh drückt, ist für diese Karte raus.'],
    ['check', 'Richtig', 'Es gibt den Kartenwert: 1, 2 oder 3 Punkte.'],
    ['minus', 'Falsch', '1 Punkt Abzug, das nächste Team in der Reihe darf.'],
    ['flag', 'Wer wählt?', 'Das letzte Team der Wertung wählt zuerst, dann reihum.'],
  ].map((r) => `<div class="rcard row"><span class="circ sky">${icon(r[0])}</span><div><b>${r[1]}</b><p>${r[2]}</p></div></div>`).join('')}</div>`;

  function boardGrid(quiz, state) {
    // Symbol: eigenes, sonst passend zum Schlüssel oder zum Kartentyp
    const sym = (c) => [c.icon, c.key, { who: 'who', tf: 'myth' }[(c.cards[0] || {}).type]].find((k) => k && k in window.ICONS) || 'bolt';
    // Mehr als 3 Karten je Spalte: kleiner setzen. Alle Karten gleich viel wert (z. B. Lightning Round): fortlaufend nummerieren.
    const all = quiz.buzzer.flatMap((c) => c.cards);
    const same = all.length > 1 && all.every((cd) => cd.pts === all[0].pts);
    const rows = Math.max(0, ...quiz.buzzer.map((c) => c.cards.length));
    let seq = 0;
    return `<div class="board ${rows > 3 ? 'compact' : ''}" style="grid-template-columns:repeat(${Math.max(1, quiz.buzzer.length)}, 1fr)">${quiz.buzzer.map((c) => `<div class="bcol"><div class="bhead"><span class="circ mag">${icon(sym(c))}</span><b>${esc(c.name)}</b></div>
      ${c.cards.map((cd, i) => {
        const key = `b:${c.key}:${i}`;
        const u = state.used[key];
        seq++;
        if (u) return `<div class="bcard used" data-card="${key}"><span>${u.team ? icon('check') : '–'}</span><small>${u.team ? esc(window.C.teamName(state, u.team)) : 'niemand'}</small></div>`;
        return same ? `<div class="bcard" data-card="${key}"><b>${seq}</b><small>${cd.pts} ${cd.pts === 1 ? 'PUNKT' : 'PUNKTE'}</small></div>`
          : `<div class="bcard" data-card="${key}"><b>${cd.pts}</b><small>${cd.pts === 1 ? 'PUNKT' : 'PUNKTE'}</small></div>`;
      }).join('')}</div>`).join('')}</div>`;
  }
  function miniScore(quiz, state) {
    const list = window.Flow.ranking(state, quiz);
    return `<div class="mini">${list.map((e) => `<span style="--tc:${e.color}"><i></i>${esc(e.name)} <b>${e.pts}</b></span>`).join('')}</div>`;
  }
  S.board = ({ quiz, state }) => {
    const bz = state.buzz;
    const co = window.C.cardOf(quiz, bz.card);
    if (!co) return hdr('04', 'BUZZER', 'Kartenwahl') + `<h1 class="h1 nm">Wählt eine Karte</h1>` + boardGrid(quiz, state) + miniScore(quiz, state);
    const { cat, card } = co;
    let q = '';
    if (card.type === 'who') {
      q = `<h1 class="qt q-l">Wer bin ich?</h1><div class="hints">${card.hints.map((h, k) => (k < bz.hint ? rv('h' + k, `<div class="hint"><span class="circ sky sm">${k + 1}</span><span>${esc(h)}</span></div>`) : '<div class="hint ghost"></div>')).join('')}</div>`;
    } else if (card.type === 'tf') {
      q = `<div class="kick mag">MYTHOS ODER FAKT?</div><h1 class="qt ${qsize(card.q)}">„${esc(card.q)}“</h1>`;
    } else q = `<h1 class="qt ${qsize(card.q)}">${esc(card.q)}</h1>`;
    // Buzzer-Status
    let st = '';
    const wrong = (bz.wrong || []).map((id) => esc(window.C.teamName(state, id)));
    const early = (bz.early || []).map((id) => esc(window.C.teamName(state, id)));
    if (bz.reveal) {
      const win = bz.judged && bz.judged.ok ? bz.judged.team : null;
      st = rva('rev', `<div class="ans buzzans"><b>LÖSUNG</b><strong>${esc(card.answer)}</strong>${win ? `<span class="winner" style="--tc:${window.C.teamColor(state, win)}">+${card.pts} für ${esc(window.C.teamName(state, win))}</span>` : ''}</div>`);
    } else if (bz.queue.length) {
      const first = bz.queue[0];
      st = rva('q' + first.team, `<div class="bstat turn" style="--tc:${window.C.teamColor(state, first.team)}"><span class="pulse"></span><div><small>ES ANTWORTET</small><b>${esc(window.C.teamName(state, first.team))}</b></div>
        ${bz.queue.length > 1 ? `<div class="queue">danach: ${bz.queue.slice(1).map((x, i) => `${i + 2}. ${esc(window.C.teamName(state, x.team))}`).join(' · ')}</div>` : ''}</div>`);
    } else if (bz.open) {
      st = rva('open', `<div class="bstat open">${icon('bell')}<b>FREI! Jetzt buzzern!</b></div>`);
    } else {
      st = `<div class="bstat wait">${icon('hand')}<b>Noch nicht drücken – wartet auf „Frei!“</b></div>`;
    }
    const outl = !bz.reveal && (wrong.length || early.length) ? `<div class="outl">${wrong.length ? `<span>Falsch: ${wrong.join(', ')}</span>` : ''}${early.length ? `<span>Zu früh: ${early.join(', ')}</span>` : ''}</div>` : '';
    return hdr('04', 'BUZZER', cat.name, [{ t: ptsTxt(card.pts), k: 'pts mag' }]) + `<div class="bq">${q}</div>` + st + outl;
  };

  const tieLine = (quiz, state) => window.Flow.podiumTies(state, quiz, { raw: true })
    .map((g) => `<span class="tieg">Platz ${g.rank}: ${g.teams.map((e) => `<i style="--tc:${e.color}"></i>${esc(e.name)}`).join(' <em>vs.</em> ')}</span>`).join('');
  S.tie_q = ({ quiz, state }) => hdr('05', 'STECHFRAGE', 'Gleichstand auf dem Podest', [{ t: 'SCHÄTZEN', k: 'cat' }]) + `<div class="ties">${tieLine(quiz, state)}</div><h1 class="qt ${qsize(quiz.tiebreak.q)} tieq">${esc(quiz.tiebreak.q)}</h1>
    <div class="ybox">${icon('pen')}<div><b>VERDECKT SCHÄTZEN</b><span>Die nächste Zahl gewinnt.</span></div></div>` + timer();
  S.tie_a = ({ quiz, state }) => hdr('05', 'STECHFRAGE', 'Lösung') + `<div class="qsmall">${esc(quiz.tiebreak.q)}</div>` +
    (state.step >= 1 ? rva('ta', answerCard(quiz.tiebreak.answer)) : '<div class="ans ghost"><b>LÖSUNG</b><strong>?</strong></div>') + (state.step >= 2 && quiz.tiebreak.fact ? rva('tf', fact(quiz.tiebreak.fact)) : '');

  S.final = ({ quiz, state }) => {
    const list = window.Flow.ranking(state, quiz);
    const n = list.length;
    const shown = state.step; // von hinten aufdecken
    // Countdown vor dem ersten Aufdecken; Platz 1 kommt erst nach dem Trommelwirbel
    const cd = shown === 0 && n ? `<div class="cdown" data-k="cd"><span>3</span><span>2</span><span>1</span></div>` : '';
    return hdr('06', 'ENDSTAND', 'der Moment der Wahrheit') + `<h1 class="h1">Der Endstand</h1><div class="final ${n > 7 ? 'tight' : ''}">${list.map((e, i) => {
      const vis = i >= n - shown;
      const ghost = `<div class="frow ghost"><span class="frk">${e.rank}</span><b>?</b></div>`;
      if (!vis) return ghost;
      const tb = e.tp !== Infinity && list.some((x) => x !== e && x.pts === e.pts) ? '<em class="stb">STECHFRAGE</em>' : '';
      const row = `<div class="frow ${e.rank === 1 ? 'gold' : ''}" style="--tc:${e.color}"><span class="frk">${e.rank}</span><i></i><b>${esc(e.name)}</b>${tb}<span class="fpt">${e.pts}<small> Punkte</small></span></div>`;
      return e.rank === 1 ? `<div class="susw">${ghost.replace('frow ghost', 'frow ghost drum')}${rv('f' + e.id, row, 'sus')}</div>` : rv('f' + e.id, row);
    }).join('')}</div>${cd}`;
  };

  S.ceremony = ({ quiz, state }) => {
    const list = window.Flow.ranking(state, quiz);
    // Gruppen nach Rang (Gleichstand = gemeinsamer Platz)
    const groups = [];
    list.forEach((e) => { const g = groups.find((x) => x.rank === e.rank); if (g) g.names.push(e.name); else groups.push({ rank: e.rank, names: [e.name] }); });
    const aw = quiz.intro.awards;
    const col = (gi, award, ic, cls, h, stepNeed) => {
      const g = groups[gi];
      const place = g ? g.rank : gi + 1;
      const ghost = `<div class="pod ghost" style="height:${h}px"><small>PLATZ ${place}</small></div>`;
      if (state.step < stepNeed) return ghost;
      const pod = rv('c' + gi, `<div class="pod ${cls}" style="height:${h}px"><span class="circ ${cls === 'first' ? 'white' : 'sky'}">${icon(ic)}</span><small>PLATZ ${place}</small><b>${g ? g.names.map(esc).join(' &amp; ') : '–'}</b><em>${esc(award)}</em></div>`, cls === 'first' ? 'rise sus' : 'rise');
      return cls === 'first' ? `<div class="susw">${ghost.replace('pod ghost', 'pod ghost drum')}${pod}</div>` : pod;
    };
    const last = list.length ? list[list.length - 1] : null;
    return hdr('07', 'SIEGEREHRUNG', 'und die Preise gehen an') + `<div class="podium">
      ${col(1, aw.second, 'medal', 'second', 350, 2)}${col(0, aw.first, 'trophy', 'first', 440, 3)}${col(2, aw.third, 'star', 'third', 310, 1)}</div>
      ${state.step >= 4 ? rva('sp', `<div class="special"><b>SONDERPREIS</b><span>${esc(aw.special)}${last && groups.length > 3 ? ` – <strong>${esc(last.name)}</strong>` : ''}</span></div>`) : ''}`;
  };

  // Danke-Folie; mit eigenem Bild (z. B. QR-Code) steht es groß rechts neben dem Text
  S.thanks = ({ quiz }) => {
    const o = quiz.intro.outro;
    if (o.img) return `<div class="thanks-img"><div class="ti-text"><div class="huge">${esc(o.title)}</div><div class="sky b tsub2">${esc(o.sub)}</div><div class="soft tsub3">${esc(o.meta)}</div></div><img src="${esc(o.img)}" alt=""></div>`;
    return `<div class="center-wrap"><img class="cheers sm" src="img/cheers.png" alt=""><div class="huge">${esc(o.title)}</div><div class="sky b tsub2">${esc(o.sub)}</div><div class="soft tsub3">${esc(o.meta)}</div></div>`;
  };

  S.spare = ({ quiz, item, state }) => {
    const sp = quiz.spare[item.idx];
    return hdr('E' + (item.idx + 1), 'ERSATZFRAGE', 'falls Zeit übrig', [{ t: sp.cat, k: 'cat' }]) + `<h1 class="qt q-l">${esc(sp.q)}</h1>` +
      `<div class="spare">${state.step >= 1 ? rva('sa', answerCard(sp.answer)) : ''}</div>` + (state.step >= 2 ? rva('sf', fact(sp.fact)) : '');
  };

  // ---------- Overlays über jeder Folie ----------
  // Punkte-Pflicht: dezenter Hinweis, solange die Moderation noch einträgt
  function gate({ quiz, state }) {
    if (!state.gate) return '';
    const m = window.Flow.missingScores(state, quiz, state.gate.round);
    if (!m.missing.length) return `<div class="gate ok">${icon('check')} Punkte komplett – weiter mit →</div>`;
    return `<div class="gate"><span class="dots"><i></i><i></i><i></i></span>Moderation trägt noch Punkte ein … (${m.teamsDone}/${m.teams} Teams)</div>`;
  }
  function pause({ quiz, state }) {
    if (!state.pause) return '';
    const list = window.Flow.ranking(state, quiz).slice(0, 6);
    return `<div class="pausew"><div class="pk">PAUSE</div><div class="ph1">Getränke holen!</div><div class="pcount" id="pcount"></div>
      <div class="pmini">${list.map((e) => `<span style="--tc:${e.color}"><em>${e.rank}.</em><i></i>${esc(e.name)} <b>${e.pts}</b></span>`).join('')}</div></div>`;
  }

  const TITLE_BG = new Set(['title', 'go', 'thanks', 'div']);
  function slide(ctx) {
    const item = ctx.flow[ctx.state.slide];
    const fn = S[item.type];
    const html = fn ? fn(Object.assign({ item }, ctx)) : '';
    const foot = TITLE_BG.has(item.type) && item.type !== 'div' ? '' : '';
    return { html: html + foot, bg: TITLE_BG.has(item.type) ? 'title' : 'content', type: item.type };
  }
  window.Render = { slide, gate, pause };
})();
