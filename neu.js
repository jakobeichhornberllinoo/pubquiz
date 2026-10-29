// Online: Spiele anlegen, wieder öffnen und schließen; Quiz hochladen. Nur mit Admin-PIN.
(function () {
  const { esc } = window.C;
  const O = window.Online;
  const $ = (id) => document.getElementById(id);
  let sets = [], rooms = [], made = null;

  const links = (code, key) => ({ host: O.page('host.html', { room: code, key }), screen: O.page('screen.html', { room: code, key }), team: O.page('team.html', { room: code }) });
  const ago = (t) => { const m = Math.round((Date.now() - (t || 0)) / 60000); return m < 1 ? 'gerade eben' : m < 60 ? `vor ${m} min` : m < 1440 ? `vor ${Math.round(m / 60)} h` : `vor ${Math.round(m / 1440)} Tagen`; };

  async function load() {
    [sets, rooms] = await Promise.all([O.listSets(), O.listRooms()]);
    render();
  }
  function render() {
    $('login').hidden = true; $('main').hidden = false;
    const L = made && links(made.code, made.key);
    $('main').innerHTML = `
      ${made ? `<div class="box okbox"><h3>SPIEL ${esc(made.code)} IST BEREIT</h3>
        <div class="bigcode">${esc(made.code)}</div>
        <div class="bctl"><a class="btn pri" href="${esc(L.screen)}" target="_blank" id="goScreen">Beamer öffnen</a><a class="btn" href="${esc(L.host)}" target="_blank" id="goHost">Moderation öffnen</a></div>
        <div class="small" style="margin-top:10px">Handys: <span class="link">${esc(L.team)}</span> (der QR-Code steht auf dem Beamer)</div>
        <div class="small" style="margin-top:6px">Die Links für Beamer und Moderation enthalten den Schlüssel dieses Spiels – nur im Moderationsteam teilen.</div></div>` : ''}
      <div class="box"><h3>NEUES SPIEL</h3>
        ${sets.length ? `<div class="small">Welches Quiz soll laufen? (Bearbeiten geht danach in der Moderation, Tab „Fragen“.)</div>
        <select class="qsel" id="set" style="margin-top:10px">${sets.map((s) => `<option value="${esc(s.id)}">${esc(s.title)} (${s.questions} Fragen)</option>`).join('')}</select>
        <div class="bctl"><button class="btn pri" id="create">Spiel anlegen</button></div>` : '<div class="small">Noch kein Quiz online. Unten eines hochladen.</div>'}</div>
      <div class="box"><h3>QUIZ HOCHLADEN</h3>
        <div class="small">JSON aus dem lokalen Editor („Fragen“ → JSON) oder eine ausgefüllte CSV-Vorlage. Bilder stecken im JSON mit drin.</div>
        <div class="bctl"><label class="btn">Datei wählen<input type="file" id="up" accept=".json,.csv,.txt" hidden></label></div></div>
      <div class="box"><h3>SPIELE (${rooms.length})</h3>
        ${rooms.map((r) => `<div class="trm"><b class="rc">${esc(r.code)}</b><span class="grow small">${esc(r.title || '')} · angelegt ${ago(r.created)}</span>
          <button class="btn sm" data-open="${esc(r.code)}">Öffnen</button><button class="btn sm ghost" data-close="${esc(r.code)}">Schließen</button></div>`).join('') || '<div class="small">Noch keine Spiele.</div>'}
        <div class="small" style="margin-top:8px">„Schließen“ löscht das Spiel mit Teams und Punkten. Die Quiz-Sets bleiben.</div></div>
      <div class="box"><h3>VOR DEM ABEND</h3><div class="small">Online braucht der Beamer-Laptop Internet, die Handys mobile Daten oder irgendein WLAN. Ohne Internet in der Kneipe: lokal starten (Laptop + Handy-Hotspot), siehe Anleitung.</div></div>`;
  }

  $('lf').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await O.login($('pin').value.trim()); await load(); } catch (err) { window.C.toast(err.message, true); }
  });
  $('main').addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    try {
      if (b.id === 'create') {
        made = await O.createRoom($('set').value);
        try { localStorage.setItem('asium_key_' + made.code, made.key); } catch (x) { /* */ }
        await load(); window.scrollTo(0, 0);
      }
      if (b.dataset.open) { const r = rooms.find((x) => x.code === b.dataset.open); made = { code: r.code, key: r.key }; render(); window.scrollTo(0, 0); }
      if (b.dataset.close && confirm(`Spiel ${b.dataset.close} schließen? Teams und Punkte dieses Spiels werden gelöscht.`)) { await O.closeRoom(b.dataset.close); if (made && made.code === b.dataset.close) made = null; await load(); }
    } catch (err) { window.C.toast(err.message, true); }
  });
  $('main').addEventListener('change', async (e) => {
    if (e.target.id !== 'up' || !e.target.files[0]) return;
    const f = e.target.files[0]; const text = await f.text();
    const csv = /\.(csv|txt)$/i.test(f.name) || !/^\s*\{/.test(text);
    try {
      const r = csv ? window.QuizModel.fromCsv(text) : window.QuizModel.normalize(JSON.parse(text));
      await O.createSet(r.quiz.meta.name && r.quiz.meta.name !== 'Quiz ohne Namen' ? r.quiz.meta.name : f.name.replace(/\.[^.]+$/, ''), r.quiz);
      window.C.toast(r.warnings.length ? `Hochgeladen – ${r.warnings.length} Hinweise, im Editor prüfen` : 'Hochgeladen ✓');
      await load();
    } catch (err) { window.C.toast(err.message, true); }
  });
  if (!window.C.online) { $('login').innerHTML = '<h3>NUR ONLINE</h3><div class="small">Diese Seite gehört zum Online-Betrieb mit Firebase. Lokal: <a class="link" href="/host">Moderation öffnen</a>.</div>'; return; }
  O.editor().then((ok) => { if (ok) load(); }).catch(() => {});
})();
