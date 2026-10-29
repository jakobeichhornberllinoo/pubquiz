// Quiz-Format: prüfen und reparieren, Vorlagen, CSV lesen/schreiben.
// Wird von Server, Editor und Import gemeinsam genutzt.
(function (root) {
  const TYPES = { mc: 'Auswahl (A–D)', tf: 'Falsche Aussage finden', open: 'Offene Frage', est: 'Schätzfrage', order: 'Reihenfolge', img: 'Bilderrätsel' };
  const CARD_TYPES = { who: 'Wer bin ich? (Hinweise)', tf: 'Mythos oder Fakt?', q: 'Frage' };
  const LET = 'ABCDEFGH';
  const MAX_OPTS = 6;

  const str = (v) => (v == null ? '' : String(v)).replace(/\r/g, '').trim();
  const num = (v, d, min, max) => { let n = Math.round(Number(String(v).replace(',', '.'))); if (!isFinite(n) || String(v).trim() === '') n = d; return Math.max(min, Math.min(max, n)); };
  const newId = () => Math.random().toString(36).slice(2, 10);
  const slug = (s) => str(s).toLowerCase().replace(/[äöüß]/g, (c) => ({ ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' }[c])).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  const clone = (o) => JSON.parse(JSON.stringify(o));

  // ---------- Neue Bausteine ----------
  function newQuestion(type, round) {
    const q = { id: newId(), round: round || 1, type, cat: '', pts: type === 'order' || type === 'est' ? 2 : 1, time: type === 'order' ? 90 : 60, q: '' };
    if (type === 'mc' || type === 'tf' || type === 'img') { q.opts = ['', '', '', '']; q.correct = 0; q.time = 45; }
    if (type === 'img') q.img = '';
    if (type === 'open' || type === 'est') q.answer = '';
    if (type === 'est') q.unit = '';
    if (type === 'order') { q.items = [0, 1, 2, 3, 4].map(() => ({ t: '', y: '' })); q.orderIdx = [0, 1, 2, 3, 4]; }
    return q;
  }
  function newCard(type, pts) {
    const c = { id: newId(), type, pts: pts || 1, answer: '' };
    if (type === 'who') c.hints = ['', '', ''];
    else c.q = '';
    if (type === 'tf') c.truth = false;
    return c;
  }
  function blank(name) {
    return {
      meta: { name: name || 'Neues Quiz' },
      intro: {
        title: { kicker: 'Das Außen- und Sicherheitspolitische', title: 'PUB-QUIZ', sub: '', meta: '' },
        eilTitle: 'Heute Abend', eil: [], teamIdeas: [],
        awards: { first: 'Hegemon des Abends', second: 'Vetomacht in Warteposition', third: 'Regionalmacht mit Ambitionen', special: 'Failed State des Abends – aber mit bestem Teamgeist' },
        outro: { title: 'Prost & danke!', sub: '', meta: '' },
      },
      rounds: [{ key: 'r1', no: 1, name: 'Runde 1', sub: '' }],
      questions: [], tiebreak: { q: '', answer: '' }, spare: [], buzzer: [],
    };
  }

  // ---------- Prüfen und reparieren ----------
  // Ergebnis ist immer darstellbar. Inhaltliche Lücken landen als Warnung in `warnings`.
  function normalize(input) {
    const warnings = [];
    const warn = (where, msg) => warnings.push({ where, msg });
    const src = input && typeof input === 'object' ? clone(input) : {};
    const out = blank();
    out.meta = Object.assign({}, src.meta || {}, { name: str((src.meta || {}).name) || 'Quiz ohne Namen' });

    // Intro-Texte
    const si = src.intro || {};
    ['kicker', 'title', 'sub', 'meta'].forEach((k) => { out.intro.title[k] = str((si.title || {})[k]); });
    out.intro.eilTitle = str(si.eilTitle) || 'Heute Abend: Diplomatie ohne Immunität';
    out.intro.eil = (Array.isArray(si.eil) ? si.eil : []).map((l) => [str(l[0]), str(l[1])]).filter((l) => l[0] || l[1]);
    out.intro.teamIdeas = (Array.isArray(si.teamIdeas) ? si.teamIdeas : []).map(str).filter(Boolean);
    ['first', 'second', 'third', 'special'].forEach((k) => { out.intro.awards[k] = str((si.awards || {})[k]) || out.intro.awards[k]; });
    ['title', 'sub', 'meta'].forEach((k) => { out.intro.outro[k] = str((si.outro || {})[k]) || (k === 'title' ? out.intro.outro.title : ''); });

    // Runden: neu durchnummerieren, alte Nummern merken
    const rIn = Array.isArray(src.rounds) && src.rounds.length ? src.rounds : [{ no: 1, name: 'Runde 1' }];
    const rMap = {}; const used = new Set();
    out.rounds = rIn.map((r, i) => {
      rMap[r.no != null ? r.no : i + 1] = i + 1;
      let key = slug(r.key) || 'r' + (i + 1); while (used.has(key)) key += 'x'; used.add(key);
      const name = str(r.name) || `Runde ${i + 1}`;
      return { key, no: i + 1, name, sub: str(r.sub) };
    });

    // Fragen: nach Runde ordnen (Reihenfolge innerhalb bleibt), dann 1..N nummerieren
    const qIn = (Array.isArray(src.questions) ? src.questions : []).map((q, i) => ({ q, i, r: rMap[q && q.round] || (q && q.round ? null : 1) }));
    qIn.forEach((x) => { if (!x.r) { warn('Fragen', `Frage „${str(x.q.q).slice(0, 30)}“ gehört zu keiner Runde und steht jetzt in Runde ${out.rounds.length}.`); x.r = out.rounds.length; } });
    qIn.sort((a, b) => a.r - b.r || a.i - b.i);
    const ids = new Set();
    out.questions = qIn.map((x, i) => {
      const s = x.q || {};
      const no = i + 1;
      const where = `Frage ${no}`;
      const type = TYPES[s.type] ? s.type : 'open';
      if (!TYPES[s.type]) warn(where, `Unbekannter Fragetyp „${str(s.type)}“, als offene Frage übernommen.`);
      let id = str(s.id) || newId(); while (ids.has(id)) id = newId(); ids.add(id);
      const q = { id, no, round: x.r, type, cat: str(s.cat).toUpperCase(), pts: num(s.pts, type === 'order' || type === 'est' ? 2 : 1, 0, 10), time: num(s.time, 60, 5, 900), q: str(s.q) };
      if (!q.q) warn(where, 'Der Fragetext fehlt.');
      if (type === 'mc' || type === 'tf' || type === 'img') {
        let opts = (Array.isArray(s.opts) ? s.opts : []).map(str);
        const correctText = opts[num(s.correct, 0, 0, 99)];
        opts = opts.filter(Boolean).slice(0, MAX_OPTS);
        if (opts.length < 2) { warn(where, 'Mindestens zwei Antwortoptionen nötig.'); while (opts.length < 2) opts.push('–'); }
        q.opts = opts;
        q.correct = Math.max(0, opts.indexOf(correctText));
        if (!correctText) warn(where, 'Die richtige Option ist leer – Option A ist jetzt markiert.');
      }
      if (type === 'img') { q.img = str(s.img); if (!q.img) warn(where, 'Bild fehlt.'); }
      if (type === 'open' || type === 'est') { q.answer = str(s.answer); if (!q.answer) warn(where, 'Die Lösung fehlt.'); }
      if (type === 'est') q.unit = str(s.unit);
      if (type === 'order') {
        const items = (Array.isArray(s.items) ? s.items : []).map((it) => ({ t: str(it && it.t), y: str(it && it.y) })).filter((it) => it.t || it.y).slice(0, MAX_OPTS);
        if (items.length < 2) { warn(where, 'Mindestens zwei Elemente nötig.'); while (items.length < 2) items.push({ t: '–', y: '' }); }
        q.items = items;
        let idx = Array.isArray(s.orderIdx) ? s.orderIdx.map(Number) : [];
        const perm = idx.length === items.length && idx.slice().sort((a, b) => a - b).every((v, k) => v === k);
        if (!perm) { idx = sortByValue(items); warn(where, 'Richtige Reihenfolge war unvollständig – nach den Werten sortiert. Bitte prüfen.'); }
        q.orderIdx = idx;
        q.answerLetters = idx.map((k) => LET[k]).join(' – ');
      }
      const bonusQ = str(s.bonusQ);
      if (bonusQ) { q.bonusQ = bonusQ; q.bonusA = str(s.bonusA); q.bonus = num(s.bonus, 1, 1, 5); if (!q.bonusA) warn(where, 'Die Bonus-Lösung fehlt.'); }
      ['fact', 'note'].forEach((k) => { const v = str(s[k]); if (v) q[k] = v; });
      return q;
    });
    if (!out.questions.length) warn('Fragen', 'Das Quiz hat noch keine Fragen.');
    out.rounds.forEach((r) => { if (!out.questions.some((q) => q.round === r.no)) warn(`Runde ${r.no}`, 'Die Runde hat keine Fragen.'); });

    // Buzzer
    const keys = new Set(); const cids = new Set();
    out.buzzer = (Array.isArray(src.buzzer) ? src.buzzer : []).map((c, ci) => {
      const name = str(c.name) || `Kategorie ${ci + 1}`;
      let key = slug(c.key) || slug(name) || 'k' + ci; while (keys.has(key)) key += 'x'; keys.add(key);
      const cat = { key, name, cards: [] };
      if (str(c.icon)) cat.icon = str(c.icon);
      cat.cards = (Array.isArray(c.cards) ? c.cards : []).map((d, i) => {
        const where = `Buzzer ${name}, Karte ${i + 1}`;
        const type = CARD_TYPES[d.type] ? d.type : 'q';
        let id = str(d.id) || newId(); while (cids.has(id)) id = newId(); cids.add(id);
        const cd = { id, type, pts: num(d.pts, i + 1, 1, 5), answer: str(d.answer) };
        if (type === 'who') { cd.hints = (Array.isArray(d.hints) ? d.hints : []).map(str).filter(Boolean); if (!cd.hints.length) { warn(where, 'Hinweise fehlen.'); cd.hints = ['–']; } }
        else { cd.q = str(d.q); if (!cd.q) warn(where, 'Der Fragetext fehlt.'); }
        if (type === 'tf') cd.truth = d.truth === true || d.truth === 'true';
        if (!cd.answer) warn(where, 'Die Lösung fehlt.');
        return cd;
      });
      if (!cat.cards.length) warn(`Buzzer ${name}`, 'Die Kategorie hat keine Karten.');
      return cat;
    });

    const t = src.tiebreak || {};
    out.tiebreak = { q: str(t.q), answer: str(t.answer) };
    ['fact', 'note'].forEach((k) => { if (str(t[k])) out.tiebreak[k] = str(t[k]); });
    if (!out.tiebreak.q) warn('Stechfrage', 'Die Stechfrage fehlt (wird nur bei Gleichstand gebraucht).');
    out.spare = (Array.isArray(src.spare) ? src.spare : []).map((s) => {
      const o = { cat: str(s.cat).toUpperCase(), q: str(s.q), answer: str(s.answer) };
      if (str(s.fact)) o.fact = str(s.fact);
      return o;
    }).filter((s) => s.q);
    return { quiz: out, warnings };
  }

  // Reihenfolge nach den Werten (z. B. Jahreszahlen) aufsteigend
  function sortByValue(items) {
    const v = (s) => { const m = String(s.y).replace(/\./g, '').replace(',', '.').match(/-?\d+(\.\d+)?/); return m ? Number(m[0]) : Infinity; };
    return items.map((it, i) => i).sort((a, b) => v(items[a]) - v(items[b]) || a - b);
  }

  // ---------- CSV (Excel-tauglich: Semikolon, UTF-8 mit BOM) ----------
  const COLS = ['Bereich', 'Runde', 'Typ', 'Kategorie', 'Frage', 'A', 'B', 'C', 'D', 'E', 'F', 'Richtig', 'Lösung', 'Punkte', 'Bonusfrage', 'Bonuslösung', 'Bonuspunkte', 'Zeit', 'Wusstet ihr', 'Notiz', 'Bild'];
  const QT_CSV = { mc: 'Auswahl', tf: 'Falsche Aussage', open: 'Offen', est: 'Schätzen', order: 'Reihenfolge', img: 'Bild' };
  const CT_CSV = { who: 'Wer bin ich', tf: 'Mythos oder Fakt', q: 'Frage' };
  const INTRO = [
    ['Quizname', (q) => q.meta.name, (q, a) => { q.meta.name = a; }],
    ['Titel-Zeile', (q) => q.intro.title.kicker, (q, a) => { q.intro.title.kicker = a; }],
    ['Titel', (q) => q.intro.title.title, (q, a) => { q.intro.title.title = a; }],
    ['Untertitel', (q) => q.intro.title.sub, (q, a) => { q.intro.title.sub = a; }],
    ['Datum und Ort', (q) => q.intro.title.meta, (q, a) => { q.intro.title.meta = a; }],
    ['Eilmeldung-Überschrift', (q) => q.intro.eilTitle, (q, a) => { q.intro.eilTitle = a; }],
    ['Preis Platz 1', (q) => q.intro.awards.first, (q, a) => { q.intro.awards.first = a; }],
    ['Preis Platz 2', (q) => q.intro.awards.second, (q, a) => { q.intro.awards.second = a; }],
    ['Preis Platz 3', (q) => q.intro.awards.third, (q, a) => { q.intro.awards.third = a; }],
    ['Sonderpreis', (q) => q.intro.awards.special, (q, a) => { q.intro.awards.special = a; }],
    ['Danke-Titel', (q) => q.intro.outro.title, (q, a) => { q.intro.outro.title = a; }],
    ['Danke-Untertitel', (q) => q.intro.outro.sub, (q, a) => { q.intro.outro.sub = a; }],
    ['Danke-Zeile', (q) => q.intro.outro.meta, (q, a) => { q.intro.outro.meta = a; }],
  ];

  function csvRows(text) {
    const s = String(text || '').replace(/^﻿/, '');
    const first = s.split(/\r?\n/)[0] || '';
    const counts = [';', '\t', ','].map((d) => [d, first.split(d).length]);
    const D = counts.sort((a, b) => b[1] - a[1])[0][0];
    const rows = []; let row = []; let f = ''; let q = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (q) { if (c === '"') { if (s[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; continue; }
      if (c === '"') q = true;
      else if (c === D) { row.push(f); f = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
      else f += c;
    }
    if (f || row.length) { row.push(f); rows.push(row); }
    return rows.filter((r) => r.some((x) => x.trim()));
  }
  const norm = (h) => str(h).toLowerCase().replace(/[äöüß]/g, (c) => ({ ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' }[c])).replace(/[^a-z0-9]/g, '');
  const findKey = (map, v) => { const n = norm(v); return Object.keys(map).find((k) => norm(map[k]) === n || norm(k) === n || (n && norm(map[k]).startsWith(n))); };

  function fromCsv(text) {
    const rows = csvRows(text);
    const warnings = [];
    if (!rows.length) return { quiz: normalize(blank()).quiz, warnings: [{ where: 'CSV', msg: 'Die Datei ist leer.' }] };
    const head = rows[0].map(norm);
    const col = {}; COLS.forEach((c) => { col[c] = head.indexOf(norm(c)); });
    if (col.Bereich < 0 || col.Frage < 0) return { quiz: normalize(blank()).quiz, warnings: [{ where: 'CSV', msg: 'Kopfzeile nicht erkannt. Die erste Zeile muss die Spalten „Bereich“ und „Frage“ enthalten – am besten die Vorlage verwenden.' }] };
    const get = (r, c) => (col[c] >= 0 ? str(r[col[c]]) : '');
    const letters = (r) => ['A', 'B', 'C', 'D', 'E', 'F'].map((c) => get(r, c));
    const quiz = blank(); quiz.rounds = []; quiz.intro.eil = [];
    const roundNo = (v) => num(v, 1, 1, 99);
    rows.slice(1).forEach((r, i) => {
      const line = `CSV-Zeile ${i + 2}`;
      const area = norm(get(r, 'Bereich'));
      if (!area || area.startsWith('hinweis') || area.startsWith('#')) return;
      if (area.startsWith('runde')) { quiz.rounds.push({ no: roundNo(get(r, 'Runde')), name: get(r, 'Kategorie'), sub: get(r, 'Frage') }); return; }
      if (area.startsWith('frage')) {
        const tk = findKey(QT_CSV, get(r, 'Typ')) || (get(r, 'A') ? 'mc' : 'open');
        const q = { round: roundNo(get(r, 'Runde')), type: tk, cat: get(r, 'Kategorie'), q: get(r, 'Frage'), pts: get(r, 'Punkte'), time: get(r, 'Zeit'), answer: get(r, 'Lösung'), unit: '', fact: get(r, 'Wusstet ihr'), note: get(r, 'Notiz'), img: get(r, 'Bild'), bonusQ: get(r, 'Bonusfrage'), bonusA: get(r, 'Bonuslösung'), bonus: get(r, 'Bonuspunkte') };
        const L = letters(r).filter(Boolean);
        if (tk === 'order') {
          q.items = L.map((x) => { const [t, y] = x.split('|').map(str); return { t, y: y || '' }; });
          const seq = get(r, 'Richtig').toUpperCase().replace(/[^A-F]/g, '').split('');
          q.orderIdx = seq.map((c) => LET.indexOf(c));
        } else if (tk === 'mc' || tk === 'tf' || tk === 'img') {
          q.opts = L;
          const c = get(r, 'Richtig').toUpperCase().replace(/[^A-F]/g, '')[0];
          q.correct = c ? LET.indexOf(c) : 0;
          if (!c) warnings.push({ where: line, msg: 'Spalte „Richtig“ fehlt (Buchstabe der richtigen Option).' });
        }
        if (tk === 'est') { q.unit = get(r, 'Richtig'); }
        quiz.questions.push(q); return;
      }
      if (area.startsWith('buzzer')) {
        const name = get(r, 'Kategorie') || 'Buzzer';
        let cat = quiz.buzzer.find((c) => c.name === name);
        if (!cat) { cat = { name, cards: [] }; quiz.buzzer.push(cat); }
        const tk = findKey(CT_CSV, get(r, 'Typ')) || 'q';
        const cd = { type: tk, pts: get(r, 'Punkte'), answer: get(r, 'Lösung') };
        if (tk === 'who') { // Hinweise in A–F, alternativ in „Frage“ mit | getrennt
          cd.hints = letters(r).filter(Boolean);
          if (!cd.hints.length) cd.hints = get(r, 'Frage').split('|').map(str);
        } else cd.q = get(r, 'Frage');
        if (tk === 'tf') cd.truth = /fakt|wahr|true|ja/i.test(get(r, 'Richtig'));
        cat.cards.push(cd); return;
      }
      if (area.startsWith('stech')) { quiz.tiebreak = { q: get(r, 'Frage'), answer: get(r, 'Lösung'), fact: get(r, 'Wusstet ihr'), note: get(r, 'Notiz') }; return; }
      if (area.startsWith('ersatz')) { quiz.spare.push({ cat: get(r, 'Kategorie'), q: get(r, 'Frage'), answer: get(r, 'Lösung'), fact: get(r, 'Wusstet ihr') }); return; }
      if (area.startsWith('intro')) {
        const k = norm(get(r, 'Kategorie'));
        if (k.startsWith('eilmeldung') && !k.includes('ueberschrift')) { quiz.intro.eil.push([get(r, 'Frage'), get(r, 'Lösung')]); return; }
        if (k.startsWith('teamname')) { quiz.intro.teamIdeas.push(get(r, 'Frage')); return; }
        const e = INTRO.find((x) => norm(x[0]) === k);
        if (e) e[2](quiz, get(r, 'Frage')); else warnings.push({ where: line, msg: `Unbekannter Intro-Eintrag „${get(r, 'Kategorie')}“.` });
        return;
      }
      warnings.push({ where: line, msg: `Unbekannter Bereich „${get(r, 'Bereich')}“ – Zeile übersprungen.` });
    });
    if (!quiz.rounds.length) quiz.rounds = [...new Set(quiz.questions.map((q) => q.round))].sort((a, b) => a - b).map((n) => ({ no: n, name: `Runde ${n}` }));
    quiz.rounds.sort((a, b) => a.no - b.no);
    const res = normalize(quiz);
    return { quiz: res.quiz, warnings: warnings.concat(res.warnings) };
  }

  function toCsv(quizIn) {
    const quiz = normalize(quizIn).quiz;
    const rows = [COLS];
    const row = (o) => COLS.map((c) => (o[c] == null ? '' : String(o[c])));
    rows.push(row({ Bereich: 'Hinweis', Frage: 'Eine Zeile pro Eintrag. Bereich: Intro, Runde, Frage, Buzzer, Stechfrage, Ersatz. Typen: Auswahl, Falsche Aussage, Offen, Schätzen, Reihenfolge, Bild. Reihenfolge: Elemente als „Text | Wert“ in A–F, Richtig = Buchstabenfolge (z. B. B D E A C). Schätzen: Hinweis für die Teams in „Richtig“.' }));
    INTRO.forEach(([k, g]) => rows.push(row({ Bereich: 'Intro', Kategorie: k, Frage: g(quiz) })));
    quiz.intro.eil.forEach((l) => rows.push(row({ Bereich: 'Intro', Kategorie: 'Eilmeldung', Frage: l[0], Lösung: l[1] })));
    quiz.intro.teamIdeas.forEach((t) => rows.push(row({ Bereich: 'Intro', Kategorie: 'Teamname-Idee', Frage: t })));
    quiz.rounds.forEach((r) => {
      rows.push(row({ Bereich: 'Runde', Runde: r.no, Kategorie: r.name, Frage: r.sub }));
      quiz.questions.filter((q) => q.round === r.no).forEach((q) => {
        const o = { Bereich: 'Frage', Runde: r.no, Typ: QT_CSV[q.type], Kategorie: q.cat, Frage: q.q, Punkte: q.pts, Zeit: q.time, 'Wusstet ihr': q.fact, Notiz: q.note, Bild: q.img, Bonusfrage: q.bonusQ, Bonuslösung: q.bonusA, Bonuspunkte: q.bonusQ ? q.bonus : '' };
        if (q.opts) { q.opts.forEach((x, i) => { o[LET[i]] = x; }); o.Richtig = LET[q.correct]; }
        if (q.items) { q.items.forEach((x, i) => { o[LET[i]] = x.y ? `${x.t} | ${x.y}` : x.t; }); o.Richtig = q.orderIdx.map((i) => LET[i]).join(' '); }
        if (q.answer) o.Lösung = q.answer;
        if (q.type === 'est') o.Richtig = q.unit;
        rows.push(row(o));
      });
    });
    quiz.buzzer.forEach((c) => c.cards.forEach((cd) => {
      const o = { Bereich: 'Buzzer', Typ: CT_CSV[cd.type], Kategorie: c.name, Punkte: cd.pts, Lösung: cd.answer };
      if (cd.hints) cd.hints.forEach((h, i) => { o[LET[i]] = h; }); else o.Frage = cd.q;
      if (cd.type === 'tf') o.Richtig = cd.truth ? 'Fakt' : 'Mythos';
      rows.push(row(o));
    }));
    rows.push(row({ Bereich: 'Stechfrage', Frage: quiz.tiebreak.q, Lösung: quiz.tiebreak.answer, 'Wusstet ihr': quiz.tiebreak.fact, Notiz: quiz.tiebreak.note }));
    quiz.spare.forEach((s) => rows.push(row({ Bereich: 'Ersatz', Kategorie: s.cat, Frage: s.q, Lösung: s.answer, 'Wusstet ihr': s.fact })));
    const cell = (v) => (/[";\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    return '﻿' + rows.map((r) => r.map(cell).join(';')).join('\r\n') + '\r\n';
  }

  // Kleines Beispielquiz für die CSV-Vorlage
  function example() {
    const q = blank('Mein Quiz');
    q.intro.title.sub = 'Wer hat die Weltlage im Griff?'; q.intro.title.meta = 'Datum · Ort';
    q.intro.eil = [['Die Lage', 'Ein Pub, viele Teams, keine Immunität.']];
    q.intro.teamIdeas = ['Soft Power, Hard Drinks'];
    q.rounds = [{ no: 1, name: 'Weltlage', sub: 'Zum Aufwärmen' }];
    q.questions = [
      { round: 1, type: 'mc', cat: 'NATO', q: 'Wie viele Mitglieder hat die NATO?', opts: ['30', '31', '32', '33'], correct: 2, fact: 'Schweden kam 2024 dazu.' },
      { round: 1, type: 'open', cat: 'UN', q: 'Wie heißt der UN-Generalsekretär?', answer: '…', bonusQ: 'Aus welchem Land kommt er?', bonusA: '…' },
      { round: 1, type: 'est', cat: 'ZAHLEN', q: 'Wie viele Staaten haben die UN?', unit: 'Zahl notieren', answer: '193' },
      { round: 1, type: 'order', cat: 'GESCHICHTE', q: 'Ordnet die Beitritte, frühester zuerst.', items: [{ t: 'Finnland', y: '2023' }, { t: 'Polen', y: '1999' }, { t: 'Estland', y: '2004' }], orderIdx: [1, 2, 0] },
      { round: 1, type: 'tf', cat: 'FALLE', q: 'Welche Aussage ist falsch?', opts: ['Aussage 1', 'Aussage 2', 'Aussage 3'], correct: 1 },
    ];
    q.buzzer = [{ name: 'Wer bin ich?', cards: [{ type: 'who', pts: 1, hints: ['Hinweis 1', 'Hinweis 2', 'Hinweis 3'], answer: 'Lösung' }] }, { name: 'Mythos oder Fakt?', cards: [{ type: 'tf', pts: 1, q: 'Eine Aussage', truth: true, answer: 'Fakt – weil …' }] }];
    q.tiebreak = { q: 'Schätzfrage für den Gleichstand', answer: 'Zahl' };
    return normalize(q).quiz;
  }

  const api = { TYPES, CARD_TYPES, LET, MAX_OPTS, newId, slug, newQuestion, newCard, blank, normalize, sortByValue, fromCsv, toCsv, example, COLS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.QuizModel = api;
})(this);
