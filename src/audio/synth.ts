/**
 * Procedural sound design. Every sound effect is synthesized from code with a stateless
 * hash for noise, so the app ships no audio files, has no licensing concerns (the output is
 * original work, dedicated to the public domain), and renders identically every time.
 * Works in the main thread and in workers (plain Float32Array math, no Web Audio needed).
 */
import { hashFloat } from '../engine/rng';
import { GAME_VOICES } from './gameVoices';

export const SAMPLE_RATE = 48000;
const SR = SAMPLE_RATE;
const TAU = Math.PI * 2;

export type SoundId =
  | 'hit0'
  | 'hit1'
  | 'hit2'
  | 'hit3'
  | 'hit4'
  | 'elim'
  | 'whoosh'
  | 'fanfare'
  | 'tick'
  | 'boom'
  | 'exit'
  | 'clack0'
  | 'clack1'
  | 'clack2'
  | 'boing'
  | 'tock0'
  | 'tock1'
  | 'tock2'
  | 'shatter'
  | 'beep'
  | 'bell'
  | 'celesta'
  | 'bloop'
  | 'riser'
  | 'marimba'
  | 'snip'
  | 'gulp'
  | 'whomp';
export type Stereo = { L: Float32Array; R: Float32Array };

const noise = (i: number, seed: number) => hashFloat(seed, i) * 2 - 1;

/** One-pole low-pass coefficient for a cutoff in Hz. */
const lpCoef = (hz: number) => 1 - Math.exp((-TAU * hz) / SR);

function normalize(buf: Float32Array, peak = 0.9): Float32Array {
  let m = 0;
  for (let i = 0; i < buf.length; i++) m = Math.max(m, Math.abs(buf[i]));
  if (m > 0) for (let i = 0; i < buf.length; i++) buf[i] *= peak / m;
  return buf;
}

function hit(variant: number): Float32Array {
  const len = Math.floor(SR * 0.22);
  const out = new Float32Array(len);
  const f0 = [190, 150, 230, 170, 210][variant];
  const tone = [0.9, 1, 0.75, 0.95, 0.85][variant];
  let phase = 0;
  let lp = 0;
  let hpPrev = 0;
  let hpOut = 0;
  const bandHz = [1800, 1200, 2600, 1500, 2100][variant];
  const a = lpCoef(bandHz);
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    // Body: pitched thump with a fast downward sweep.
    const f = 55 + (f0 - 55) * Math.exp(-t / 0.03);
    phase += (TAU * f) / SR;
    const body = Math.sin(phase) * Math.exp(-t / 0.075) * tone;
    // Smack: band-limited noise burst.
    const n = noise(i, 300 + variant);
    lp += (n - lp) * a;
    hpOut = 0.97 * (hpOut + lp - hpPrev);
    hpPrev = lp;
    const smack = hpOut * Math.exp(-t / 0.018) * 1.6;
    const click = i < 90 ? noise(i, 900 + variant) * (1 - i / 90) * 0.6 : 0;
    out[i] = body + smack + click;
  }
  return normalize(out, 0.85);
}

function elim(): Float32Array {
  const len = Math.floor(SR * 0.9);
  const out = new Float32Array(len);
  let phase = 0;
  let hpPrev = 0;
  let hpOut = 0;
  const pings = Array.from({ length: 7 }, (_, k) => ({
    f: 2200 + 3200 * hashFloat(77, k),
    at: 0.01 + 0.18 * hashFloat(78, k),
    d: 0.08 + 0.18 * hashFloat(79, k),
  }));
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const f = 48 + 90 * Math.exp(-t / 0.06);
    phase += (TAU * f) / SR;
    const boom = Math.sin(phase) * Math.exp(-t / 0.22) * 0.9;
    const n = noise(i, 41);
    hpOut = 0.92 * (hpOut + n - hpPrev);
    hpPrev = n;
    const crash = hpOut * Math.exp(-t / 0.12) * 0.7;
    let glass = 0;
    for (const p of pings) {
      if (t < p.at) continue;
      const tt = t - p.at;
      glass += Math.sin(TAU * p.f * tt) * Math.exp(-tt / p.d) * 0.22;
    }
    out[i] = boom + crash + glass;
  }
  return normalize(out, 0.9);
}

function whoosh(): Float32Array {
  const dur = 1.6;
  const len = Math.floor(SR * dur);
  const out = new Float32Array(len);
  // State-variable band-pass sweeping upward.
  let low = 0;
  let band = 0;
  let phase = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const p = t / dur;
    const fc = 250 * Math.pow(18, p);
    const f = 2 * Math.sin((Math.PI * Math.min(fc, 9000)) / SR);
    const q = 0.25;
    const n = noise(i, 55);
    low += f * band;
    const high = n - low - q * band;
    band += f * high;
    const env = Math.pow(p, 1.6) * (p > 0.9 ? (1 - p) / 0.1 : 1);
    phase += (TAU * (180 + 520 * p * p)) / SR;
    out[i] = band * env * 1.3 + Math.sin(phase) * env * 0.25;
  }
  return normalize(out, 0.75);
}

function boom(): Float32Array {
  const len = Math.floor(SR * 0.8);
  const out = new Float32Array(len);
  let phase = 0;
  let lp = 0;
  const a = lpCoef(900);
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    phase += (TAU * (40 + 80 * Math.exp(-t / 0.05))) / SR;
    lp += (noise(i, 66) - lp) * a;
    out[i] = Math.sin(phase) * Math.exp(-t / 0.3) + lp * Math.exp(-t / 0.15) * 1.4;
  }
  return normalize(out, 0.9);
}

/** A flag slipping out through the opening: quick rising zip with an airy tail. */
function exit(): Float32Array {
  const dur = 0.55;
  const len = Math.floor(SR * dur);
  const out = new Float32Array(len);
  let phase = 0;
  let lp = 0;
  const a = lpCoef(3000);
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const p = t / dur;
    const f = 260 * Math.pow(5, Math.min(1, p / 0.45));
    phase += (TAU * f) / SR;
    const env = Math.min(1, t / 0.008) * Math.exp(-t / 0.16);
    lp += (noise(i, 88) - lp) * a;
    out[i] = (Math.sin(phase) + 0.35 * Math.sin(phase * 2.01)) * env + lp * Math.exp(-t / 0.09) * 0.8;
  }
  return normalize(out, 0.8);
}

function tick(): Float32Array {
  const len = Math.floor(SR * 0.09);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    out[i] = (Math.sin(TAU * 1320 * t) + 0.4 * Math.sin(TAU * 2640 * t)) * Math.exp(-t / 0.018);
  }
  return normalize(out, 0.7);
}

/** Band-limited sawtooth via additive harmonics. */
function saw(phase: number, harmonics: number): number {
  let s = 0;
  for (let h = 1; h <= harmonics; h++) s += Math.sin(phase * h) / h;
  return s * 0.6;
}

const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

function fanfare(): Float32Array {
  const dur = 2.6;
  const len = Math.floor(SR * dur);
  const out = new Float32Array(len);
  // C major flourish: G4 C5 E5 then a held C major chord.
  const notes: { m: number; at: number; d: number }[] = [
    { m: 67, at: 0, d: 0.16 },
    { m: 72, at: 0.16, d: 0.16 },
    { m: 76, at: 0.32, d: 0.16 },
    { m: 72, at: 0.5, d: 2.1 },
    { m: 76, at: 0.5, d: 2.1 },
    { m: 79, at: 0.5, d: 2.1 },
    { m: 84, at: 0.5, d: 2.1 },
  ];
  for (const n of notes) {
    const start = Math.floor(n.at * SR);
    const nlen = Math.floor(n.d * SR);
    const f = midiHz(n.m);
    let lp = 0;
    for (let i = 0; i < nlen && start + i < len; i++) {
      const t = i / SR;
      const att = Math.min(1, t / 0.025);
      const rel = Math.min(1, (n.d - t) / 0.25);
      const vib = 1 + 0.004 * Math.sin(TAU * 5.5 * t) * Math.min(1, t / 0.4);
      const ph = TAU * f * vib * t;
      const raw = saw(ph, 10) + 0.5 * saw(ph * 1.003, 10);
      lp += (raw - lp) * lpCoef(1400 + 2200 * Math.exp(-t / 0.3));
      out[start + i] += lp * att * Math.max(0, rel) * 0.5;
    }
  }
  return normalize(out, 0.85);
}

/** Glass marbles knocking: a bright click with a few short inharmonic partials. */
function clack(variant: number): Float32Array {
  const len = Math.floor(SR * 0.12);
  const out = new Float32Array(len);
  const base = [2350, 2780, 3150][variant];
  const partials = [1, 2.31, 3.87, 5.2];
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    let v = 0;
    partials.forEach((m, k) => {
      v += (Math.sin(TAU * base * m * t) * Math.exp(-t / (0.022 / (k + 1)))) / (k + 1);
    });
    const click = i < 60 ? noise(i, 700 + variant) * (1 - i / 60) * 0.8 : 0;
    out[i] = v + click;
  }
  return normalize(out, 0.75);
}

/**
 * A marble landing on a wooden track: a short, dry click with a small hollow resonance and no
 * low "drum" body, like a real marble run.
 */
function tock(variant: number): Float32Array {
  const len = Math.floor(SR * 0.07);
  const out = new Float32Array(len);
  const res = [1180, 1420, 980][variant];
  // Two-pole resonator excited by a very short noise burst.
  const r = Math.exp(-1 / (SR * 0.012));
  const c = 2 * r * Math.cos((TAU * res) / SR);
  let y1 = 0;
  let y2 = 0;
  let lp = 0;
  const a = lpCoef(5200);
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const burst = i < 70 ? noise(i, 640 + variant) * (1 - i / 70) : 0;
    const y = burst + c * y1 - r * r * y2;
    y2 = y1;
    y1 = y;
    lp += (noise(i, 660 + variant) - lp) * a;
    out[i] = y * 0.6 + lp * Math.exp(-t / 0.004) * 0.9;
  }
  return normalize(out, 0.7);
}

/** Bumper: a springy pitch wobble. */
function boing(): Float32Array {
  const dur = 0.42;
  const len = Math.floor(SR * dur);
  const out = new Float32Array(len);
  let phase = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const f = 330 + 260 * Math.exp(-t / 0.06) + 40 * Math.sin(TAU * 18 * t) * Math.exp(-t / 0.15);
    phase += (TAU * f) / SR;
    out[i] = (Math.sin(phase) + 0.3 * Math.sin(phase * 2)) * Math.min(1, t / 0.004) * Math.exp(-t / 0.12);
  }
  return normalize(out, 0.8);
}

/** A ring breaking: bright glass shards over a short crackle, with no low boom. */
function shatter(): Float32Array {
  const len = Math.floor(SR * 0.85);
  const out = new Float32Array(len);
  let hpPrev = 0;
  let hpOut = 0;
  const pings = Array.from({ length: 11 }, (_, k) => ({
    f: 2600 + 3600 * hashFloat(81, k),
    at: 0.005 + 0.22 * hashFloat(82, k) ** 1.6,
    d: 0.05 + 0.16 * hashFloat(83, k),
  }));
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const n = noise(i, 47);
    hpOut = 0.86 * (hpOut + n - hpPrev);
    hpPrev = n;
    let glass = 0;
    for (const p of pings) {
      if (t < p.at) continue;
      const tt = t - p.at;
      glass += Math.sin(TAU * p.f * tt) * Math.exp(-tt / p.d) * 0.2;
    }
    out[i] = hpOut * Math.exp(-t / 0.07) * 0.55 + glass;
  }
  return normalize(out, 0.8);
}

// ---------------------------------------------------------------- per-game voices
// Marble Race: start-light beeps and a tubular bell. Ring Escape: a glassy celesta and a riser.
// Growing Ball: a water-drop bloop. Paper Land: a wooden marimba and a scissor snip. Each game also
// builds its own victory phrase from its voice.

/** Marble Race start light: a clean, slightly hollow beep (A5). Pitch it up for GO. */
function beep(): Float32Array {
  const len = Math.floor(SR * 0.2);
  const out = new Float32Array(len);
  const f = 880;
  let lp = 0;
  const a = lpCoef(3800);
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const sq = Math.sin(TAU * f * t) > 0 ? 1 : -1;
    lp += (sq - lp) * a;
    const env = Math.min(1, t / 0.004) * (t < 0.15 ? 1 : Math.max(0, 1 - (t - 0.15) / 0.05));
    out[i] = lp * env;
  }
  return normalize(out, 0.4);
}

/** Marble Race finish: a tubular bell (C5) with inharmonic partials and a long ring. */
function bell(): Float32Array {
  const len = Math.floor(SR * 1.6);
  const out = new Float32Array(len);
  const f = 523.25;
  const partials: [number, number, number][] = [
    [1, 1, 1.1],
    [2.76, 0.45, 0.5],
    [5.4, 0.25, 0.22],
    [8.93, 0.12, 0.1],
    [0.5, 0.18, 1.4],
  ];
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    let v = 0;
    for (const [m, g, d] of partials) v += Math.sin(TAU * f * m * t) * g * Math.exp(-t / d);
    out[i] = v * Math.min(1, t / 0.002);
  }
  return normalize(out, 0.7);
}

/** Ring Escape bounce: a glassy celesta (C6) from two-operator FM, bright and short. */
function celesta(): Float32Array {
  const len = Math.floor(SR * 0.7);
  const out = new Float32Array(len);
  const f = 1046.5;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const index = 2.2 * Math.exp(-t / 0.05);
    const mod = Math.sin(TAU * f * 3.5 * t) * index;
    out[i] =
      (Math.sin(TAU * f * t + mod) + 0.25 * Math.sin(TAU * f * 2 * t) * Math.exp(-t / 0.12)) *
      Math.min(1, t / 0.0015) *
      Math.exp(-t / 0.22);
  }
  return normalize(out, 0.65);
}

/** Growing Ball bounce: a water-drop bloop (G4) whose pitch springs up, then settles. */
function bloop(): Float32Array {
  const len = Math.floor(SR * 0.32);
  const out = new Float32Array(len);
  let phase = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const f = 392 * (1 + 0.55 * Math.exp(-t / 0.018) - 0.08 * (1 - Math.exp(-t / 0.08)));
    phase += (TAU * f) / SR;
    out[i] =
      (Math.sin(phase) + 0.18 * Math.sin(2 * phase) * Math.exp(-t / 0.04)) *
      Math.min(1, t / 0.003) *
      Math.exp(-t / 0.09);
  }
  return normalize(out, 0.7);
}

/** Ring Escape's last escape: a rising, airy sweep into the slow motion, with no low end. */
function riser(): Float32Array {
  const dur = 1.3;
  const len = Math.floor(SR * dur);
  const out = new Float32Array(len);
  let lo = 0;
  let lo2 = 0;
  let phase = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const u = t / dur;
    const cut = 900 + 6000 * u * u;
    lo += (noise(i, 91) - lo) * lpCoef(cut);
    lo2 += (lo - lo2) * lpCoef(cut * 0.35);
    phase += (TAU * (600 + 1400 * u * u)) / SR;
    const env = Math.min(1, u / 0.6) * (u > 0.92 ? (1 - u) / 0.08 : 1);
    out[i] = ((lo - lo2) * 0.9 + Math.sin(phase) * 0.12) * env;
  }
  return normalize(out, 0.6);
}

/** Paper Land claim: a wooden marimba bar (C5) with its tuned fourth-harmonic overtone and a soft mallet. */
function marimba(): Float32Array {
  const len = Math.floor(SR * 0.9);
  const out = new Float32Array(len);
  const f = 523.25;
  let lp = 0;
  const a = lpCoef(2400);
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    lp += (noise(i, 133) - lp) * a;
    const mallet = i < 240 ? lp * (1 - i / 240) * 0.5 : 0;
    out[i] =
      (Math.sin(TAU * f * t) * Math.exp(-t / 0.32) +
        0.32 * Math.sin(TAU * f * 3.99 * t) * Math.exp(-t / 0.06) +
        0.1 * Math.sin(TAU * f * 9.8 * t) * Math.exp(-t / 0.018)) *
        Math.min(1, t / 0.002) +
      mallet;
  }
  return normalize(out, 0.75);
}

/** Paper Land knock-out: scissors snipping through paper, two quick metal clicks over a tear. */
function snip(): Float32Array {
  const len = Math.floor(SR * 0.32);
  const out = new Float32Array(len);
  let hpPrev = 0;
  let hpOut = 0;
  let bp = 0;
  const clicks = [0, 0.075];
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    let metal = 0;
    for (const at of clicks) {
      if (t < at) continue;
      const tt = t - at;
      metal += (Math.sin(TAU * 4200 * tt) + 0.6 * Math.sin(TAU * 6900 * tt)) * Math.exp(-tt / 0.012);
    }
    const n = noise(i, 151);
    hpOut = 0.9 * (hpOut + n - hpPrev);
    hpPrev = n;
    bp += (hpOut - bp) * lpCoef(5200);
    const tear = bp * Math.exp(-t / 0.07) * (t < 0.11 ? Math.min(1, t / 0.02) : 1) * 1.4;
    out[i] = metal * 0.5 + tear;
  }
  return normalize(out, 0.7);
}

const VOICES: Record<string, () => Float32Array> = {
  elim,
  whoosh,
  fanfare,
  tick,
  boom,
  exit,
  boing,
  shatter,
  beep,
  bell,
  celesta,
  bloop,
  riser,
  marimba,
  snip,
  ...GAME_VOICES,
};

const sfxCache = new Map<SoundId, Float32Array>();

export function getSound(id: SoundId): Float32Array {
  let s = sfxCache.get(id);
  if (!s) {
    const voice = VOICES[id];
    s = voice
      ? voice()
      : id.startsWith('clack')
        ? clack(Number(id.slice(5)))
        : id.startsWith('tock')
          ? tock(Number(id.slice(4)))
          : hit(Number(id.slice(3)));
    sfxCache.set(id, s);
  }
  return s;
}
