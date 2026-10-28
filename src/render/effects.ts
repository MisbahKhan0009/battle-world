/**
 * Visual effects as pure functions of time. Every particle position is computed analytically
 * from its spawning event and a stateless seeded hash, so effects need no simulation state,
 * scrub correctly, and look identical in the preview and the export.
 */
import { hashFloat } from '../engine/rng';
import type { Ctx2D, ImageSource } from './canvas';
import { upperIndex, type EffectsIndex } from './scene';

const SPARK_LIFE = 0.5;
const MAX_SPARKS = 600;
const SHARD_LIFE = 1.1;
const SHARDS = 9;

/** Index of the first hit at or after time t (sorted array). */
function firstHitAfter(fx: EffectsIndex, t: number): number {
  return upperIndex(fx.hitT, t - 1e-9) + 1;
}

/** Screen shake offset in design pixels at sim time t. */
export function shakeOffset(fx: EffectsIndex, t: number, seed: number): { x: number; y: number } {
  let x = 0;
  let y = 0;
  const from = firstHitAfter(fx, t - 0.3);
  const to = upperIndex(fx.hitT, t);
  for (let k = from; k <= to; k++) {
    const age = t - fx.hitT[k];
    const f = Math.min(1, fx.hitImpact[k] / 650);
    const amp = (2 + 10 * f * f) * Math.exp(-age / 0.07);
    const ang = hashFloat(seed, k, 7) * Math.PI * 2;
    const osc = Math.cos(age * 70 + ang);
    x += Math.cos(ang) * amp * osc;
    y += Math.sin(ang) * amp * osc;
  }
  for (const e of fx.elims) {
    const age = t - e.t;
    if (age < 0 || age > 0.5) continue;
    const amp = 16 * Math.exp(-age / 0.12);
    const ang = hashFloat(seed, e.i, 11) * Math.PI * 2;
    x += Math.cos(ang) * amp * Math.cos(age * 55);
    y += Math.sin(ang) * amp * Math.sin(age * 61);
  }
  const m = Math.hypot(x, y);
  if (m > 26) {
    x *= 26 / m;
    y *= 26 / m;
  }
  return { x, y };
}

/** Last hit time at or before t for fighter i (or -Infinity). */
export function lastHitTime(fx: EffectsIndex, i: number, t: number): number {
  const arr = fx.hitsOf[i];
  const k = upperIndex(arr, t);
  return k < 0 ? -Infinity : arr[k];
}

/** Spark streaks for recent hits, in world units. `px` = world units per design pixel. */
export function drawSparks(
  ctx: Ctx2D,
  fx: EffectsIndex,
  t: number,
  seed: number,
  px: number,
  accents: string[],
): void {
  const from = firstHitAfter(fx, t - SPARK_LIFE);
  const to = upperIndex(fx.hitT, t);
  if (to < from) return;
  // Bucket by alpha so the whole burst costs a handful of stroke calls.
  const buckets: Path2D[] = [new Path2D(), new Path2D(), new Path2D(), new Path2D()];
  const tinted: Path2D[] = [new Path2D(), new Path2D(), new Path2D(), new Path2D()];
  let count = 0;
  for (let k = to; k >= from && count < MAX_SPARKS; k--) {
    const age = t - fx.hitT[k];
    const f = Math.min(1.6, fx.hitImpact[k] / 400);
    const n = Math.min(14, 4 + Math.round(6 * f));
    for (let s = 0; s < n && count < MAX_SPARKS; s++, count++) {
      const life = SPARK_LIFE * (0.6 + 0.4 * hashFloat(seed, k, s * 3 + 1));
      if (age > life) continue;
      const ang = hashFloat(seed, k, s * 3 + 2) * Math.PI * 2;
      const speed = (180 + 420 * hashFloat(seed, k, s * 3 + 3)) * (0.6 + 0.5 * f);
      // Exponential drag: distance = v/k * (1 - e^{-k t}).
      const drag = 6;
      const d = (speed / drag) * (1 - Math.exp(-drag * age));
      const v = speed * Math.exp(-drag * age);
      const cx = Math.cos(ang);
      const cy = Math.sin(ang);
      const x = fx.hitX[k] + cx * d;
      const y = fx.hitY[k] + cy * d;
      const len = Math.max(2 * px, v * 0.028);
      const bucket = Math.min(3, Math.floor((1 - age / life) * 4));
      const path = s % 3 === 0 ? tinted[bucket] : buckets[bucket];
      path.moveTo(x, y);
      path.lineTo(x - cx * len, y - cy * len);
    }
  }
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineWidth = 3.2 * px;
  const accent = accents[fx.hitA[to]] ?? '#FFFFFF';
  for (let b = 0; b < 4; b++) {
    ctx.globalAlpha = (b + 1) / 4;
    ctx.strokeStyle = '#FFF6D8';
    ctx.stroke(buckets[b]);
    ctx.strokeStyle = accent;
    ctx.stroke(tinted[b]);
  }
  ctx.restore();
}

/** Flag shards and shockwave ring for recent eliminations (world units). */
export function drawShatter(
  ctx: Ctx2D,
  fx: EffectsIndex,
  t: number,
  seed: number,
  px: number,
  radii: Float32Array,
  tokenFor: (i: number) => { image: ImageSource; scale: number } | null,
  danger: string,
): void {
  for (const e of fx.elims) {
    const age = t - e.t;
    if (age < 0 || age > SHARD_LIFE) continue;
    const r = radii[e.i];
    const p = age / SHARD_LIFE;

    // Shockwave ring.
    if (age < 0.45) {
      const q = age / 0.45;
      ctx.save();
      ctx.globalAlpha = (1 - q) * 0.9;
      ctx.strokeStyle = danger;
      ctx.lineWidth = (10 * (1 - q) + 1) * px;
      ctx.beginPath();
      ctx.arc(e.x, e.y, r * (1 + 1.6 * easeOut(q)), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    const tok = tokenFor(e.i);
    if (!tok) continue;
    ctx.save();
    ctx.globalAlpha = p < 0.6 ? 1 : 1 - (p - 0.6) / 0.4;
    for (let s = 0; s < SHARDS; s++) {
      const a0 = (s / SHARDS) * Math.PI * 2 + hashFloat(seed, e.i, s) * 0.3;
      const a1 = ((s + 1) / SHARDS) * Math.PI * 2 + hashFloat(seed, e.i, s + 1) * 0.3;
      const mid = (a0 + a1) / 2;
      const speed = 160 + 260 * hashFloat(seed, e.i, s + 40);
      const drag = 3.2;
      const d = (speed / drag) * (1 - Math.exp(-drag * age));
      const fall = 140 * age * age;
      const spin = (hashFloat(seed, e.i, s + 80) - 0.5) * 9 * age;
      ctx.save();
      ctx.translate(e.x + Math.cos(mid) * d, e.y + Math.sin(mid) * d + fall);
      ctx.rotate(spin);
      const shrink = 1 - 0.35 * p;
      ctx.scale(shrink, shrink);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, r, a0, a1);
      ctx.closePath();
      ctx.clip();
      const size = r * 2 * tok.scale;
      ctx.drawImage(tok.image, -size / 2, -size / 2, size, size);
      ctx.restore();
    }
    ctx.restore();
  }
}

/** Confetti in the winner's flag colors. `u` = seconds since the winner was decided. */
export function drawConfetti(
  ctx: Ctx2D,
  u: number,
  W: number,
  H: number,
  palette: string[],
  seed: number,
): void {
  if (u < 0) return;
  const colors = palette.length ? [...palette, '#FFFFFF'] : ['#C6FF3D', '#FFFFFF'];
  const count = 170;
  const scale = Math.min(W, H) / 1080;
  for (let i = 0; i < count; i++) {
    const delay = hashFloat(seed, i, 501) * 1.4;
    const age = u - delay;
    if (age <= 0) continue;
    const x0 = hashFloat(seed, i, 502) * W;
    const vy = (260 + 340 * hashFloat(seed, i, 503)) * scale;
    const y = -40 * scale + vy * age + 60 * age * age * scale;
    if (y > H + 40) continue;
    const sway = (30 + 50 * hashFloat(seed, i, 504)) * scale;
    const freq = 1.5 + 2.5 * hashFloat(seed, i, 505);
    const x = x0 + Math.sin(age * freq + i) * sway;
    const rot = age * (2 + 6 * hashFloat(seed, i, 506)) + i;
    const w = (10 + 10 * hashFloat(seed, i, 507)) * scale;
    const h = w * 0.55;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.scale(1, Math.cos(age * (5 + 5 * hashFloat(seed, i, 508))));
    ctx.fillStyle = colors[i % colors.length];
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.restore();
  }
}

export function easeOut(x: number): number {
  return 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
}

export function easeInOut(x: number): number {
  const v = Math.min(1, Math.max(0, x));
  return v * v * (3 - 2 * v);
}

/** Overshooting ease for pop-in animations. */
export function easeBack(x: number): number {
  const v = Math.min(1, Math.max(0, x));
  const c1 = 1.9;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(v - 1, 3) + c1 * Math.pow(v - 1, 2);
}
