/* Canvas 演出エンジン（光の粒子・波紋）。
 * 長時間稼働を想定し、
 *  - 粒子/波紋はオブジェクトプールで再利用（上限固定・GC を抑制）
 *  - 粒子の見た目は色×形ごとにスプライトを事前描画してキャッシュ（上限あり）
 *  - 演出がない間は 30fps に間引き、タブ非表示時は rAF 停止に任せる
 */
(function (global) {
  'use strict';

  const W = 1080;
  const H = 1920;
  const MAX_PARTICLES = 700;
  const MAX_RIPPLES = 32;
  const AMBIENT_COUNT = 18;
  const SPRITE = 64;
  const SPRITE_CACHE_LIMIT = 80;

  const rand = (a, b) => a + Math.random() * (b - a);

  /* ---------- スプライト描画 ---------- */
  const SHAPES = {
    star4(c, col) {
      glow(c, col, 0.55);
      c.fillStyle = '#fff';
      c.beginPath();
      for (let i = 0; i < 8; i++) {
        const r = i % 2 === 0 ? 26 : 5;
        const a = (Math.PI / 4) * i - Math.PI / 2;
        c.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r);
      }
      c.closePath();
      c.fill();
      c.globalCompositeOperation = 'source-atop';
      c.fillStyle = col; c.globalAlpha = 0.45; c.fillRect(0, 0, SPRITE, SPRITE);
    },
    orb(c, col) {
      const g = c.createRadialGradient(32, 32, 0, 32, 32, 30);
      g.addColorStop(0, '#ffffff'); g.addColorStop(0.25, col); g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g; c.fillRect(0, 0, SPRITE, SPRITE);
    },
    leaf(c, col) {
      glow(c, col, 0.25);
      c.fillStyle = col;
      c.beginPath();
      c.moveTo(32, 6);
      c.quadraticCurveTo(58, 32, 32, 58);
      c.quadraticCurveTo(6, 32, 32, 6);
      c.fill();
      c.strokeStyle = 'rgba(255,255,255,0.7)'; c.lineWidth = 2;
      c.beginPath(); c.moveTo(32, 10); c.lineTo(32, 54); c.stroke();
    },
    heart(c, col) {
      glow(c, col, 0.4);
      c.fillStyle = col;
      c.beginPath();
      c.moveTo(32, 54);
      c.bezierCurveTo(6, 36, 8, 12, 24, 12);
      c.bezierCurveTo(30, 12, 32, 18, 32, 20);
      c.bezierCurveTo(32, 18, 34, 12, 40, 12);
      c.bezierCurveTo(56, 12, 58, 36, 32, 54);
      c.fill();
      c.fillStyle = 'rgba(255,255,255,0.6)';
      c.beginPath(); c.ellipse(23, 22, 5, 3, -0.6, 0, Math.PI * 2); c.fill();
    },
    drop(c, col) {
      glow(c, col, 0.3);
      const g = c.createLinearGradient(32, 6, 32, 58);
      g.addColorStop(0, '#ffffff'); g.addColorStop(1, col);
      c.fillStyle = g;
      c.beginPath();
      c.moveTo(32, 4);
      c.bezierCurveTo(44, 26, 48, 36, 48, 42);
      c.arc(32, 42, 16, 0, Math.PI);
      c.bezierCurveTo(16, 36, 20, 26, 32, 4);
      c.fill();
    },
    ember(c, col) {
      const g = c.createRadialGradient(32, 32, 0, 32, 32, 30);
      g.addColorStop(0, '#fff6d0'); g.addColorStop(0.2, '#ffd27a'); g.addColorStop(0.45, col); g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g; c.fillRect(0, 0, SPRITE, SPRITE);
    },
    snow(c, col) {
      const g = c.createRadialGradient(32, 32, 0, 32, 32, 28);
      g.addColorStop(0, '#ffffff'); g.addColorStop(0.35, col); g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g; c.fillRect(0, 0, SPRITE, SPRITE);
      c.strokeStyle = 'rgba(255,255,255,0.85)'; c.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        const a = (Math.PI / 3) * i;
        c.beginPath();
        c.moveTo(32 - Math.cos(a) * 18, 32 - Math.sin(a) * 18);
        c.lineTo(32 + Math.cos(a) * 18, 32 + Math.sin(a) * 18);
        c.stroke();
      }
    },
    bubble(c, col) {
      c.strokeStyle = col; c.lineWidth = 3; c.globalAlpha = 0.9;
      c.beginPath(); c.arc(32, 32, 26, 0, Math.PI * 2); c.stroke();
      const g = c.createRadialGradient(32, 32, 10, 32, 32, 28);
      g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(255,255,255,0.25)');
      c.fillStyle = g; c.fill();
      c.fillStyle = 'rgba(255,255,255,0.9)';
      c.beginPath(); c.ellipse(22, 21, 6, 3.5, -0.7, 0, Math.PI * 2); c.fill();
    },
    confetti(c, col) {
      glow(c, col, 0.2);
      c.fillStyle = col; c.fillRect(20, 12, 24, 40);
      c.fillStyle = 'rgba(255,255,255,0.45)'; c.fillRect(20, 12, 8, 40);
    },
    prism(c, col) {
      glow(c, col, 0.5);
      c.fillStyle = col;
      c.beginPath();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? 26 : 11;
        const a = (Math.PI / 5) * i - Math.PI / 2;
        c.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r);
      }
      c.closePath(); c.fill();
      c.fillStyle = 'rgba(255,255,255,0.7)';
      c.beginPath(); c.arc(32, 32, 5, 0, Math.PI * 2); c.fill();
    },
  };

  function glow(c, col, alpha) {
    const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.save(); c.globalAlpha = alpha; c.fillStyle = g; c.fillRect(0, 0, SPRITE, SPRITE); c.restore();
  }

  const spriteCache = new Map();
  function sprite(shape, color) {
    const key = shape + '|' + color;
    let s = spriteCache.get(key);
    if (s) return s;
    if (spriteCache.size >= SPRITE_CACHE_LIMIT) spriteCache.delete(spriteCache.keys().next().value);
    s = document.createElement('canvas');
    s.width = s.height = SPRITE;
    const c = s.getContext('2d');
    (SHAPES[shape] || SHAPES.orb)(c, color);
    spriteCache.set(key, s);
    return s;
  }

  /* ---------- プール ---------- */
  const particles = Array.from({ length: MAX_PARTICLES }, () => ({ on: false }));
  const ripples = Array.from({ length: MAX_RIPPLES }, () => ({ on: false }));
  const ambient = [];

  let canvas, ctx, cx = W / 2, cy = 760;
  let rafId = 0, lastTs = 0, lastDraw = 0, activeCount = 0;
  let ambientColor = '#ffd98a';

  function init(el, center) {
    canvas = el;
    canvas.width = W; canvas.height = H;
    ctx = canvas.getContext('2d');
    if (center) { cx = center.x; cy = center.y; }
    for (let i = 0; i < AMBIENT_COUNT; i++) {
      ambient.push({ x: rand(0, W), y: rand(H * 0.3, H), vx: rand(-0.3, 0.3), vy: rand(-0.5, -0.15), size: rand(6, 14), ph: rand(0, 6.28) });
    }
    start();
  }

  function setAmbientColor(col) { ambientColor = col; }

  function spawn(theme) {
    const p = theme.particle;
    const cols = theme.colors;
    for (let n = 0; n < p.count; n++) {
      const q = particles.find((x) => !x.on);
      if (!q) break; // 上限到達時は追加しない
      q.on = true;
      q.shape = p.shape; q.motion = p.motion;
      q.cols = cols; q.ci = n % cols.length; q.hueCycle = !!p.hueCycle;
      q.size = rand(p.size[0], p.size[1]) * 2.2;
      q.speed = rand(p.speed[0], p.speed[1]);
      q.rot = rand(0, 6.28); q.vr = rand(-0.05, 0.05);
      q.ph = rand(0, 6.28); q.twinkle = !!p.twinkle; q.flicker = !!p.flicker;
      q.age = 0; q.delay = Math.floor(rand(0, 90));
      q.life = rand(220, 360);
      switch (p.motion) {
        case 'rise': case 'wobble':
          q.x = rand(0, W); q.y = H + rand(0, 300); q.vx = rand(-0.4, 0.4); q.vy = -q.speed; break;
        case 'float':
          q.x = cx + rand(-380, 380); q.y = cy + rand(200, 900); q.vx = rand(-0.3, 0.3); q.vy = -q.speed; break;
        case 'fall':
          q.x = rand(0, W); q.y = -rand(0, 400); q.vx = rand(-0.2, 0.2); q.vy = q.speed; break;
        case 'drift':
          q.x = rand(0, W); q.y = -rand(0, 500); q.vx = rand(-0.5, 0.5); q.vy = q.speed; q.vr = rand(-0.03, 0.03); break;
        case 'swirl':
          q.ang = rand(0, 6.28); q.rad = rand(40, 200); q.x = cx; q.y = cy; q.vx = 0; q.vy = 0; break;
        case 'burst': default: {
          const a = rand(0, 6.28);
          q.x = cx; q.y = cy; q.vx = Math.cos(a) * q.speed; q.vy = Math.sin(a) * q.speed; q.delay = Math.floor(rand(0, 20));
        }
      }
      activeCount++;
    }
    const r = theme.ripple;
    for (let i = 0; i < r.count; i++) {
      const q = ripples.find((x) => !x.on);
      if (!q) break;
      q.on = true; q.style = r.style; q.r = 20; q.width = r.width; q.speed = r.speed;
      q.color = theme.colors[i % theme.colors.length]; q.idx = i;
      q.delay = i * (r.style === 'wave' ? 28 : 16); q.age = 0; q.maxR = r.style === 'flash' ? 900 : 760;
      activeCount++;
    }
    start();
  }

  /** 既存の粒子・波紋を短時間でフェードアウトさせる（色の切り替え時に混色を防ぐ） */
  function fadeOut() {
    for (const p of particles) {
      if (!p.on) continue;
      if (p.delay > 0) { p.on = false; activeCount--; continue; }
      p.age = Math.max(p.age, p.life * 0.85);
    }
    for (const r of ripples) {
      if (r.on && r.delay > 0) { r.on = false; activeCount--; }
    }
  }

  function clear() {
    particles.forEach((p) => { p.on = false; });
    ripples.forEach((r) => { r.on = false; });
    activeCount = 0;
  }

  function start() {
    if (!rafId) { lastTs = 0; rafId = requestAnimationFrame(frame); }
  }

  function stop() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }

  function frame(ts) {
    rafId = requestAnimationFrame(frame);
    // 演出がないときは 30fps に間引き
    if (activeCount === 0 && ts - lastDraw < 33) return;
    const dt = lastTs ? Math.min(3, (ts - lastTs) / 16.67) : 1;
    lastTs = ts; lastDraw = ts;
    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';
    drawAmbient(dt, ts);
    drawRipples(dt);
    drawParticles(dt, ts);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  function drawAmbient(dt, ts) {
    const img = sprite('orb', ambientColor);
    for (const a of ambient) {
      a.x += a.vx * dt; a.y += a.vy * dt;
      if (a.y < -20) { a.y = H + 20; a.x = rand(0, W); }
      if (a.x < -20) a.x = W + 20; else if (a.x > W + 20) a.x = -20;
      ctx.globalAlpha = 0.25 + 0.25 * Math.sin(ts / 700 + a.ph);
      ctx.drawImage(img, a.x - a.size, a.y - a.size, a.size * 2, a.size * 2);
    }
  }

  function drawParticles(dt, ts) {
    for (const p of particles) {
      if (!p.on) continue;
      if (p.delay > 0) { p.delay -= dt; continue; }
      p.age += dt;
      switch (p.motion) {
        case 'swirl':
          p.ang += 0.012 * p.speed * dt; p.rad += 0.9 * dt;
          p.x = cx + Math.cos(p.ang) * p.rad; p.y = cy + Math.sin(p.ang) * p.rad * 0.85; break;
        case 'drift':
          p.x += (p.vx + Math.sin(p.age / 30 + p.ph) * 1.4) * dt; p.y += p.vy * dt; break;
        case 'wobble':
          p.x += (p.vx + Math.sin(p.age / 18 + p.ph) * 1.1) * dt; p.y += p.vy * dt; break;
        case 'float':
          p.x += (p.vx + Math.sin(p.age / 25 + p.ph) * 0.8) * dt; p.y += p.vy * dt; break;
        case 'burst':
          p.vx *= Math.pow(0.975, dt); p.vy = p.vy * Math.pow(0.975, dt) + 0.04 * dt;
          p.x += p.vx * dt; p.y += p.vy * dt; break;
        default:
          p.x += (p.vx + Math.sin(p.age / 40 + p.ph) * 0.3) * dt; p.y += p.vy * dt;
      }
      p.rot += p.vr * dt;
      const t = p.age / p.life;
      if (t >= 1 || p.y < -200 || p.y > H + 400) { p.on = false; activeCount--; continue; }
      let alpha = t < 0.1 ? t / 0.1 : t > 0.75 ? (1 - t) / 0.25 : 1;
      if (p.twinkle) alpha *= 0.55 + 0.45 * Math.sin(ts / 120 + p.ph);
      if (p.flicker) alpha *= 0.6 + 0.4 * Math.random();
      const ci = p.hueCycle ? (p.ci + Math.floor(ts / 250)) % p.cols.length : p.ci;
      const img = sprite(p.shape, p.cols[ci]);
      ctx.globalAlpha = Math.max(0, alpha);
      const s = p.size;
      if (p.shape === 'leaf' || p.shape === 'confetti' || p.shape === 'star4' || p.shape === 'prism') {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.drawImage(img, -s / 2, -s / 2, s, s);
        ctx.restore();
      } else {
        ctx.drawImage(img, p.x - s / 2, p.y - s / 2, s, s);
      }
    }
  }

  function drawRipples(dt) {
    for (const r of ripples) {
      if (!r.on) continue;
      if (r.delay > 0) { r.delay -= dt; continue; }
      r.age += dt;
      r.r += r.speed * dt * (r.style === 'shock' ? Math.max(0.3, 1 - r.r / r.maxR) * 1.6 : 1);
      if (r.r >= r.maxR) { r.on = false; activeCount--; continue; }
      const t = r.r / r.maxR;
      const a = 1 - t;
      ctx.globalAlpha = a;
      ctx.lineWidth = r.width;
      ctx.strokeStyle = r.color;
      ctx.setLineDash([]);
      switch (r.style) {
        case 'soft':
          ctx.globalAlpha = a * 0.35; ctx.lineWidth = r.width * (1 + t * 2);
          circle(r.r); break;
        case 'double':
          circle(r.r); ctx.globalAlpha = a * 0.6; circle(r.r * 0.86); break;
        case 'water':
          ctx.beginPath(); ctx.ellipse(cx, cy + 420, r.r, r.r * 0.22, 0, 0, Math.PI * 2); ctx.stroke(); break;
        case 'shock':
          ctx.globalAlpha = a * a; ctx.lineWidth = r.width * (1 - t * 0.7); circle(r.r); break;
        case 'flash': {
          const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r.r);
          g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.8, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.globalAlpha = a; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r.r, 0, Math.PI * 2); ctx.fill(); break;
        }
        case 'ellipse': {
          const w = 1 + 0.06 * Math.sin(r.age / 6);
          ctx.beginPath(); ctx.ellipse(cx, cy, r.r * w, r.r / w, 0, 0, Math.PI * 2); ctx.stroke(); break;
        }
        case 'dash':
          ctx.setLineDash([24, 18]); ctx.lineDashOffset = -r.age * 2; circle(r.r); ctx.setLineDash([]); break;
        case 'rainbow':
          ctx.globalAlpha = a * 0.8; circle(r.r); break;
        default:
          circle(r.r);
      }
    }
  }

  function circle(radius) {
    ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.stroke();
  }

  function stats() {
    return {
      particles: particles.filter((p) => p.on).length,
      ripples: ripples.filter((r) => r.on).length,
      activeCount,
      spriteCache: spriteCache.size,
      running: !!rafId,
    };
  }

  global.HadoEffects = { init, spawn, fadeOut, clear, start, stop, setAmbientColor, stats };
})(window);
