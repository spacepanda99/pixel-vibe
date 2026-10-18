// Pixel Vibe game: three cannons on block foundations fire on their
// instrument's notes. Enemy ships park and shoot the blocks; shield keys block
// shots. Every 45 seconds a boss fires down at each cannon on a lead rhythm,
// so blocking it in time plays the lead part. Beat three bosses to clear the level.
import { Music, STEP } from './audio.js?v=0.6.0';

const W = 180;                       // logical pixels across; height follows the screen shape
const KEY_H = 40;
const TURRET_X = [30, 90, 150];
const COLORS = ['#ff7a3d', '#37e0ff', '#ff4fd8'];   // drums, bass, vibraphone
const AIM_LIMIT = 1.25;              // radians either side of straight up
const BARREL = 13;
const SHIELD_R = 19;

// Foundations: tiny 2px blocks, narrower at the top like a plinth.
const BLOCK = 2, F_COLS = 19, F_ROWS = 10;
const LOST_AT = 0.3;                 // a cannon falls when its blocks drop below 30%
const halfWidth = r => Math.min(9, 6 + r);

const SHOT = {
  kick:  { speed: 150, trail: 6, dmg: 3 },
  snare: { speed: 190, trail: 8, dmg: 2 },
  hat:   { speed: 260, trail: 4, dmg: 1 },
  bass:  { speed: 125, trail: 12, dmg: 2 },
  arp:   { speed: 210, trail: 7, dmg: 1 },
};

// Shield energy: drains while held, refills when let go, so shields are for timing, not camping.
const SHIELD_DRAIN = 1 / 1.6, SHIELD_REFILL = 1 / 2.5;

// Enemy waves: ships keep arriving for WAVE_TIME seconds, then the boss comes.
const WAVE_TIME = 45, ENEMY_HP = 20, SPAWN_GAP = 2.5, ENEMY_SHOT_SPEED = 75;
const ENEMY_SCALE = 2;               // sprite drawn at 2x so ships are easy to hit
const SLOTS = [[34, 74], [90, 52], [146, 74], [60, 110], [120, 110]];
const ENEMY_SPRITE = [
  '....a...a....',
  '.....a.a.....',
  '...bbbbbbb...',
  '..bbcbbbcbb..',
  '.bbbbbbbbbbb.',
  '.b.bbbbbbb.b.',
  '.b.b.....b.b.',
  '....bb.bb....',
];
const ENEMY_COLORS = ['#7cff5b', '#ff5b5b', '#c18bff', '#ffd23d'];

// Bosses, one after each wave; beating the last clears the level.
// Each boss fires the same 4 shots every bar, from the ports above the
// cannons: [16th step in the bar, cannon]. That motif is the rhythm of the
// fight, and blocking each shot with its key plays it as the lead part.
// To win, knock out the 12 big coloured blocks under the boss.
const BOSS_Y = 34, BOSS_SHOT_SPEED = 110;
const BOSS_SHOT_LEN = 24;            // long shots = a wider window to block them in time
const BOSS_BLOCKS = 12, BOSS_BLOCK_W = 10, BOSS_BLOCK_H = 8;
const BOSS_BLOCK_COLORS = ['#ff5b5b', '#ffa23d', '#ffd23d', '#7cff5b', '#37e0ff', '#c18bff'];
const BOSSES = [
  { name: 'BOSS 1', style: 'saucer', blockHp: 25, hull: '#5a1f6e', dome: '#7a2b94', trim: '#3a1247', eye: '#ffd23d',
    motif: [[0, 0], [4, 1], [8, 2], [12, 1]] },
  { name: 'BOSS 2', style: 'crab', blockHp: 35, hull: '#7a1e2a', dome: '#b8324a', trim: '#3e0d16', eye: '#7cff5b',
    motif: [[0, 0], [3, 1], [6, 2], [10, 1]] },
  { name: 'BOSS 3', style: 'mothership', blockHp: 45, hull: '#6b5310', dome: '#c99a1e', trim: '#3a2c07', eye: '#37e0ff',
    motif: [[0, 2], [3, 0], [8, 1], [11, 0]] },
];

// Aim assist: dragging near a target locks the cannon onto it and it tracks
// it; when that target dies the cannon picks the next one near where it points.
// Shots also curve gently toward their cannon's target.
const LOCK_CONE = 0.35, HOMING = 5;   // radians; radians per second

const canvas = document.getElementById('screen');
const g = canvas.getContext('2d');
const music = new Music();
const bannerEl = document.getElementById('banner');
const endEl = document.getElementById('end');

let H = 320, keyTop = 280, turretY = 246, foundTop = 258;
const weapons = TURRET_X.map((x, i) => ({ x, color: COLORS[i], angle: 0, recoil: 0, flash: 0, dead: false }));
const shields = COLORS.map(color => ({ color, down: 0, level: 0, flash: 0, voice: null, energy: 1 }));
let foundations = [];
let shots = [], enemyShots = [], bossShots = [], sparks = [], stars = [];
let enemies = [], boss = null;
let state = 'title';                 // title, wave, bossIntro, boss, bossDown, over, clear
let stage = 0, waveTimer = 0, spawned = 0, killed = 0, spawnTimer = 0, stateTimer = 0, lastStep = -1;
let pulse = 0, shake = 0;

function resize() {
  const vw = window.innerWidth, vh = window.innerHeight;
  H = Math.max(300, Math.min(400, Math.round(W * vh / vw)));
  canvas.width = W;
  canvas.height = H;
  keyTop = H - KEY_H;
  turretY = keyTop - 34;
  foundTop = turretY + 12;
  let s = Math.min(vw / W, vh / H);
  const si = Math.floor(s);
  if (si >= 1 && si / s > 0.85) s = si;   // whole-number scale keeps pixels even when it costs little
  canvas.style.width = Math.floor(W * s) + 'px';
  canvas.style.height = Math.floor(H * s) + 'px';
  stars = Array.from({ length: 70 }, () => ({ x: Math.random() * W, y: Math.random() * H, v: 4 + Math.random() * 26 }));
}

function buildFoundations() {
  foundations = TURRET_X.map(() => {
    const alive = new Uint8Array(F_COLS * F_ROWS);
    let total = 0;
    for (let r = 0; r < F_ROWS; r++) {
      for (let c = 0; c < F_COLS; c++) if (Math.abs(c - 9) <= halfWidth(r)) { alive[r * F_COLS + c] = 1; total++; }
    }
    return { alive, total, count: total };
  });
}

function reset() {
  buildFoundations();
  weapons.forEach(w => { w.dead = false; w.angle = 0; });
  shields.forEach(s => { s.energy = 1; });
  music.muted = [false, false, false];
  shots = []; enemyShots = []; bossShots = []; enemies = []; boss = null;
  spawned = 0; killed = 0; lastStep = -1; stage = 0;
  endEl.hidden = true;
  startWave();
}

function startWave() {
  state = 'wave';
  waveTimer = WAVE_TIME;
  spawnTimer = 1;
  banner('WAVE ' + (stage + 1));
}

// Between bosses, surviving cannons get their foundations rebuilt.
function repairFoundations() {
  foundations.forEach((f, i) => {
    if (weapons[i].dead) return;
    for (let r = 0; r < F_ROWS; r++) {
      for (let c = 0; c < F_COLS; c++) if (Math.abs(c - 9) <= halfWidth(r)) f.alive[r * F_COLS + c] = 1;
    }
    f.count = f.total;
  });
}

function banner(text) {
  bannerEl.textContent = text;
  bannerEl.classList.remove('show');
  void bannerEl.offsetWidth;          // restart the CSS animation
  bannerEl.classList.add('show');
}

function endGame(won) {
  state = won ? 'clear' : 'over';
  endEl.querySelector('h2').textContent = won ? 'LEVEL CLEAR' : 'GAME OVER';
  endEl.hidden = false;
  pauseBtn.hidden = true;
}

// ---------- particles ----------

function burst(x, y, color, n, speed, life = 0.35) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, v = speed * (0.3 + Math.random() * 0.7);
    sparks.push({ x, y, color, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: life * (0.5 + Math.random() * 0.5) });
  }
}

// ---------- cannons ----------

function muzzle(w) {
  return { x: w.x + Math.sin(w.angle) * BARREL, y: turretY - Math.cos(w.angle) * BARREL };
}

function targets() {
  const list = enemies.filter(e => !e.leaving && e.hp > 0);
  if (boss && boss.y >= BOSS_Y) for (const b of boss.blocks) if (b.hp > 0) list.push(b);
  return list;
}

function alive(t) { return t && t.hp > 0 && !t.gone; }

function angleTo(w, t) { return Math.atan2(t.x - w.x, turretY - t.y); }

function findTarget(w, angle, cone) {
  let best = null, bestD = cone;
  for (const t of targets()) {
    const a = angleTo(w, t);
    if (Math.abs(a) > AIM_LIMIT) continue;
    const d = Math.abs(a - angle);
    if (d < bestD) { best = t; bestD = d; }
  }
  return best;
}

function trackTargets(dt) {
  for (const w of weapons) {
    if (w.dead) continue;
    w.noLock = Math.max(0, (w.noLock || 0) - dt);
    if (!alive(w.lock)) w.lock = w.noLock > 0 ? null : findTarget(w, w.angle, LOCK_CONE);
    if (w.lock) w.angle = Math.max(-AIM_LIMIT, Math.min(AIM_LIMIT, angleTo(w, w.lock)));
  }
}

function fire(ev) {
  const w = weapons[ev.weapon];
  if (w.dead) return;
  w.recoil = 1;
  w.flash = 1;
  if (ev.kind === 'kick') pulse = 1;
  const spec = SHOT[ev.kind];
  const a = w.angle + (ev.kind === 'hat' ? (Math.random() - 0.5) * 0.12 : 0);
  const m = muzzle(w);
  const color = ev.kind === 'snare' ? '#ffd23d' : ev.kind === 'hat' ? '#ffe2cc' : w.color;
  shots.push({ x: m.x, y: m.y, vx: Math.sin(a) * spec.speed, vy: -Math.cos(a) * spec.speed,
    kind: ev.kind, color, trail: spec.trail, dmg: spec.dmg, speed: spec.speed, target: w.lock });
  for (let i = 0; i < 4; i++) {
    sparks.push({ x: m.x, y: m.y, color: w.color, life: 0.12 + Math.random() * 0.1,
      vx: (Math.random() - 0.5) * 60 + Math.sin(a) * 30, vy: (Math.random() - 0.5) * 60 - Math.cos(a) * 30 });
  }
}

function killTurret(i) {
  const w = weapons[i];
  if (w.dead) return;
  w.dead = true;
  music.muted[i] = true;                 // its instrument drops out of the song
  burst(w.x, turretY, w.color, 40, 90, 0.6);
  burst(w.x, turretY, '#ffffff', 15, 60, 0.4);
  music.sfx('boom', 1);
  music.sfx('crash', 0.5);
  shake = 0.4;
  if (weapons.every(x => x.dead)) endGame(false);
}

// ---------- foundations ----------

function blockX(i, c) { return TURRET_X[i] - 19 + c * BLOCK; }

// A shot at (x, y) moving down: if it has reached a live block in its column,
// blow a ragged hole there and return true.
function hitFoundation(x, y, radius) {
  if (y < foundTop) return false;
  for (let i = 0; i < 3; i++) {
    const c = Math.floor((x - (TURRET_X[i] - 19)) / BLOCK);
    if (c < 0 || c >= F_COLS) continue;
    const f = foundations[i];
    const maxR = Math.min(F_ROWS - 1, Math.floor((y - foundTop) / BLOCK));
    for (let r = 0; r <= maxR; r++) {
      if (!f.alive[r * F_COLS + c]) continue;
      for (let dr = -radius; dr <= radius; dr++) {
        for (let dc = -radius; dc <= radius; dc++) {
          const rr = r + dr, cc = c + dc, d = Math.abs(dr) + Math.abs(dc);
          if (rr < 0 || rr >= F_ROWS || cc < 0 || cc >= F_COLS || d > radius) continue;
          if (d > 0 && Math.random() > 0.65) continue;
          const k = rr * F_COLS + cc;
          if (f.alive[k]) { f.alive[k] = 0; f.count--; }
        }
      }
      burst(blockX(i, c) + 1, foundTop + r * BLOCK, '#8a95c8', 6, 50, 0.3);
      music.sfx('crumble', 0.18);
      if (f.count < f.total * LOST_AT) killTurret(i);
      return true;
    }
  }
  return false;
}

// Is an enemy shot at (x, y) inside a raised shield? Then it's blocked.
function shieldBlocks(x, y) {
  for (let i = 0; i < 3; i++) {
    const s = shields[i];
    if (s.level < 0.5) continue;
    const cx = TURRET_X[i], cy = turretY + 6;
    if (y <= cy + 1 && Math.hypot(x - cx, y - cy) <= SHIELD_R + 1) {
      burst(x, y, s.color, 10, 70, 0.3);
      s.flash = Math.max(s.flash, 0.6);
      return true;
    }
  }
  return false;
}

// ---------- enemies ----------

function spawnEnemy() {
  const taken = new Set(enemies.map(e => e.slot));
  const free = SLOTS.map((_, i) => i).filter(i => !taken.has(i));
  if (!free.length) return false;
  const slot = free[Math.floor(Math.random() * free.length)];
  const left = Math.random() < 0.5;
  enemies.push({
    slot, t: 0, x: left ? -10 : W + 10, y: -10,
    from: { x: left ? -10 : W + 10, y: -10 },
    ctrl: { x: W / 2 + (Math.random() - 0.5) * 100, y: 150 + Math.random() * 40 },
    hp: ENEMY_HP, flash: 0, color: ENEMY_COLORS[spawned % ENEMY_COLORS.length],
    period: 8, phase: 2 * Math.floor(Math.random() * 4), bob: Math.random() * 6,
  });
  spawned++;
  return true;
}

function enemyFire(e) {
  const alive = [0, 1, 2].filter(i => !weapons[i].dead);
  if (!alive.length) return;
  const i = alive[Math.floor(Math.random() * alive.length)];
  const tx = TURRET_X[i] + (Math.random() - 0.5) * 24, ty = foundTop;
  const dx = tx - e.x, dy = ty - (e.y + 9), d = Math.hypot(dx, dy);
  enemyShots.push({ x: e.x, y: e.y + 9, vx: dx / d * ENEMY_SHOT_SPEED, vy: dy / d * ENEMY_SHOT_SPEED });
}

function killEnemy(e) {
  burst(e.x, e.y, e.color, 30, 80, 0.5);
  burst(e.x, e.y, '#ffffff', 10, 50, 0.3);
  music.sfx('boom', 0.6);
  killed++;
}

// ---------- boss ----------

function bossShotTop() { return turretY + 6 - SHIELD_R; }   // where a boss shot meets the dome

function makeBoss(def) {
  const blocks = [];
  for (let k = 0; k < BOSS_BLOCKS; k++) {
    blocks.push({ k, hp: def.blockHp, max: def.blockHp, flash: 0, x: 0, y: 0,
      color: BOSS_BLOCK_COLORS[k % BOSS_BLOCK_COLORS.length] });
  }
  return { def, x: W / 2, y: -30, flash: 0, portFlash: [0, 0, 0], startStep: 0, nextStep: 0, blocks };
}

// Block k's top-left corner; x/y on the block are its centre (for aiming).
function bossBlockRect(b, k) {
  return { x: Math.round(b.x - 70) + 4 + k * (BOSS_BLOCK_W + 1), y: Math.round(b.y) + 12 };
}

function bossHp(b) { return b.blocks.reduce((n, k) => n + Math.max(0, k.hp), 0); }

function defeatBoss() {
  for (let k = 0; k < 6; k++) burst(boss.x + (Math.random() - 0.5) * 120, boss.y + Math.random() * 16, ENEMY_COLORS[k % 4], 25, 100, 0.8);
  music.sfx('boom', 1);
  music.sfx('crash', 0.8);
  shake = 0.6;
  for (const k of boss.blocks) k.gone = true;
  boss = null;
  bossShots = [];
  if (stage < BOSSES.length - 1) {
    stage++;
    state = 'bossDown';
    stateTimer = 3;
    repairFoundations();
    banner('BOSS DOWN');
  } else endGame(true);
}

function updateBoss(dt) {
  const b = boss;
  b.flash = Math.max(0, b.flash - dt);
  for (const k of b.blocks) {
    const r = bossBlockRect(b, k.k);
    k.x = r.x + BOSS_BLOCK_W / 2;
    k.y = r.y + BOSS_BLOCK_H / 2;
    k.flash = Math.max(0, k.flash - dt);
  }
  if (b.y < BOSS_Y) {
    b.y = Math.min(BOSS_Y, b.y + 18 * dt);
    if (b.y === BOSS_Y) {
      // Start firing two bars after it settles, on a bar line.
      b.startStep = (Math.floor(music.stepNow() / 16) + 2) * 16;
      b.nextStep = b.startStep;
    }
    return;
  }
  // Launch each shot so its middle reaches the shield exactly on its step.
  const now = music.heard();
  const y0 = b.y + 24, travel = (bossShotTop() + BOSS_SHOT_LEN / 2 - y0) / BOSS_SHOT_SPEED;
  while (music.stepTime(b.nextStep) - travel <= now) {
    const s16 = (b.nextStep - b.startStep) % 16;
    for (const [st, port] of b.def.motif) {
      if (st !== s16) continue;
      if (!weapons[port].dead) {
        const arrive = music.stepTime(b.nextStep);
        // A little sideways scatter so unblocked shots wear the whole foundation down, not one narrow hole.
        const x = TURRET_X[port] + Math.round((Math.random() - 0.5) * 10);
        bossShots.push({ port, x, y0, y: y0, launch: arrive - travel });
        b.portFlash[port] = 1;
      }
    }
    b.nextStep++;
  }
  for (let i = 0; i < 3; i++) b.portFlash[i] = Math.max(0, b.portFlash[i] - dt * 4);
  // Positions come from the audio clock, so the shots stay locked to the beat.
  for (const s of bossShots) s.y = s.y0 + (now - s.launch) * BOSS_SHOT_SPEED;
  // Blocked if its shield is up at any moment while any part of the long shot
  // is between the top of the dome and the blocks: about a quarter second.
  const top = bossShotTop();
  bossShots = bossShots.filter(s => {
    const sh = shields[s.port];
    if (s.y >= top && s.y - BOSS_SHOT_LEN <= foundTop && s.y <= foundTop + 2 && sh.level >= 0.5) {
      burst(s.x, Math.max(top, s.y - BOSS_SHOT_LEN / 2), sh.color, 14, 80, 0.35);
      sh.flash = Math.max(sh.flash, 0.8);
      return false;
    }
    if (hitFoundation(s.x, s.y, 2)) return false;
    return s.y < keyTop;
  });
}

// ---------- update ----------

function onStep(n) {
  if (state !== 'wave') return;
  for (const e of enemies) if (e.t >= 1 && !e.leaving && n % e.period === e.phase) enemyFire(e);
}

function update(dt) {
  if (music.running) {
    for (const ev of music.drain()) fire(ev);
    const n = music.stepNow();
    if (lastStep < 0 || n - lastStep > 16) lastStep = n - 1;
    while (lastStep < n) onStep(++lastStep);
  }
  const t = performance.now() / 1000;
  for (const w of weapons) {
    w.recoil = Math.max(0, w.recoil - dt * 8);
    w.flash = Math.max(0, w.flash - dt * 6);
  }
  shields.forEach((s, i) => {
    const want = s.down > 0 && !weapons[i].dead;
    if (want) s.energy = Math.max(0, s.energy - dt * SHIELD_DRAIN);
    else s.energy = Math.min(1, s.energy + dt * SHIELD_REFILL);
    const target = want && s.energy > 0 ? 1 : 0;
    s.level += (target - s.level) * Math.min(1, dt * (target ? 25 : 10));
    s.flash = Math.max(0, s.flash - dt * 4);
  });
  pulse = Math.max(0, pulse - dt * 5);
  shake = Math.max(0, shake - dt);
  for (const st of stars) {
    st.y += st.v * dt * (1 + pulse * 2);
    if (st.y > keyTop) { st.y -= keyTop; st.x = Math.random() * W; }
  }

  // Director
  if (state === 'wave') {
    waveTimer -= dt;
    spawnTimer -= dt;
    if (waveTimer > 4 && spawnTimer <= 0 && spawnEnemy()) spawnTimer = SPAWN_GAP;
    if (waveTimer <= 0) {
      // Time's up: the ships still up there retreat and the boss arrives.
      for (const e of enemies) { e.leaving = true; e.gone = true; }
      state = 'bossIntro';
      stateTimer = 3;
      banner('WARNING: ' + BOSSES[stage].name);
    }
  } else if (state === 'bossIntro') {
    stateTimer -= dt;
    if (stateTimer <= 0) {
      state = 'boss';
      const def = BOSSES[stage];
      boss = makeBoss(def);
    }
  } else if (state === 'bossDown') {
    stateTimer -= dt;
    if (stateTimer <= 0) startWave();
  }

  // Enemies fly in on a curve, then hover in their slot.
  for (const e of enemies) {
    const [sx, sy] = SLOTS[e.slot];
    e.flash = Math.max(0, e.flash - dt);
    if (e.leaving) {
      e.y -= 70 * dt;
    } else if (e.t < 1) {
      e.t = Math.min(1, e.t + dt / 2.2);
      const u = e.t * e.t * (3 - 2 * e.t), v = 1 - u;
      e.x = v * v * e.from.x + 2 * v * u * e.ctrl.x + u * u * sx;
      e.y = v * v * e.from.y + 2 * v * u * e.ctrl.y + u * u * sy;
    } else {
      e.x = sx + Math.sin(t * 1.5 + e.bob) * 3;
      e.y = sy + Math.sin(t * 2.1 + e.bob) * 1.5;
    }
  }
  if (boss && state === 'boss') updateBoss(dt);
  trackTargets(dt);

  // Player shots curve toward their cannon's target, then hit ships
  for (const s of shots) {
    if (alive(s.target)) {
      const a = Math.atan2(s.vx, -s.vy);
      let d = Math.atan2(s.target.x - s.x, s.y - s.target.y) - a;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      const na = a + Math.max(-HOMING * dt, Math.min(HOMING * dt, d));
      s.vx = Math.sin(na) * s.speed;
      s.vy = -Math.cos(na) * s.speed;
    }
    s.x += s.vx * dt;
    s.y += s.vy * dt;
  }
  shots = shots.filter(s => {
    if (s.y < -12 || s.x < -12 || s.x > W + 12) return false;
    for (const e of enemies) {
      if (e.hp > 0 && Math.abs(s.x - e.x) <= 16 && Math.abs(s.y - e.y) <= 12) {
        e.hp -= s.dmg;
        e.flash = 0.06;
        burst(s.x, s.y, s.color, 3, 40, 0.15);
        if (e.hp <= 0) killEnemy(e);
        return false;
      }
    }
    if (boss) {
      // Coloured blocks take the damage; the hull itself just soaks shots up.
      for (const k of boss.blocks) {
        if (k.hp <= 0) continue;
        const r = bossBlockRect(boss, k.k);
        if (s.x >= r.x - 1 && s.x <= r.x + BOSS_BLOCK_W + 1 && s.y >= r.y - 1 && s.y <= r.y + BOSS_BLOCK_H + 1) {
          k.hp -= s.dmg;
          k.flash = 0.06;
          burst(s.x, s.y, s.color, 3, 40, 0.15);
          if (k.hp <= 0) {
            burst(k.x, k.y, k.color, 24, 90, 0.5);
            music.sfx('boom', 0.5);
            shake = Math.max(shake, 0.15);
          }
          return false;
        }
      }
      if (s.x >= boss.x - 70 && s.x <= boss.x + 70 && s.y >= boss.y - 12 && s.y <= boss.y + 12) {
        burst(s.x, s.y, '#6a73a8', 2, 30, 0.12);
        return false;
      }
    }
    return true;
  });
  if (boss && boss.blocks.every(k => k.hp <= 0)) defeatBoss();
  enemies = enemies.filter(e => {
    const keep = e.hp > 0 && e.y > -30;
    if (!keep) e.gone = true;
    return keep;
  });

  // Enemy shots vs shields and blocks (never the cannons themselves)
  for (const s of enemyShots) { s.x += s.vx * dt; s.y += s.vy * dt; }
  enemyShots = enemyShots.filter(s => !shieldBlocks(s.x, s.y) && !hitFoundation(s.x, s.y, 1) && s.y < keyTop);

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

function sprite(map, x, y, colors, scale = 1) {
  const x0 = Math.round(x - map[0].length * scale / 2), y0 = Math.round(y - map.length * scale / 2);
  for (let r = 0; r < map.length; r++) {
    for (let c = 0; c < map[r].length; c++) {
      const col = colors[map[r][c]];
      if (col) { g.fillStyle = col; g.fillRect(x0 + c * scale, y0 + r * scale, scale, scale); }
    }
  }
}

function drawBackground() {
  g.fillStyle = '#05060c';
  g.fillRect(0, 0, W, H);
  for (const st of stars) {
    g.fillStyle = st.v > 20 ? '#c8d0ff' : st.v > 12 ? '#6a73a8' : '#353a5c';
    px(st.x, st.y, 1, st.v > 24 ? 2 : 1);
  }
  // Ground line the foundations stand on, with a beat light
  g.fillStyle = '#2a3156';
  g.fillRect(0, keyTop - 1, W, 1);
  if (pulse > 0) {
    g.globalAlpha = pulse * 0.8;
    g.fillStyle = COLORS[0];
    g.fillRect(0, keyTop - 1, W, 1);
    g.globalAlpha = 1;
  }
}

function drawFoundations() {
  foundations.forEach((f, i) => {
    for (let r = 0; r < F_ROWS; r++) {
      for (let c = 0; c < F_COLS; c++) {
        if (!f.alive[r * F_COLS + c]) continue;
        const x = blockX(i, c), y = foundTop + r * BLOCK;
        g.fillStyle = (r + c) & 1 ? '#3d4570' : '#465080';
        g.fillRect(x, y, BLOCK, BLOCK);
        g.fillStyle = r === 0 || !f.alive[(r - 1) * F_COLS + c] ? '#7c88c4' : '#58629a';
        g.fillRect(x, y, 1, 1);
      }
    }
  });
}

function drawEnemies() {
  for (const e of enemies) {
    const body = e.flash > 0 ? '#ffffff' : e.color;
    sprite(ENEMY_SPRITE, e.x, e.y, { a: '#ffd23d', b: body, c: '#05060c' }, ENEMY_SCALE);
  }
  // Time left until the boss
  if (state === 'wave') {
    g.fillStyle = '#1a1f38';
    g.fillRect(5, 3, W - 10, 2);
    g.fillStyle = '#6a73a8';
    g.fillRect(5, 3, Math.round((W - 10) * (1 - waveTimer / WAVE_TIME)), 2);
  }
  if (!boss) return;
  const b = boss, d = b.def, x0 = Math.round(b.x - 70), y = Math.round(b.y);
  const hull = b.flash > 0 ? '#ffffff' : d.hull, dome = b.flash > 0 ? '#ffffff' : d.dome;
  g.fillStyle = hull;
  g.fillRect(x0 + 4, y, 132, 12);
  g.fillRect(x0, y + 3, 140, 6);
  g.fillStyle = dome;
  if (d.style === 'saucer') {
    g.fillRect(x0 + 40, y - 8, 60, 8);
    g.fillRect(x0 + 50, y - 12, 40, 4);
  } else if (d.style === 'crab') {
    // Claws hanging off each side, two eye stalks on top
    g.fillStyle = hull;
    g.fillRect(x0 - 2, y + 6, 8, 16);
    g.fillRect(x0 + 134, y + 6, 8, 16);
    g.fillStyle = dome;
    g.fillRect(x0 + 2, y + 20, 8, 4);
    g.fillRect(x0 + 130, y + 20, 8, 4);
    g.fillRect(x0 + 44, y - 10, 6, 10);
    g.fillRect(x0 + 90, y - 10, 6, 10);
    g.fillRect(x0 + 30, y - 3, 80, 3);
  } else {
    // Mothership: tall stepped tower with running lights
    g.fillRect(x0 + 20, y - 6, 100, 6);
    g.fillRect(x0 + 36, y - 12, 68, 6);
    g.fillRect(x0 + 54, y - 18, 32, 6);
    g.fillStyle = d.eye;
    for (let k = 0; k < 8; k++) {
      g.globalAlpha = (k + Math.floor(performance.now() / 120)) % 4 === 0 ? 1 : 0.25;
      g.fillRect(x0 + 26 + k * 12, y - 4, 3, 2);
    }
    g.globalAlpha = 1;
  }
  g.fillStyle = d.eye;
  g.globalAlpha = 0.6 + pulse * 0.4;
  if (d.style === 'crab') { g.fillRect(x0 + 44, y - 13, 6, 3); g.fillRect(x0 + 90, y - 13, 6, 3); }
  else if (d.style === 'mothership') g.fillRect(x0 + 62, y - 16, 16, 3);
  else g.fillRect(x0 + 62, y - 7, 16, 3);
  g.globalAlpha = 1;
  g.fillStyle = d.trim;
  for (let k = 0; k < 132; k += 6) g.fillRect(x0 + 4 + k, y + 10, 3, 1);
  // The 12 target blocks: darker as they take damage, a white flash per hit
  for (const k of b.blocks) {
    if (k.hp <= 0) continue;
    const r = bossBlockRect(b, k.k);
    g.fillStyle = k.flash > 0 ? '#ffffff' : k.color;
    g.fillRect(r.x, r.y, BOSS_BLOCK_W, BOSS_BLOCK_H);
    g.fillStyle = '#000';
    g.globalAlpha = 0.55 * (1 - k.hp / k.max);
    g.fillRect(r.x, r.y, BOSS_BLOCK_W, BOSS_BLOCK_H);
    g.globalAlpha = 0.35;
    g.fillStyle = '#ffffff';
    g.fillRect(r.x, r.y, BOSS_BLOCK_W, 1);
    g.fillStyle = '#000';
    g.fillRect(r.x, r.y + BOSS_BLOCK_H - 1, BOSS_BLOCK_W, 1);
    g.globalAlpha = 1;
  }
  // Gun ports hang below the blocks, one over each cannon
  for (let i = 0; i < 3; i++) {
    const px0 = TURRET_X[i];
    g.fillStyle = '#1a0a22';
    g.fillRect(px0 - 3, y + 20, 6, 4);
    g.fillStyle = COLORS[i];
    g.globalAlpha = 0.35 + b.portFlash[i] * 0.65;
    g.fillRect(px0 - 2, y + 22, 4, 2);
    g.globalAlpha = 1;
  }
  // Health bar: what's left of the blocks
  const max = b.blocks.reduce((n, k) => n + k.max, 0);
  g.fillStyle = '#2a1030';
  g.fillRect(5, 3, W - 10, 3);
  g.fillStyle = '#ff4f6d';
  g.fillRect(5, 3, Math.ceil((W - 10) * bossHp(b) / max), 3);
}

// Corner brackets around each cannon's locked target
function drawLocks() {
  for (const w of weapons) {
    if (w.dead || !alive(w.lock)) continue;
    const t = w.lock, big = enemies.includes(t);
    const hw = big ? 15 : 7, hh = big ? 11 : 6, x = Math.round(t.x), y = Math.round(t.y);
    g.fillStyle = w.color;
    g.globalAlpha = 0.85;
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const cx = x + sx * hw, cy = y + sy * hh;
      g.fillRect(sx < 0 ? cx : cx - 2, cy, 3, 1);
      g.fillRect(cx, sy < 0 ? cy : cy - 2, 1, 3);
    }
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
  for (const s of enemyShots) {
    g.fillStyle = '#ff5b5b';
    px(s.x - 1, s.y - 1, 2, 3);
    g.fillStyle = '#ffd23d';
    px(s.x - 1, s.y, 1, 1);
  }
  // Boss shots: long bolts in the colour of the key that blocks them.
  for (const s of bossShots) {
    const y = Math.round(s.y), x = Math.round(s.x);
    g.fillStyle = COLORS[s.port];
    g.globalAlpha = 0.45;
    g.fillRect(x - 3, y - BOSS_SHOT_LEN, 7, BOSS_SHOT_LEN);
    g.globalAlpha = 1;
    g.fillRect(x - 2, y - BOSS_SHOT_LEN + 2, 5, BOSS_SHOT_LEN - 2);
    g.fillStyle = '#ffffff';
    g.fillRect(x - 1, y - BOSS_SHOT_LEN + 4, 3, BOSS_SHOT_LEN - 5);
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
  g.fillRect(x - 11, y + 5, 22, 7);
  g.fillStyle = '#3a4270';
  g.fillRect(x - 11, y + 5, 22, 1);
  if (w.dead) {
    // Wreck: dark, barrel gone, smoke
    g.fillStyle = '#23263a';
    disc(x, y + 3, 6);
    if (Math.random() < 0.3) sparks.push({ x: x + (Math.random() - 0.5) * 6, y: y, color: '#4a4f66', vx: (Math.random() - 0.5) * 6, vy: -12 - Math.random() * 10, life: 0.8 });
    return;
  }
  g.fillStyle = w.flash > 0.3 ? w.color : '#262c52';
  g.fillRect(x - 9, y + 8, 3, 2);
  g.fillRect(x + 7, y + 8, 3, 2);
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
  const cx = TURRET_X[i], cy = turretY + 6, r = SHIELD_R;
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
  // Ring flash when the key goes down or a shot is blocked
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
    // Shield energy
    g.globalAlpha = 0.5;
    g.fillStyle = '#000';
    g.fillRect(x0 + 4, faceY + faceH - 5, w - 8, 2);
    g.globalAlpha = 1;
    g.fillStyle = s.energy < 0.2 ? '#ff3b3b' : '#ffffff';
    g.fillRect(x0 + 4, faceY + faceH - 5, Math.round((w - 8) * s.energy), 2);
  }
}

function draw() {
  g.save();
  if (shake > 0) g.translate(Math.round((Math.random() - 0.5) * shake * 8), Math.round((Math.random() - 0.5) * shake * 8));
  drawBackground();
  drawEnemies();
  drawLocks();
  drawShots();
  drawFoundations();
  weapons.forEach(drawWeapon);
  shields.forEach(drawShield);
  g.restore();
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
  w.lock = findTarget(w, w.angle, LOCK_CONE);   // snap onto whatever is near the finger
  w.noLock = 0;
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

// ---------- start, pause and quit ----------

const startEl = document.getElementById('start');
const startBtn = document.getElementById('startBtn');
const pauseEl = document.getElementById('pause');
const pauseBtn = document.getElementById('pauseBtn');
let paused = false;
let backArmed = false;      // a history entry is pushed, so the phone's Back button opens the pause menu
let updateReady = false;    // a newer version took over; load it at the next quit

function armBack() {
  if (!backArmed) { history.pushState({ pv: 1 }, ''); backArmed = true; }
}

function pauseGame() {
  if (state === 'title' || paused || !endEl.hidden) return;
  paused = true;
  releaseAll();
  music.pause();
  pauseEl.hidden = false;
}

function resumeGame() {
  paused = false;
  pauseEl.hidden = true;
  music.resume();
  last = performance.now();
  armBack();
}

function playAgain() {
  resumeGame();
  pauseBtn.hidden = false;
  reset();
}

function quitToTitle() {
  if (updateReady) { location.reload(); return; }
  paused = false;
  pauseEl.hidden = true;
  endEl.hidden = true;
  pauseBtn.hidden = true;
  releaseAll();
  music.stop();
  state = 'title';
  shots = []; enemyShots = []; bossShots = []; enemies = []; boss = null; sparks = [];
  weapons.forEach(w => { w.dead = false; w.angle = 0; });
  buildFoundations();
  startEl.hidden = false;
}

// Leaving the app mid-game (home button, call, lock screen) comes back to the pause menu.
document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(); });
// Back opens the pause menu; Back again leaves the app.
addEventListener('popstate', () => {
  backArmed = false;
  pauseGame();
});
addEventListener('keydown', e => {
  if (e.key !== 'Escape' || state === 'title' || !endEl.hidden) return;
  if (paused) resumeGame(); else pauseGame();
});

music.init().then(() => {
  startBtn.disabled = false;
  startBtn.textContent = 'TAP TO START';
}, () => { startBtn.textContent = 'SOUND FAILED TO LOAD'; });
startEl.addEventListener('click', () => {
  if (!music.ready) return;
  music.start();
  startEl.hidden = true;
  pauseBtn.hidden = false;
  armBack();
  reset();
});
pauseBtn.addEventListener('click', pauseGame);
document.getElementById('resumeBtn').addEventListener('click', resumeGame);
document.getElementById('restartBtn').addEventListener('click', playAgain);
document.getElementById('quitBtn').addEventListener('click', quitToTitle);
document.getElementById('againBtn').addEventListener('click', playAgain);
document.getElementById('menuBtn').addEventListener('click', quitToTitle);

// X: close the app. An installed app on Android can usually close itself;
// where the browser won't allow it (iPhone, a normal tab), say how instead.
const closedEl = document.getElementById('closed');
function closeApp(e) {
  e.stopPropagation();
  releaseAll();
  music.stop();
  window.close();
  setTimeout(() => { closedEl.hidden = false; }, 300);
}
for (const id of ['closeTitle', 'closePause']) document.getElementById(id).addEventListener('click', closeApp);
document.getElementById('reopenBtn').addEventListener('click', () => {
  closedEl.hidden = true;
  quitToTitle();
});

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const spin = (turn.right ? 1 : 0) - (turn.left ? 1 : 0);
  if (spin) {
    for (const w of weapons) {
      w.lock = null;
      w.noLock = 0.4;
      w.angle = Math.max(-AIM_LIMIT, Math.min(AIM_LIMIT, w.angle + spin * dt * 1.8));
    }
  }
  if (!paused) update(dt);
  draw();
  requestAnimationFrame(frame);
}

addEventListener('resize', resize);
resize();
buildFoundations();
requestAnimationFrame(frame);

// Offline play and "Install app" support. sw.js always fetches code fresh, and
// the app checks for a new version on every launch and every return to it. When
// a new version takes over: reload now at the title screen, or at the next quit
// so a game in progress is never cut off.
if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => {
    document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
  }).catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return;
    if (state === 'title') location.reload(); else updateReady = true;
  });
}

// Hooks for headless checks.
window.__pv = {
  weapons, shields, music,
  get state() { return state; },
  get paused() { return paused; },
  get counts() { return { stage, waveTimer: +waveTimer.toFixed(1), shots: shots.length, enemies: enemies.length, enemyShots: enemyShots.length, bossShots: bossShots.length, killed, blocks: foundations.map(f => f.count), boss: boss && { name: boss.def.name, y: boss.y, hp: bossHp(boss), blocks: boss.blocks.filter(k => k.hp > 0).length }, locks: weapons.map(w => alive(w.lock)) }; },
  skipToBoss() { waveTimer = 0; },
  killBoss() { if (boss) for (const k of boss.blocks) k.hp = 0; },
  aimAt(i, x, y) { aim(i, x, y); },
};
