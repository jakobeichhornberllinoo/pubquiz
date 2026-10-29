// Show-Töne per WebAudio: nichts muss geladen werden, alles lizenzfrei erzeugt
(function () {
  let ac = null, master = null, vol = 0.8, muted = false;
  const live = new Set(); // laufende Klänge, damit ein Tastendruck sie abbrechen kann

  function ctx() {
    if (!ac) {
      ac = new (window.AudioContext || window.webkitAudioContext)();
      master = ac.createGain(); master.connect(ac.destination); apply();
    }
    if (ac.state === 'suspended') ac.resume();
    return ac;
  }
  function apply() { if (master) master.gain.value = muted ? 0 : vol; }
  function track(node, end) { live.add(node); node.onended = () => live.delete(node); node.stop(end); }

  function tone(f, start, dur, type, gain, to) {
    const t0 = ac.currentTime + start;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type || 'triangle'; o.frequency.setValueAtTime(f, t0);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain || 0.3, t0 + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(master); o.start(t0); track(o, t0 + dur + 0.05);
  }
  let noiseBuf = null;
  function noise(start, dur, gain, freq, q, sweepTo) {
    if (!noiseBuf) {
      noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
      const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const t0 = ac.currentTime + start;
    const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = noiseBuf; s.loop = true;
    f.type = 'bandpass'; f.frequency.setValueAtTime(freq || 1000, t0); f.Q.value = q || 0.8;
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain || 0.3, t0 + Math.min(0.02, dur / 3));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f); f.connect(g); g.connect(master); s.start(t0); track(s, t0 + dur + 0.05);
  }

  const S = {
    tick() { tone(1500, 0, 0.04, 'square', 0.08); },
    tock() { tone(1000, 0, 0.05, 'square', 0.1); },
    gong() { [[110, 2.6, 0.45], [220, 2, 0.25], [331, 1.4, 0.12], [440, 1, 0.08]].forEach(([f, d, g]) => tone(f, 0, d, 'sine', g)); noise(0, 0.4, 0.15, 400, 0.5); },
    whoosh() { noise(0, 0.55, 0.35, 300, 1.2, 4000); },
    news() { [[784, 0], [988, 0.12], [1175, 0.24], [1568, 0.36]].forEach(([f, s]) => tone(f, s, 0.22, 'square', 0.12)); },
    pop() { tone(500, 0, 0.12, 'sine', 0.35, 1100); },
    open() { tone(660, 0, 0.1); tone(990, 0.09, 0.18); },
    buzz() { [523, 659, 784].forEach((f) => tone(f, 0, 0.5, 'sawtooth', 0.12)); tone(1046, 0.05, 0.45, 'square', 0.1); noise(0, 0.15, 0.25, 2500, 0.6); },
    ok() { tone(660, 0, 0.12); tone(880, 0.1, 0.12); tone(1320, 0.2, 0.35); },
    wrong() { tone(233, 0, 0.32, 'sawtooth', 0.2); tone(196, 0.3, 0.5, 'sawtooth', 0.2); },
    hit() { noise(0, 1.1, 0.4, 6000, 0.3); tone(80, 0, 0.4, 'sine', 0.5, 40); },
    drumroll(sec) {
      const d = sec || 1.6; const n = Math.floor(d / 0.045);
      for (let i = 0; i < n; i++) noise(i * 0.045, 0.06, 0.06 + 0.22 * (i / n), 180 + 200 * Math.random(), 0.9);
    },
    fanfare() {
      [[523, 0, 0.18], [659, 0.16, 0.18], [784, 0.32, 0.18], [1046, 0.5, 0.9]].forEach(([f, s, d]) => { tone(f, s, d, 'square', 0.12); tone(f / 2, s, d, 'triangle', 0.18); });
      [[784, 1.15, 0.16], [1046, 1.3, 1.1]].forEach(([f, s, d]) => { tone(f, s, d, 'square', 0.12); tone(f * 1.25, s, d, 'triangle', 0.1); });
      noise(0.5, 1.4, 0.18, 7000, 0.3);
    },
  };

  window.SFX = {
    play(name, arg) { try { ctx(); if (S[name]) S[name](arg); } catch (e) { /* kein Ton möglich */ } },
    set(v, m) { vol = v == null ? vol : v; muted = !!m; apply(); },
    stopAll() { live.forEach((n) => { try { n.stop(); } catch (e) { /* */ } }); live.clear(); },
    unlock() { try { ctx(); } catch (e) { /* */ } },
  };
})();
