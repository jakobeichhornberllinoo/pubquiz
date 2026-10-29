// Konfetti und Partikel auf einem Canvas, ohne Bibliothek
(function () {
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let cv = null, g = null, W = 0, H = 0, parts = [], raf = null, fixed = false;

  // host: Element, in das der Canvas kommt. Ohne w/h füllt er das Fenster (Handy).
  function init(host, w, h) {
    cv = document.createElement('canvas'); cv.className = 'fxc';
    fixed = !w;
    const size = () => {
      const dpr = fixed ? Math.min(2, window.devicePixelRatio || 1) : 1;
      W = fixed ? window.innerWidth : w; H = fixed ? window.innerHeight : h;
      cv.width = W * dpr; cv.height = H * dpr; g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    size(); if (fixed) window.addEventListener('resize', size);
    cv.style.cssText = `position:${fixed ? 'fixed' : 'absolute'};left:0;top:0;width:${fixed ? '100vw' : w + 'px'};height:${fixed ? '100vh' : h + 'px'};pointer-events:none;z-index:40`;
    host.appendChild(cv);
  }
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = (a) => a[Math.floor(Math.random() * a.length)];

  // Konfetti-Regen von oben (oder als Fontäne von einem Punkt)
  function confetti(colors, n, from) {
    if (reduce || !cv) return;
    const cols = colors && colors.length ? colors : ['#F04DB8', '#4FB3F0', '#FFC93C', '#fff'];
    const k = (n || 160) * (W / 1600 > 0.5 ? 1 : 0.5);
    for (let i = 0; i < k; i++) {
      const p = from ? { x: from.x, y: from.y, vx: rnd(-9, 9) * W / 1600, vy: rnd(-22, -9) * H / 900 }
        : { x: rnd(0, W), y: rnd(-H * 0.5, -10), vx: rnd(-2, 2), vy: rnd(2, 6) };
      parts.push(Object.assign(p, { kind: 'c', c: pick(cols), w: rnd(8, 16) * W / 1600 + 4, h: rnd(5, 9) * W / 1600 + 3, r: rnd(0, 6.3), vr: rnd(-0.25, 0.25), life: 1, sway: rnd(0, 6.3) }));
    }
    loop();
  }
  // Kreis-Explosion, z. B. beim ersten Buzz
  function burst(x, y, color, n) {
    if (reduce || !cv) return;
    for (let i = 0; i < (n || 70); i++) {
      const a = rnd(0, Math.PI * 2), s = rnd(6, 22);
      parts.push({ kind: 'b', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, c: Math.random() < 0.7 ? color : '#fff', rad: rnd(3, 9), life: 1 });
    }
    loop();
  }
  function loop() {
    if (raf) return;
    const step = () => {
      g.clearRect(0, 0, W, H);
      parts.forEach((p) => {
        if (p.kind === 'c') {
          p.vy = Math.min(p.vy + 0.35 * H / 900, 7 * H / 900 + 2); p.vx *= 0.985; p.sway += 0.08;
          p.x += p.vx + Math.sin(p.sway) * 0.8; p.y += p.vy; p.r += p.vr;
          if (p.y > H + 30) p.life = 0;
          g.save(); g.translate(p.x, p.y); g.rotate(p.r); g.fillStyle = p.c; g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.sway))); g.restore();
        } else {
          p.vx *= 0.92; p.vy = p.vy * 0.92 + 0.3; p.x += p.vx; p.y += p.vy; p.life -= 0.018;
          g.globalAlpha = Math.max(0, p.life); g.fillStyle = p.c; g.beginPath(); g.arc(p.x, p.y, p.rad, 0, 6.3); g.fill(); g.globalAlpha = 1;
        }
      });
      parts = parts.filter((p) => p.life > 0);
      raf = parts.length ? requestAnimationFrame(step) : null;
      if (!raf) g.clearRect(0, 0, W, H);
    };
    raf = requestAnimationFrame(step);
  }
  function clear() { parts = []; }

  window.FX = { init, confetti, burst, clear, reduce };
})();
