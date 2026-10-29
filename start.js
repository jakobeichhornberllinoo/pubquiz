// Online-Startseite der Handys: Spiel-Code eingeben, dann weiter zu team.html?room=CODE
(function () {
  const inp = document.getElementById('code');
  const pre = new URLSearchParams(location.search).get('code');
  if (pre) inp.value = pre.toUpperCase();
  inp.addEventListener('input', () => { inp.value = inp.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
  document.getElementById('f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = inp.value.trim();
    if (code.length < 4) return window.C.toast('Bitte den Code vom Beamer eingeben.', true);
    if (!window.C.online) { location.href = '/'; return; } // lokal gibt es keine Codes
    try {
      if (!(await window.Online.roomExists(code))) return window.C.toast('Kein Spiel mit diesem Code. Bitte den Code auf dem Beamer prüfen.', true);
      location.href = 'team.html?room=' + code;
    } catch (err) { window.C.toast('Keine Verbindung – Internet prüfen.', true); }
  });
})();
