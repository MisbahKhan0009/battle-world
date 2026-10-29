/**
 * Black Hole's voices, synthesized like the rest (see synth.ts, which registers them). Kept in
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

/**
 * A thing falls in: a hollow gulp (A3) whose pitch drops as it goes down, with a breathy suck of
 * air at the start.
 */
export function gulp(): Float32Array {
  const len = Math.floor(SR * 0.26);
  const out = new Float32Array(len);
  let phase = 0;
  let lp = 0;
  const a = lpCoef(1400);
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const f = 220 * (1.35 - 0.6 * (1 - Math.exp(-t / 0.06)));
    phase += (TAU * f) / SR;
    lp += (noise(i, 171) - lp) * a;
    const air = lp * Math.exp(-t / 0.03) * 0.6;
    out[i] =
      (Math.sin(phase) + 0.35 * Math.sin(3 * phase) * Math.exp(-t / 0.03)) *
        Math.min(1, t / 0.008) *
        Math.exp(-t / 0.07) +
      air;
  }
  return normalize(out, 0.7);
}

/** A hole eats a hole: a deep, round whomp (A1) sinking an octave, with a soft rumble under it. */
export function whomp(): Float32Array {
  const len = Math.floor(SR * 0.85);
  const out = new Float32Array(len);
  let phase = 0;
  let lp = 0;
  const a = lpCoef(220);
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const f = 55 * (2 - (1 - Math.exp(-t / 0.18)));
    phase += (TAU * f) / SR;
    lp += (noise(i, 181) - lp) * a;
    out[i] =
      (Math.sin(phase) + 0.4 * Math.sin(2 * phase)) * Math.min(1, t / 0.01) * Math.exp(-t / 0.28) +
      lp * 2.2 * Math.exp(-t / 0.35);
  }
  return normalize(out, 0.85);
}
