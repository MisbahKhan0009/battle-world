/**
 * Ring Escape physics. Identical flag balls fall and bounce inside the innermost of a set of
 * nested rings. Each ring is a thin wall with one gap and turns at its own constant rate. The
 * first ball through the gap shatters that ring for everyone, so the whole group is then inside
 * the next one; the ball that breaks out of the last ring wins.
 *
 * Fixed sub-steps, seeded RNG and the polynomial dsin/dcos keep it deterministic. Only the
 * current ring can be touched (every ball is always inside it), and ring k's shape depends only
 * on (seed, k), so adding rings outside never changes what happened before: the planner probes
 * with many rings and keeps as many as fit the target length.
 */
import { dcos, dsin } from '../physics';
import { hash32, Rng } from '../rng';
import type { Ring, RingsConfig, RingsEvent, RingsTrackData } from './types';

export const STEP = 1 / 120;
const SUBSTEPS = 2;
export const GRAVITY = 1100;
/** Wall restitution a touch above 1 keeps the balls lively; the speed cap keeps them watchable. */
const E_WALL = 1.012;
const E_BALL = 0.97;
const VMAX = 2300;
const WALL = 7;
const REC_HZ = 60;
const MIN_HIT = 60;

/** Deterministic arcsine for |x| <= 0.9 (Newton steps on dsin; Math.asin may differ between engines). */
function dasin(x: number): number {
  let y = x + (x * x * x) / 6;
  for (let k = 0; k < 8; k++) y -= (dsin(y) - x) / dcos(y);
  return y;
}

/** Ball radius for a field of n balls. */
export function ballRadius(n: number): number {
  return Math.max(17, Math.min(30, 36 - n * 1.2));
}

/** Radius of the innermost ring for n balls of radius r, and the spacing between rings. */
export function ringGeometry(n: number, r: number): { R0: number; spacing: number } {
  return { R0: r * (3.2 + 1.25 * Math.sqrt(n)), spacing: 2 * r + 2 * WALL + 14 };
}

/** Ring k of a game. Depends only on (seed, k, n, r), never on how many rings there are. */
export function ringAt(seed: number, k: number, n: number, r: number): Ring {
  const rng = new Rng(hash32(seed, k, 0x41a9));
  const { R0, spacing } = ringGeometry(n, r);
  const R = R0 + k * spacing;
  // Opening wide enough for a ball with room to spare, and at least a minimum share of the ring
  // (smaller with more balls, since more balls find the gap sooner).
  const room = (r * rng.range(1.3, 1.6) + WALL) / R;
  const gap = Math.max(dasin(Math.min(0.85, room)), rng.range(0.13, 0.2) * Math.sqrt(5 / Math.max(5, n)));
  const dir = (k % 2 === 0 ? 1 : -1) * (rng.next() < 0.2 ? -1 : 1);
  return {
    R,
    w: WALL,
    gap,
    // The first opening starts at the top, away from where the balls fall.
    phase: k === 0 ? -1.5707963267948966 + rng.range(-0.4, 0.4) : rng.range(0, 6.283185307179586),
    omega: dir * rng.range(0.55, 1.35),
    hue: (hash32(seed, 0x9e) % 360) + k * 37,
  };
}

export function buildRings(config: RingsConfig): Ring[] {
  const n = config.ids.length;
  return Array.from({ length: config.rings }, (_, k) => ringAt(config.seed, k, n, config.radius));
}

export type RingsSimOut = {
  events: RingsEvent[];
  shatterT: number[];
  shatterBy: number[];
  winnerIndex: number;
  winnerT: number;
  endT: number;
  rec: RingsTrackData | null;
};

/**
 * Runs the game until the last ring breaks (plus `holdSec`) or `maxT`. With `ringLimit`
 * larger than the config's ring count it is a probe: rings keep coming and the shatter times
 * tell the planner how long any ring count would take.
 */
export function simulateRings(
  config: RingsConfig,
  opts: { record: boolean; holdSec: number; maxT: number; ringLimit?: number },
): RingsSimOut {
  const n = config.ids.length;
  const r = config.radius;
  const limit = opts.ringLimit ?? config.rings;
  const rings: Ring[] = [];
  const ring = (k: number) => (rings[k] ??= ringAt(config.seed, k, n, r));

  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const vx = new Float64Array(n);
  const vy = new Float64Array(n);
  const rng = new Rng(hash32(config.seed, 0x5a11));
  // Start grid: random, non-overlapping spots inside the first ring, each with a random push.
  const inner = ring(0).R - WALL - r - 4;
  for (let i = 0; i < n; i++) {
    for (let attempt = 0; attempt < 400; attempt++) {
      const px = rng.range(-inner, inner);
      const py = rng.range(-inner, inner);
      if (px * px + py * py > inner * inner) continue;
      let ok = true;
      for (let j = 0; j < i && ok; j++) {
        const dx = px - x[j];
        const dy = py - y[j];
        ok = dx * dx + dy * dy > (2 * r + 6) * (2 * r + 6);
      }
      if (ok || attempt === 399) {
        x[i] = px;
        y[i] = py;
        break;
      }
    }
    const a = rng.range(0, 6.283185307179586);
    const sp = rng.range(450, 800);
    vx[i] = sp * dcos(a);
    vy[i] = sp * dsin(a);
  }

  const events: RingsEvent[] = [];
  const shatterT: number[] = [];
  const shatterBy: number[] = [];
  let current = 0;
  let winnerIndex = -1;
  let winnerT = Infinity;

  const recEvery = Math.round(1 / STEP / REC_HZ);
  const frames: Float32Array[] = [];
  const snap = () => {
    const f = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      f[i * 2] = x[i];
      f[i * 2 + 1] = y[i];
    }
    frames.push(f);
  };
  if (opts.record) snap();

  const h = STEP / SUBSTEPS;
  let step = 0;
  let t = 0;
  const endAt = () => (winnerIndex >= 0 ? Math.min(opts.maxT, winnerT + opts.holdSec) : opts.maxT);
  while (t < endAt()) {
    for (let sub = 0; sub < SUBSTEPS; sub++) {
      const ts = step * STEP + sub * h;
      for (let i = 0; i < n; i++) {
        vy[i] += GRAVITY * h;
        x[i] += vx[i] * h;
        y[i] += vy[i] * h;
      }
      // Ball against ball.
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const dx = x[j] - x[i];
          const dy = y[j] - y[i];
          const d2 = dx * dx + dy * dy;
          if (d2 >= 4 * r * r || d2 < 1e-12) continue;
          const d = Math.sqrt(d2);
          const nx = dx / d;
          const ny = dy / d;
          const push = (2 * r - d) / 2;
          x[i] -= nx * push;
          y[i] -= ny * push;
          x[j] += nx * push;
          y[j] += ny * push;
          const vn = (vx[j] - vx[i]) * nx + (vy[j] - vy[i]) * ny;
          if (vn >= 0) continue;
          const jmp = (-(1 + E_BALL) * vn) / 2;
          vx[i] -= jmp * nx;
          vy[i] -= jmp * ny;
          vx[j] += jmp * nx;
          vy[j] += jmp * ny;
          if (jmp > MIN_HIT)
            events.push({
              t: ts,
              type: 'hit',
              a: i,
              b: j,
              kind: 'ball',
              impulse: jmp,
              x: x[i] + nx * r,
              y: y[i] + ny * r,
            });
        }
      }
      // Ball against the current ring.
      if (current < limit) {
        const R = ring(current);
        const th = R.phase + R.omega * ts;
        const gc = dcos(th);
        const gs = dsin(th);
        const cosGap = dcos(R.gap);
        for (let i = 0; i < n && current < limit; i++) {
          const d = Math.sqrt(x[i] * x[i] + y[i] * y[i]);
          if (d < 1e-9) continue;
          const ux = x[i] / d;
          const uy = y[i] / d;
          const inGap = ux * gc + uy * gs > cosGap;
          if (!inGap) {
            // Solid arc: the nearest wall point is straight out from the center.
            if (d + r <= R.R - R.w) continue;
            const lim = R.R - R.w - r;
            x[i] = ux * lim;
            y[i] = uy * lim;
            const vn = vx[i] * ux + vy[i] * uy;
            if (vn > 0) {
              const jmp = (1 + E_WALL) * vn;
              vx[i] -= jmp * ux;
              vy[i] -= jmp * uy;
              if (jmp > MIN_HIT)
                events.push({
                  t: ts,
                  type: 'hit',
                  a: i,
                  b: -1,
                  kind: 'ring',
                  impulse: jmp,
                  x: ux * R.R,
                  y: uy * R.R,
                  ring: current,
                });
            }
            continue;
          }
          // In the opening: the wall's round ends are moving points.
          for (const side of [-1, 1]) {
            const ea = th + side * R.gap;
            const ex = R.R * dcos(ea);
            const ey = R.R * dsin(ea);
            const dx = x[i] - ex;
            const dy = y[i] - ey;
            const dd2 = dx * dx + dy * dy;
            const reach = r + R.w;
            if (dd2 >= reach * reach || dd2 < 1e-12) continue;
            const dd = Math.sqrt(dd2);
            const nx = dx / dd;
            const ny = dy / dd;
            x[i] = ex + nx * reach;
            y[i] = ey + ny * reach;
            const evx = -R.omega * ey;
            const evy = R.omega * ex;
            const vn = (vx[i] - evx) * nx + (vy[i] - evy) * ny;
            if (vn < 0) {
              const jmp = -(1 + E_WALL) * vn;
              vx[i] += jmp * nx;
              vy[i] += jmp * ny;
              if (jmp > MIN_HIT)
                events.push({
                  t: ts,
                  type: 'hit',
                  a: i,
                  b: -1,
                  kind: 'edge',
                  impulse: jmp,
                  x: ex,
                  y: ey,
                  ring: current,
                });
            }
          }
          // Through the gap: the ring shatters.
          const d2 = Math.sqrt(x[i] * x[i] + y[i] * y[i]);
          if (d2 > R.R) {
            events.push({ t: ts, type: 'shatter', ring: current, by: i, x: x[i], y: y[i] });
            shatterT.push(ts);
            shatterBy.push(i);
            current++;
            if (current === config.rings && winnerIndex < 0) {
              winnerIndex = i;
              winnerT = ts;
            }
          }
        }
      }
      for (let i = 0; i < n; i++) {
        const v2 = vx[i] * vx[i] + vy[i] * vy[i];
        if (v2 > VMAX * VMAX) {
          const k = VMAX / Math.sqrt(v2);
          vx[i] *= k;
          vy[i] *= k;
        }
      }
    }
    step++;
    t = step * STEP;
    if (opts.record && step % recEvery === 0) snap();
  }

  let rec: RingsTrackData | null = null;
  if (opts.record) {
    const data = new Float32Array(frames.length * n * 2);
    frames.forEach((f, k) => data.set(f, k * n * 2));
    rec = { hz: REC_HZ, frames: frames.length, n, data };
  }
  return { events, shatterT, shatterBy, winnerIndex, winnerT, endT: t, rec };
}
