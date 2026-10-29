/**
 * Black Hole rules and steering, like Hole.io. Every hole starts the same size and roams the city
 * at the same speed (big holes are a little slower). An object falls in when it fits (its size is
 * under FIT of the hole's radius) and its footprint is mostly over the hole; the hole's area grows
 * by what it eats. A clearly bigger hole swallows a smaller one when it covers its center. When the
 * clock runs out the biggest hole wins, or the last hole left wins early.
 *
 * The steering seeks the best food in reach, flees bigger holes and (after the opening) chases
 * smaller ones. Fixed steps, a seeded RNG and dsin/dcos keep it deterministic: the same config is
 * the same game.
 */
import { dcos, dsin } from '../physics';
import { hash32, Rng } from '../rng';
import { buildCity } from './city';
import type { BlackConfig, BlackEvent, BlackTrack, City } from './types';

export const STEP = 1 / 60;
/** Starting hole radius. */
export const R0 = 16;
/** City units moved per second at the starting size, and the fastest turn (radians per second). */
const SPEED = 150;
const TURN = 3.4;
/** An object fits when its size is at most FIT of the hole's radius. */
export const FIT = 0.85;
/** It falls when its center is this deep in the hole: distance + OVER * size <= radius. */
export const OVER = 0.4;
/** Share of an object's footprint the hole's area gains, and of a swallowed hole's area. */
const GAIN = 0.55;
const HOLE_GAIN = 0.8;
/** A hole swallows another this much bigger (radius), once that one's center is well inside. */
export const EAT_MARGIN = 1.15;
/** Until this share of the clock, holes eat the city and leave each other alone. */
const CALM = 0.2;
/** Steering re-plans every DECIDE steps (staggered per hole). */
const DECIDE = 6;
/** A hole counts as the new leader once it is this much bigger (no flicker on near-ties). */
const LEAD_MARGIN = 1.04;
/** Bucket size of the object grid. */
const CELL = 110;
const REC_HZ = 60;

const TURN_C = dcos(TURN * STEP);
const TURN_S = dsin(TURN * STEP);

export type BlackSimOut = {
  city: City;
  events: BlackEvent[];
  winnerIndex: number;
  winnerT: number;
  endT: number;
  radii: number[];
  lastStanding: boolean;
  leadChanges: number;
  swallows: number;
  eaten: number;
  rec: BlackTrack | null;
};

/** City blocks per side for n holes on a clock of `limit` seconds (long games get a bigger city). */
export function cityBlocks(n: number, limit: number): number {
  return Math.max(4, Math.min(9, 3 + Math.round(n * 0.6) + (limit > 50 ? 1 : 0)));
}

export function simulateBlack(config: BlackConfig, opts: { record: boolean; holdSec: number }): BlackSimOut {
  const city = buildCity(config.seed, config.blocks);
  const S = city.size;
  const objs = city.objects;
  const n = config.ids.length;
  const rng = new Rng(hash32(config.seed, 0xb1a));

  // Object buckets.
  const G = Math.ceil(S / CELL);
  const buckets: number[][] = Array.from({ length: G * G }, () => []);
  const cellOf = (v: number) => Math.max(0, Math.min(G - 1, Math.floor(v / CELL)));
  objs.forEach((o, k) => buckets[cellOf(o.y) * G + cellOf(o.x)].push(k));
  const eaten = new Uint8Array(objs.length);

  // Holes start evenly round the middle of the city, heading outward-ish.
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const hx = new Float64Array(n);
  const hy = new Float64Array(n);
  const area = new Float64Array(n).fill(Math.PI * R0 * R0);
  const r = new Float64Array(n).fill(R0);
  const alive = new Uint8Array(n).fill(1);
  const tx = new Float64Array(n);
  const ty = new Float64Array(n);
  const wx = new Float64Array(n);
  const wy = new Float64Array(n);
  const a0 = rng.range(0, Math.PI * 2);
  for (let i = 0; i < n; i++) {
    const a = a0 + (i * Math.PI * 2) / n;
    const d = S * rng.range(0.26, 0.36);
    x[i] = S / 2 + d * dcos(a);
    y[i] = S / 2 + d * dsin(a);
    const b = a + rng.range(-1.2, 1.2);
    hx[i] = dcos(b);
    hy[i] = dsin(b);
    wx[i] = rng.range(0.15, 0.85) * S;
    wy[i] = rng.range(0.15, 0.85) * S;
  }

  const events: BlackEvent[] = [];
  let leader = -1;
  let leadChanges = 0;
  let swallows = 0;
  let eatenCount = 0;
  let winnerIndex = -1;
  let winnerT = Infinity;
  let lastStanding = false;
  let radiiAtEnd: number[] = [];

  const frames: Float32Array[] = [];
  const recEvery = Math.max(1, Math.round(1 / STEP / REC_HZ));
  const snap = () => {
    const f = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      f[i * 3] = x[i];
      f[i * 3 + 1] = y[i];
      f[i * 3 + 2] = alive[i] ? r[i] : 0;
    }
    frames.push(f);
  };
  if (opts.record) snap();

  /** Picks where hole i heads next: the best food or prey in reach, else its wander point. */
  const decide = (i: number, hunting: boolean) => {
    const ri = r[i];
    const reach = 260 + 2.5 * ri;
    let best = 0;
    let bx = wx[i];
    let by = wy[i];
    const c0x = cellOf(x[i] - reach);
    const c1x = cellOf(x[i] + reach);
    const c0y = cellOf(y[i] - reach);
    const c1y = cellOf(y[i] + reach);
    for (let cy = c0y; cy <= c1y; cy++)
      for (let cx = c0x; cx <= c1x; cx++)
        for (const k of buckets[cy * G + cx]) {
          if (eaten[k]) continue;
          const o = objs[k];
          if (o.s > FIT * ri) continue;
          const dx = o.x - x[i];
          const dy = o.y - y[i];
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d > reach) continue;
          // Ahead is cheaper than behind: turning around costs time.
          const ahead = d > 1e-6 ? (dx * hx[i] + dy * hy[i]) / d : 1;
          const score = o.area / (d + 60) / (1.35 - 0.35 * ahead);
          if (score > best) {
            best = score;
            bx = o.x;
            by = o.y;
          }
        }
    if (hunting)
      for (let j = 0; j < n; j++) {
        if (j === i || !alive[j] || ri < EAT_MARGIN * 1.03 * r[j]) continue;
        const dx = x[j] - x[i];
        const dy = y[j] - y[i];
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > 380 + ri) continue;
        const score = (1.4 * GAIN * area[j]) / (d + 60);
        if (score > best) {
          best = score;
          bx = x[j];
          by = y[j];
        }
      }
    if (best === 0) {
      // Nothing worth it nearby: roam toward a new spot once this one is reached.
      const dx = wx[i] - x[i];
      const dy = wy[i] - y[i];
      if (dx * dx + dy * dy < 80 * 80) {
        wx[i] = rng.range(0.1, 0.9) * S;
        wy[i] = rng.range(0.1, 0.9) * S;
      }
      bx = wx[i];
      by = wy[i];
    }
    tx[i] = bx;
    ty[i] = by;
  };

  const limitSteps = Math.round(config.limit / STEP);
  const holdSteps = Math.round(opts.holdSec / STEP);
  let endStep = Infinity;
  for (let step = 1; step <= endStep && step <= limitSteps + holdSteps + 1; step++) {
    const t = step * STEP;
    const playing = winnerIndex < 0;
    const hunting = t > config.limit * CALM;
    for (let i = 0; i < n; i++) {
      if (!alive[i]) continue;
      if ((step + i * 2) % DECIDE === 0 || step === 1) decide(i, hunting && playing);
      // Wanted direction: the target, away from bigger holes, and away from the city edge.
      let dx = tx[i] - x[i];
      let dy = ty[i] - y[i];
      const dl = Math.sqrt(dx * dx + dy * dy) || 1;
      dx /= dl;
      dy /= dl;
      for (let j = 0; j < n; j++) {
        if (j === i || !alive[j] || r[j] < EAT_MARGIN * 0.97 * r[i]) continue;
        const ex = x[i] - x[j];
        const ey = y[i] - y[j];
        const d = Math.sqrt(ex * ex + ey * ey) || 1;
        const range = r[j] + r[i] + 170;
        if (d >= range) continue;
        const w = (1 - d / range) * 2.6;
        dx += (ex / d) * w;
        dy += (ey / d) * w;
      }
      const m = 70;
      if (x[i] < m) dx += (m - x[i]) / m;
      if (x[i] > S - m) dx -= (x[i] - (S - m)) / m;
      if (y[i] < m) dy += (m - y[i]) / m;
      if (y[i] > S - m) dy -= (y[i] - (S - m)) / m;
      const l = Math.sqrt(dx * dx + dy * dy);
      if (l > 1e-9) {
        dx /= l;
        dy /= l;
        // Turn toward it at a limited rate.
        if (dx * hx[i] + dy * hy[i] >= TURN_C) {
          hx[i] = dx;
          hy[i] = dy;
        } else {
          const side = hx[i] * dy - hy[i] * dx >= 0 ? 1 : -1;
          const nx = hx[i] * TURN_C - hy[i] * TURN_S * side;
          const ny = hx[i] * TURN_S * side + hy[i] * TURN_C;
          const nl = Math.sqrt(nx * nx + ny * ny);
          hx[i] = nx / nl;
          hy[i] = ny / nl;
        }
      }
      // Bigger holes are a little slower. A target close by and off to the side slows the hole
      // down so it turns onto it instead of circling round it forever.
      let v = SPEED * Math.sqrt(Math.sqrt(R0 / r[i]));
      if (dl < 110) v *= 0.06 + (0.94 * Math.max(0, (tx[i] - x[i]) * hx[i] + (ty[i] - y[i]) * hy[i])) / dl;
      x[i] += hx[i] * v * STEP;
      y[i] += hy[i] * v * STEP;
      const lim = Math.min(r[i] * 0.6, S * 0.2);
      x[i] = Math.max(lim, Math.min(S - lim, x[i]));
      y[i] = Math.max(lim, Math.min(S - lim, y[i]));
    }

    // Holes against holes: the clearly bigger one swallows; equals nudge apart.
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (!alive[i] || !alive[j]) continue;
        const dx = x[j] - x[i];
        const dy = y[j] - y[i];
        const d = Math.sqrt(dx * dx + dy * dy);
        const [big, small] = r[i] >= r[j] ? [i, j] : [j, i];
        if (playing && r[big] >= EAT_MARGIN * r[small] && d <= r[big] - 0.5 * r[small]) {
          alive[small] = 0;
          area[big] += HOLE_GAIN * area[small];
          r[big] = Math.sqrt(area[big] / Math.PI);
          swallows++;
          events.push({ t, type: 'swallow', i: big, j: small, x: x[small], y: y[small], r: r[big] });
          continue;
        }
        const touch = (r[i] + r[j]) * 0.8;
        if (r[big] < EAT_MARGIN * r[small] && d < touch && d > 1e-9) {
          const push = (touch - d) * 0.5;
          x[i] -= (dx / d) * push;
          y[i] -= (dy / d) * push;
          x[j] += (dx / d) * push;
          y[j] += (dy / d) * push;
        }
      }
    }

    if (playing) {
      // Objects that fit and are mostly over a hole fall in.
      for (let i = 0; i < n; i++) {
        if (!alive[i]) continue;
        const c0x = cellOf(x[i] - r[i]);
        const c1x = cellOf(x[i] + r[i]);
        const c0y = cellOf(y[i] - r[i]);
        const c1y = cellOf(y[i] + r[i]);
        for (let cy = c0y; cy <= c1y; cy++)
          for (let cx = c0x; cx <= c1x; cx++)
            for (const k of buckets[cy * G + cx]) {
              if (eaten[k]) continue;
              const o = objs[k];
              if (o.s > FIT * r[i]) continue;
              const dx = o.x - x[i];
              const dy = o.y - y[i];
              const reach = r[i] - OVER * o.s;
              if (reach <= 0 || dx * dx + dy * dy > reach * reach) continue;
              eaten[k] = 1;
              eatenCount++;
              area[i] += GAIN * o.area;
              r[i] = Math.sqrt(area[i] / Math.PI);
              events.push({ t, type: 'eat', i, o: k, r: r[i] });
            }
      }
      // Who is biggest (with a margin), and is the game over?
      let big = -1;
      let count = 0;
      for (let i = 0; i < n; i++) {
        if (!alive[i]) continue;
        count++;
        if (big < 0 || r[i] > r[big]) big = i;
      }
      if (leader < 0 || !alive[leader]) {
        if (leader >= 0) leadChanges++;
        leader = big;
      } else if (big !== leader && r[big] > r[leader] * LEAD_MARGIN) {
        leadChanges++;
        leader = big;
      }
      if (count <= 1 || step >= limitSteps) {
        winnerIndex = big;
        winnerT = t;
        lastStanding = count <= 1;
        radiiAtEnd = Array.from(r, (v, i) => (alive[i] ? v : 0));
        endStep = step + holdSteps;
      }
    }
    if (opts.record && step % recEvery === 0) snap();
  }

  let rec: BlackTrack | null = null;
  if (opts.record) {
    const data = new Float32Array(frames.length * n * 3);
    frames.forEach((f, k) => data.set(f, k * n * 3));
    rec = { hz: REC_HZ, frames: frames.length, n, data };
  }
  return {
    city,
    events,
    winnerIndex,
    winnerT,
    endT: Math.min(endStep, limitSteps + holdSteps + 1) * STEP,
    radii: radiiAtEnd,
    lastStanding,
    leadChanges,
    swallows,
    eaten: eatenCount,
    rec,
  };
}
