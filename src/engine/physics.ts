import type { ArenaShape } from './types';

/** Arena half-size (circle radius / square half-width) in world units. */
export const ARENA_R = 500;
/** Corner radius of the rounded arena as a fraction of its half-size. */
export const ROUNDED_CORNER = 0.3;
/** Smallest the arena may shrink to, as a fraction of its starting size. */
export const MIN_ARENA_FRAC = 0.32;

/** Arena scale factor at sim time t (1 = full size). */
export function arenaScale(shrink: { enabled: boolean; startSec: number; rate: number }, t: number): number {
  if (!shrink.enabled || t <= shrink.startSec) return 1;
  return Math.max(MIN_ARENA_FRAC, 1 - shrink.rate * (t - shrink.startSec));
}

/** Inward speed of the arena wall (world units / s) at sim time t. */
export function wallSpeed(shrink: { enabled: boolean; startSec: number; rate: number }, t: number): number {
  if (!shrink.enabled || t <= shrink.startSec) return 0;
  return arenaScale(shrink, t) > MIN_ARENA_FRAC ? shrink.rate * ARENA_R : 0;
}

/** Output of a wall test: penetration depth and outward normal. */
export type WallContact = { depth: number; nx: number; ny: number };

/**
 * Tests a disc (center x,y, radius r) against the inside of the arena with half-size h.
 * Returns null when the disc is fully inside. Uses only + - * / sqrt so results are
 * bit-identical across JS engines.
 */
export function wallContact(shape: ArenaShape, h: number, x: number, y: number, r: number): WallContact | null {
  if (shape === 'circle') {
    const limit = h - r;
    const d2 = x * x + y * y;
    if (d2 <= limit * limit) return null;
    const d = Math.sqrt(d2);
    if (d < 1e-9) return null;
    return { depth: d - limit, nx: x / d, ny: y / d };
  }
  // Square and rounded share a rounded-box SDF; a square is a rounded box with corner 0.
  // The allowed region for the center is the arena box shrunk by r (Minkowski difference).
  const b = h - r;
  const c = shape === 'rounded' ? Math.max(ROUNDED_CORNER * h - r, 0) : 0;
  const ax = x < 0 ? -x : x;
  const ay = y < 0 ? -y : y;
  const qx = ax - (b - c);
  const qy = ay - (b - c);
  if (qx > 0 && qy > 0) {
    // Corner region.
    const len = Math.sqrt(qx * qx + qy * qy);
    const depth = len - c;
    if (depth <= 0) return null;
    if (len < 1e-9) return { depth, nx: x < 0 ? -0.7071 : 0.7071, ny: y < 0 ? -0.7071 : 0.7071 };
    return { depth, nx: ((x < 0 ? -1 : 1) * qx) / len, ny: ((y < 0 ? -1 : 1) * qy) / len };
  }
  // Edge region: push along the dominant axis.
  if (qx >= qy) {
    const depth = qx - c;
    if (depth <= 0) return null;
    return { depth, nx: x < 0 ? -1 : 1, ny: 0 };
  }
  const depth = qy - c;
  if (depth <= 0) return null;
  return { depth, nx: 0, ny: y < 0 ? -1 : 1 };
}

/**
 * Uniform spatial hash for broad-phase. Preallocated typed arrays, no per-step allocation.
 * Cells are linked lists (head per cell, next per body).
 */
export class SpatialGrid {
  readonly cols: number;
  readonly cell: number;
  readonly head: Int32Array;
  readonly next: Int32Array;
  private readonly origin: number;

  constructor(halfSize: number, cellSize: number, bodies: number) {
    this.cell = cellSize;
    this.cols = Math.max(1, Math.ceil((2 * halfSize) / cellSize));
    this.origin = -halfSize;
    this.head = new Int32Array(this.cols * this.cols);
    this.next = new Int32Array(bodies);
  }

  clear(): void {
    this.head.fill(-1);
  }

  cellOf(v: number): number {
    const c = Math.floor((v - this.origin) / this.cell);
    return c < 0 ? 0 : c >= this.cols ? this.cols - 1 : c;
  }

  insert(i: number, x: number, y: number): void {
    const k = this.cellOf(y) * this.cols + this.cellOf(x);
    this.next[i] = this.head[k];
    this.head[k] = i;
  }
}
