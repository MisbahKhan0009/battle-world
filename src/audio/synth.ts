/**
 * Procedural sound design. Every sound effect is synthesized from code with a stateless
 * hash for noise, so the app ships no audio files, has no licensing concerns (the output is
 * original work, dedicated to the public domain), and renders identically every time.
 * Works in the main thread and in workers (plain Float32Array math, no Web Audio needed).
 */
import { hashFloat } from '../engine/rng';

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
  | 'ding';
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

/** Crossing the finish line: a small bell. */
function ding(): Float32Array {
  const len = Math.floor(SR * 0.9);
  const out = new Float32Array(len);
  const f = 1567.98; // G6
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    out[i] =
      (Math.sin(TAU * f * t) +
        0.45 * Math.sin(TAU * f * 2.76 * t) * Math.exp(-t / 0.08) +
        0.25 * Math.sin(TAU * f * 5.4 * t) * Math.exp(-t / 0.04)) *
      Math.min(1, t / 0.002) *
      Math.exp(-t / 0.28);
  }
  return normalize(out, 0.7);
}

const sfxCache = new Map<SoundId, Float32Array>();

export function getSound(id: SoundId): Float32Array {
  let s = sfxCache.get(id);
  if (!s) {
    s =
      id === 'elim'
        ? elim()
        : id === 'whoosh'
          ? whoosh()
          : id === 'fanfare'
            ? fanfare()
            : id === 'tick'
              ? tick()
              : id === 'boom'
                ? boom()
                : id === 'exit'
                  ? exit()
                  : id === 'boing'
                    ? boing()
                    : id === 'ding'
                      ? ding()
                      : id.startsWith('clack')
                        ? clack(Number(id.slice(5)))
                        : hit(Number(id.slice(3)));
    sfxCache.set(id, s);
  }
  return s;
}
