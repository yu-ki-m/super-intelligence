/*
 * 汎用デザインシステム — 舞台の背景（特殊な画面だけで使う）
 * タイトル画面・ログインの前の画面など、「作業の前の、入口の画面」の背景に、
 * 立体の中を漂う粒と、近い粒どうしを結ぶ線を描く。作業の画面では使わない（README の「特殊な画面」）。
 *
 * 使い方: components.js の後に <script src="stage.js" defer></script> を読み込み、
 *   <div class="ds-stage"><canvas class="ds-stage__canvas" aria-hidden="true"></canvas> … </div> を置く。
 *   data-stage-density（既定 1）で粒の多さ、data-stage-speed（既定 1）で速さを変える。
 * 描かないとき（止まった 1 コマだけ描く）:
 *   動きを減らす設定 ／ 利用者が「背景を動かす」を切った（ds.stage.setMotion(false)。localStorage の ds-stage-motion に残る）
 *   ／ 画面の外 ／ タブが隠れている
 * 色は tokens.css の --ds-color-stage-*。見た目・明るさを切り替えると描き直す。
 */
(() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const MOTION_KEY = 'ds-stage-motion';
  let userMotion = true;
  try { userMotion = localStorage.getItem(MOTION_KEY) !== 'off'; } catch (_) { /* 保存できない環境 */ }

  const rgb = (probe, name) => {
    probe.style.color = `var(${name})`;
    const m = getComputedStyle(probe).color.match(/[\d.]+/g) || ['0', '0', '0'];
    return m.slice(0, 3).map(Number).join(',');
  };
  const rand = (a, b) => a + Math.random() * (b - a);
  const instances = [];

  const create = stage => {
    const canvas = stage.querySelector(':scope > .ds-stage__canvas');
    if (!canvas || canvas.dataset.dsStage) return;
    canvas.dataset.dsStage = '1';
    const ctx = canvas.getContext('2d');
    const density = parseFloat(stage.dataset.stageDensity || '1') || 1;
    const speed = parseFloat(stage.dataset.stageSpeed || '1') || 1;
    const probe = document.createElement('span');
    probe.hidden = true;
    stage.appendChild(probe);

    let w = 0, h = 0, dpr = 1, pts = [], color = { p: '0,0,0', l: '0,0,0' };
    let angle = 0, tiltX = 0, tiltY = 0, aimX = 0, aimY = 0;
    let visible = true, raf = 0, last = 0;

    const readColors = () => { color = { p: rgb(probe, '--ds-color-stage-particle'), l: rgb(probe, '--ds-color-stage-line') }; };
    const point = () => ({ x: rand(-1, 1), y: rand(-1, 1), z: rand(-1, 1), vx: rand(-1, 1) * 0.00006, vy: rand(-1, 1) * 0.00006, vz: rand(-1, 1) * 0.00006 });
    const resize = () => {
      const r = stage.getBoundingClientRect();
      w = Math.max(1, r.width); h = Math.max(1, r.height);
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // 粒の数は面積に合わせる（狭い画面では少なく。上限 220）
      const n = Math.round(Math.min(220, Math.max(48, (w * h) / 9000)) * density);
      while (pts.length < n) pts.push(point());
      pts.length = n;
      draw(0);
    };

    const draw = dt => {
      // 動かす: 漂う・ゆっくり回る・マウスの方へ少し傾く
      for (const p of pts) {
        p.x += p.vx * dt * speed; p.y += p.vy * dt * speed; p.z += p.vz * dt * speed;
        if (p.x < -1) p.x += 2; else if (p.x > 1) p.x -= 2;
        if (p.y < -1) p.y += 2; else if (p.y > 1) p.y -= 2;
        if (p.z < -1) p.z += 2; else if (p.z > 1) p.z -= 2;
      }
      angle += 0.00005 * dt * speed;
      tiltX += (aimX - tiltX) * Math.min(1, dt * 0.003);
      tiltY += (aimY - tiltY) * Math.min(1, dt * 0.003);
      const ay = angle + tiltX * 0.35, ax = tiltY * 0.25;
      const cy = Math.cos(ay), sy = Math.sin(ay), cx = Math.cos(ax), sx = Math.sin(ax);
      const scale = Math.max(w, h) * 0.62;
      // 立体から画面へ写す（手前ほど大きく・濃く）
      const proj = pts.map(p => {
        const x1 = p.x * cy - p.z * sy, z1 = p.x * sy + p.z * cy;
        const y2 = p.y * cx - z1 * sx, z2 = p.y * sx + z1 * cx;
        const k = 1.6 / (2.6 - z2);
        return { x: w / 2 + x1 * scale * k, y: h / 2 + y2 * scale * k, k, d: (z2 + 1) / 2, wx: p.x, wy: p.y, wz: p.z };
      });
      ctx.clearRect(0, 0, w, h);
      // 近い粒どうしを線で結ぶ（立体の中での距離で決める）
      ctx.lineWidth = 1;
      const LIM = 0.32, LIM2 = LIM * LIM;
      for (let i = 0; i < proj.length; i++) {
        const a = proj[i];
        for (let j = i + 1; j < proj.length; j++) {
          const b = proj[j];
          const dx = a.wx - b.wx, dy = a.wy - b.wy, dz = a.wz - b.wz;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 > LIM2) continue;
          const alpha = (1 - Math.sqrt(d2) / LIM) * 0.35 * (0.3 + 0.7 * (a.d + b.d) / 2);
          ctx.strokeStyle = `rgba(${color.l},${alpha.toFixed(3)})`;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
      }
      // 粒（奥から手前の順に描く）
      proj.sort((a, b) => a.d - b.d);
      for (const p of proj) {
        const r = 0.5 + 1.9 * p.k * p.k;
        ctx.fillStyle = `rgba(${color.p},${(0.2 + 0.8 * p.d).toFixed(3)})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
      }
    };

    const moving = () => visible && !document.hidden && !reduce.matches && userMotion;
    const frame = now => {
      const dt = Math.min(64, last ? now - last : 16);
      last = now;
      draw(dt);
      raf = moving() ? requestAnimationFrame(frame) : 0;
    };
    const update = () => {
      if (moving() && !raf) { last = 0; raf = requestAnimationFrame(frame); }
      if (!moving() && raf) { cancelAnimationFrame(raf); raf = 0; }
    };

    new ResizeObserver(resize).observe(stage);
    new IntersectionObserver(es => { visible = es[0].isIntersecting; update(); }).observe(stage);
    stage.addEventListener('pointermove', e => {
      if (reduce.matches) return;
      const r = stage.getBoundingClientRect();
      aimX = ((e.clientX - r.left) / r.width) * 2 - 1;
      aimY = ((e.clientY - r.top) / r.height) * 2 - 1;
    });
    stage.addEventListener('pointerleave', () => { aimX = 0; aimY = 0; });
    const recolor = () => { readColors(); draw(0); };
    readColors();
    instances.push({ update, recolor });
    resize();
    update();
  };

  const updateAll = () => instances.forEach(i => i.update());
  const recolorAll = () => { instances.forEach(i => i.recolor()); setTimeout(() => instances.forEach(i => i.recolor()), 400); };
  document.addEventListener('visibilitychange', updateAll);
  reduce.addEventListener('change', updateAll);
  ['ds-themechange', 'ds-lookchange'].forEach(t => document.addEventListener(t, recolorAll));
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', recolorAll);

  window.ds = window.ds || {};
  window.ds.stage = {
    /** 背景を動かすか（利用者の設定）。localStorage に残す */
    setMotion: on => {
      userMotion = !!on;
      try { localStorage.setItem(MOTION_KEY, on ? 'on' : 'off'); } catch (_) { /* 保存できない環境 */ }
      updateAll();
    },
    motion: () => userMotion,
    /** あとから足した舞台を動かす */
    init: el => create(el),
  };
  document.querySelectorAll('.ds-stage').forEach(create);
})();
