/**
 * Territory Wars' voices, synthesized like the rest (see synth.ts, which registers them). Kept in
 * their own file so synth.ts stays a manageable size.
 */
import { hashFloat } from '../engine/rng';

/** Same rate as SAMPLE_RATE in synth.ts (not imported, so the two files don't import each other). */
const SR = 48000;
const TAU = Math.PI * 2;
const noise = (i: number, seed: number) => hashFloat(seed, i) * 2 - 1;
const lpCoef = (hz: number) => 1 - Math.exp((-TAU * hz) / SR);

function normalize(buf: Float32Array, peak: number): Float32Array {
  let m = 0;
  for (let i = 0; i < buf.length; i++) m = Math.max(m, Math.abs(buf[i]));
  if (m > 0) for (let i = 0; i < buf.length; i++) buf[i] *= peak / m;
  return buf;
}

/** Band-limited sawtooth via additive harmonics. */
function saw(phase: number, harmonics: number): number {
  let s = 0;
  for (let h = 1; h <= harmonics; h++) s += Math.sin(phase * h) / h;
  return s * 0.6;
}

/** Territory Wars border clash: a taiko-style war drum, a deep skin thump with a stick slap on top. */
export function wardrum(): Float32Array {
  const len = Math.floor(SR * 0.7);
  const out = new Float32Array(len);
  let phase = 0;
  let lp = 0;
  const a = lpCoef(900);
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const f = 62 + 58 * Math.exp(-t / 0.045);
    phase += (TAU * f) / SR;
    lp += (noise(i, 171) - lp) * a;
    const skin = (Math.sin(phase) + 0.25 * Math.sin(2.4 * phase) * Math.exp(-t / 0.06)) * Math.exp(-t / 0.22);
    const slap = lp * Math.exp(-t / 0.025) * 1.4;
    out[i] = (skin + slap) * Math.min(1, t / 0.0015);
  }
  return normalize(out, 0.85);
}

/** Territory Wars call: a warm brass horn (A3) that swells in and bends up into the note. */
export function horn(): Float32Array {
  const dur = 0.9;
  const len = Math.floor(SR * dur);
  const out = new Float32Array(len);
  let phase = 0;
  let lp = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const f = 220 * (1 - 0.03 * Math.exp(-t / 0.05));
    phase += (TAU * f) / SR;
    const env = Math.min(1, t / 0.06) * (t > dur - 0.25 ? (dur - t) / 0.25 : 1);
    // Brightness follows the swell, like a player blowing harder.
    lp += (saw(phase, 9) - lp) * lpCoef(500 + 2200 * Math.min(1, t / 0.12));
    out[i] = lp * env;
  }
  return normalize(out, 0.7);
}
