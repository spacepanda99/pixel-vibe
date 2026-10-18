// Pixel Vibe sound engine: recorded samples played on the AudioContext clock.
// Notes are scheduled a little ahead (refilled every 25 ms) against
// ctx.currentTime, never setTimeout or frame counts, so the beat can't drift
// when the frame rate hiccups. Each scheduled note also queues an event that
// the game drains once the note is audible, so shots fire on the beat you hear.

export const BPM = 112;
export const STEP = 60 / BPM / 4;   // one 16th note, in seconds
const BAR = 16;
const LOOKAHEAD = 0.12;
const TICK_MS = 25;

const NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const GRID = [0, 3, 6, 9];   // pitch classes stored on disk (see audio/CREDITS.md)

// What each cannon and the shield keys play. Ships will swap these later.
export const LOADOUT = {
  kit: { dir: 'tr808', kick: 'BD2525', snare: 'SD2550', hat: 'CH', openHat: 'OH10', clap: 'CP',
    // Sound effects (not part of the beat)
    boom: 'BD2575', crash: 'CY2550', crumble: 'MA' },
  bass: { name: 'synth_bass_1', lo: 1, hi: 4 },
  harmony: { name: 'vibraphone', lo: 2, hi: 6 },
  // The player's own instrument on the shield keys: a big layered synth.
  // Two detuned saws spread left/right, synth brass for bite, a saw an octave
  // down for weight, then a filter sweep and a dotted-8th echo (see keyOn).
  keys: {
    lo: 2, hi: 6,
    layers: [
      { name: 'lead_2_sawtooth', vol: 0.34, detune: -9, pan: -0.6 },
      { name: 'lead_2_sawtooth', vol: 0.34, detune: 9, pan: 0.6 },
      { name: 'synth_brass_1', vol: 0.3 },
      { name: 'lead_2_sawtooth', vol: 0.22, octave: -12 },
    ],
  },
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
    this.muted = [false, false, false];   // a fallen cannon's instrument drops out
  }

  // Call on page load. The context starts suspended until start() runs in a tap.
  init() {
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'interactive' });
    this.out = this.ctx.createGain();
    this.out.gain.value = 0.8;
    const comp = this.ctx.createDynamicsCompressor();
    // Analyser on the final mix feeds the on-screen EQ meter and the shot waveforms.
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.55;
    this.spectrum = new Uint8Array(this.analyser.frequencyBinCount);
    this.out.connect(comp).connect(this.analyser).connect(this.ctx.destination);
    // Key bus: dry plus a dotted-8th echo that stays darker than the dry sound.
    const c = this.ctx;
    this.keyBus = c.createGain();
    this.keyBus.connect(this.out);
    const delay = c.createDelay(1);
    delay.delayTime.value = STEP * 3;
    const fb = c.createGain();
    fb.gain.value = 0.32;
    const dark = c.createBiquadFilter();
    dark.type = 'lowpass';
    dark.frequency.value = 3000;
    const wet = c.createGain();
    wet.gain.value = 0.28;
    this.keyBus.connect(delay);
    delay.connect(dark).connect(fb).connect(delay);
    dark.connect(wet).connect(this.out);
    return this.loadAll().then(() => { this.ready = true; });
  }

  async loadAll() {
    const c = this.ctx, k = LOADOUT.kit;
    this.kit = {};
    await Promise.all(Object.keys(k).filter(n => n !== 'dir').map(async n => {
      try { this.kit[n] = await load(c, `audio/drums/${k.dir}/${k[n]}.wav`); } catch { /* play without it */ }
    }));
    const keyNames = [...new Set(LOADOUT.keys.layers.map(l => l.name))];
    const [bass, harmony, ...keySets] = await Promise.all([
      loadInstrument(c, LOADOUT.bass), loadInstrument(c, LOADOUT.harmony),
      ...keyNames.map(name => loadInstrument(c, { name, lo: LOADOUT.keys.lo, hi: LOADOUT.keys.hi }))]);
    this.bass = bass;
    this.harmony = harmony;
    this.keys = Object.fromEntries(keyNames.map((n, i) => [n, keySets[i]]));
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

  // Back to silence at the title screen; start() begins the song again from bar one.
  stop() {
    clearInterval(this.timer);
    this.timer = 0;
    this.events = [];
    this.ctx?.suspend();
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
    const [mDrum, mBass, mHarm] = this.muted;
    if (!mDrum) {
      let drum = null;
      if (KICK[s] === 'x') { this.hit('kick', t, 1); drum = 'kick'; }
      if (SNARE[s] === 'x') { this.hit('snare', t, 0.8); this.hit('clap', t, 0.35); drum = drum || 'snare'; }
      if (HAT[s] === 'x') { this.hit('hat', t, 0.35); drum = drum || 'hat'; }
      if (HAT[s] === 'o') { this.hit('openHat', t, 0.3); drum = drum || 'hat'; }
      if (drum) this.events.push({ time: t, weapon: 0, kind: drum });
    }
    if (!mBass) for (const [st, semi] of BASS) if (st === s) {
      this.note(this.bass, chord.bass + semi, t, 0.85, STEP * 1.6);
      this.events.push({ time: t, weapon: 1, kind: 'bass' });
    }
    if (!mHarm) for (const [st, tone] of ARP) if (st === s) {
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

  // Fill this.spectrum (0-255 per frequency bin) with what's playing now.
  readSpectrum() { if (this.analyser) this.analyser.getByteFrequencyData(this.spectrum); return this.spectrum; }

  // Context time of 16th-note step n (step 0 is when the music started).
  stepTime(n) { return this.t0 + n * STEP; }

  // Step that is audible right now.
  stepNow() { return Math.floor((this.heard() - this.t0) / STEP); }

  // One-off sound effect, right now.
  sfx(name, vol) { if (this.running) this.play(this.kit[name], this.ctx.currentTime, 1, vol, 0); }

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

  // Shield keys: the layered synth plays a tone of the chord that's sounding
  // and holds it (the steady middle of each sample loops) until release.
  keyOn(i) {
    if (!this.running || !this.keys) return null;
    const c = this.ctx, t = c.currentTime;
    const midi = this.chordNow().triad[i] + 12;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 5;
    lp.frequency.setValueAtTime(900, t);
    lp.frequency.exponentialRampToValueAtTime(7000, t + 0.04);
    lp.frequency.setTargetAtTime(2800, t + 0.04, 0.25);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.9, t + 0.005);
    lp.connect(g).connect(this.keyBus);
    const srcs = [];
    for (const L of LOADOUT.keys.layers) {
      const m = midi + (L.octave || 0);
      const s = nearest(this.keys[L.name] || [], m);
      if (!s) continue;
      const src = c.createBufferSource();
      src.buffer = s.buf;
      src.playbackRate.value = Math.pow(2, (m - s.midi) / 12 + (L.detune || 0) / 1200);
      src.loop = true;
      src.loopStart = s.start + 0.3;
      src.loopEnd = s.start + 1.5;
      const lg = c.createGain();
      lg.gain.value = L.vol;
      src.connect(lg);
      if (L.pan && c.createStereoPanner) {
        const p = c.createStereoPanner();
        p.pan.value = L.pan;
        lg.connect(p).connect(lp);
      } else lg.connect(lp);
      src.start(t, s.start);
      srcs.push(src);
    }
    return { g, srcs };
  }

  keyOff(v) {
    if (!v) return;
    const t = this.ctx.currentTime, p = v.g.gain;
    if (p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(t); else p.cancelScheduledValues(t);
    p.setTargetAtTime(0, t, 0.08);
    for (const s of v.srcs) s.stop(t + 0.6);
  }
}
