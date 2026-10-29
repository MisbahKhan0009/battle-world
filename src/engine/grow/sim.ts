/**
 * Growing Ball physics. Identical flag balls bounce under gravity inside a circular arena, and
 * every firm wall bounce makes a ball a little bigger. Balls push each other around (mass goes
 * with area), so big balls get boxed in while small ones still find the wall. When the balls
 * together fill END_FILL of the arena, the biggest one wins; races are usually close.
 *
 * Fixed sub-steps, a seeded RNG and dsin/dcos keep it deterministic: the same config is the same
 * game.
 */
import { dcos, dsin } from '../physics';
import { hash32, Rng } from '../rng';
import type { GrowConfig, GrowEvent, GrowTrackData } from './types';

export const ARENA = 500;
export const STEP = 1 / 120;
const SUBSTEPS = 2;
const GRAVITY = 900;
const E_WALL = 1.006;
const E_BALL = 0.96;
const VMAX = 1700;
/** The wall throws anything touching it back at this speed at least (world units/s). */
const KICK = 650;
/** A wall bounce or bump only counts when it is this firm (normal speed, world units/s). */
const FIRM = 140;
/** The game ends when the balls fill this share of the arena; the biggest wins. */
export const END_FILL = 0.55;
/** A new ball counts as the biggest once it is this much bigger (no flicker between near-ties). */
const LEAD_MARGIN = 1.03;
const REC_HZ = 60;
/** Extra position passes per sub-step that pull pressed-together balls apart. */
const RELAX = 4;

/** Starting radius for n balls. */
export function startRadius(n: number): number {
  return Math.max(30, Math.min(52, 66 - n * 4.5));
}

export type GrowSimOut = {
  events: GrowEvent[];
  winnerIndex: number;
  winnerT: number;
  endT: number;
  leadChanges: number;
  rec: GrowTrackData | null;
};

export function simulateGrow(
  config: GrowConfig,
  opts: { record: boolean; holdSec: number; maxT: number },
): GrowSimOut {
  const n = config.ids.length;
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const vx = new Float64Array(n);
  const vy = new Float64Array(n);
  const r = new Float64Array(n).fill(config.r0);
  const rng = new Rng(hash32(config.seed, 0x6a0));
  // Start: random, non-overlapping spots in the upper part of the arena, each with a push.
  const room = ARENA - config.r0 - 8;
  for (let i = 0; i < n; i++) {
    for (let attempt = 0; attempt < 500; attempt++) {
      const px = rng.range(-room, room);
      const py = rng.range(-room, room * 0.3);
      if (px * px + py * py > room * room) continue;
      let ok = true;
      for (let j = 0; j < i && ok; j++) {
        const dx = px - x[j];
        const dy = py - y[j];
        ok = dx * dx + dy * dy > (2 * config.r0 + 10) * (2 * config.r0 + 10);
      }
      if (ok || attempt === 499) {
        x[i] = px;
        y[i] = py;
        break;
      }
    }
    const a = rng.range(0, 6.283185307179586);
    const sp = rng.range(500, 850);
    vx[i] = sp * dcos(a);
    vy[i] = sp * dsin(a);
  }

  const A2 = ARENA * ARENA;
  const growArea = config.growth * A2;
  const events: GrowEvent[] = [];
  let winnerIndex = -1;
  let winnerT = Infinity;
  let leader = -1;
  let leadChanges = 0;

  const recEvery = Math.round(1 / STEP / REC_HZ);
  const frames: Float32Array[] = [];
  const snap = () => {
    const f = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      f[i * 3] = x[i];
      f[i * 3 + 1] = y[i];
      f[i * 3 + 2] = r[i];
    }
    frames.push(f);
  };
  if (opts.record) snap();

  const fill = () => {
    let s = 0;
    for (let i = 0; i < n; i++) s += r[i] * r[i];
    return s / A2;
  };

  const h = STEP / SUBSTEPS;
  let step = 0;
  let t = 0;
  const endAt = () => (winnerIndex >= 0 ? Math.min(opts.maxT, winnerT + opts.holdSec) : opts.maxT);
  while (t < endAt()) {
    for (let sub = 0; sub < SUBSTEPS; sub++) {
      const ts = step * STEP + sub * h;
      const playing = winnerIndex < 0;
      for (let i = 0; i < n; i++) {
        vy[i] += GRAVITY * h;
        x[i] += vx[i] * h;
        y[i] += vy[i] * h;
      }
      // Ball against ball: mass goes with area, so big balls shove small ones.
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const dx = x[j] - x[i];
          const dy = y[j] - y[i];
          const rr = r[i] + r[j];
          const d2 = dx * dx + dy * dy;
          if (d2 >= rr * rr || d2 < 1e-12) continue;
          const d = Math.sqrt(d2);
          const nx = dx / d;
          const ny = dy / d;
          const mi = r[i] * r[i];
          const mj = r[j] * r[j];
          const over = rr - d;
          x[i] -= nx * over * (mj / (mi + mj));
          y[i] -= ny * over * (mj / (mi + mj));
          x[j] += nx * over * (mi / (mi + mj));
          y[j] += ny * over * (mi / (mi + mj));
          const vn = (vx[j] - vx[i]) * nx + (vy[j] - vy[i]) * ny;
          if (vn >= 0) continue;
          const jmp = (-(1 + E_BALL) * vn) / (1 / mi + 1 / mj);
          vx[i] -= (jmp / mi) * nx;
          vy[i] -= (jmp / mi) * ny;
          vx[j] += (jmp / mj) * nx;
          vy[j] += (jmp / mj) * ny;
          if (playing && -vn >= FIRM)
            events.push({
              t: ts,
              type: 'bump',
              a: i,
              b: j,
              impulse: -vn,
              x: x[i] + nx * r[i],
              y: y[i] + ny * r[i],
            });
        }
      }
      // Ball against the arena wall; firm bounces grow the ball.
      for (let i = 0; i < n; i++) {
        const d = Math.sqrt(x[i] * x[i] + y[i] * y[i]);
        if (d + r[i] <= ARENA || d < 1e-9) continue;
        const ux = x[i] / d;
        const uy = y[i] / d;
        const vn = vx[i] * ux + vy[i] * uy;
        if (vn > 0) {
          // A springy wall: it returns at least KICK, so balls never settle in a heap.
          const out = Math.max(E_WALL * vn, KICK);
          vx[i] -= (vn + out) * ux;
          vy[i] -= (vn + out) * uy;
          if (playing && vn > FIRM) {
            r[i] = Math.sqrt(r[i] * r[i] + growArea);
            events.push({ t: ts, type: 'wall', i, x: ux * ARENA, y: uy * ARENA, impulse: vn, r: r[i] });
          }
        }
        const lim = Math.max(0, ARENA - r[i]);
        x[i] = ux * lim;
        y[i] = uy * lim;
      }
      // A crowded arena: a few extra passes to separate any balls still pressed together.
      for (let pass = 0; pass < RELAX; pass++) {
        for (let i = 0; i < n; i++) {
          for (let j = i + 1; j < n; j++) {
            const dx = x[j] - x[i];
            const dy = y[j] - y[i];
            const rr = r[i] + r[j];
            const d2 = dx * dx + dy * dy;
            if (d2 >= rr * rr || d2 < 1e-12) continue;
            const d = Math.sqrt(d2);
            const over = rr - d;
            const wi = (r[j] * r[j]) / (r[i] * r[i] + r[j] * r[j]);
            x[i] -= (dx / d) * over * wi;
            y[i] -= (dy / d) * over * wi;
            x[j] += (dx / d) * over * (1 - wi);
            y[j] += (dy / d) * over * (1 - wi);
          }
        }
        for (let i = 0; i < n; i++) {
          const d = Math.sqrt(x[i] * x[i] + y[i] * y[i]);
          const lim = Math.max(0, ARENA - r[i]);
          if (d > lim && d > 1e-9) {
            x[i] *= lim / d;
            y[i] *= lim / d;
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
      if (!playing) continue;
      // Who is biggest (with a margin, so near-ties don't flicker), and is the arena full?
      let big = 0;
      for (let i = 1; i < n; i++) if (r[i] > r[big]) big = i;
      if (leader < 0) leader = big;
      else if (big !== leader && r[big] > r[leader] * LEAD_MARGIN) {
        leadChanges++;
        leader = big;
      }
      if (fill() >= END_FILL) {
        winnerIndex = big;
        winnerT = ts;
      }
    }
    step++;
    t = step * STEP;
    if (opts.record && step % recEvery === 0) snap();
  }

  let rec: GrowTrackData | null = null;
  if (opts.record) {
    const data = new Float32Array(frames.length * n * 3);
    frames.forEach((f, k) => data.set(f, k * n * 3));
    rec = { hz: REC_HZ, frames: frames.length, n, data };
  }
  if (winnerIndex < 0) {
    // Out of time (never expected for a planned game): the biggest ball wins.
    winnerIndex = Math.max(0, leader);
    winnerT = t;
  }
  return { events, winnerIndex, winnerT, endT: t, leadChanges, rec };
}
