// Spiellogik des Quiz. Läuft lokal im Node-Server und online im Browser der Moderation (Firebase).
// Jede Funktion bekommt das Spiel G = { state, quiz, flow, now() } und ändert G.state (bzw. G.quiz/G.flow).
(function (root) {
  const Flow = typeof module !== 'undefined' && module.exports ? require('./flow.js') : root.Flow;
  const TEAM_COLORS = ['#F04DB8', '#4FB3F0', '#FFC93C', '#7BE0A6', '#B98CFF', '#FF8A5B', '#5EEAD4', '#F9A8D4', '#A3E635', '#FCA5A5'];

  function newId() {
    const b = new Uint8Array(4);
    (globalThis.crypto || require('crypto').webcrypto).getRandomValues(b);
    return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  }
  const cleanName = (n) => String(n || '').replace(/\s+/g, ' ').trim().slice(0, 40);

  function freshState(teams) {
    return {
      slide: 0, step: 0,
      teams: teams || [], tokens: {},
      scores: {}, adjust: {},
      timer: { dur: 0, endsAt: null, left: null },
      buzz: { card: null, open: false, queue: [], out: [], early: [], reveal: false, hint: 1, wrong: [] },
      used: {},
      gate: null, overrides: {}, // Punkte-Pflicht vor dem Zwischenstand
      tieOrder: [], // Ergebnis der Stechfrage: Team-IDs in Platzreihenfolge
      pause: null, ping: 0,
      settings: { phoneScores: true, joinOpen: true, joinHost: '', mirrorQuestions: false, expectedTeams: 6, volume: 0.8, muted: false },
    };
  }
  function loadState(raw) {
    const s = Object.assign(freshState(), raw || {});
    s.settings = Object.assign(freshState().settings, s.settings || {});
    s.overrides = s.overrides || {}; s.tieOrder = s.tieOrder || [];
    s.buzz = Object.assign(freshState().buzz, s.buzz || {});
    return s;
  }

  // ---------- Was die Handys sehen dürfen (nie Lösungen vor dem Aufdecken) ----------
  function publicState(G) {
    const { state, quiz, flow } = G;
    const item = flow[state.slide] || {};
    const slide = { type: item.type, label: item.label, idx: state.slide, step: state.step };
    const mirror = state.settings.mirrorQuestions; // Fragen nur auf Wunsch aufs Handy
    if (mirror && (item.type === 'q' || item.type === 'a')) {
      const q = Flow.question(quiz, item.no);
      if (q) {
        Object.assign(slide, { no: q.no, cat: q.cat, qtype: q.type, q: q.q, opts: q.opts, items: (q.items || []).map((x) => x.t), unit: q.unit, bonusQ: q.bonusQ, pts: q.pts, bonus: q.bonus, total: quiz.questions.length });
        if (item.type === 'a' && state.step >= 1) Object.assign(slide, { answer: q.answer || (q.opts ? q.opts[q.correct] : q.answerLetters), correct: q.correct });
      }
    }
    if (item.type === 'div') { const r = quiz.rounds.find((x) => x.no === item.round); if (r) Object.assign(slide, { round: r.no, name: r.name }); }
    if (item.type === 'tie_q' || item.type === 'tie_a') slide.q = quiz.tiebreak && quiz.tiebreak.q;
    const b = state.buzz;
    let card = null;
    if (b.card) {
      const cd = cardInfo(G, b.card); const cat = quiz.buzzer.find((c) => c.key === b.card.split(':')[1]);
      if (cd) card = { cat: cat.name, pts: cd.pts, type: cd.type, q: cd.q, hints: cd.hints ? cd.hints.slice(0, b.hint) : null, answer: b.reveal ? cd.answer : null };
    }
    const showScores = state.settings.phoneScores && !['final', 'ceremony'].includes(item.type);
    const rk = Flow.ranking(state, quiz);
    // Siegerehrung: welche Plätze schon aufgedeckt sind (für die Gewinner-Animation auf dem Handy)
    const podium = [];
    if (item.type === 'ceremony') {
      const groups = [];
      rk.forEach((e) => { const g = groups.find((x) => x.rank === e.rank); if (g) g.ids.push(e.id); else groups.push({ rank: e.rank, ids: [e.id] }); });
      const aw = quiz.intro.awards || {};
      [[2, 1, aw.third], [1, 2, aw.second], [0, 3, aw.first]].forEach(([gi, need, award]) => {
        if (state.step >= need && groups[gi]) groups[gi].ids.forEach((id) => podium.push({ team: id, place: groups[gi].rank, award }));
      });
      const last = rk[rk.length - 1];
      if (state.step >= 4 && last && groups.length > 3) podium.push({ team: last.id, place: last.rank, award: aw.special, special: true });
    }
    return {
      slide, mirror, podium,
      pause: state.pause,
      timer: state.timer,
      teams: state.teams.map((t) => {
        const e = rk.find((r) => r.id === t.id) || {};
        return { id: t.id, name: t.name, color: t.color, pts: showScores ? e.pts : null, rank: showScores ? e.rank : null, members: t.members || 0 };
      }),
      buzz: { card, open: b.open, queue: b.queue, out: b.out, early: b.early, wrong: b.wrong, reveal: b.reveal, judged: b.judged || null },
      joinOpen: state.settings.joinOpen,
      phoneScores: showScores,
    };
  }

  // ---------- Hilfen ----------
  const clampSlide = (G, i) => Math.max(0, Math.min(G.flow.length - 1, i));
  const curMax = (G) => Flow.maxStep(G.quiz, G.flow[G.state.slide], G.state.teams.length);
  function cardInfo(G, key) {
    const [, ck, ci] = key.split(':');
    const cat = G.quiz.buzzer.find((c) => c.key === ck);
    return cat && cat.cards[Number(ci)];
  }
  const teamExists = (G, id) => G.state.teams.some((t) => t.id === id);
  // Zwischenstand erst, wenn alle Punkte der Runde eingetragen sind (oder die Moderation freigibt)
  function gateAt(G, n) {
    const it = G.flow[n]; const st = G.state;
    if (!it || it.type !== 'score' || st.overrides[it.round] || !st.teams.length) return null;
    return Flow.missingScores(st, G.quiz, it.round).missing.length ? it : null;
  }
  function advanceTo(G, n) {
    const g = gateAt(G, n);
    if (g) { G.state.gate = { round: g.round, to: n }; return; }
    goSlide(G, n);
  }
  function goSlide(G, i, stepAtEnd) {
    const st = G.state;
    const n = clampSlide(G, i);
    st.gate = null;
    if (n !== st.slide) {
      st.timer = { dur: 0, endsAt: null, left: null };
      st.buzz.card = null; st.buzz.open = false;
    }
    st.slide = n;
    st.step = stepAtEnd ? curMax(G) : 0;
    const it = G.flow[n];
    if (it.type === 'q') { const q = Flow.question(G.quiz, it.no); st.timer = { dur: (q && q.time) || 60, endsAt: null, left: (q && q.time) || 60 }; }
    if (it.type === 'tie_q') st.timer = { dur: 45, endsAt: null, left: 45 };
  }
  function resetBuzz(G, card) {
    G.state.buzz = { card, open: false, queue: [], out: [], early: [], reveal: false, hint: 1, wrong: [], judged: null };
  }
  function addTeam(G, name) {
    const st = G.state;
    const used = new Set(st.teams.map((t) => t.color));
    const color = TEAM_COLORS.find((c) => !used.has(c)) || TEAM_COLORS[st.teams.length % TEAM_COLORS.length];
    const t = { id: newId(), name, color, members: 0 };
    st.teams.push(t);
    return t;
  }

  // ---------- Aktionen der Moderation ----------
  const host = {
    next(G) {
      const st = G.state; const it = G.flow[st.slide];
      if (it.type === 'board' && st.buzz.card) { // im Buzzer: erst Hinweise, dann Lösung
        const cd = cardInfo(G, st.buzz.card);
        if (cd && cd.hints && st.buzz.hint < cd.hints.length && !st.buzz.reveal) { st.buzz.hint++; return; }
        if (!st.buzz.reveal) { st.buzz.reveal = true; st.buzz.open = false; return; }
        st.buzz.card = null; st.buzz.open = false; return;
      }
      if (st.step < curMax(G)) st.step++; else advanceTo(G, Flow.stepIndex(G.flow, st, G.quiz, st.slide, 1));
    },
    prev(G) {
      const st = G.state;
      if (st.gate) { st.gate = null; return; }
      if (G.flow[st.slide].type === 'board' && st.buzz.card) { st.buzz.card = null; st.buzz.open = false; return; }
      if (st.step > 0) st.step--; else goSlide(G, Flow.stepIndex(G.flow, st, G.quiz, st.slide, -1), true);
    },
    goto(G, b) { advanceTo(G, clampSlide(G, Number(b.to) || 0)); },
    // Punkte-Pflicht: fehlende Felder der Runde als 0 eintragen bzw. trotzdem zum Zwischenstand
    fillZero(G, b) {
      Flow.missingScores(G.state, G.quiz, Number(b.round)).missing.forEach((m) => {
        const k = 'q' + m.no; G.state.scores[k] = G.state.scores[k] || {};
        m.teams.forEach((id) => { G.state.scores[k][id] = 0; });
      });
    },
    override(G, b) {
      const st = G.state; const r = Number(b.round);
      st.overrides[r] = true;
      if (st.gate && st.gate.round === r) goSlide(G, st.gate.to);
    },
    // Stechfrage: Moderation tippt die Teams in Platzreihenfolge an
    tiePick(G, b) { if (teamExists(G, b.team) && !G.state.tieOrder.includes(b.team)) G.state.tieOrder.push(b.team); },
    tieReset(G) { G.state.tieOrder = []; },
    // Pause: ohne min = an/aus (10 min), mit min = starten bzw. verlängern
    pause(G, b) {
      const st = G.state; const min = Number(b.min) || 0;
      if (!min) { st.pause = st.pause ? null : { until: G.now() + 10 * 60000 }; return; }
      st.pause = { until: Math.max(G.now(), st.pause ? st.pause.until : 0) + min * 60000 };
    },
    ping(G) { G.state.ping = G.now(); },
    step(G, b) { G.state.step = Math.max(0, Math.min(curMax(G), Number(b.step) || 0)); },
    timer(G, b) {
      const t = G.state.timer; const now = G.now();
      const left = () => (t.endsAt ? Math.max(0, (t.endsAt - now) / 1000) : (t.left == null ? t.dur : t.left));
      if (b.cmd === 'start') { const l = left() > 0 ? left() : (t.dur || 60); t.endsAt = now + l * 1000; t.left = null; if (!t.dur) t.dur = l; }
      else if (b.cmd === 'pause') { t.left = left(); t.endsAt = null; }
      else if (b.cmd === 'reset') { t.endsAt = null; t.left = t.dur || 60; }
      else if (b.cmd === 'add') { const s = Number(b.sec) || 15; if (t.endsAt) t.endsAt += s * 1000; else t.left = left() + s; t.dur = Math.max(t.dur, left()); }
      else if (b.cmd === 'set') { const s = Number(b.sec) || 60; t.dur = s; t.left = s; t.endsAt = null; }
    },
    score(G, b) {
      if (!teamExists(G, b.team)) throw new Error('Team unbekannt');
      const sc = G.state.scores; sc[b.key] = sc[b.key] || {};
      if (b.value === null || b.value === undefined || b.value === '') delete sc[b.key][b.team];
      else sc[b.key][b.team] = Number(b.value);
    },
    adjust(G, b) {
      if (!teamExists(G, b.team)) throw new Error('Team unbekannt');
      G.state.adjust[b.team] = (Number(G.state.adjust[b.team]) || 0) + (Number(b.delta) || 0);
    },
    addTeam(G, b) { const n = cleanName(b.name); if (!n) throw new Error('Name fehlt'); addTeam(G, n); },
    renameTeam(G, b) { const t = G.state.teams.find((x) => x.id === b.id); const n = cleanName(b.name); if (t && n) t.name = n; },
    removeTeam(G, b) {
      const st = G.state;
      st.teams = st.teams.filter((t) => t.id !== b.id);
      Object.keys(st.tokens).forEach((k) => { if (st.tokens[k] === b.id) delete st.tokens[k]; });
    },
    settings(G, b) {
      const s = G.state.settings;
      ['phoneScores', 'joinOpen', 'mirrorQuestions', 'muted'].forEach((k) => { if (k in b) s[k] = !!b[k]; });
      if ('joinHost' in b) s.joinHost = String(b.joinHost || '').trim();
      if ('volume' in b) s.volume = Math.max(0, Math.min(1, Number(b.volume) || 0));
      if ('expectedTeams' in b) s.expectedTeams = Math.max(1, Math.min(30, Math.round(Number(b.expectedTeams) || 6)));
    },
    // Buzzer
    card(G, b) {
      const bi = G.flow.findIndex((f) => f.type === 'board');
      if (G.state.slide !== bi) goSlide(G, bi);
      resetBuzz(G, b.card || null);
    },
    buzzOpen(G) { if (G.state.buzz.card) { G.state.buzz.open = true; G.state.buzz.openAt = G.now(); } },
    buzzClose(G) { G.state.buzz.open = false; },
    unlock(G, b) { const bz = G.state.buzz; bz.out = bz.out.filter((x) => x !== b.team); bz.early = bz.early.filter((x) => x !== b.team); },
    judge(G, b) {
      const st = G.state; const bz = st.buzz;
      if (!bz.card || !bz.queue.length) return;
      const team = bz.queue[0].team;
      const cd = cardInfo(G, bz.card);
      st.scores[bz.card] = st.scores[bz.card] || {};
      if (b.ok) {
        st.scores[bz.card][team] = (st.scores[bz.card][team] || 0) + cd.pts;
        bz.reveal = true; bz.open = false; bz.judged = { team, ok: true };
        st.used[bz.card] = { team };
      } else {
        st.scores[bz.card][team] = (st.scores[bz.card][team] || 0) - 1;
        bz.queue.shift(); bz.out.push(team); bz.wrong.push(team); bz.judged = { team, ok: false };
      }
    },
    revealCard(G) {
      const st = G.state; const bz = st.buzz; if (!bz.card) return;
      bz.reveal = true; bz.open = false;
      if (!st.used[bz.card]) st.used[bz.card] = { team: null };
    },
    hint(G, b) { const bz = G.state.buzz; const cd = bz.card && cardInfo(G, bz.card); if (cd && cd.hints) bz.hint = Math.max(1, Math.min(cd.hints.length, bz.hint + (Number(b.d) || 1))); },
    closeCard(G) { const st = G.state; const bz = st.buzz; if (bz.card && (bz.reveal || bz.judged) && !st.used[bz.card]) st.used[bz.card] = { team: null }; bz.card = null; bz.open = false; },
    freeCard(G, b) { delete G.state.used[b.card]; delete G.state.scores[b.card]; },
    reset(G, b) {
      const st = G.state; const keep = b && b.keepTeams;
      const teams = keep ? st.teams.map((t) => Object.assign({}, t)) : [];
      const tokens = keep ? st.tokens : {};
      const settings = st.settings;
      G.state = freshState(teams); G.state.tokens = tokens; G.state.settings = settings;
    },
    // Anderes Quiz übernehmen: mit reset neu beginnen (Teams bleiben), sonst Punkte mitnehmen
    useQuiz(G, b) {
      if (b.reset) { G.quiz = b.quiz; G.flow = Flow.buildFlow(G.quiz); host.reset(G, { keepTeams: true }); } else applyQuiz(G, b.quiz);
    },
  };

  // Neues Quiz übernehmen. Punkte und gespielte Karten hängen an der Frage bzw. Karte (über die ID),
  // damit Umsortieren mitten im Spiel nichts durcheinanderbringt.
  function applyQuiz(G, nq) {
    const st = G.state;
    const keyIds = (q) => {
      const m = {};
      q.questions.forEach((x) => { m['q' + x.no] = x.id; });
      q.buzzer.forEach((c) => c.cards.forEach((d, i) => { m[`b:${c.key}:${i}`] = d.id; }));
      return m;
    };
    const oldIds = keyIds(G.quiz);
    const newKeys = {}; Object.entries(keyIds(nq)).forEach(([k, id]) => { newKeys[id] = k; });
    const mapKey = (k) => (k.startsWith('q') || k.startsWith('b:') ? newKeys[oldIds[k]] : k);
    const remap = (obj) => { const o = {}; Object.entries(obj || {}).forEach(([k, v]) => { const n = mapKey(k); if (n) o[n] = v; }); return o; };
    st.scores = remap(st.scores); st.used = remap(st.used);
    if (st.buzz.card) st.buzz.card = mapKey(st.buzz.card) || null;
    // auf derselben Folie bleiben, auch wenn sie jetzt anders nummeriert ist
    const it = G.flow[st.slide] || {};
    const oq = (it.type === 'q' || it.type === 'a') ? Flow.question(G.quiz, it.no) : null;
    G.quiz = nq; G.flow = Flow.buildFlow(nq);
    let idx = -1;
    if (oq) { const nqq = nq.questions.find((x) => x.id === oq.id); if (nqq) idx = G.flow.findIndex((f) => f.type === it.type && f.no === nqq.no); }
    if (idx < 0) idx = G.flow.findIndex((f) => f.type === it.type && f.round === it.round && f.idx === it.idx);
    st.slide = idx >= 0 ? idx : clampSlide(G, st.slide);
    st.step = Math.min(st.step, curMax(G));
    st.gate = null;
  }

  // ---------- Aktionen der Handys ----------
  const team = {
    join(G, b) {
      const st = G.state;
      if (b.teamId) {
        const t = st.teams.find((x) => x.id === b.teamId);
        if (!t) throw new Error('Team nicht gefunden');
        t.members = (t.members || 0) + 1;
        const token = newId() + newId(); st.tokens[token] = t.id; return { token, teamId: t.id };
      }
      if (!st.settings.joinOpen) throw new Error('Die Anmeldung ist geschlossen. Fragt die Moderation.');
      const n = cleanName(b.name);
      if (n.length < 2) throw new Error('Bitte einen Teamnamen mit mindestens 2 Zeichen eingeben.');
      if (st.teams.find((x) => x.name.toLowerCase() === n.toLowerCase())) throw new Error('Den Namen gibt es schon. Tretet dem Team bei oder wählt einen anderen.');
      const t = addTeam(G, n); t.members = 1;
      const token = newId() + newId(); st.tokens[token] = t.id; return { token, teamId: t.id };
    },
    rename(G, b, t) { const n = cleanName(b.name); if (n.length < 2) throw new Error('Name zu kurz'); if (!G.state.settings.joinOpen) throw new Error('Umbenennen ist nur während der Anmeldung möglich.'); t.name = n; },
    // at: Zeitpunkt des Drückens (online: Zeitstempel des Firebase-Servers) – entscheidet Reihenfolge und Fehlstart
    buzz(G, b, t) {
      const bz = G.state.buzz; const at = Number(b.at) || G.now();
      if (!bz.card || bz.reveal) return { status: 'idle' };
      if (bz.out.includes(t.id)) return { status: 'out' };
      if (bz.queue.some((q) => q.team === t.id)) return { status: 'queued' };
      if (!bz.open || (bz.openAt && at < bz.openAt)) { bz.out.push(t.id); bz.early.push(t.id); return { status: 'early' }; }
      bz.queue.push({ team: t.id, t: at });
      bz.queue.sort((x, y) => x.t - y.t);
      return { status: 'queued', pos: bz.queue.findIndex((q) => q.team === t.id) + 1 };
    },
    leave(G, b, t, token) { delete G.state.tokens[token]; t.members = Math.max(0, (t.members || 1) - 1); },
  };
  // Team zu einem Token (Handy) finden
  const teamOf = (G, token) => { const id = G.state.tokens[token]; return id && G.state.teams.find((t) => t.id === id); };

  const api = { freshState, loadState, publicState, host, team, teamOf, applyQuiz, newId, TEAM_COLORS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Engine = api;
})(this);
