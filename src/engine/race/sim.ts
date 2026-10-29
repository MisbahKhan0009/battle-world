/**
 * Marble Race physics. Marbles are solid spheres (I = 2/5 m r^2) that roll for real: every
 * contact applies a normal impulse with restitution and a Coulomb friction impulse at the
 * contact point, so marbles pick up spin, roll without slipping on ramps (accelerating at
 * 5/7 g sin(theta), as a real ball does) and transfer spin to each other. Spinners are moving
 * contacts (their surface velocity counts), bumpers add a kick.
 *
 * Deterministic: fixed 1/120 s steps, seeded randomness, and only + - * / sqrt plus the
 * polynomial dsin/dcos, so the same config replays bit for bit.
 */
import { dcos, dsin } from '../physics';
import { hash32, hashFloat, Rng } from '../rng';
import { startGrid } from './track';
import type { RaceConfig, RaceEvent, RaceTrackData, Track } from './types';

export const RACE_DT = 1 / 120;
export const RACE_TRACK_HZ = 60;

const G = 1500;
const DRAG = 0.05;
const SPIN_DAMP = 0.2;
const VMAX = 1350;
const MU_TRACK = 0.45;
const MU_MARBLE = 0.08;
const E_WALL = 0.32;
const E_PEG = 0.45;
const E_SPIN = 0.5;
const E_MARBLE = 0.72;
/** Approach speeds below this do not bounce (keeps resting contact quiet). */
const REST_VN = 40;
const BUMPER_KICK = 420;
/** Hits weaker than this are not recorded (they would be inaudible anyway). */
const EVENT_MIN = 90;
const BUCKET = 120;
/** A marble slower than this for STUCK_SEC gets a small hop (a "shaker", like real marble runs). */
const STUCK_SPEED = 8;
const STUCK_SEC = 1.2;

type Buckets = { b0: number; cells: number[][] };

function makeBuckets(y0: number, y1: number): Buckets {
  const b0 = Math.floor(y0 / BUCKET);
  const n = Math.floor(y1 / BUCKET) - b0 + 1;
  return { b0, cells: Array.from({ length: n }, () => []) };
}

function insert(b: Buckets, lo: number, hi: number, item: number): void {
  const a = Math.max(0, Math.floor(lo / BUCKET) - b.b0);
  const z = Math.min(b.cells.length - 1, Math.floor(hi / BUCKET) - b.b0);
  for (let k = a; k <= z; k++) b.cells[k].push(item);
}

export type RaceSimOptions = {
  /** Record positions for rendering. */
  record: boolean;
  /** Keep simulating this long after the winner crosses the line. */
  holdSec: number;
  /** Hard stop (sim seconds). */
  maxT: number;
  /** Probe mode: report when the race front (deepest marble) first reaches each level. */
  levels?: number[];
};

export type RaceSimOutput = {
  events: RaceEvent[];
  finishT: Float64Array;
  order: number[];
  endT: number;
  rec: RaceTrackData | null;
  /** Probe mode: time the front first reached each level (Infinity if never). */
  levelT: number[];
  /** How often the lead changed hands before the winner crossed (sampled every 0.25 s). */
  leadChanges: number;
};

export function simulateRace(config: RaceConfig, track: Track, opts: RaceSimOptions): RaceSimOutput {
  const n = config.ids.length;
  const r = config.radius;
  const I = 0.4 * r * r; // per unit mass
  const W = track.width;
  const wallIn = 7; // half thickness of the side walls

  // Static geometry in vertical buckets (each item in every bucket a marble touching it can be in).
  const yTop = Math.min(-2000, ...startGrid(n, r).map((p) => p.y)) - 4 * r;
  const yBot = track.bottomY + 4 * r;
  const segB = makeBuckets(yTop, yBot);
  const pegB = makeBuckets(yTop, yBot);
  const spinB = makeBuckets(yTop, yBot);
  track.segs.forEach((s, i) =>
    insert(segB, Math.min(s.ay, s.by) - s.r - r, Math.max(s.ay, s.by) + s.r + r, i),
  );
  track.pegs.forEach((p, i) => insert(pegB, p.y - p.r - r, p.y + p.r + r, i));
  track.spinners.forEach((s, i) => insert(spinB, s.cy - s.half - s.r - r, s.cy + s.half + s.r + r, i));

  // State.
  const rng = new Rng(hash32(config.seed, 0x51a7));
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const vx = new Float64Array(n);
  const vy = new Float64Array(n);
  const w = new Float64Array(n);
  const ang = new Float64Array(n);
  const still = new Float64Array(n);
  const finishT = new Float64Array(n).fill(Infinity);
  const order: number[] = [];
  const grid = startGrid(n, r, W);
  // Shuffle who starts where (deterministically) so start positions are not tied to the roster.
  const slots = grid.map((_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [slots[i], slots[j]] = [slots[j], slots[i]];
  }
  for (let i = 0; i < n; i++) {
    const p = grid[slots[i]];
    x[i] = p.x + (rng.next() - 0.5) * 0.3 * r;
    y[i] = p.y + (rng.next() - 0.5) * 0.3 * r;
  }
  const byY = Array.from({ length: n }, (_, i) => i);

  const events: RaceEvent[] = [];
  const levels = opts.levels ?? [];
  const levelT = levels.map(() => Infinity);
  let nextLevel = 0;
  let front = -Infinity;

  const recEvery = Math.round(1 / RACE_DT / RACE_TRACK_HZ);
  const maxFrames = Math.ceil(opts.maxT * RACE_TRACK_HZ) + 2;
  const recData = opts.record ? new Float32Array(maxFrames * n * 3) : null;
  let frames = 0;
  const record = () => {
    if (!recData || frames >= maxFrames) return;
    const o = frames * n * 3;
    for (let i = 0; i < n; i++) {
      recData[o + i * 3] = x[i];
      recData[o + i * 3 + 1] = y[i];
      recData[o + i * 3 + 2] = ang[i];
    }
    frames++;
  };

  let t = 0;
  let step = 0;
  let winnerT = Infinity;
  let firstPass = true;
  let leader = -1;
  let leadChanges = 0;

  /** Contact of marble i with a surface moving at (ovx, ovy); n points from surface to marble. */
  const contact = (
    i: number,
    nx: number,
    ny: number,
    pen: number,
    ovx: number,
    ovy: number,
    e: number,
    kind: 'wall' | 'peg' | 'bumper' | 'spinner',
    obstacle?: number,
  ) => {
    x[i] += nx * pen;
    y[i] += ny * pen;
    const rvx = vx[i] - ovx;
    const rvy = vy[i] - ovy;
    const vn = rvx * nx + rvy * ny;
    if (vn >= 0) return;
    const jn = -(1 + (-vn < REST_VN ? 0 : e)) * vn;
    vx[i] += jn * nx;
    vy[i] += jn * ny;
    // Friction at the contact point: drive the slip (surface speed vs rolling speed) to zero.
    const tx = -ny;
    const ty = nx;
    const slip = rvx * tx + rvy * ty - w[i] * r;
    let jt = -slip / (1 + (r * r) / I);
    const lim = MU_TRACK * jn;
    if (jt > lim) jt = lim;
    else if (jt < -lim) jt = -lim;
    vx[i] += jt * tx;
    vy[i] += jt * ty;
    w[i] -= (jt * r) / I;
    if (kind === 'bumper') {
      vx[i] += nx * BUMPER_KICK;
      vy[i] += ny * BUMPER_KICK;
    }
    if (firstPass && (jn > EVENT_MIN || kind === 'bumper'))
      events.push({
        t,
        type: 'hit',
        a: i,
        b: -1,
        kind,
        impulse: jn,
        x: x[i] - nx * r,
        y: y[i] - ny * r,
        ...(obstacle !== undefined ? { obstacle } : {}),
      });
  };

  for (;;) {
    t = step * RACE_DT;
    if (step % recEvery === 0) record();
    if (t >= opts.maxT) break;
    if (winnerT < Infinity && t >= winnerT + opts.holdSec) break;
    if (levels.length && nextLevel >= levels.length) break;

    // Integrate.
    for (let i = 0; i < n; i++) {
      vy[i] += G * RACE_DT;
      const damp = 1 - DRAG * RACE_DT;
      vx[i] *= damp;
      vy[i] *= damp;
      const sp2 = vx[i] * vx[i] + vy[i] * vy[i];
      if (sp2 > VMAX * VMAX) {
        const k = VMAX / Math.sqrt(sp2);
        vx[i] *= k;
        vy[i] *= k;
      }
      w[i] *= 1 - SPIN_DAMP * RACE_DT;
      x[i] += vx[i] * RACE_DT;
      y[i] += vy[i] * RACE_DT;
      ang[i] += w[i] * RACE_DT;
    }

    const tNext = t + RACE_DT;
    // Two solver passes keep stacks and piles stable.
    for (let pass = 0; pass < 2; pass++) {
      firstPass = pass === 0;
      // Track.
      for (let i = 0; i < n; i++) {
        // Side walls.
        if (x[i] < wallIn + r) contact(i, 1, 0, wallIn + r - x[i], 0, 0, E_WALL, 'wall');
        else if (x[i] > W - wallIn - r) contact(i, -1, 0, x[i] - (W - wallIn - r), 0, 0, E_WALL, 'wall');
        const k = Math.floor(y[i] / BUCKET) - segB.b0;
        if (k < 0 || k >= segB.cells.length) continue;
        for (const si of segB.cells[k]) {
          const s = track.segs[si];
          const ex = s.bx - s.ax;
          const ey = s.by - s.ay;
          const len2 = ex * ex + ey * ey;
          let u = ((x[i] - s.ax) * ex + (y[i] - s.ay) * ey) / len2;
          u = u < 0 ? 0 : u > 1 ? 1 : u;
          const dx = x[i] - (s.ax + ex * u);
          const dy = y[i] - (s.ay + ey * u);
          const R = r + s.r;
          const d2 = dx * dx + dy * dy;
          if (d2 >= R * R || d2 < 1e-12) continue;
          const d = Math.sqrt(d2);
          contact(i, dx / d, dy / d, R - d, 0, 0, E_WALL, 'wall');
        }
        for (const pi of pegB.cells[k]) {
          const p = track.pegs[pi];
          const dx = x[i] - p.x;
          const dy = y[i] - p.y;
          const R = r + p.r;
          const d2 = dx * dx + dy * dy;
          if (d2 >= R * R || d2 < 1e-12) continue;
          const d = Math.sqrt(d2);
          contact(
            i,
            dx / d,
            dy / d,
            R - d,
            0,
            0,
            E_PEG,
            p.bumper ? 'bumper' : 'peg',
            p.bumper ? pi : undefined,
          );
        }
        for (const qi of spinB.cells[k]) {
          const s = track.spinners[qi];
          const th = s.phase + s.omega * tNext;
          const c = dcos(th);
          const sn = dsin(th);
          // Closest point on the bar to the marble.
          let u = (x[i] - s.cx) * c + (y[i] - s.cy) * sn;
          u = u < -s.half ? -s.half : u > s.half ? s.half : u;
          const px = s.cx + c * u;
          const py = s.cy + sn * u;
          const dx = x[i] - px;
          const dy = y[i] - py;
          const R = r + s.r;
          const d2 = dx * dx + dy * dy;
          if (d2 >= R * R || d2 < 1e-12) continue;
          const d = Math.sqrt(d2);
          // Surface velocity of the bar at the contact point: omega x (p - c).
          contact(i, dx / d, dy / d, R - d, -s.omega * (py - s.cy), s.omega * (px - s.cx), E_SPIN, 'spinner');
        }
      }

      // Marble against marble (sweep over a list kept sorted by y).
      for (let a = 1; a < n; a++) {
        const v = byY[a];
        let b = a - 1;
        while (b >= 0 && y[byY[b]] > y[v]) {
          byY[b + 1] = byY[b];
          b--;
        }
        byY[b + 1] = v;
      }
      const D = 2 * r;
      for (let a = 0; a < n; a++) {
        const i = byY[a];
        for (let b = a + 1; b < n; b++) {
          const j = byY[b];
          const dy = y[j] - y[i];
          if (dy >= D) break;
          const dx = x[j] - x[i];
          const d2 = dx * dx + dy * dy;
          if (d2 >= D * D || d2 < 1e-12) continue;
          const d = Math.sqrt(d2);
          const nx = dx / d;
          const ny = dy / d;
          const pen = (D - d) / 2;
          x[i] -= nx * pen;
          y[i] -= ny * pen;
          x[j] += nx * pen;
          y[j] += ny * pen;
          const vn = (vx[j] - vx[i]) * nx + (vy[j] - vy[i]) * ny;
          if (vn >= 0) continue;
          const jn = (-(1 + (-vn < REST_VN ? 0 : E_MARBLE)) * vn) / 2;
          vx[i] -= jn * nx;
          vy[i] -= jn * ny;
          vx[j] += jn * nx;
          vy[j] += jn * ny;
          // Friction between the two surfaces (equal masses; both spins count).
          const tx = -ny;
          const ty = nx;
          const vt = (vx[j] - vx[i]) * tx + (vy[j] - vy[i]) * ty - w[j] * r - w[i] * r;
          let jt = -vt / (2 + (2 * r * r) / I);
          const lim = MU_MARBLE * jn;
          if (jt > lim) jt = lim;
          else if (jt < -lim) jt = -lim;
          vx[i] -= jt * tx;
          vy[i] -= jt * ty;
          vx[j] += jt * tx;
          vy[j] += jt * ty;
          w[i] -= (jt * r) / I;
          w[j] -= (jt * r) / I;
          if (pass === 0 && jn > EVENT_MIN * 0.6)
            events.push({
              t,
              type: 'hit',
              a: i,
              b: j,
              kind: 'marble',
              impulse: jn * 2,
              x: x[i] + nx * r,
              y: y[i] + ny * r,
            });
        }
      }
    }

    // Stuck marbles get a small hop; finish line; race front.
    for (let i = 0; i < n; i++) {
      if (finishT[i] === Infinity && t > 0.5 && vx[i] * vx[i] + vy[i] * vy[i] < STUCK_SPEED * STUCK_SPEED) {
        still[i] += RACE_DT;
        if (still[i] > STUCK_SEC) {
          // Hop up and toward the middle of the track, away from whatever is holding it.
          vx[i] += (x[i] < W / 2 ? 1 : -1) * 90 + (hashFloat(config.seed, i, step) - 0.5) * 120;
          vy[i] -= 280;
          still[i] = 0;
        }
      } else still[i] = 0;
      if (finishT[i] === Infinity && y[i] >= track.finishY) {
        const yPrev = y[i] - vy[i] * RACE_DT;
        const f = vy[i] > 0 ? Math.min(1, Math.max(0, (track.finishY - yPrev) / (vy[i] * RACE_DT))) : 1;
        finishT[i] = t + f * RACE_DT;
        order.push(i);
        if (order.length === 1) winnerT = finishT[i];
        events.push({ t: finishT[i], type: 'finish', i, place: order.length });
      }
      if (y[i] > front) front = y[i];
    }
    if (step % 30 === 0 && t > 3 && winnerT === Infinity) {
      let best = 0;
      for (let i = 1; i < n; i++) if (y[i] > y[best]) best = i;
      if (leader >= 0 && best !== leader) leadChanges++;
      leader = best;
    }
    while (nextLevel < levels.length && front >= levels[nextLevel]) {
      levelT[nextLevel] = tNext;
      nextLevel++;
    }
    step++;
  }

  // Finishers in the same step are ordered by their interpolated crossing time.
  order.sort((a, b) => finishT[a] - finishT[b] || a - b);
  events.sort((a, b) => a.t - b.t);
  for (const e of events) if (e.type === 'finish') e.place = order.indexOf(e.i) + 1;
  return {
    events,
    finishT,
    order,
    endT: t,
    rec: recData ? { hz: RACE_TRACK_HZ, frames, n, data: recData.subarray(0, frames * n * 3) } : null,
    levelT,
    leadChanges,
  };
}
