// Pixel Vibe game screen: three cannons that fire on their instrument's notes,
// three piano keys that raise a shield over each cannon, and drag-to-aim.
import { Music } from './audio.js?v=0.2.0';

const W = 180;                       // logical pixels across; height follows the screen shape
const KEY_H = 40;
const TURRET_X = [30, 90, 150];
const COLORS = ['#ff7a3d', '#37e0ff', '#ff4fd8'];   // drums, bass, vibraphone
const AIM_LIMIT = 1.25;              // radians either side of straight up
const BARREL = 13;

const SHOT = {
  kick:  { speed: 150, trail: 6 },
  snare: { speed: 190, trail: 8 },
  hat:   { speed: 260, trail: 4 },
  bass:  { speed: 125, trail: 12 },
  arp:   { speed: 210, trail: 7 },
};

const canvas = document.getElementById('screen');
const g = canvas.getContext('2d');
const music = new Music();

let H = 320, keyTop = 280, turretY = 254;
const weapons = TURRET_X.map((x, i) => ({ x, color: COLORS[i], angle: 0, recoil: 0, flash: 0 }));
const shields = COLORS.map(color => ({ color, down: 0, level: 0, flash: 0, voice: null }));
let shots = [];
let sparks = [];
let stars = [];
let pulse = 0;

function resize() {
  const vw = window.innerWidth, vh = window.innerHeight;
  H = Math.max(300, Math.min(400, Math.round(W * vh / vw)));
  canvas.width = W;
  canvas.height = H;
  keyTop = H - KEY_H;
  turretY = keyTop - 26;
  let s = Math.min(vw / W, vh / H);
  const si = Math.floor(s);
  if (si >= 1 && si / s > 0.85) s = si;   // whole-number scale keeps pixels even when it costs little
  canvas.style.width = Math.floor(W * s) + 'px';
  canvas.style.height = Math.floor(H * s) + 'px';
  stars = Array.from({ length: 70 }, () => ({ x: Math.random() * W, y: Math.random() * H, v: 4 + Math.random() * 26 }));
}

// ---------- firing ----------

function muzzle(w) {
  return { x: w.x + Math.sin(w.angle) * BARREL, y: turretY - Math.cos(w.angle) * BARREL };
}

function fire(ev) {
  const w = weapons[ev.weapon];
  w.recoil = 1;
  w.flash = 1;
  if (ev.kind === 'kick') pulse = 1;
  const spec = SHOT[ev.kind];
  const a = w.angle + (ev.kind === 'hat' ? (Math.random() - 0.5) * 0.12 : 0);
  const m = muzzle(w);
  const color = ev.kind === 'snare' ? '#ffd23d' : ev.kind === 'hat' ? '#ffe2cc' : w.color;
  shots.push({ x: m.x, y: m.y, vx: Math.sin(a) * spec.speed, vy: -Math.cos(a) * spec.speed,
    kind: ev.kind, color, trail: spec.trail });
  for (let i = 0; i < 4; i++) {
    sparks.push({ x: m.x, y: m.y, color: w.color, life: 0.12 + Math.random() * 0.1,
      vx: (Math.random() - 0.5) * 60 + Math.sin(a) * 30, vy: (Math.random() - 0.5) * 60 - Math.cos(a) * 30 });
  }
}

// ---------- update ----------

function update(dt) {
  if (music.running) for (const ev of music.drain()) fire(ev);
  for (const w of weapons) {
    w.recoil = Math.max(0, w.recoil - dt * 8);
    w.flash = Math.max(0, w.flash - dt * 6);
  }
  for (const s of shields) {
    const target = s.down > 0 ? 1 : 0;
    s.level += (target - s.level) * Math.min(1, dt * (target ? 25 : 10));
    s.flash = Math.max(0, s.flash - dt * 4);
  }
  pulse = Math.max(0, pulse - dt * 5);
  for (const st of stars) {
    st.y += st.v * dt * (1 + pulse * 2);
    if (st.y > keyTop) { st.y -= keyTop; st.x = Math.random() * W; }
  }
  for (const s of shots) { s.x += s.vx * dt; s.y += s.vy * dt; }
  shots = shots.filter(s => s.y > -12 && s.x > -12 && s.x < W + 12);
  for (const p of sparks) { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
  sparks = sparks.filter(p => p.life > 0);
}

// ---------- drawing ----------

function px(x, y, w = 1, h = 1) { g.fillRect(Math.round(x), Math.round(y), w, h); }

function disc(cx, cy, r) {
  for (let dy = -r; dy <= r; dy++) {
    const dx = Math.floor(Math.sqrt(r * r - dy * dy) + 0.3);
    g.fillRect(cx - dx, cy + dy, dx * 2 + 1, 1);
  }
}

function drawBackground() {
  g.fillStyle = '#05060c';
  g.fillRect(0, 0, W, H);
  for (const st of stars) {
    g.fillStyle = st.v > 20 ? '#c8d0ff' : st.v > 12 ? '#6a73a8' : '#353a5c';
    px(st.x, st.y, 1, st.v > 24 ? 2 : 1);
  }
  const deckTop = turretY + 12;
  g.fillStyle = '#0d1020';
  g.fillRect(0, deckTop, W, keyTop - deckTop);
  g.fillStyle = '#2a3156';
  g.fillRect(0, deckTop, W, 1);
  g.fillStyle = '#161b34';
  for (let x = 4; x < W; x += 8) g.fillRect(x, deckTop + 3, 4, 1);
  // Beat light along the deck edge
  if (pulse > 0) {
    g.globalAlpha = pulse * 0.8;
    g.fillStyle = COLORS[0];
    g.fillRect(0, deckTop, W, 1);
    g.globalAlpha = 1;
  }
}

function drawShots() {
  for (const s of shots) {
    const sp = Math.hypot(s.vx, s.vy), ux = s.vx / sp, uy = s.vy / sp;
    g.fillStyle = s.color;
    const thick = s.kind === 'kick' || s.kind === 'bass' ? 2 : 1;
    for (let k = s.trail; k >= 1; k--) {
      g.globalAlpha = (1 - k / (s.trail + 1)) * 0.6;
      px(s.x - ux * k * 1.5, s.y - uy * k * 1.5, thick, thick);
    }
    g.globalAlpha = 1;
    const x = Math.round(s.x), y = Math.round(s.y);
    if (s.kind === 'kick') {
      disc(x, y, 2);
      g.fillStyle = '#fff';
      g.fillRect(x, y, 1, 1);
    } else if (s.kind === 'snare') {
      for (let k = -2; k <= 2; k++) px(s.x - uy * k, s.y + ux * k, 1, 1);
    } else if (s.kind === 'bass') {
      g.fillRect(x - 1, y - 1, 3, 3);
      g.fillStyle = '#e6fbff';
      g.fillRect(x, y, 1, 1);
    } else if (s.kind === 'arp') {
      g.fillRect(x, y - 1, 1, 3);
      g.fillRect(x - 1, y, 3, 1);
    } else {
      g.fillRect(x, y, 1, 2);
    }
  }
  for (const p of sparks) {
    g.globalAlpha = Math.min(1, p.life * 6);
    g.fillStyle = p.color;
    px(p.x, p.y);
  }
  g.globalAlpha = 1;
}

function drawWeapon(w) {
  const x = w.x, y = turretY;
  // Mount
  g.fillStyle = '#1c2140';
  g.fillRect(x - 14, y + 5, 28, 7);
  g.fillStyle = '#3a4270';
  g.fillRect(x - 14, y + 5, 28, 1);
  g.fillStyle = w.flash > 0.3 ? w.color : '#262c52';
  g.fillRect(x - 12, y + 8, 3, 2);
  g.fillRect(x + 10, y + 8, 3, 2);
  // Barrel (drawn before the body so the body covers its base)
  const len = BARREL - w.recoil * 3;
  const sx = Math.sin(w.angle), sy = -Math.cos(w.angle);
  for (let t = 3; t <= len; t++) {
    g.fillStyle = t > len - 2 ? w.color : '#8a95c8';
    g.fillRect(Math.round(x + sx * t) - 1, Math.round(y + sy * t) - 1, 3, 3);
  }
  // Body
  g.fillStyle = '#3b4373';
  disc(x, y, 7);
  g.fillStyle = '#5d68a3';
  disc(x - 2, y - 2, 3);
  // Core lights up on each note
  g.fillStyle = w.color;
  g.globalAlpha = 0.45 + w.flash * 0.55;
  g.fillRect(x - 1, y - 1, 3, 3);
  g.globalAlpha = 1;
  if (w.flash > 0.5) {
    const m = muzzle(w);
    g.fillStyle = '#fff';
    px(m.x - 1, m.y - 1, 3, 3);
  }
}

function drawShield(s, i) {
  if (s.level < 0.02) return;
  const cx = TURRET_X[i], cy = turretY + 6, r = 19;
  const t = performance.now() / 1000;
  g.fillStyle = s.color;
  // Dithered dome fill
  g.globalAlpha = 0.18 * s.level;
  for (let dy = -r; dy <= 0; dy++) {
    const dx = Math.floor(Math.sqrt(r * r - dy * dy));
    for (let x = -dx; x <= dx; x++) if (((x + dy) & 1) === 0) g.fillRect(cx + x, cy + dy, 1, 1);
  }
  // Scan line sweeping up the dome
  const band = Math.floor((t * 36) % (r + 1));
  const bdx = Math.floor(Math.sqrt(r * r - band * band));
  g.globalAlpha = 0.45 * s.level;
  g.fillRect(cx - bdx, cy - band, bdx * 2 + 1, 1);
  // Rim
  g.globalAlpha = s.level * (0.8 + 0.2 * Math.sin(t * 40));
  for (let a = Math.PI; a <= Math.PI * 2 + 0.001; a += 0.04) {
    px(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  // Ring flash when the key goes down
  if (s.flash > 0) {
    const rr = r + (1 - s.flash) * 10;
    g.globalAlpha = s.flash;
    for (let a = Math.PI; a <= Math.PI * 2 + 0.001; a += 0.06) px(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  g.globalAlpha = 1;
}

function drawKeys() {
  g.fillStyle = '#05060c';
  g.fillRect(0, keyTop, W, KEY_H);
  for (let i = 0; i < 3; i++) {
    const s = shields[i], down = s.down > 0;
    const x0 = i * 60 + 1, w = 58;
    const faceY = keyTop + 2 + (down ? 2 : 0), faceH = KEY_H - 9;
    // Each key is its shield's colour: dimmed at rest, full and lit when held.
    const sideY = faceY + faceH, sideH = keyTop + KEY_H - 1 - sideY;
    g.fillStyle = s.color;
    g.fillRect(x0, faceY, w, faceH + sideH);
    g.fillStyle = '#000';
    g.globalAlpha = 0.55;
    g.fillRect(x0, sideY, w, sideH);
    if (!down) {
      g.globalAlpha = 0.4;
      g.fillRect(x0, faceY, w, faceH);
    }
    g.fillStyle = '#fff';
    g.globalAlpha = down ? 0.9 : 0.35;
    g.fillRect(x0, faceY, w, 1);
    if (down) {
      g.globalAlpha = 0.25 + 0.1 * s.flash;
      g.fillRect(x0 + 2, faceY + 2, w - 4, faceH - 4);
    }
    g.globalAlpha = 1;
  }
}

function draw() {
  drawBackground();
  drawShots();
  weapons.forEach(drawWeapon);
  shields.forEach(drawShield);
  drawKeys();
}

// ---------- input ----------

const pointers = new Map();   // pointerId -> { key } or { weapon }

function toLogical(e) {
  const r = canvas.getBoundingClientRect();
  return { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * H };
}

function keyAt(x) { return Math.max(0, Math.min(2, Math.floor(x / 60))); }

function pressKey(i) {
  const s = shields[i];
  if (s.down++ === 0) {
    s.flash = 1;
    s.voice = music.keyOn(i);
  }
}

function releaseKey(i) {
  const s = shields[i];
  if (s.down === 0) return;
  if (--s.down === 0) {
    music.keyOff(s.voice);
    s.voice = null;
  }
}

function aim(wi, x, y) {
  const w = weapons[wi];
  const dy = Math.max(4, turretY - y);
  w.angle = Math.max(-AIM_LIMIT, Math.min(AIM_LIMIT, Math.atan2(x - w.x, dy)));
}

canvas.addEventListener('pointerdown', e => {
  e.preventDefault();
  canvas.setPointerCapture(e.pointerId);
  const { x, y } = toLogical(e);
  if (y >= keyTop) {
    const k = keyAt(x);
    pointers.set(e.pointerId, { key: k });
    pressKey(k);
  } else {
    let wi = 0;
    for (let i = 1; i < 3; i++) if (Math.abs(x - TURRET_X[i]) < Math.abs(x - TURRET_X[wi])) wi = i;
    pointers.set(e.pointerId, { weapon: wi });
    aim(wi, x, y);
  }
});

canvas.addEventListener('pointermove', e => {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  const { x, y } = toLogical(e);
  if (p.weapon !== undefined) aim(p.weapon, x, y);
  else if (y >= keyTop - 6) {
    // Slide across the keys like a glissando
    const k = keyAt(x);
    if (k !== p.key) { releaseKey(p.key); pressKey(k); p.key = k; }
  }
});

function endPointer(e) {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  if (p.key !== undefined) releaseKey(p.key);
  pointers.delete(e.pointerId);
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('contextmenu', e => e.preventDefault());

// Keyboard: A S D (or J K L) for shields, arrows swing all cannons.
const KEYMAP = { a: 0, s: 1, d: 2, j: 0, k: 1, l: 2 };
const held = new Set();
const turn = { left: false, right: false };
addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (k in KEYMAP && !held.has(k)) { held.add(k); pressKey(KEYMAP[k]); }
  if (e.key === 'ArrowLeft') turn.left = true;
  if (e.key === 'ArrowRight') turn.right = true;
});
addEventListener('keyup', e => {
  const k = e.key.toLowerCase();
  if (held.delete(k)) releaseKey(KEYMAP[k]);
  if (e.key === 'ArrowLeft') turn.left = false;
  if (e.key === 'ArrowRight') turn.right = false;
});

function releaseAll() {
  for (const [, p] of pointers) if (p.key !== undefined) releaseKey(p.key);
  pointers.clear();
  for (const k of held) releaseKey(KEYMAP[k]);
  held.clear();
  turn.left = turn.right = false;
}
addEventListener('blur', releaseAll);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { releaseAll(); music.pause(); } else music.resume();
});

// ---------- start ----------

const startEl = document.getElementById('start');
const startBtn = document.getElementById('startBtn');
music.init().then(() => {
  startBtn.disabled = false;
  startBtn.textContent = 'TAP TO START';
}, () => { startBtn.textContent = 'SOUND FAILED TO LOAD'; });
startEl.addEventListener('click', () => {
  if (!music.ready) return;
  music.start();
  startEl.hidden = true;
});

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const spin = (turn.right ? 1 : 0) - (turn.left ? 1 : 0);
  if (spin) for (const w of weapons) w.angle = Math.max(-AIM_LIMIT, Math.min(AIM_LIMIT, w.angle + spin * dt * 1.8));
  update(dt);
  draw();
  requestAnimationFrame(frame);
}

addEventListener('resize', resize);
resize();
requestAnimationFrame(frame);

// Offline play and "Install app" support.
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

// Read-only hooks for headless checks.
window.__pv = { weapons, shields, get shots() { return shots.length; }, music };
