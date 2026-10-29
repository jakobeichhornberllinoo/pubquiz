// Quiz-Editor in der Moderation: Sets verwalten, alle Inhalte bearbeiten, Beamer-Vorschau
(function () {
  const { esc, icon } = window.C;
  const QM = window.QuizModel;
  const F = window.Flow;
  const LET = QM.LET;
  const ICON_CHOICES = [['', 'automatisch'], ['who', 'Agent'], ['myth', 'Masken'], ['cap', 'Karte'], ['cold', 'Geschichte'], ['bolt', 'Blitz'], ['flag', 'Flagge'], ['star', 'Stern'], ['trophy', 'Pokal'], ['users', 'Leute'], ['bell', 'Glocke'], ['crown', 'Krone']];

  let root = null;
  let sets = [], active = null, setId = null;
  let Q = null, saved = '', warnings = [], norm = null;
  let sel = { k: 'intro' };
  let view = 'q'; // Vorschau: Frage oder Lösung bzw. Intro-Folie
  let showWarn = false;
  let drag = null;
  let imp = null; // PowerPoint-Import: { sources, summary, status, title } – solange die Prüfansicht offen ist

  const api = (a, b) => window.C.host(a, b);
  const toast = (m, bad) => window.C.toast(m, bad);
  const dirty = () => Q && (imp ? true : JSON.stringify(Q) !== saved);

  // ---------- Prüfansicht nach dem PowerPoint-Import ----------
  function impKey(s) {
    if (s.k === 'q') return s.id;
    if (s.k === 'card') { const c = target(s); return c && c.id; }
    if (s.k === 'tie' || s.k === 'intro') return s.k;
    if (s.k === 'spare') return 'spare:' + s.i;
    return null;
  }
  const impSrc = (s) => { const k = impKey(s); return k && imp.sources[k]; };
  const impState = (s) => { const k = impKey(s); return !k || !imp.sources[k] ? 'ok' : imp.status[k] || 'open'; };
  function impBadge(s) {
    const st = impState(s); const src = impSrc(s);
    if (!impKey(s)) return '';
    if (st === 'ok') return '<i class="ib ok">✓</i>';
    if (st === 'skip') return '<i class="ib skip">✕</i>';
    return src && src.problems.length ? '<i class="ib warn">!</i>' : '<i class="ib open">○</i>';
  }
  function impItems() { // alle prüfbaren Einträge in Gliederungs-Reihenfolge
    const out = [{ k: 'intro' }];
    Q.rounds.forEach((r) => qsInRound(r.no).forEach((q) => out.push({ k: 'q', id: q.id })));
    Q.buzzer.forEach((c, ci) => c.cards.forEach((d, i) => out.push({ k: 'card', ci, i })));
    out.push({ k: 'tie' }); Q.spare.forEach((x, i) => out.push({ k: 'spare', i }));
    return out.filter((s) => impSrc(s));
  }
  const impCount = () => { const it = impItems(); return { all: it.length, ok: it.filter((s) => impState(s) === 'ok').length, skip: it.filter((s) => impState(s) === 'skip').length }; };
  function impNext() { const it = impItems(); const i = it.findIndex((s) => selStr(s) === selStr(sel)); const n = it.slice(i + 1).concat(it.slice(0, i + 1)).find((s) => impState(s) === 'open'); if (n) { sel = n; view = n.k === 'intro' ? 'title' : 'q'; } }
  function impBox() {
    const s = impSrc(sel); if (!s) return '';
    const st = impState(sel);
    return `<div class="impbox ${st}"><div class="imphead"><b>${st === 'ok' ? '✓ Bestätigt' : st === 'skip' ? '✕ Wird nicht übernommen' : s.problems.length ? '⚠ Bitte prüfen' : '○ Noch nicht bestätigt'}</b>
      <span>Folie ${s.slides.join(' + ') || '–'}</span></div>
      ${s.problems.map((p) => `<div class="wline">⚠ ${esc(p)}</div>`).join('')}
      <div class="bctl">${st !== 'ok' ? btn('impOk', '✓ Stimmt – bestätigen & weiter', 'pri') : ''}${st !== 'skip' ? btn('impSkip', 'Weglassen', 'ghost') : ''}${st !== 'open' ? btn('impOpen', 'Wieder öffnen', 'ghost') : ''}</div>
      <details><summary>Text der Folie${s.slides.length > 1 ? 'n' : ''} und Notizen</summary>${s.text.map((t) => `<div class="srcsl"><b>Folie ${t.n}</b>${t.lines.map((l) => `<div>${esc(l)}</div>`).join('')}</div>`).join('')}${s.notes.length ? `<div class="srcsl"><b>Notizen</b>${s.notes.map((l) => `<div>${esc(l)}</div>`).join('')}</div>` : ''}</details></div>`;
  }
  async function impFinish() {
    const c = impCount(); const open = c.all - c.ok - c.skip;
    if (!c.ok) return toast('Noch nichts bestätigt.', true);
    if (open && !confirm(`${open} Einträge sind noch nicht bestätigt und werden NICHT übernommen. Trotzdem anlegen?`)) return;
    const title = prompt('Name des neuen Quiz:', imp.title); if (!title) return;
    const q = JSON.parse(JSON.stringify(Q));
    const keep = (k) => !imp.sources[k] || imp.status[k] === 'ok';
    q.questions = q.questions.filter((x) => keep(x.id));
    q.buzzer.forEach((cat) => { cat.cards = cat.cards.filter((d) => keep(d.id)); });
    q.buzzer = q.buzzer.filter((cat) => cat.cards.length);
    q.spare = q.spare.filter((x, i) => keep('spare:' + i));
    if (!keep('tie')) q.tiebreak = { q: '', answer: '' };
    if (!keep('intro')) q.intro = QM.blank().intro;
    try {
      const r = await api('setImport', { text: JSON.stringify(q), format: 'json', title });
      imp = null; await loadSets(); await loadSet(r.id); render();
      toast(`Neues Set „${title}“ angelegt ✓`);
    } catch (e) { toast(e.message, true); }
  }
  async function impStart(file) {
    if (dirty() && !confirm('Ungespeicherte Änderungen gehen verloren. Weiter?')) return;
    toast('PowerPoint wird gelesen …');
    const bytes = new Uint8Array(await file.arrayBuffer());
    let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    try {
      const r = await api('pptxParse', { data: btoa(bin) });
      imp = { sources: r.sources, summary: r.summary, status: {}, title: file.name.replace(/\.pptx$/i, '') };
      Q = r.quiz; saved = ''; setId = null; sel = { k: 'intro' }; analyse(); impNext(); render();
      if (r.warnings.length) toast(r.warnings[0], true);
    } catch (e) { toast(e.message, true); }
  }
  const qsInRound = (no) => Q.questions.filter((q) => q.round === no);
  const qNo = (q) => { const n = norm && norm.questions.find((x) => x.id === q.id); return n ? n.no : '?'; };

  // ---------- Laden und Speichern ----------
  async function loadSets() { const r = await api('sets'); sets = r.sets; active = r.active; if (!setId || !sets.some((s) => s.id === setId)) setId = active; }
  async function loadSet(id) {
    const r = await api('setGet', { id });
    setId = id; Q = JSON.parse(JSON.stringify(r.quiz)); saved = JSON.stringify(Q); sel = { k: 'intro' }; analyse();
  }
  async function save() {
    try {
      const r = await api('saveQuiz', { id: setId, quiz: Q });
      Q = r.quiz; saved = JSON.stringify(Q); analyse();
      toast(r.warnings.length ? `Gespeichert – ${r.warnings.length} Hinweise` : 'Gespeichert ✓');
      await loadSets(); render();
    } catch (e) { toast(e.message, true); }
  }
  function analyse() { const r = QM.normalize(Q); norm = r.quiz; warnings = r.warnings; }
  const warnFor = (where) => warnings.filter((w) => w.where === where);
  function warnKey(s) {
    if (s.k === 'q') { const t = target(s); return t ? 'Frage ' + qNo(t) : ''; }
    if (s.k === 'card') return `Buzzer ${Q.buzzer[s.ci].name}, Karte ${s.i + 1}`;
    if (s.k === 'round') return 'Runde ' + (s.i + 1);
    if (s.k === 'cat') return 'Buzzer ' + Q.buzzer[s.i].name;
    if (s.k === 'tie') return 'Stechfrage';
    return '';
  }

  // ---------- Auswahl und Ziel des Formulars ----------
  function target(s) {
    s = s || sel;
    if (s.k === 'q') return Q.questions.find((q) => q.id === s.id);
    if (s.k === 'round') return Q.rounds[s.i];
    if (s.k === 'cat') return Q.buzzer[s.i];
    if (s.k === 'card') return Q.buzzer[s.ci] && Q.buzzer[s.ci].cards[s.i];
    if (s.k === 'tie') return Q.tiebreak;
    if (s.k === 'spare') return Q.spare[s.i];
    return Q;
  }
  const parseSel = (v) => { const [k, a, b] = v.split(':'); return k === 'q' ? { k, id: a } : k === 'card' ? { k, ci: Number(a), i: Number(b) } : a != null ? { k, i: Number(a) } : { k }; };
  const selStr = (s) => (s.k === 'q' ? 'q:' + s.id : s.k === 'card' ? `card:${s.ci}:${s.i}` : s.i != null ? `${s.k}:${s.i}` : s.k);
  function setPath(obj, p, v) { const ks = p.split('.'); let o = obj; ks.slice(0, -1).forEach((k) => { if (o[k] == null) o[k] = /^\d+$/.test(k) ? [] : {}; o = o[k]; }); o[ks[ks.length - 1]] = v; }
  function getPath(obj, p) { return p.split('.').reduce((o, k) => (o == null ? o : o[k]), obj); }

  // ---------- Struktur ändern ----------
  function renumberRounds(order) { // order: neue Reihenfolge der Runden-Objekte
    const map = {}; order.forEach((r, i) => { map[r.no] = i + 1; });
    Q.questions.forEach((q) => { q.round = map[q.round] || 1; });
    order.forEach((r, i) => { r.no = i + 1; });
    Q.rounds = order;
  }
  function moveQuestion(id, round, beforeId) {
    const q = Q.questions.find((x) => x.id === id); if (!q) return;
    Q.questions = Q.questions.filter((x) => x !== q); q.round = round;
    let at = beforeId ? Q.questions.findIndex((x) => x.id === beforeId) : -1;
    if (at < 0) { const last = Q.questions.map((x) => x.round).lastIndexOf(round); at = last >= 0 ? last + 1 : Q.questions.filter((x) => x.round < round).length; }
    Q.questions.splice(at, 0, q);
  }
  const arrMove = (a, from, to) => { const [x] = a.splice(from, 1); a.splice(Math.max(0, Math.min(a.length, to)), 0, x); };
  function move(dir) {
    if (sel.k === 'q') {
      const q = target(); const list = qsInRound(q.round); const i = list.indexOf(q);
      if (list[i + dir]) { const a = Q.questions.indexOf(q), b = Q.questions.indexOf(list[i + dir]); [Q.questions[a], Q.questions[b]] = [Q.questions[b], Q.questions[a]]; }
      else if (Q.rounds[q.round - 1 + dir]) moveQuestion(q.id, q.round + dir, dir > 0 ? (qsInRound(q.round + 1)[0] || {}).id : null);
    } else if (sel.k === 'round') { const o = Q.rounds.slice(); arrMove(o, sel.i, sel.i + dir); renumberRounds(o); sel.i = Math.max(0, Math.min(Q.rounds.length - 1, sel.i + dir)); }
    else if (sel.k === 'cat') { arrMove(Q.buzzer, sel.i, sel.i + dir); sel.i = Math.max(0, Math.min(Q.buzzer.length - 1, sel.i + dir)); }
    else if (sel.k === 'card') { const c = Q.buzzer[sel.ci].cards; arrMove(c, sel.i, sel.i + dir); sel.i = Math.max(0, Math.min(c.length - 1, sel.i + dir)); }
    else if (sel.k === 'spare') { arrMove(Q.spare, sel.i, sel.i + dir); sel.i = Math.max(0, Math.min(Q.spare.length - 1, sel.i + dir)); }
    changed(true);
  }
  function remove() {
    const t = target();
    if (sel.k === 'q') { if (!confirm('Diese Frage löschen?')) return; Q.questions = Q.questions.filter((q) => q !== t); sel = { k: 'round', i: t.round - 1 }; }
    else if (sel.k === 'round') {
      if (Q.rounds.length < 2) return toast('Mindestens eine Runde muss bleiben.', true);
      const n = qsInRound(t.no).length; const to = t.no > 1 ? t.no - 1 : 2;
      if (!confirm(n ? `Runde löschen? Ihre ${n} Fragen wandern in Runde ${t.no > 1 ? to : 1}.` : 'Runde löschen?')) return;
      Q.questions.forEach((q) => { if (q.round === t.no) q.round = to; });
      renumberRounds(Q.rounds.filter((r) => r !== t)); sel = { k: 'intro' };
    } else if (sel.k === 'cat') { if (!confirm(`Kategorie „${t.name}“ mit ${t.cards.length} Karten löschen?`)) return; Q.buzzer.splice(sel.i, 1); sel = { k: 'intro' }; }
    else if (sel.k === 'card') { if (!confirm('Diese Karte löschen?')) return; Q.buzzer[sel.ci].cards.splice(sel.i, 1); sel = { k: 'cat', i: sel.ci }; }
    else if (sel.k === 'spare') { Q.spare.splice(sel.i, 1); sel = { k: 'tie' }; }
    changed(true);
  }
  function duplicate() {
    if (sel.k === 'q') { const c = JSON.parse(JSON.stringify(target())); c.id = QM.newId(); Q.questions.splice(Q.questions.indexOf(target()) + 1, 0, c); sel = { k: 'q', id: c.id }; }
    if (sel.k === 'card') { const c = JSON.parse(JSON.stringify(target())); c.id = QM.newId(); Q.buzzer[sel.ci].cards.splice(sel.i + 1, 0, c); sel.i++; }
    changed(true);
  }
  function add(what) {
    const [k, a] = what.split(':');
    if (k === 'q') { const q = QM.newQuestion('mc', Number(a)); Q.questions.push(q); moveQuestion(q.id, Number(a)); sel = { k: 'q', id: q.id }; view = 'q'; }
    if (k === 'round') { Q.rounds.push({ key: 'r' + QM.newId().slice(0, 4), no: Q.rounds.length + 1, name: `Runde ${Q.rounds.length + 1}`, sub: '' }); sel = { k: 'round', i: Q.rounds.length - 1 }; }
    if (k === 'cat') { Q.buzzer.push({ key: 'k' + QM.newId().slice(0, 5), name: 'Neue Kategorie', cards: [1, 2, 3].map((p) => QM.newCard('q', p)) }); sel = { k: 'cat', i: Q.buzzer.length - 1 }; }
    if (k === 'card') { const c = Q.buzzer[Number(a)]; c.cards.push(QM.newCard((c.cards[0] || {}).type || 'q', c.cards.length + 1)); sel = { k: 'card', ci: Number(a), i: c.cards.length - 1 }; }
    if (k === 'spare') { Q.spare.push({ cat: '', q: '', answer: '' }); sel = { k: 'spare', i: Q.spare.length - 1 }; }
    changed(true);
  }
  function changeType(type) {
    const old = target(); const n = QM.newQuestion(type, old.round);
    ['id', 'cat', 'q', 'fact', 'note', 'bonusQ', 'bonusA', 'bonus'].forEach((k) => { if (old[k] != null) n[k] = old[k]; });
    if (old.opts && n.opts) { n.opts = old.opts; n.correct = old.correct; }
    if (old.answer && n.answer != null) n.answer = old.answer;
    if (old.img && type === 'img') n.img = old.img;
    Q.questions[Q.questions.indexOf(old)] = n;
  }

  // ---------- Bild hochladen (große Fotos werden verkleinert) ----------
  function readImage(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onerror = () => reject(new Error('Datei nicht lesbar'));
      fr.onload = () => {
        const url = fr.result;
        // online liegt das Bild direkt im Quiz in der Datenbank – deshalb dort kleiner
        const [limit, w, h, q] = window.C.online ? [4e5, 1280, 800, 0.8] : [1.5e6, 1600, 1000, 0.85];
        if (file.size < limit && file.type !== 'image/heic') return resolve(url);
        const img = new Image();
        img.onload = () => {
          const s = Math.min(1, w / img.width, h / img.height);
          const cv = document.createElement('canvas'); cv.width = Math.round(img.width * s); cv.height = Math.round(img.height * s);
          cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
          resolve(cv.toDataURL('image/jpeg', q));
        };
        img.onerror = () => reject(new Error('Bildformat wird nicht unterstützt'));
        img.src = url;
      };
      fr.readAsDataURL(file);
    });
  }

  // ---------- Darstellung ----------
  const fld = (label, p, val, opt = {}) => {
    const v = val == null ? '' : val;
    const inp = opt.area ? `<textarea data-p="${p}" ${opt.t ? `data-t="${opt.t}"` : ''} rows="${opt.rows || 2}">${esc(v)}</textarea>`
      : `<input data-p="${p}" ${opt.t ? `data-t="${opt.t}"` : ''} value="${esc(v)}" ${opt.t === 'num' ? 'inputmode="numeric"' : ''} ${opt.ph ? `placeholder="${esc(opt.ph)}"` : ''}>`;
    return `<label class="${opt.cls || ''}"><span>${label}</span>${inp}</label>`;
  };
  const btn = (a, label, cls) => `<button type="button" class="btn sm ${cls || ''}" data-a="${a}">${label}</button>`;

  function outline() {
    const item = (s, label, extra, dragKey) => {
      const on = selStr(sel) === s ? 'on' : '';
      const w = !imp && warnFor(warnKey(parseSel(s))).length ? '<i class="w">⚠</i>' : '';
      return `<button type="button" class="ol ${extra || ''} ${on}" data-sel="${s}" ${dragKey ? `draggable="true" data-drag="${dragKey}"` : ''}>${imp ? impBadge(parseSel(s)) : ''}${label}${w}</button>`;
    };
    const short = (t, n) => esc((t || '').length > n ? t.slice(0, n) + '…' : t || '(leer)');
    let h = item('intro', `${icon('edit')} Intro & Texte`, 'olsec');
    Q.rounds.forEach((r, i) => {
      h += `<div class="olr" data-drop="round:${r.no}">` + item(`round:${i}`, `<b>Runde ${r.no}</b> ${short(r.name, 26)}`, 'olh', `round:${i}`);
      qsInRound(r.no).forEach((q) => { h += item('q:' + q.id, `<span class="no">${qNo(q)}</span><span class="tx">${short(q.q, 46)}</span><span class="ty">${q.type.toUpperCase()}</span>`, 'olq', 'q:' + q.id); });
      h += `<button type="button" class="oladd" data-add="q:${r.no}">+ Frage</button></div>`;
    });
    h += '<button type="button" class="oladd" data-add="round">+ Runde</button><div class="olsep">BUZZER-FINALE</div>';
    Q.buzzer.forEach((c, ci) => {
      h += `<div class="olr" data-drop="cat:${ci}">` + item(`cat:${ci}`, `<b>${short(c.name, 30)}</b>`, 'olh', `cat:${ci}`);
      c.cards.forEach((cd, i) => { h += item(`card:${ci}:${i}`, `<span class="no">${cd.pts}</span><span class="tx">${short(cd.q || (cd.hints || []).join(' · '), 44)}</span><span class="ty">${{ who: 'WER', tf: 'M/F', q: 'FRAGE' }[cd.type]}</span>`, 'olq', `card:${ci}:${i}`); });
      h += `<button type="button" class="oladd" data-add="card:${ci}">+ Karte</button></div>`;
    });
    h += '<button type="button" class="oladd" data-add="cat">+ Kategorie</button><div class="olsep">FINALE & RESERVE</div>';
    h += item('tie', 'Stechfrage', 'olq');
    Q.spare.forEach((s, i) => { h += item(`spare:${i}`, `<span class="tx">Ersatz: ${short(s.q, 40)}</span>`, 'olq'); });
    h += '<button type="button" class="oladd" data-add="spare">+ Ersatzfrage</button>';
    return h;
  }

  const form = () => (imp ? impBox() : '') + formBody();
  function formBody() {
    const t = target();
    if (!t) { sel = { k: 'intro' }; return formBody(); }
    const ws = warnFor(warnKey(sel)).map((w) => `<div class="wline">⚠ ${esc(w.msg)}</div>`).join('');
    const tools = (more) => `<div class="edtools">${more || ''}${['q', 'round', 'cat', 'card', 'spare'].includes(sel.k) ? btn('up', '↑') + btn('down', '↓') : ''}${['q', 'card'].includes(sel.k) ? btn('dup', 'Duplizieren') : ''}${['q', 'round', 'cat', 'card', 'spare'].includes(sel.k) ? btn('del', icon('trash') + ' Löschen', 'ghost') : ''}</div>`;
    if (sel.k === 'intro') {
      const I = Q.intro;
      return `<h3>INTRO & TEXTE</h3>${fld('Name des Quiz (nur in der Liste)', 'meta.name', Q.meta.name)}
        <div class="grid2">${fld('Titel-Zeile', 'intro.title.kicker', I.title.kicker)}${fld('Titel', 'intro.title.title', I.title.title)}</div>
        <div class="grid2">${fld('Untertitel', 'intro.title.sub', I.title.sub)}${fld('Datum und Ort', 'intro.title.meta', I.title.meta)}</div>
        ${fld('Eilmeldung: Überschrift', 'intro.eilTitle', I.eilTitle)}
        <div class="sub">Eilmeldungen (je Klick eine Zeile)</div>
        ${(I.eil || []).map((l, i) => `<div class="row3">${fld('Stichwort', `intro.eil.${i}.0`, l[0])}${fld('Text', `intro.eil.${i}.1`, l[1], { cls: 'grow' })}<button type="button" class="btn sm ghost" data-a="eilDel" data-i="${i}">✕</button></div>`).join('')}
        ${btn('eilAdd', '+ Eilmeldung')}
        ${fld('Ideen für Teamnamen (eine pro Zeile)', 'intro.teamIdeas', (I.teamIdeas || []).join('\n'), { area: 1, t: 'lines', rows: 4 })}
        <div class="sub">Preistitel der Siegerehrung</div>
        <div class="grid2">${fld('Platz 1', 'intro.awards.first', I.awards.first)}${fld('Platz 2', 'intro.awards.second', I.awards.second)}</div>
        <div class="grid2">${fld('Platz 3', 'intro.awards.third', I.awards.third)}${fld('Sonderpreis (letzter Platz)', 'intro.awards.special', I.awards.special)}</div>
        <div class="sub">Danke-Folie</div>
        <div class="grid2">${fld('Titel', 'intro.outro.title', I.outro.title)}${fld('Untertitel', 'intro.outro.sub', I.outro.sub)}</div>${fld('Zeile darunter', 'intro.outro.meta', I.outro.meta)}`;
    }
    if (sel.k === 'round') return `<h3>RUNDE ${t.no}</h3>${ws}${fld('Name', 'name', t.name)}${fld('Untertitel', 'sub', t.sub)}
      <div class="small">${qsInRound(t.no).length} Fragen. Fragen per Drag & Drop oder mit ↑↓ verschieben.</div>${tools(btn('addQ', '+ Frage in dieser Runde'))}`;
    if (sel.k === 'cat') return `<h3>BUZZER-KATEGORIE</h3>${ws}${fld('Name', 'name', t.name)}
      <label><span>Symbol</span><select data-p="icon">${ICON_CHOICES.map(([k, l]) => `<option value="${k}" ${String(t.icon || '') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <div class="small">${t.cards.length} Karten. Auf dem Board stehen die Kategorien als Spalten.</div>${tools(btn('addCard', '+ Karte'))}`;
    if (sel.k === 'card') {
      return `<h3>BUZZER-KARTE · ${esc(Q.buzzer[sel.ci].name).toUpperCase()}</h3>${ws}
        <div class="grid2"><label><span>Typ</span><select data-a="cardType">${Object.entries(QM.CARD_TYPES).map(([k, l]) => `<option value="${k}" ${t.type === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>${fld('Punkte (1–5)', 'pts', t.pts, { t: 'num' })}</div>
        ${t.type === 'who' ? fld('Hinweise (einer pro Zeile, werden nacheinander aufgedeckt)', 'hints', (t.hints || []).join('\n'), { area: 1, t: 'lines', rows: 4 }) : fld(t.type === 'tf' ? 'Aussage' : 'Frage', 'q', t.q, { area: 1 })}
        ${t.type === 'tf' ? `<label><span>Stimmt die Aussage?</span><select data-p="truth" data-t="bool"><option value="true" ${t.truth ? 'selected' : ''}>Fakt</option><option value="false" ${t.truth ? '' : 'selected'}>Mythos</option></select></label>` : ''}
        ${fld('Lösung', 'answer', t.answer)}${tools()}`;
    }
    if (sel.k === 'tie') return `<h3>STECHFRAGE</h3><div class="small">Kommt nur bei Gleichstand auf Platz 1–3. Am besten eine Schätzfrage.</div>${ws}${fld('Frage', 'q', t.q, { area: 1 })}${fld('Lösung', 'answer', t.answer)}${fld('„Das wusstet ihr noch nicht“', 'fact', t.fact, { area: 1 })}${fld('Notiz für die Moderation', 'note', t.note, { area: 1 })}`;
    if (sel.k === 'spare') return `<h3>ERSATZFRAGE</h3>${fld('Kategorie', 'cat', t.cat)}${fld('Frage', 'q', t.q, { area: 1 })}${fld('Lösung', 'answer', t.answer)}${fld('„Das wusstet ihr noch nicht“', 'fact', t.fact, { area: 1 })}${tools()}`;
    // Frage
    let body = '';
    if (t.opts) {
      const tf = t.type === 'tf';
      body += `<div class="sub">${tf ? 'Aussagen – markiert ist die FALSCHE' : 'Antwortoptionen – markiert ist die richtige'}</div>` + t.opts.map((o, i) => `<div class="optrow ${t.correct === i ? 'ok' : ''}"><button type="button" class="pick" data-a="correct" data-i="${i}" title="als ${tf ? 'falsch' : 'richtig'} markieren">${LET[i]}</button><input data-p="opts.${i}" value="${esc(o)}" placeholder="Option ${LET[i]}"><button type="button" class="btn sm ghost" data-a="optDel" data-i="${i}">✕</button></div>`).join('')
        + (t.opts.length < QM.MAX_OPTS ? btn('optAdd', '+ Option') : '');
    }
    if (t.type === 'img') {
      body += `<div class="sub">Bild</div><div class="imgrow">${t.img ? `<img src="${esc(t.img)}" alt="">` : '<div class="noimg">kein Bild</div>'}<div><label class="btn sm pri">Bild hochladen<input type="file" accept="image/*" data-a="img" hidden></label>${fld('oder Pfad', 'img', t.img, { ph: 'img/bnd.png' })}</div></div>`;
    }
    if (t.type === 'open' || t.type === 'est') body += fld('Lösung', 'answer', t.answer);
    if (t.type === 'est') body += fld('Hinweis für die Teams', 'unit', t.unit, { ph: 'z. B. Zahl in Mrd. US-Dollar' });
    if (t.type === 'order') {
      body += '<div class="sub">Elemente – so stehen sie auf der Folie (A, B, C …)</div>' + t.items.map((it, i) => `<div class="optrow"><span class="pick">${LET[i]}</span><input data-p="items.${i}.t" value="${esc(it.t)}" placeholder="Element"><input class="short" data-p="items.${i}.y" value="${esc(it.y)}" placeholder="Jahr/Wert"><button type="button" class="btn sm ghost" data-a="itemDel" data-i="${i}">✕</button></div>`).join('')
        + (t.items.length < QM.MAX_OPTS ? btn('itemAdd', '+ Element') : '')
        + `<div class="sub">Richtige Reihenfolge</div><div class="ordrow">${(t.orderIdx || []).map((ix, k) => `<span class="ochip"><button type="button" data-a="ordL" data-i="${k}">‹</button><b>${k + 1}. ${LET[ix]}</b> ${esc((t.items[ix] || {}).t || '')}<button type="button" data-a="ordR" data-i="${k}">›</button></span>`).join('')}</div>${btn('ordSort', 'Nach Jahr/Wert sortieren')}`;
    }
    return `<h3>FRAGE ${qNo(t)} · ${esc(QM.TYPES[t.type]).toUpperCase()}</h3>${ws}
      <div class="grid3"><label><span>Typ</span><select data-a="type">${Object.entries(QM.TYPES).map(([k, l]) => `<option value="${k}" ${t.type === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label><span>Runde</span><select data-a="round">${Q.rounds.map((r) => `<option value="${r.no}" ${t.round === r.no ? 'selected' : ''}>${r.no}: ${esc(r.name)}</option>`).join('')}</select></label>${fld('Kategorie', 'cat', t.cat, { ph: 'z. B. NATO' })}</div>
      ${fld('Frage', 'q', t.q, { area: 1, rows: 3 })}
      <div class="grid3">${fld('Punkte', 'pts', t.pts, { t: 'num' })}${fld('Zeit (Sekunden)', 'time', t.time, { t: 'num' })}${fld('Bonuspunkte', 'bonus', t.bonusQ ? t.bonus || 1 : '', { t: 'num', ph: '1' })}</div>
      ${body}
      <div class="grid2">${fld('Bonusfrage (optional)', 'bonusQ', t.bonusQ)}${fld('Bonus-Lösung', 'bonusA', t.bonusA)}</div>
      ${fld('„Das wusstet ihr noch nicht“', 'fact', t.fact, { area: 1 })}${fld('Notiz für die Moderation', 'note', t.note, { area: 1 })}${tools()}`;
  }

  function previewTabs() {
    const tabs = sel.k === 'intro' ? [['title', 'Titel'], ['eil', 'Eilmeldung'], ['rules', 'Regeln'], ['ceremony', 'Siegerehrung'], ['thanks', 'Danke']]
      : ['q', 'card', 'tie'].includes(sel.k) ? [['q', 'Frage'], ['a', 'Lösung']] : [];
    if (tabs.length && !tabs.some((x) => x[0] === view)) view = tabs[0][0];
    return tabs.map(([k, l]) => `<button type="button" class="${view === k ? 'on' : ''}" data-view="${k}">${l}</button>`).join('');
  }

  function bar() {
    if (imp) {
      const c = impCount(); const S = imp.summary;
      return `<div class="edbar impbar"><b>PowerPoint-Import „${esc(imp.title)}“</b><span class="small">${S.slides} Folien → ${S.questions} Fragen in ${S.rounds} Runden, ${S.cards} Buzzer-Karten, ${S.spare} Ersatzfragen${S.tiebreak ? ', Stechfrage' : ''}</span></div>
        <div class="edsave dirty">${btn('impFinish', `Als neues Set anlegen (${c.ok})`, 'pri')}${btn('impNextBtn', 'Nächste offene')}${btn('impAllSure', 'Alle ohne ⚠ bestätigen')}${btn('impCancel', 'Import abbrechen', 'ghost')}
        <span class="st">${c.ok} von ${c.all} bestätigt${c.skip ? `, ${c.skip} weggelassen` : ''}. Jede Frage links anklicken, mit der Folie vergleichen, bei Bedarf korrigieren und bestätigen.</span></div>`;
    }
    return `<div class="edbar">
        <select id="edSet">${sets.map((x) => `<option value="${x.id}" ${x.id === setId ? 'selected' : ''}>${x.id === active ? '▶ ' : ''}${esc(x.title)} (${x.questions || 0} Fragen)</option>`).join('')}</select>
        ${setId !== active ? btn('activate', 'Für den Abend aktivieren', 'pri') : '<span class="live">läuft gerade</span>'}
        ${btn('new', '+ Neu')}${btn('copy', 'Duplizieren')}${btn('rename', 'Umbenennen')}${setId !== active ? btn('delSet', 'Löschen', 'ghost') : ''}
        <span class="grow"></span>
        <label class="btn sm">PowerPoint (.pptx)<input type="file" id="edPptx" accept=".pptx" hidden></label>
        <label class="btn sm">Import (JSON/CSV)<input type="file" id="edImp" accept=".json,.csv,.txt" hidden></label>
        ${window.C.online ? btn('expJson', 'JSON') + btn('expCsv', 'Excel/CSV') : `<a class="btn sm" href="/api/export?id=${encodeURIComponent(setId)}&format=json&key=${encodeURIComponent(window.C.key())}" download>JSON</a>
        <a class="btn sm" href="/api/export?id=${encodeURIComponent(setId)}&format=csv&key=${encodeURIComponent(window.C.key())}" download>Excel/CSV</a>`}
        <a class="btn sm ghost" href="/vorlage.csv" download>CSV-Vorlage</a></div>
      <div class="edsave ${dirty() ? 'dirty' : ''}">${btn('save', 'Speichern', 'pri')}${dirty() ? btn('undo', 'Verwerfen', 'ghost') : ''}
        <span class="st">${dirty() ? 'Ungespeicherte Änderungen' : 'Alles gespeichert'}${setId === active ? ' · Änderungen gelten sofort auf dem Beamer' : ''}</span>
        <button type="button" class="wbtn ${warnings.length ? '' : 'none'}" data-a="warn">${warnings.length ? `⚠ ${warnings.length} Hinweise` : '✓ keine Hinweise'}</button></div>
      ${showWarn && warnings.length ? `<div class="wlist">${warnings.map((w) => `<div><b>${esc(w.where)}:</b> ${esc(w.msg)}</div>`).join('')}</div>` : ''}`;
  }
  // Grundgerüst einmal; danach werden nur die Teile ersetzt (die Vorschau lädt nicht jedes Mal neu)
  function render() {
    if (!root) return;
    root.innerHTML = `<div id="edBar">${bar()}</div>
      <div class="edgrid"><nav class="outline" id="edOl">${outline()}</nav>
        <section class="edmain"><div class="edprev"><iframe id="edPv" src="${window.C.page('screen', { preview: 1, draft: 1 })}" tabindex="-1"></iframe></div>
          <div class="pvtabs" id="edPvT">${previewTabs()}</div><div id="edOver" class="wline" hidden></div>
          <form class="edform" id="edForm" autocomplete="off">${form()}</form></section></div>`;
    const f = document.getElementById('edPv'); f.onload = () => { fitPv(); preview(); };
    fitPv();
  }
  // Nur ersetzen, was sich wirklich geändert hat – sonst verschwindet ein Knopf mitten im Klick
  // (beim Verlassen eines Feldes feuert „change“ zwischen Maus-runter und Maus-hoch).
  function setHtml(id, html) { const el = document.getElementById(id); if (el && el._html !== html) { el.innerHTML = html; el._html = html; } }
  function refresh(full) { // nach Eingaben: Gliederung, Hinweise, Vorschau – Formular nur bei Strukturänderung
    analyse();
    if (!document.getElementById('edPv')) return render();
    setHtml('edBar', bar());
    setHtml('edOl', outline());
    if (full) { const f = document.getElementById('edForm'); f.innerHTML = form(); f._html = null; setHtml('edPvT', previewTabs()); }
    clearTimeout(refresh.t); refresh.t = setTimeout(preview, full ? 0 : 200);
  }
  const changed = (full) => refresh(full !== false);

  // ---------- Beamer-Vorschau: die echte Beamer-Seite rendert den Entwurf ----------
  function fitPv() { const f = document.getElementById('edPv'); if (f) f.style.transform = `scale(${f.parentElement.clientWidth / 1600})`; }
  function preview() {
    const f = document.getElementById('edPv'); if (!f || !f.contentWindow || !norm) return;
    const quiz = norm; const flow = F.buildFlow(quiz);
    const teams = ['Die Vetomächte', 'Soft Power Rangers', 'Team Zeitenwende', 'Die Blockfreien'].map((n, i) => ({ id: 't' + i, name: n, color: ['#F04DB8', '#4FB3F0', '#FFC93C', '#7BE0A6'][i], members: 1 }));
    const st = { slide: 0, step: 0, teams, tokens: {}, scores: {}, adjust: { t0: 30, t1: 22, t2: 17, t3: 9 }, timer: { dur: 60, endsAt: null, left: 60 }, buzz: { card: null, open: false, queue: [], out: [], early: [], reveal: false, hint: 1, wrong: [] }, used: {}, gate: null, overrides: {}, tieOrder: [], pause: null, settings: { expectedTeams: 6 } };
    const at = (pred) => Math.max(0, flow.findIndex(pred));
    const t = target();
    if (sel.k === 'q') { const n = quiz.questions.find((x) => x.id === t.id); st.slide = at((x) => x.type === view && x.no === (n || {}).no); if (n) { st.timer = { dur: n.time, left: n.time }; } }
    else if (sel.k === 'round') st.slide = at((x) => x.type === 'div' && x.round === sel.i + 1);
    else if (sel.k === 'cat') st.slide = at((x) => x.type === 'board');
    else if (sel.k === 'card') { st.slide = at((x) => x.type === 'board'); const c = quiz.buzzer[sel.ci]; if (c && c.cards[sel.i]) { st.buzz.card = `b:${c.key}:${sel.i}`; st.buzz.hint = 9; st.buzz.reveal = view === 'a'; } }
    else if (sel.k === 'tie') st.slide = at((x) => x.type === (view === 'a' ? 'tie_a' : 'tie_q'));
    else if (sel.k === 'spare') st.slide = at((x) => x.type === 'spare' && x.idx === sel.i);
    else st.slide = at((x) => x.type === view);
    st.step = F.maxStep(quiz, flow[st.slide], teams.length);
    f.contentWindow.postMessage({ quiz, flow, state: st, joinUrl: location.origin }, location.origin);
    setTimeout(() => { // Text, der selbst verkleinert nicht passt, melden
      const o = document.getElementById('edOver'); const w = f.contentWindow; if (!o || !w || !w.__overflow) return;
      const list = w.__overflow(); o.hidden = !list.length; o.textContent = list.length ? '⚠ Text passt auch verkleinert nicht auf die Folie – bitte kürzen.' : '';
    }, 400);
  }

  // ---------- Ereignisse ----------
  function onInput(e) {
    const el = e.target; const p = el.dataset.p; if (!p) return;
    const t = sel.k === 'intro' ? Q : target();
    let v = el.value;
    if (el.dataset.t === 'num') v = v === '' ? '' : Number(v);
    if (el.dataset.t === 'lines') v = v.split('\n');
    if (el.dataset.t === 'bool') v = v === 'true';
    if (p === 'bonus' && v === '') { delete t.bonus; refresh(false); return; }
    setPath(t, p, v);
    refresh(e.type === 'change' && el.tagName === 'SELECT');
  }
  async function onClick(e) {
    const b = e.target.closest('[data-sel],[data-add],[data-a],[data-view]'); if (!b || b.tagName === 'SELECT' || (b.tagName === 'INPUT' && b.type === 'file')) return;
    if (b.dataset.sel) { sel = parseSel(b.dataset.sel); view = sel.k === 'intro' ? 'title' : 'q'; return refresh(true); }
    if (b.dataset.add) return add(b.dataset.add);
    if (b.dataset.view) { view = b.dataset.view; root.querySelectorAll('[data-view]').forEach((x) => x.classList.toggle('on', x === b)); return preview(); }
    const a = b.dataset.a; const t = target(); const i = Number(b.dataset.i);
    if (a === 'save') return save();
    if (a === 'expJson' || a === 'expCsv') { // online: Datei direkt im Browser erzeugen
      const csv = a === 'expCsv'; const q = QM.normalize(Q).quiz;
      const blob = new Blob([csv ? QM.toCsv(q) : JSON.stringify(q, null, 1)], { type: csv ? 'text/csv;charset=utf-8' : 'application/json' });
      const l = document.createElement('a'); l.href = URL.createObjectURL(blob); l.download = `${setId || 'quiz'}.${csv ? 'csv' : 'json'}`; l.click();
      setTimeout(() => URL.revokeObjectURL(l.href), 2000);
      return;
    }
    if (imp && a && a.startsWith('imp')) {
      const k = impKey(sel);
      if (a === 'impOk') { imp.status[k] = 'ok'; impNext(); }
      if (a === 'impSkip') { imp.status[k] = 'skip'; impNext(); }
      if (a === 'impOpen') delete imp.status[k];
      if (a === 'impNextBtn') impNext();
      if (a === 'impAllSure') {
        const it = impItems().filter((s) => impState(s) === 'open' && !impSrc(s).problems.length && impSrc(s).sure);
        if (!it.length) return toast('Keine offenen Einträge ohne ⚠.');
        if (!confirm(`${it.length} Einträge ohne erkannte Probleme als geprüft markieren? Die mit ⚠ bleiben offen.`)) return;
        it.forEach((s) => { imp.status[impKey(s)] = 'ok'; }); impNext();
      }
      if (a === 'impFinish') return impFinish();
      if (a === 'impCancel') { if (!confirm('Import abbrechen? Die erkannten Fragen werden verworfen.')) return; imp = null; await loadSet(active); return render(); }
      view = sel.k === 'intro' ? 'title' : 'q';
      return refresh(true);
    }
    if (a === 'undo') { if (confirm('Alle ungespeicherten Änderungen verwerfen?')) { Q = JSON.parse(saved); analyse(); render(); } return; }
    if (a === 'warn') { showWarn = !showWarn; return refresh(false); }
    if (a === 'up') return move(-1);
    if (a === 'down') return move(1);
    if (a === 'del') return remove();
    if (a === 'dup') return duplicate();
    if (a === 'addQ') return add('q:' + t.no);
    if (a === 'addCard') return add('card:' + sel.i);
    if (a === 'correct') { t.correct = i; return changed(); }
    if (a === 'optAdd') { t.opts.push(''); return changed(); }
    if (a === 'optDel') { if (t.opts.length <= 2) return toast('Mindestens zwei Optionen.', true); t.opts.splice(i, 1); if (t.correct >= t.opts.length || t.correct === i) t.correct = 0; else if (t.correct > i) t.correct--; return changed(); }
    if (a === 'itemAdd') { t.items.push({ t: '', y: '' }); t.orderIdx.push(t.items.length - 1); return changed(); }
    if (a === 'itemDel') { if (t.items.length <= 2) return toast('Mindestens zwei Elemente.', true); t.items.splice(i, 1); t.orderIdx = t.orderIdx.filter((x) => x !== i).map((x) => (x > i ? x - 1 : x)); return changed(); }
    if (a === 'ordL' && i > 0) { arrMove(t.orderIdx, i, i - 1); return changed(); }
    if (a === 'ordR' && i < t.orderIdx.length - 1) { arrMove(t.orderIdx, i, i + 1); return changed(); }
    if (a === 'ordSort') { t.orderIdx = QM.sortByValue(t.items); return changed(); }
    if (a === 'eilAdd') { Q.intro.eil.push(['', '']); return changed(); }
    if (a === 'eilDel') { Q.intro.eil.splice(i, 1); return changed(); }
    // Sets
    if (a === 'activate') {
      if (dirty() && !confirm('Es gibt ungespeicherte Änderungen. Trotzdem aktivieren (ohne sie)?')) return;
      if (!confirm(`„${(sets.find((x) => x.id === setId) || {}).title}“ für den Abend aktivieren?\nTeams bleiben angemeldet, Punkte und Ablauf beginnen neu.`)) return;
      try { await api('setActivate', { id: setId }); await loadSets(); toast('Aktiviert ✓'); render(); } catch (err) { toast(err.message, true); }
      return;
    }
    if (a === 'new' || a === 'copy') {
      if (dirty() && !confirm('Ungespeicherte Änderungen gehen verloren. Weiter?')) return;
      const from = a === 'copy' ? setId : (confirm('Mit Beispielfragen beginnen?\nOK = mit Beispielen, Abbrechen = leer') ? 'example' : 'blank');
      const title = prompt('Name des neuen Quiz:', a === 'copy' ? `${Q.meta.name} (Kopie)` : 'Neues Quiz'); if (!title) return;
      try { const r = await api('setCreate', { title, from }); await loadSets(); await loadSet(r.id); render(); } catch (err) { toast(err.message, true); }
      return;
    }
    if (a === 'rename') {
      const title = prompt('Neuer Name:', Q.meta.name); if (!title) return;
      Q.meta.name = title; return save();
    }
    if (a === 'delSet') {
      if (!confirm(`„${Q.meta.name}“ löschen? Es landet im Papierkorb-Ordner (quizzes/.papierkorb) und lässt sich von dort zurückholen.`)) return;
      try { await api('setDelete', { id: setId }); setId = active; await loadSets(); await loadSet(setId); render(); } catch (err) { toast(err.message, true); }
    }
  }
  async function onChange(e) {
    const el = e.target;
    if (el.id === 'edSet') {
      if (dirty() && !confirm('Ungespeicherte Änderungen gehen verloren. Weiter?')) { el.value = setId; return; }
      await loadSet(el.value); return render();
    }
    if (el.id === 'edPptx' && el.files[0]) return impStart(el.files[0]);
    if (el.dataset.a === 'type') { changeType(el.value); return changed(); }
    if (el.dataset.a === 'round') { moveQuestion(target().id, Number(el.value)); return changed(); }
    if (el.dataset.a === 'cardType') { const old = target(); const n = QM.newCard(el.value, old.pts); n.id = old.id; n.answer = old.answer; if (old.q && n.q != null) n.q = old.q; Q.buzzer[sel.ci].cards[sel.i] = n; return changed(); }
    if (el.dataset.a === 'img' && el.files[0]) {
      try { const data = await readImage(el.files[0]); const r = await api('upload', { data }); target().img = r.url; changed(); toast('Bild hochgeladen ✓'); } catch (err) { toast(err.message, true); }
      return;
    }
    if (el.id === 'edImp' && el.files[0]) {
      const file = el.files[0]; const text = await file.text();
      const format = /\.csv$|\.txt$/i.test(file.name) || !/^\s*\{/.test(text) ? 'csv' : 'json';
      const title = prompt('Name für das importierte Quiz:', file.name.replace(/\.[^.]+$/, '')); if (!title) return;
      try {
        const r = await api('setImport', { text, format, title });
        await loadSets(); await loadSet(r.id); showWarn = r.warnings.length > 0; render();
        toast(r.warnings.length ? `Importiert – bitte ${r.warnings.length} Hinweise prüfen` : 'Importiert ✓');
      } catch (err) { toast(err.message, true); }
      return;
    }
    if (el.dataset.p) onInput(e);
  }

  // Drag & Drop in der Gliederung (Fragen, Runden, Kategorien, Karten)
  function onDragStart(e) { const d = e.target.closest('[data-drag]'); if (!d) return; drag = d.dataset.drag; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', drag); }
  function dropTarget(e) {
    if (!drag) return null;
    const over = e.target.closest('[data-drag],[data-drop]'); if (!over) return null;
    const kind = drag.split(':')[0]; const o = (over.dataset.drag || over.dataset.drop).split(':')[0];
    const ok = kind === o || (kind === 'q' && o === 'round') || (kind === 'card' && o === 'cat');
    return ok ? over : null;
  }
  function onDragOver(e) { const t = dropTarget(e); root.querySelectorAll('.dropat').forEach((x) => x.classList.remove('dropat')); if (t) { e.preventDefault(); t.classList.add('dropat'); } }
  function onDrop(e) {
    const t = dropTarget(e); root.querySelectorAll('.dropat').forEach((x) => x.classList.remove('dropat'));
    if (!t) return; e.preventDefault();
    const [k, a, b] = drag.split(':'); const tk = (t.dataset.drag || t.dataset.drop).split(':');
    if (k === 'q') {
      if (tk[0] === 'q') { const tq = Q.questions.find((x) => x.id === tk[1]); if (tq && tq.id !== a) moveQuestion(a, tq.round, tq.id); }
      else moveQuestion(a, tk[0] === 'round' && t.dataset.drop ? Number(tk[1]) : Q.rounds[Number(tk[1])].no);
      sel = { k: 'q', id: a };
    } else if (k === 'round' && tk[0] === 'round') { const o = Q.rounds.slice(); const to = t.dataset.drag ? Number(tk[1]) : Number(tk[1]) - 1; arrMove(o, Number(a), to); renumberRounds(o); sel = { k: 'round', i: to }; }
    else if (k === 'cat' && tk[0] === 'cat') { arrMove(Q.buzzer, Number(a), Number(tk[1])); sel = { k: 'cat', i: Number(tk[1]) }; }
    else if (k === 'card') {
      const card = Q.buzzer[Number(a)].cards.splice(Number(b), 1)[0];
      const ci = Number(tk[1]); const at = tk[0] === 'card' ? Number(tk[2]) : Q.buzzer[ci].cards.length;
      Q.buzzer[ci].cards.splice(at, 0, card); sel = { k: 'card', ci, i: Q.buzzer[ci].cards.indexOf(card) };
    }
    drag = null; changed(true);
  }

  function bind(el) {
    el.addEventListener('input', onInput);
    el.addEventListener('change', onChange);
    el.addEventListener('click', onClick);
    el.addEventListener('dragstart', onDragStart);
    el.addEventListener('dragover', onDragOver);
    el.addEventListener('drop', onDrop);
    el.addEventListener('dragend', () => { drag = null; root.querySelectorAll('.dropat').forEach((x) => x.classList.remove('dropat')); });
    el.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(); } });
    if (!bind.done) { window.addEventListener('resize', fitPv); bind.done = true; }
  }

  window.Editor = {
    async mount(el) {
      // Online sind die Quiz-Sets mit der Admin-PIN geschützt (der Spiel-Schlüssel allein reicht nicht)
      if (window.C.online && !(await window.Online.editor().catch(() => false))) {
        el.innerHTML = `<div class="box"><h3>QUIZ-SETS BEARBEITEN</h3><div class="small">Online braucht der Editor einmalig die Admin-PIN.</div>
          <form class="trm" id="edLogin"><input type="password" id="edPin" placeholder="Admin-PIN" inputmode="numeric"><button class="btn sm pri">Anmelden</button></form></div>`;
        el.querySelector('#edLogin').addEventListener('submit', async (e) => {
          e.preventDefault();
          try { await window.Online.login(el.querySelector('#edPin').value.trim()); window.Editor.mount(el); } catch (err) { toast(err.message, true); }
        });
        return;
      }
      root = el; bind(el);
      try { await loadSets(); if (!Q || !sets.some((s) => s.id === setId)) await loadSet(setId); render(); } catch (e) { el.innerHTML = `<div class="box">${esc(e.message)}</div>`; }
    },
    dirty,
    get draft() { return Q; }, // für Tests
  };
})();
