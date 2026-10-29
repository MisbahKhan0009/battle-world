/**
 * Procedural marble track. Sections are generated one after another from a seeded PRNG, so the
 * first k sections are identical whatever the total length. Every section keeps a clear band at
 * its top (no geometry within TOP of its upper edge), which is what lets the race place the
 * finish line at any section boundary without changing anything that happened above it.
 */
import { hash32, Rng } from '../rng';
import type { Peg, Section, SectionKind, Seg, Spinner, Track } from './types';

export const TRACK_W = 1000;
const WALL_R = 7;
const RAMP_R = 7;

type Parts = { segs: Seg[]; pegs: Peg[]; spinners: Spinner[] };

/**
 * Finish line below a section boundary. It sits halfway into the next section's clear band, so a
 * marble whose center is above it cannot touch anything of that section.
 */
export function finishLevel(boundary: number, radius: number): number {
  return boundary + 2.5 * radius;
}

/** Clear band at the top of every section, in marble diameters. */
export const TOP_BAND_D = 2.5;

function ramps(
  rng: Rng,
  p: Parts,
  lx: number,
  rx: number,
  top: number,
  count: number,
  d: number,
  startLeft: boolean,
): number {
  const width = rx - lx;
  const slope = 0.11 + rng.next() * 0.09;
  const gap = 3.2 * d + rng.next() * 1.0 * d;
  const vsp = 3.0 * d + rng.next() * 0.8 * d;
  const run = width - gap;
  let y = top;
  let left = startLeft;
  let low = top;
  for (let i = 0; i < count; i++) {
    if (left) p.segs.push({ ax: lx, ay: y, bx: rx - gap, by: y + run * slope, r: RAMP_R });
    else p.segs.push({ ax: rx, ay: y, bx: lx + gap, by: y + run * slope, r: RAMP_R });
    low = y + run * slope;
    // The next ramp passes under this one's low end with `vsp` of clearance.
    y = low + vsp - gap * slope;
    left = !left;
  }
  return low;
}

function pegField(
  rng: Rng,
  p: Parts,
  lx: number,
  rx: number,
  top: number,
  rows: number,
  d: number,
  bumpers: number,
): number {
  const sx = 3.0 * d + rng.next() * 0.5 * d;
  const sy = 2.3 * d + rng.next() * 0.5 * d;
  const pr = (0.28 + rng.next() * 0.08) * d;
  const start = p.pegs.length;
  let y = top + d;
  for (let row = 0; row < rows; row++) {
    const off = row % 2 ? sx / 2 : 0;
    // Pegs keep a gap wider than a marble from the walls, so nothing can wedge beside them.
    const minX = lx + WALL_R + 1.25 * d + pr;
    const maxX = rx - WALL_R - 1.25 * d - pr;
    for (let x = lx + sx * 0.5 + off; x < rx; x += sx) {
      // A hair of jitter so nothing can balance forever on a peg top.
      const px = x + (rng.next() - 0.5) * 0.1 * d;
      if (px < minX || px > maxX) continue;
      p.pegs.push({ x: px, y, r: pr, bumper: false });
    }
    y += sy;
  }
  // Promote a few pegs to bumpers.
  const count = p.pegs.length - start;
  for (let b = 0; b < bumpers && count > 4; b++) {
    const peg = p.pegs[start + 2 + rng.int(count - 4)];
    peg.bumper = true;
    peg.r = 0.62 * d;
  }
  return y - sy;
}

function spinners(rng: Rng, p: Parts, top: number, d: number, W: number): number {
  const rows = 2 + rng.int(2);
  let y = top;
  let dir = rng.next() < 0.5 ? 1 : -1;
  for (let row = 0; row < rows; row++) {
    const k = row % 2 === 0 ? 2 : 3;
    const spacing = W / k;
    // Bar tips clear the walls (and each other) by more than a marble.
    const half = Math.min(spacing * 0.3, spacing / 2 - WALL_R - 1.3 * d);
    const cy = y + half;
    for (let i = 0; i < k; i++) {
      p.spinners.push({
        cx: spacing * (i + 0.5),
        cy,
        half,
        r: 0.17 * d,
        omega: dir * (1.4 + rng.next() * 1.2),
        phase: rng.next() * Math.PI,
      });
      dir = -dir;
    }
    y = cy + half + 2.2 * d;
  }
  return y - 2.2 * d;
}

function funnel(rng: Rng, p: Parts, top: number, d: number, W: number): number {
  const open = 3.4 * d + rng.next() * 0.6 * d;
  const steep = 1.3 + rng.next() * 0.5;
  const h = (W / 2 - open / 2) * steep;
  const yT = top + h;
  p.segs.push({ ax: 0, ay: top, bx: W / 2 - open / 2, by: yT, r: RAMP_R });
  p.segs.push({ ax: W, ay: top, bx: W / 2 + open / 2, by: yT, r: RAMP_R });
  // Bumpers scatter the flow under the throat.
  const br = 0.72 * d;
  p.pegs.push({ x: W / 2 + (rng.next() - 0.5) * 0.4 * d, y: yT + 3.2 * d, r: br, bumper: true });
  const spread = W * (0.2 + rng.next() * 0.06);
  p.pegs.push({ x: W / 2 - spread, y: yT + 6.2 * d, r: br, bumper: true });
  p.pegs.push({ x: W / 2 + spread, y: yT + 6.2 * d, r: br, bumper: true });
  return yT + 6.2 * d + br;
}

function fork(rng: Rng, p: Parts, top: number, d: number, W: number): number {
  const mid = W / 2;
  const rampsLeft = rng.next() < 0.5;
  const lane = (lx: number, rx: number, useRamps: boolean) =>
    useRamps ? ramps(rng, p, lx, rx, top + d, 3, d, lx === 0) : pegField(rng, p, lx, rx, top, 6, d, 0);
  const a = lane(0, mid, rampsLeft);
  const b = lane(mid, W, !rampsLeft);
  const end = Math.max(a, b) + 1.5 * d;
  p.segs.push({ ax: mid, ay: top, bx: mid, by: end, r: WALL_R });
  return end;
}

const KINDS: SectionKind[] = ['ramps', 'pegs', 'spinners', 'funnel', 'fork'];
const WEIGHTS = [3, 2, 2, 1.5, 1.5];

function nextKind(rng: Rng, prev: SectionKind | null): SectionKind {
  // Always open with a plinko field: it scatters the start grid instead of lining it up.
  if (prev === null) return 'pegs';
  const total = KINDS.reduce((s, k, i) => s + (k === prev ? 0 : WEIGHTS[i]), 0);
  let x = rng.next() * total;
  for (let i = 0; i < KINDS.length; i++) {
    if (KINDS[i] === prev) continue;
    x -= WEIGHTS[i];
    if (x < 0) return KINDS[i];
  }
  return 'ramps';
}

/** Rows of the start grid (marbles wait above y = 0). */
export function startGrid(n: number, radius: number, W = TRACK_W): { x: number; y: number }[] {
  const pitch = radius * 2.35;
  const cols = Math.max(1, Math.floor((W - 2 * WALL_R - pitch) / pitch));
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const inRow = Math.min(cols, n - row * cols);
    const x0 = W / 2 - ((inRow - 1) * pitch) / 2;
    out.push({ x: x0 + col * pitch, y: -radius * 1.5 - row * pitch });
  }
  return out;
}

/**
 * Builds a track with `sections` sections. With `finish`, a finish line and a catch tray follow
 * the last section; without, the track simply continues to a floor far below (used to probe
 * how far the race gets in a given time).
 */
export function buildTrack(seed: number, sections: number, radius: number, finish: boolean): Track {
  const W = TRACK_W;
  const d = 2 * radius;
  const rng = new Rng(hash32(seed, 0x7a11));
  const parts: Parts = { segs: [], pegs: [], spinners: [] };
  const list: Section[] = [];
  const TOP = TOP_BAND_D * d;
  let y = 0;
  let prev: SectionKind | null = null;
  for (let s = 0; s < sections; s++) {
    const kind = nextKind(rng, prev);
    prev = kind;
    const top = y + TOP;
    let bottom: number;
    switch (kind) {
      case 'ramps':
        bottom = ramps(rng, parts, 0, W, top, 2 + rng.int(3), d, rng.next() < 0.5);
        break;
      case 'pegs':
        bottom = pegField(rng, parts, 0, W, top, 5 + rng.int(4), d, rng.int(3));
        break;
      case 'spinners':
        bottom = spinners(rng, parts, top, d, W);
        break;
      case 'funnel':
        bottom = funnel(rng, parts, top, d, W);
        break;
      default:
        bottom = fork(rng, parts, top, d, W);
    }
    const y1 = bottom + 1.5 * d;
    list.push({ kind, y0: y, y1 });
    y = y1;
  }

  // Room above the start line for the largest start grid.
  const topY = Math.min(-600, startGrid(64, radius).at(-1)!.y - 6 * radius);
  let finishY = Infinity;
  let bottomY: number;
  if (finish) {
    finishY = finishLevel(y, radius);
    // A shallow V tray catches everyone after the line.
    const trayY = finishY + 7 * d;
    const dip = (W / 2) * 0.12;
    parts.segs.push({ ax: 0, ay: trayY, bx: W / 2, by: trayY + dip, r: RAMP_R });
    parts.segs.push({ ax: W, ay: trayY, bx: W / 2, by: trayY + dip, r: RAMP_R });
    bottomY = trayY + dip + 4 * d;
  } else {
    bottomY = y + 30 * d;
    parts.segs.push({ ax: 0, ay: bottomY, bx: W, by: bottomY, r: RAMP_R });
  }
  parts.segs.push({ ax: 0, ay: topY, bx: 0, by: bottomY, r: WALL_R });
  parts.segs.push({ ax: W, ay: topY, bx: W, by: bottomY, r: WALL_R });

  return { width: W, ...parts, sections: list, startY: 0, finishY, bottomY };
}
