// Ablauf des Quiz: wird von Server, Beamer, Moderation und Handys gemeinsam genutzt.
(function (root) {
  function buildFlow(quiz) {
    const f = [];
    const add = (o) => f.push(o);
    add({ type: 'title', label: 'Titel' });
    add({ type: 'eil', label: 'Eilmeldung' });
    add({ type: 'join', label: 'Teams anmelden (QR)' });
    add({ type: 'rules', label: 'Spielregeln' });
    add({ type: 'points', label: 'Punkte' });
    add({ type: 'go', label: 'Let’s Go!' });
    quiz.rounds.forEach((r) => {
      add({ type: 'div', round: r.no, label: `Runde ${r.no}: ${r.name}` });
      quiz.questions.filter((q) => q.round === r.no).forEach((q) => {
        add({ type: 'q', no: q.no, label: `Frage ${q.no}` });
        add({ type: 'a', no: q.no, label: `Lösung ${q.no}` });
      });
      add({ type: 'score', round: r.no, label: `Zwischenstand nach Runde ${r.no}` });
    });
    add({ type: 'buzzintro', label: 'Buzzer-Finale: Regeln' });
    add({ type: 'board', label: 'Buzzer-Finale: Kartenwahl' });
    add({ type: 'tie_q', label: 'Stechfrage' });
    add({ type: 'tie_a', label: 'Stechfrage: Lösung' });
    add({ type: 'final', label: 'Endstand' });
    add({ type: 'ceremony', label: 'Siegerehrung' });
    add({ type: 'thanks', label: 'Danke' });
    (quiz.spare || []).forEach((s, i) => add({ type: 'spare', idx: i, label: `Ersatzfrage ${i + 1}` }));
    return f;
  }

  function question(quiz, no) { return quiz.questions.find((q) => q.no === no); }

  function maxStep(quiz, item, teamCount) {
    switch (item.type) {
      case 'eil': return (quiz.intro.eil || []).length;
      case 'a': {
        const q = question(quiz, item.no);
        if (!q) return 0;
        return 1 + (q.bonusQ ? 1 : 0) + (q.fact ? 1 : 0);
      }
      case 'tie_a': return 2;
      case 'spare': return 2;
      case 'final': return Math.max(teamCount, 1);
      case 'ceremony': return 4;
      default: return 0;
    }
  }

  // Punkte, die eine Frage maximal bringt (für die Eingabe-Buttons)
  function maxPoints(q) { return (q.pts || 1) + (q.bonus || 0); }

  function cardKey(catKey, i) { return `b:${catKey}:${i}`; }

  function totals(state, quiz, uptoRound) {
    const t = {};
    state.teams.forEach((tm) => { t[tm.id] = 0; });
    const roundOf = {};
    quiz.questions.forEach((q) => { roundOf['q' + q.no] = q.round; });
    Object.entries(state.scores || {}).forEach(([key, per]) => {
      if (uptoRound) {
        if (key.startsWith('b:')) return;
        if (roundOf[key] && roundOf[key] > uptoRound) return;
      }
      Object.entries(per).forEach(([tid, v]) => { if (t[tid] !== undefined) t[tid] += Number(v) || 0; });
    });
    Object.entries(state.adjust || {}).forEach(([tid, v]) => { if (t[tid] !== undefined) t[tid] += Number(v) || 0; });
    return t;
  }

  // Rangliste. Gleiche Punkte = gleicher Platz, außer die Stechfrage (state.tieOrder) hat entschieden.
  function ranking(state, quiz, uptoRound, opt) {
    const t = totals(state, quiz, uptoRound);
    const order = !uptoRound && !(opt && opt.raw) ? state.tieOrder || [] : [];
    const tp = (id) => { const i = order.indexOf(id); return i < 0 ? Infinity : i; };
    const list = state.teams.map((tm) => ({ id: tm.id, name: tm.name, color: tm.color, pts: t[tm.id] || 0, tp: tp(tm.id) }));
    list.sort((a, b) => b.pts - a.pts || (a.tp === b.tp ? 0 : a.tp < b.tp ? -1 : 1) || a.name.localeCompare(b.name));
    let rank = 0, prev = null;
    list.forEach((e, i) => { const k = e.pts + '|' + e.tp; if (k !== prev) { rank = i + 1; prev = k; } e.rank = rank; });
    return list;
  }

  // Teams, die sich einen Podestplatz (1–3) teilen
  function podiumTies(state, quiz, opt) {
    const groups = {};
    ranking(state, quiz, null, opt).forEach((e) => { if (e.rank <= 3) (groups[e.rank] = groups[e.rank] || []).push(e); });
    return Object.keys(groups).map(Number).sort((a, b) => a - b).filter((r) => groups[r].length > 1).map((r) => ({ rank: r, teams: groups[r] }));
  }
  // Ob die Stechfrage gespielt wird, entscheidet der Stand ohne Stechfrage-Ergebnis
  const needsTiebreak = (state, quiz) => state.teams.length > 1 && podiumTies(state, quiz, { raw: true }).length > 0;

  // Punkte-Pflicht: welche Fragen einer Runde noch leere Felder haben. Leer heißt „nicht eingetragen“, nicht 0.
  function missingScores(state, quiz, round) {
    const done = new Set(state.teams.map((t) => t.id));
    const missing = [];
    quiz.questions.filter((q) => q.round === round).forEach((q) => {
      const sc = (state.scores || {})['q' + q.no] || {};
      const open = state.teams.filter((t) => sc[t.id] === undefined).map((t) => t.id);
      open.forEach((id) => done.delete(id));
      if (open.length) missing.push({ no: q.no, teams: open });
    });
    return { missing, teamsDone: done.size, teams: state.teams.length };
  }

  // Nächste/vorige Folie; die Stechfrage wird übersprungen, wenn es keinen Gleichstand auf dem Podest gibt
  const isTie = (it) => it && (it.type === 'tie_q' || it.type === 'tie_a');
  function stepIndex(flow, state, quiz, from, dir) {
    let j = from + dir;
    while (isTie(flow[j]) && !needsTiebreak(state, quiz)) j += dir;
    return Math.max(0, Math.min(flow.length - 1, j));
  }

  const api = { buildFlow, maxStep, question, maxPoints, cardKey, totals, ranking, podiumTies, needsTiebreak, missingScores, stepIndex };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Flow = api;
})(this);
