import { ARENA_R, dcos, dsin, MAX_GAP_HALF, MIN_ARENA_FRAC, SpatialGrid, wallContact } from './physics';
import { Rng } from './rng';
import type { SimConfig, SimEvent, SimResult, Track } from './types';

/** Fixed physics timestep. */
export const DT = 1 / 120;
/** Track sampling rate (every second physics step). */
export const TRACK_HZ = 60;
const STEPS_PER_SAMPLE = 120 / TRACK_HZ;

/** Fraction of the arena area covered by discs at spawn. */
const FILL = 0.16;
const MAX_R = ARENA_R * 0.17;
/** Cruise speed in world units per second at speed multiplier 1. */
export const BASE_SPEED = 310;
const RESTITUTION = 0.95;
/** Time constant for speed relaxing back to cruise speed after a collision. */
const SPEED_TAU = 0.6;
const MIN_SPEED_FRAC = 0.6;
const PAIR_COOLDOWN = 0.15;
/** After taking damage a fighter is briefly invulnerable, so crowds produce fewer, clearer hits. */
const INVULN = 0.5;
/** Closing speeds below this do not count as hits (resting contact and grazes). */
const MIN_IMPACT = 90;
const REF_IMPACT = 320;
/** Densest the shrinking arena may pack alive discs (area fraction). */
const MAX_PACKING = 0.42;
/** Seconds without any hit before fighters start steering toward each other. */
const STALEMATE_SEC = 2.5;
/** Max rate (1/s) at which velocities blend toward the nearest opponent during a stalemate. */
const STEER_RATE = 2.5;
/** Tangential deflection on wall bounces (fraction of speed). */
const WALL_JITTER = 0.08;
/** Extra damage multiplier per second past the target (director only). */
const OVERTIME_SURGE = 0.6;
const PLAN_EXP = 1.4;
const HEADCOUNT_WEIGHT = 0.5;
const DIRECTOR_GAIN = 2.5;
const DIRECTOR_MIN = 0.15;
const DIRECTOR_MAX = 12;
/** Smoothing time constant of the director multiplier (s). */
const DIRECTOR_TAU = 0.6;
/** Escape mode: the director moves the opening width more gently than damage. */
const GAP_DIRECTOR_TAU = 1.5;
/** Escape mode without a target: after this long with no escape, the pace slowly picks up. */
const GAP_QUIET_SEC = 6;
const GAP_WIDEN_RATE = 0.1;
/**
 * Escape pacing keeps the opening small where it can: the director first speeds flags up
 * (to SPEED_BOOST_MAX), and only beyond that widens the opening (to GAP_GROW_MAX times).
 */
const SPEED_BOOST_MAX = 2;
/** Ahead of schedule, flags may also slow down a little. */
const SPEED_MIN = 0.75;
/** Radians per second the opening closes at once a winner is decided. */
const GAP_CLOSE_RATE = 1.2;
const GAP_GROW_MAX = 2.5;

export const DEFAULT_BASE_DAMAGE = 10;
export const DEFAULT_RAMP = 0.02;

export type SimOptions = {
  /** Record the position/HP track (needed for rendering, not for tuning). */
  record?: boolean;
  /** Seconds to keep simulating after the winner is decided. */
  holdSec?: number;
  /** Hard stop; the highest-HP fighter wins if nobody has by then. */
  maxSec?: number;
};

/** Disc radius for each fighter, scaled so everyone fits regardless of count. */
export function computeRadii(sizes: number[]): Float32Array {
  const sumSq = sizes.reduce((s, v) => s + v * v, 0) || 1;
  const base = Math.min(ARENA_R * Math.sqrt(FILL / sumSq), MAX_R);
  return Float32Array.from(sizes, (s) => base * s);
}

export class Simulation {
  readonly n: number;
  readonly ids: string[];
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly vx: Float64Array;
  readonly vy: Float64Array;
  readonly r: Float64Array;
  readonly invMass: Float64Array;
  readonly hp: Float64Array;
  readonly maxHp: Float64Array;
  readonly cruise: Float64Array;
  readonly attack: Float64Array;
  readonly alive: Uint8Array;
  readonly elimT: Float64Array;
  readonly kills: Uint16Array;
  readonly events: SimEvent[] = [];

  t = 0;
  stepIndex = 0;
  aliveCount: number;
  arena = 1;
  /** Escape mode: opening center angle (radians, unwrapped) and current half-angle. */
  gapAngle = 0;
  gapHalf = 0;
  /** Escape mode: pacing speed multiplier applied to every flag's cruise speed. */
  speedBoost = 1;
  winnerIndex = -1;
  winnerT = Infinity;
  final2T: number | null = null;

  private readonly cfg: SimConfig;
  private readonly lastHit: Float64Array;
  private readonly lastDamaged: Float64Array;
  private readonly grid: SpatialGrid;
  private wallV = 0;
  private director = 1;
  private dirSum = 0;
  private dirHits = 0;
  private hpPool0 = 1;
  private lastAnyHit = 0;
  private lastEscape = 0;
  private gapAngle0 = 0;
  /** Smallest opening that lets a median-sized flag through. */
  private minGapHalf = 0;
  private readonly rng: Rng;

  constructor(cfg: SimConfig) {
    this.cfg = cfg;
    const n = (this.n = cfg.fighters.length);
    this.ids = cfg.fighters.map((f) => f.id);
    this.x = new Float64Array(n);
    this.y = new Float64Array(n);
    this.vx = new Float64Array(n);
    this.vy = new Float64Array(n);
    this.r = Float64Array.from(computeRadii(cfg.fighters.map((f) => f.size)));
    this.invMass = this.r.map((r) => 1 / (r * r));
    this.hp = Float64Array.from(cfg.fighters, (f) => f.hp);
    this.maxHp = Float64Array.from(cfg.fighters, (f) => f.hp);
    this.cruise = Float64Array.from(cfg.fighters, (f) => BASE_SPEED * f.speed);
    this.attack = Float64Array.from(cfg.fighters, (f) => f.attack);
    this.alive = new Uint8Array(n).fill(1);
    this.elimT = new Float64Array(n).fill(Infinity);
    this.kills = new Uint16Array(n);
    this.lastHit = new Float64Array(n * n).fill(-Infinity);
    this.lastDamaged = new Float64Array(n).fill(-Infinity);
    this.aliveCount = n;
    this.hpPool0 = Math.max(
      1,
      this.hp.reduce((a, b) => a + b, 0) - this.hp.reduce((a, b) => Math.max(a, b), 0),
    );

    let maxR = 1;
    for (let i = 0; i < n; i++) maxR = Math.max(maxR, this.r[i]);
    this.grid = new SpatialGrid(ARENA_R, 2 * maxR, n);

    this.rng = new Rng(cfg.seed);
    this.spawn(this.rng);
    if (cfg.mode === 'escape') {
      this.gapAngle0 = this.gapAngle = this.rng.range(0, 6.283185307179586);
      const sorted = Array.from(this.r).sort((a, b) => a - b);
      this.minGapHalf = (1.08 * (sorted[Math.floor(n / 2)] ?? 20)) / ARENA_R;
      this.gapHalf = this.clampGap(cfg.gap.halfAngle);
    }
    if (n === 1) this.declareWinner(0);
  }

  private spawn(rng: Rng): void {
    const { n, x, y, vx, vy, r } = this;
    const margin = 6;
    for (let i = 0; i < n; i++) {
      let placed = false;
      for (let attempt = 0; attempt < 400 && !placed; attempt++) {
        const px = rng.range(-ARENA_R, ARENA_R);
        const py = rng.range(-ARENA_R, ARENA_R);
        if (wallContact(this.cfg.arena, ARENA_R - margin, px, py, r[i])) continue;
        let ok = true;
        for (let j = 0; j < i && ok; j++) {
          const dx = px - x[j];
          const dy = py - y[j];
          const min = r[i] + r[j] + margin;
          if (dx * dx + dy * dy < min * min) ok = false;
        }
        if (ok) {
          x[i] = px;
          y[i] = py;
          placed = true;
        }
      }
      if (!placed) {
        // Crowded roster: fall back to a deterministic spiral; the solver separates overlaps.
        const a = i * 2.399963;
        const d = (ARENA_R - r[i] - margin) * Math.sqrt((i + 0.5) / n);
        x[i] = d * dcos(a);
        y[i] = d * dsin(a);
      }
      // Random unit direction via rejection sampling (sqrt only, no trig).
      let dx = 0;
      let dy = 0;
      let len2 = 0;
      do {
        dx = rng.range(-1, 1);
        dy = rng.range(-1, 1);
        len2 = dx * dx + dy * dy;
      } while (len2 > 1 || len2 < 1e-4);
      const len = Math.sqrt(len2);
      vx[i] = (dx / len) * this.cruise[i];
      vy[i] = (dy / len) * this.cruise[i];
    }
  }

  /** Arena floor so alive discs never get packed too tightly. */
  private targetArena(): number {
    let sumSq = 0;
    for (let i = 0; i < this.n; i++) if (this.alive[i]) sumSq += this.r[i] * this.r[i];
    return Math.min(1, Math.max(MIN_ARENA_FRAC, Math.sqrt(sumSq / MAX_PACKING) / ARENA_R));
  }

  private clampGap(h: number): number {
    return h < this.minGapHalf ? this.minGapHalf : h > MAX_GAP_HALF ? MAX_GAP_HALF : h;
  }

  ramp(t: number): number {
    return (1 + this.cfg.damageRamp * t) * this.director;
  }

  /** Mean director multiplier over all hits so far (1 when the director is off). */
  get meanDirector(): number {
    return this.dirHits > 0 ? this.dirSum / this.dirHits : 1;
  }

  /**
   * Pacing director: compares the remaining HP pool (excluding the leader) with the planned curve
   * pool(tau) = (1 - tau)^1.2 and nudges a smoothed damage multiplier up when the battle runs
   * behind schedule and down when it runs ahead. Past the target it keeps rising.
   */
  private updateDirector(): void {
    const T = this.cfg.targetWinSec;
    if (T === undefined || this.winnerIndex >= 0) return;
    const tau = this.t / T;
    const planned = tau >= 1 ? 0 : Math.pow(1 - tau, PLAN_EXP);
    if (this.cfg.mode === 'escape') {
      // Escape pacing: widen the opening when flags stay inside longer than planned.
      const heads = this.n > 1 ? (this.aliveCount - 1) / (this.n - 1) : 0;
      let target = Math.exp((DIRECTOR_GAIN * (heads - planned)) / (planned + 0.08));
      if (tau > 1) target *= 1 + OVERTIME_SURGE * (this.t - T);
      target = target < DIRECTOR_MIN ? DIRECTOR_MIN : target > DIRECTOR_MAX ? DIRECTOR_MAX : target;
      this.director += (target - this.director) * (DT / GAP_DIRECTOR_TAU);
      this.dirSum += this.director;
      this.dirHits++;
      return;
    }
    // The battle ends when everyone but one is out, so pace the pool without the current leader.
    let sum = 0;
    let max = 0;
    for (let i = 0; i < this.n; i++) {
      if (!this.alive[i]) continue;
      sum += this.hp[i];
      if (this.hp[i] > max) max = this.hp[i];
    }
    const pool = (sum - max) / this.hpPool0;
    // Blend HP with head count so eliminations spread across the battle instead of bunching
    // up at the end (evenly matched rosters otherwise all run low on HP at the same time).
    const heads = this.n > 1 ? (this.aliveCount - 1) / (this.n - 1) : 0;
    const remaining = (1 - HEADCOUNT_WEIGHT) * pool + HEADCOUNT_WEIGHT * heads;
    let target = Math.exp((DIRECTOR_GAIN * (remaining - planned)) / (planned + 0.08));
    if (tau > 1) target *= 1 + OVERTIME_SURGE * (this.t - T);
    target = target < DIRECTOR_MIN ? DIRECTOR_MIN : target > DIRECTOR_MAX ? DIRECTOR_MAX : target;
    this.director += (target - this.director) * (DT / DIRECTOR_TAU);
  }

  get done(): boolean {
    return this.winnerIndex >= 0;
  }

  step(): void {
    const { n, x, y, vx, vy, r, alive, cruise } = this;
    this.t = ++this.stepIndex * DT;
    const t = this.t;

    // Arena shrink (monotonic, never tighter than the packing floor).
    const shrink = this.cfg.shrink;
    const prevArena = this.arena;
    const escape = this.cfg.mode === 'escape';
    if (!escape && shrink.enabled && t > shrink.startSec) {
      const floor = this.targetArena();
      this.arena = Math.max(floor, Math.min(prevArena, prevArena - shrink.rate * DT));
    }
    this.wallV = ((prevArena - this.arena) * ARENA_R) / DT;

    // Speed regulation + integration.
    const relax = DT / SPEED_TAU;
    for (let i = 0; i < n; i++) {
      if (!alive[i]) continue;
      const s2 = vx[i] * vx[i] + vy[i] * vy[i];
      const target = cruise[i] * this.speedBoost;
      if (s2 < 1e-6) {
        vx[i] = target;
        vy[i] = 0;
      } else {
        const s = Math.sqrt(s2);
        let ns = s + (target - s) * relax;
        if (ns < target * MIN_SPEED_FRAC) ns = target * MIN_SPEED_FRAC;
        const k = ns / s;
        vx[i] *= k;
        vy[i] *= k;
      }
      x[i] += vx[i] * DT;
      y[i] += vy[i] * DT;
    }

    // Anti-stalemate: when nobody has been hit for a while (e.g. the final two stuck in
    // non-intersecting billiard orbits), fighters gradually steer toward their nearest opponent.
    this.updateDirector();
    const T = this.cfg.targetWinSec;
    if (escape) {
      this.gapAngle = this.gapAngle0 + this.cfg.gap.omega * t;
      const m =
        T !== undefined
          ? this.director
          : 1 + GAP_WIDEN_RATE * Math.max(0, t - this.lastEscape - GAP_QUIET_SEC);
      if (this.winnerIndex >= 0) {
        // Winner decided: the opening closes so the champion stays inside.
        this.gapHalf = Math.max(0, this.gapHalf - DT * GAP_CLOSE_RATE);
      } else {
        this.speedBoost = m < SPEED_MIN ? SPEED_MIN : m < SPEED_BOOST_MAX ? m : SPEED_BOOST_MAX;
        const grow = m < 1 ? m : Math.min(GAP_GROW_MAX, Math.max(1, m / SPEED_BOOST_MAX));
        this.gapHalf = this.clampGap(this.cfg.gap.halfAngle * grow);
      }
    }
    const quiet = escape
      ? 0
      : Math.max(t - this.lastAnyHit - STALEMATE_SEC, T !== undefined ? (t - T) * 2 : 0);
    if (quiet > 0 && this.aliveCount >= 2 && this.winnerIndex < 0) {
      // Blend each velocity toward "straight at the nearest opponent". A pure steering force
      // lets two pursuers orbit each other forever; a growing blend rate guarantees contact.
      const blend = Math.min(1, Math.min(quiet / 3, 1) * STEER_RATE * DT);
      for (let i = 0; i < n; i++) {
        if (!alive[i]) continue;
        let best = -1;
        let bestD2 = Infinity;
        for (let j = 0; j < n; j++) {
          if (j === i || !alive[j]) continue;
          const dx = x[j] - x[i];
          const dy = y[j] - y[i];
          const d2 = dx * dx + dy * dy;
          if (d2 < bestD2) {
            bestD2 = d2;
            best = j;
          }
        }
        if (best < 0 || bestD2 < 1e-9) continue;
        const d = Math.sqrt(bestD2);
        const s = Math.sqrt(vx[i] * vx[i] + vy[i] * vy[i]);
        vx[i] += (((x[best] - x[i]) / d) * s - vx[i]) * blend;
        vy[i] += (((y[best] - y[i]) / d) * s - vy[i]) * blend;
      }
    }

    // Broad phase.
    const grid = this.grid;
    grid.clear();
    for (let i = 0; i < n; i++) if (alive[i]) grid.insert(i, x[i], y[i]);

    // Narrow phase: each unordered pair once, in a fixed deterministic order.
    const cols = grid.cols;
    for (let i = 0; i < n; i++) {
      if (!alive[i]) continue;
      const cx = grid.cellOf(x[i]);
      const cy = grid.cellOf(y[i]);
      for (let oy = -1; oy <= 1; oy++) {
        const gy = cy + oy;
        if (gy < 0 || gy >= cols) continue;
        for (let ox = -1; ox <= 1; ox++) {
          const gx = cx + ox;
          if (gx < 0 || gx >= cols) continue;
          for (let j = grid.head[gy * cols + gx]; j !== -1; j = grid.next[j]) {
            if (j <= i || !alive[j] || !alive[i]) continue;
            this.collide(i, j);
          }
        }
      }
    }

    if (escape) {
      for (let i = 0; i < n; i++) if (alive[i]) this.escapeWall(i);
      if (this.winnerIndex < 0 && this.aliveCount <= 1) {
        for (let i = 0; i < n; i++) if (alive[i]) this.declareWinner(i);
      }
      return;
    }

    // Walls last so nobody leaves the arena.
    const h = ARENA_R * this.arena;
    for (let i = 0; i < n; i++) {
      if (!alive[i]) continue;
      const c = wallContact(this.cfg.arena, h, x[i], y[i], r[i]);
      if (!c) continue;
      x[i] -= c.nx * c.depth;
      y[i] -= c.ny * c.depth;
      const vn = vx[i] * c.nx + vy[i] * c.ny;
      // Reflect relative to the (possibly inward-moving) wall.
      const wallVn = -this.wallV;
      if (vn > wallVn) {
        const out = wallVn - (vn - wallVn);
        vx[i] += (out - vn) * c.nx;
        vy[i] += (out - vn) * c.ny;
        // Small seeded deflection along the wall tangent breaks periodic billiard orbits.
        const jitter = this.rng.range(-WALL_JITTER, WALL_JITTER) * Math.sqrt(vx[i] * vx[i] + vy[i] * vy[i]);
        vx[i] += -c.ny * jitter;
        vy[i] += c.nx * jitter;
      }
    }

    if (this.winnerIndex < 0 && this.aliveCount <= 1) {
      // Defensive: should already be declared in eliminate().
      for (let i = 0; i < n; i++) if (alive[i]) this.declareWinner(i);
    }
  }

  /**
   * Escape-mode rim: a fixed circle with one rotating opening. The solid part is an arc; its
   * two endpoints are point obstacles that move with the rotation. A flag whose center crosses
   * the rim inside the opening is out; anywhere else the arc pushes it back.
   */
  private escapeWall(i: number): void {
    const { x, y, vx, vy, r } = this;
    const R = ARENA_R;
    const d2 = x[i] * x[i] + y[i] * y[i];
    const d = Math.sqrt(d2);
    if (d + r[i] <= R || d < 1e-9) return;

    const ga = this.gapAngle;
    const half = this.gapHalf;
    const gx = dcos(ga);
    const gy = dsin(ga);
    const ux = x[i] / d;
    const uy = y[i] / d;
    const inGap = this.winnerIndex < 0 && ux * gx + uy * gy > dcos(half);
    if (d > R && inGap) {
      this.escape(i);
      return;
    }

    if (!inGap) {
      // Solid arc: push back inside and reflect (static circle, rotation is tangential).
      x[i] = ux * (R - r[i]);
      y[i] = uy * (R - r[i]);
      const vn = vx[i] * ux + vy[i] * uy;
      if (vn > 0) {
        vx[i] -= 2 * vn * ux;
        vy[i] -= 2 * vn * uy;
        const jitter = this.rng.range(-WALL_JITTER, WALL_JITTER) * Math.sqrt(vx[i] * vx[i] + vy[i] * vy[i]);
        vx[i] += -uy * jitter;
        vy[i] += ux * jitter;
      }
    }

    // Opening edges (arc endpoints) as moving point obstacles.
    const ch = dcos(half);
    const sh = dsin(half);
    const omega = this.cfg.gap.omega;
    for (const side of [1, -1]) {
      // Rotate the gap direction by +/- half.
      const ex = R * (gx * ch - side * gy * sh);
      const ey = R * (gy * ch + side * gx * sh);
      const dx = x[i] - ex;
      const dy = y[i] - ey;
      const e2 = dx * dx + dy * dy;
      if (e2 >= r[i] * r[i] || e2 < 1e-12) continue;
      const e = Math.sqrt(e2);
      const nx = dx / e;
      const ny = dy / e;
      x[i] = ex + nx * r[i];
      y[i] = ey + ny * r[i];
      // Edge velocity from the rotation: omega x p.
      const evx = -omega * ey;
      const evy = omega * ex;
      const vn = (vx[i] - evx) * nx + (vy[i] - evy) * ny;
      if (vn < 0) {
        vx[i] -= (1 + RESTITUTION) * vn * nx;
        vy[i] -= (1 + RESTITUTION) * vn * ny;
      }
    }
  }

  private escape(i: number): void {
    this.lastEscape = this.t;
    this.alive[i] = 0;
    this.elimT[i] = this.t;
    this.aliveCount--;
    this.events.push({
      t: this.t,
      type: 'eliminate',
      id: this.ids[i],
      x: round1(this.x[i]),
      y: round1(this.y[i]),
      escaped: true,
      vx: round1(this.vx[i]),
      vy: round1(this.vy[i]),
    });
    this.afterElimination();
  }

  private collide(i: number, j: number): void {
    const { x, y, vx, vy, r, invMass } = this;
    let dx = x[j] - x[i];
    let dy = y[j] - y[i];
    const rs = r[i] + r[j];
    const d2 = dx * dx + dy * dy;
    if (d2 >= rs * rs) return;
    let d = Math.sqrt(d2);
    if (d < 1e-9) {
      dx = 1;
      dy = 0;
      d = 1;
    } else {
      dx /= d;
      dy /= d;
    }
    const wi = invMass[i];
    const wj = invMass[j];
    const wsum = wi + wj;

    // Positional correction, split by inverse mass.
    const overlap = rs - (d2 < 1e-18 ? 0 : d);
    x[i] -= dx * overlap * (wi / wsum);
    y[i] -= dy * overlap * (wi / wsum);
    x[j] += dx * overlap * (wj / wsum);
    y[j] += dy * overlap * (wj / wsum);

    // Impulse along the contact normal.
    const vrel = (vx[j] - vx[i]) * dx + (vy[j] - vy[i]) * dy;
    if (vrel >= 0) return;
    const jImp = (-(1 + RESTITUTION) * vrel) / wsum;
    vx[i] -= jImp * wi * dx;
    vy[i] -= jImp * wi * dy;
    vx[j] += jImp * wj * dx;
    vy[j] += jImp * wj * dy;

    const impact = -vrel;
    if (impact < MIN_IMPACT) return;
    const pair = i * this.n + j;
    if (this.t - this.lastHit[pair] < PAIR_COOLDOWN) return;
    this.lastHit[pair] = this.t;
    this.lastAnyHit = this.t;
    if (this.winnerIndex >= 0) return; // Celebration: bounces only.
    if (this.cfg.mode === 'escape') {
      // No damage in escape mode; the bump is still an event for sparks and sound.
      this.events.push({
        t: this.t,
        type: 'hit',
        a: this.ids[i],
        b: this.ids[j],
        dmgA: 0,
        dmgB: 0,
        impact: round1(impact),
        x: round1(x[i] + dx * r[i]),
        y: round1(y[i] + dy * r[i]),
      });
      return;
    }

    const cfg = this.cfg;
    const factor = cfg.damageModel === 'fixed' ? 1 : clamp(impact / REF_IMPACT, 0.3, 2);
    const base = cfg.baseDamage * factor * this.ramp(this.t);
    const canI = this.t - this.lastDamaged[i] >= INVULN;
    const canJ = this.t - this.lastDamaged[j] >= INVULN;
    if (!canI && !canJ) return;
    const dmgI = canI ? base * this.attack[j] : 0;
    const dmgJ = canJ ? base * this.attack[i] : 0;
    if (canI) this.lastDamaged[i] = this.t;
    if (canJ) this.lastDamaged[j] = this.t;
    this.hp[i] -= dmgI;
    this.hp[j] -= dmgJ;
    this.dirSum += this.director;
    this.dirHits++;

    const cx = x[i] + dx * r[i];
    const cy = y[i] + dy * r[i];
    this.events.push({
      t: this.t,
      type: 'hit',
      a: this.ids[i],
      b: this.ids[j],
      dmgA: round1(dmgI),
      dmgB: round1(dmgJ),
      impact: round1(impact),
      x: round1(cx),
      y: round1(cy),
    });

    const deadI = this.hp[i] <= 0;
    const deadJ = this.hp[j] <= 0;
    if (deadI && deadJ && this.aliveCount === 2) {
      // Never end with zero survivors: the one with more HP left clings on.
      if (this.hp[i] >= this.hp[j]) this.hp[i] = 1;
      else this.hp[j] = 1;
    }
    if (this.hp[i] <= 0) this.eliminate(i, j);
    if (this.hp[j] <= 0) this.eliminate(j, i);
  }

  private eliminate(i: number, by: number): void {
    this.hp[i] = 0;
    this.alive[i] = 0;
    this.elimT[i] = this.t;
    this.kills[by]++;
    this.aliveCount--;
    this.events.push({
      t: this.t,
      type: 'eliminate',
      id: this.ids[i],
      by: this.ids[by],
      x: round1(this.x[i]),
      y: round1(this.y[i]),
    });
    this.afterElimination();
  }

  private afterElimination(): void {
    if (this.aliveCount === 2 && this.final2T === null) {
      this.final2T = this.t;
      this.events.push({ t: this.t, type: 'final2' });
    }
    if (this.aliveCount === 1) {
      for (let k = 0; k < this.n; k++) if (this.alive[k]) this.declareWinner(k);
    }
  }

  private declareWinner(i: number): void {
    if (this.winnerIndex >= 0) return;
    this.winnerIndex = i;
    this.winnerT = this.t;
    this.events.push({ t: this.t, type: 'winner', id: this.ids[i] });
  }

  /** Force a result (used only at the hard time limit). */
  forceWinner(): void {
    let best = -1;
    for (let i = 0; i < this.n; i++) if (this.alive[i] && (best < 0 || this.hp[i] > this.hp[best])) best = i;
    if (best >= 0) this.declareWinner(best);
  }
}

/** Runs a full battle headlessly. Deterministic for a given config. */
export function simulate(cfg: SimConfig, opts: SimOptions = {}): SimResult {
  const sim = new Simulation(cfg);
  const holdSec = opts.holdSec ?? 4;
  const maxSec = opts.maxSec ?? 900;
  const n = sim.n;

  const stride = n * 3;
  let frames = 0;
  let data = new Float32Array(opts.record ? stride * 64 : 0);
  let arena = new Float32Array(opts.record ? 64 : 0);
  let gapAngle = new Float32Array(opts.record ? 64 : 0);
  let gapHalf = new Float32Array(opts.record ? 64 : 0);
  const record = () => {
    if (!opts.record) return;
    if (frames >= arena.length) {
      const d = new Float32Array(data.length * 2);
      d.set(data);
      data = d;
      const grow = (src: Float32Array) => {
        const out = new Float32Array(src.length * 2);
        out.set(src);
        return out;
      };
      arena = grow(arena);
      gapAngle = grow(gapAngle);
      gapHalf = grow(gapHalf);
    }
    const o = frames * stride;
    for (let i = 0; i < n; i++) {
      data[o + i * 3] = sim.x[i];
      data[o + i * 3 + 1] = sim.y[i];
      data[o + i * 3 + 2] = sim.hp[i];
    }
    arena[frames] = sim.arena;
    gapAngle[frames] = sim.gapAngle;
    gapHalf[frames] = sim.gapHalf;
    frames++;
  };

  record();
  while (!(sim.done && sim.t >= sim.winnerT + holdSec && sim.stepIndex % STEPS_PER_SAMPLE === 0)) {
    sim.step();
    if (sim.stepIndex % STEPS_PER_SAMPLE === 0) record();
    if (!sim.done && sim.t >= maxSec) sim.forceWinner();
  }

  const track: Track | null = opts.record
    ? {
        hz: TRACK_HZ,
        frames,
        n,
        data: data.slice(0, frames * stride),
        arena: arena.slice(0, frames),
        gapAngle: gapAngle.slice(0, frames),
        gapHalf: gapHalf.slice(0, frames),
      }
    : null;

  return {
    config: cfg,
    events: sim.events,
    radii: Float32Array.from(sim.r),
    maxHp: Float32Array.from(sim.maxHp),
    winnerIndex: sim.winnerIndex,
    winnerT: sim.winnerT,
    final2T: sim.final2T,
    endT: sim.t,
    elimT: sim.elimT,
    kills: sim.kills,
    meanDirector: sim.meanDirector,
    track,
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
