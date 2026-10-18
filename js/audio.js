// Pixel Vibe sound engine: recorded samples played on the AudioContext clock.
// Notes are scheduled a little ahead (refilled every 25 ms) against
// ctx.currentTime, never setTimeout or frame counts, so the beat can't drift
// when the frame rate hiccups. Each scheduled note also queues an event that
// the game drains once the note is audible, so shots fire on the beat you hear.

export const BPM = 112;
const STEP = 60 / BPM / 4;   // one 16th note, in seconds
const BAR = 16;
const LOOKAHEAD = 0.12;
const TICK_MS = 25;

const NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const GRID = [0, 3, 6, 9];   // pitch classes stored on disk (see audio/CREDITS.md)

// What each cannon and the shield keys play. Ships will swap these later.
export const LOADOUT = {
  kit: { dir: 'tr808', kick: 'BD2525', snare: 'SD2550', hat: 'CH', openHat: 'OH10', clap: 'CP' },
  bass: { name: 'synth_bass_1', lo: 1, hi: 4 },
  harmony: { name: 'vibraphone', lo: 2, hi: 6 },
  keys: { name: 'pad_2_warm', lo: 2, hi: 6 },
};

// Am - F - C - G, one bar each. triad = root, third, fifth (MIDI). Each shield
// key plays one tone of the chord that's sounding, so presses always fit.
const CHORDS = [
  { triad: [57, 60, 64], bass: 33 },
  { triad: [53, 57, 60], bass: 29 },
  { triad: [60, 64, 67], bass: 36 },
  { triad: [55, 59, 62], bass: 31 },
];

const KICK = 'x.....x.x.......';
const SNARE = '....x.......x...';
const HAT = 'x.x.x.x.x.x.x.o.';   // x closed, o open
const BASS = [[0, 0], [3, 0], [6, 12], [8, 0], [10, 7], [11, 12], [14, 0]];   // [step, semitones above root]
const ARP = [[2, 0], [5, 1], [7, 2], [10, 1], [13, 0], [15, 2]];             // [step, chord tone]

async function load(ctx, url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(url);
  const buf = await ctx.decodeAudioData(await r.arrayBuffer());
  return { buf, start: onset(buf) };
}

// MP3s carry encoder padding before the note. Start each sample at its first
// audible sample so hits land exactly on the beat.
function onset(buf) {
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) if (Math.abs(d[i]) > 0.002) return Math.max(0, i - 32) / buf.sampleRate;
  return 0;
}

async function loadInstrument(ctx, { name, lo, hi }) {
  const notes = [];
  for (let o = lo; o <= hi; o++) for (const pc of GRID) notes.push(12 * (o + 1) + pc);
  const loaded = await Promise.all(notes.map(m =>
    load(ctx, `audio/instruments/${name}/${NAMES[m % 12]}${Math.floor(m / 12) - 1}.mp3`)
      .then(s => ({ midi: m, ...s }), () => null)));
  return loaded.filter(Boolean);
}

function nearest(samples, midi) {
  let best = null;
  for (const s of samples) if (!best || Math.abs(s.midi - midi) < Math.abs(best.midi - midi)) best = s;
  return best;
}

export class Music {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.timer = 0;
    this.events = [];
  }

  // Call on page load. The context starts suspended until start() runs in a tap.
  init() {
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'interactive' });
    this.out = this.ctx.createGain();
    this.out.gain.value = 0.8;
    const comp = this.ctx.createDynamicsCompressor();
    this.out.connect(comp).connect(this.ctx.destination);
    return this.loadAll().then(() => { this.ready = true; });
  }

  async loadAll() {
    const c = this.ctx, k = LOADOUT.kit;
    this.kit = {};
    await Promise.all(['kick', 'snare', 'hat', 'openHat', 'clap'].map(async n => {
      try { this.kit[n] = await load(c, `audio/drums/${k.dir}/${k[n]}.wav`); } catch { /* play without it */ }
    }));
    [this.bass, this.harmony, this.keys] = await Promise.all(
      [LOADOUT.bass, LOADOUT.harmony, LOADOUT.keys].map(i => loadInstrument(c, i)));
  }

  get running() { return !!this.timer && this.ctx.state === 'running'; }

  // Must run inside a tap or click (browsers only allow sound after a gesture).
  start() {
    const c = this.ctx;
    c.resume();
    // iOS unlock: play one silent buffer inside the gesture.
    const src = c.createBufferSource();
    src.buffer = c.createBuffer(1, 1, c.sampleRate);
    src.connect(c.destination);
    src.start();
    if (this.timer) return;
    this.step = 0;
    this.t0 = this.nextTime = c.currentTime + 0.15;
    this.timer = setInterval(() => this.schedule(), TICK_MS);
    this.schedule();
  }

  pause() { this.ctx?.suspend(); }
  resume() { if (this.timer) this.ctx?.resume(); }

  // The context time that is reaching the speakers right now.
  heard() {
    const c = this.ctx;
    return c.currentTime - (c.outputLatency || c.baseLatency || 0);
  }

  schedule() {
    const c = this.ctx;
    if (c.state !== 'running') return;
    // If the timer stalled (background tab, busy phone), skip the missed steps
    // instead of firing them all at once.
    while (this.nextTime < c.currentTime) { this.nextTime += STEP; this.step++; }
    while (this.nextTime < c.currentTime + LOOKAHEAD) {
      this.playStep(this.step, this.nextTime);
      this.nextTime += STEP;
      this.step++;
    }
  }

  playStep(n, t) {
    const s = n % BAR;
    const chord = CHORDS[Math.floor(n / BAR) % CHORDS.length];
    let drum = null;
    if (KICK[s] === 'x') { this.hit('kick', t, 1); drum = 'kick'; }
    if (SNARE[s] === 'x') { this.hit('snare', t, 0.8); this.hit('clap', t, 0.35); drum = drum || 'snare'; }
    if (HAT[s] === 'x') { this.hit('hat', t, 0.35); drum = drum || 'hat'; }
    if (HAT[s] === 'o') { this.hit('openHat', t, 0.3); drum = drum || 'hat'; }
    if (drum) this.events.push({ time: t, weapon: 0, kind: drum });
    for (const [st, semi] of BASS) if (st === s) {
      this.note(this.bass, chord.bass + semi, t, 0.85, STEP * 1.6);
      this.events.push({ time: t, weapon: 1, kind: 'bass' });
    }
    for (const [st, tone] of ARP) if (st === s) {
      this.note(this.harmony, chord.triad[tone] + 12, t, 0.5, 0.7);
      this.events.push({ time: t, weapon: 2, kind: 'arp' });
    }
  }

  // Events whose sound is audible now. Stale ones (a stalled frame) are dropped.
  drain() {
    const now = this.heard();
    let i = 0;
    while (i < this.events.length && this.events[i].time <= now) i++;
    return i ? this.events.splice(0, i).filter(e => now - e.time < 0.25) : [];
  }

  chordNow() {
    const n = Math.max(0, Math.floor((this.heard() - this.t0) / STEP));
    return CHORDS[Math.floor(n / BAR) % CHORDS.length];
  }

  hit(name, t, vol) { return this.play(this.kit[name], t, 1, vol, 0); }

  note(samples, midi, t, vol, dur) {
    const s = nearest(samples, midi);
    return s ? this.play(s, t, Math.pow(2, (midi - s.midi) / 12), vol, dur) : null;
  }

  play(s, t, rate, vol, dur) {
    if (!s) return null;
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = s.buf;
    src.playbackRate.value = rate;
    const g = c.createGain();
    g.gain.value = vol;
    src.connect(g).connect(this.out);
    src.start(t, s.start);
    if (dur) {
      g.gain.setValueAtTime(vol, t + dur);
      g.gain.setTargetAtTime(0, t + dur, 0.04);
      src.stop(t + dur + 0.3);
    }
    return { src, g };
  }

  // Shield keys: a held note from the chord that's playing, until release.
  keyOn(i) {
    if (!this.running || !this.keys?.length) return null;
    return this.note(this.keys, this.chordNow().triad[i] + 12, this.ctx.currentTime, 0.55, 0);
  }

  keyOff(v) {
    if (!v) return;
    const t = this.ctx.currentTime, p = v.g.gain;
    if (p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(t); else p.cancelScheduledValues(t);
    p.setTargetAtTime(0, t, 0.06);
    v.src.stop(t + 0.5);
  }
}
