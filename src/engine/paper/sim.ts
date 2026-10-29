/**
 * Paper Land rules and steering, like Paper.io 2. Every flag starts on a round patch of land and
 * moves at a constant speed, steering smoothly (a limited turn rate, so paths curve). Outside its
 * land it leaves a trail; coming home closes the loop and everything the trail encloses becomes
 * its land (taken from whoever owned it). Running into a rival's trail knocks that rival out (its
 * land is wiped); running into your own trail or off the board knocks you out. When the clock
 * runs out the most land wins, or the last flag left wins early.
 *
 * Land lives on a grid of one cell per board unit. Fixed steps, a seeded RNG and dsin/dcos keep it
 * deterministic: the same config is the same game.
 */
import { dcos, dsin } from '../physics';
import { hash32, Rng } from '../rng';
import type { PaperCause, PaperConfig, PaperEvent, PaperTrack } from './types';

export const STEP = 1 / 60;
/** Board units moved per second, and the fastest turn (radians per second). */
export const SPEED = 40;
const TURN = 4.2;
/** Starting land is a disc of this radius. */
export const START_R = 6;
/** A trail is this wide either side of the flag's path. */
export const TRAIL_R = 1.7;
/** A flag only hits its own trail where it was laid more than this many steps ago. */
const RECENT = 10;
/** Recorded frames per second. */
const REC_HZ = 30;
/** The steering flies ARC moves of ARC_STEPS steps ahead to test a heading, and re-plans this often. */
const ARC = 20;
const ARC_STEPS = 2;
const DECIDE_EVERY = 3;
/** Until this share of the clock, flags build and keep clear of each other. */
const CALM = 0.45;
/** Coarse grid factor for the "way home" distance field. */
const K = 4;
/** A flag counts as the new leader once it has this much more land (no flicker on near-ties). */
const LEAD_MARGIN = 1.05;
const INF = 0x3fffffff;

/** Board side for n flags: a few thousand cells of room each. */
export function boardSize(n: number): number {
  return 4 * Math.max(30, Math.min(64, Math.round(Math.sqrt(n * 400))));
}

const STEP_C = dcos(TURN * STEP);
const STEP_S = dsin(TURN * STEP);
const ARC_C = dcos(TURN * STEP * ARC_STEPS);
const ARC_S = dsin(TURN * STEP * ARC_STEPS);
/** Swerves the steering may take instead of the wanted heading (radians from the current one). */
const SWERVES = [0.45, -0.45, 0.95, -0.95, 1.6, -1.6, 2.3, -2.3, 3.0, -3.0].map(
  (a) => [dcos(a), dsin(a)] as const,
);
/** Directions a loop may set out in. */
const COMPASS = Array.from(
  { length: 16 },
  (_, k) => [dcos((k * Math.PI) / 8), dsin((k * Math.PI) / 8)] as const,
);

/** One excursion: out to each waypoint in turn, then home by the shortest way. */
type Plan = { wps: [number, number][]; idx: number };

export type PaperSimOut = {
  events: PaperEvent[];
  winnerIndex: number;
  winnerT: number;
  endT: number;
  land: number[];
  lastStanding: boolean;
  leadChanges: number;
  cuts: number;
  rec: PaperTrack | null;
};

export function simulatePaper(config: PaperConfig, opts: { record: boolean; holdSec: number }): PaperSimOut {
  const G = config.size;
  const n = config.ids.length;
  const N = G * G;
  const CG = Math.ceil(G / K);
  const owner = new Int8Array(N).fill(-1);
  const trail = new Int8Array(N).fill(-1);
  const stamp = new Int32Array(N);
  const trails: number[][] = config.ids.map(() => []);
  const trailPts: [number, number][][] = config.ids.map(() => []);
  const ctrail = config.ids.map(() => new Uint8Array(CG * CG));
  const land = new Int32Array(n);
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const hx = new Float64Array(n);
  const hy = new Float64Array(n);
  const wx = new Float64Array(n);
  const wy = new Float64Array(n);
  const alive = new Uint8Array(n).fill(1);
  const plan: (Plan | null)[] = config.ids.map(() => null);
  const dist = config.ids.map(() => new Int32Array(CG * CG));
  const homeDist = new Float64Array(n).fill(0);
  const queue = new Int32Array(Math.max(N, CG * CG));
  const seen = new Uint8Array(N);
  const rng = new Rng(hash32(config.seed, 0x9a9f));

  // Each flag gets its own temperament (how far it roams, how early it turns back, how keen it is
  // to cut). Winners are relabelled after the game, so this only adds variety.
  const greed = config.ids.map(() => 0.75 + 0.5 * rng.next());
  const caution = config.ids.map(() => 6 + 10 * rng.next());
  const aggro = config.ids.map(() => 0.3 + 0.7 * rng.next());

  const chCells: number[] = [];
  const chOwners: number[] = [];
  const chT: number[] = [];
  const chStart: number[] = [];
  const setOwner = (c: number, o: number) => {
    if (owner[c] === o) return;
    owner[c] = o;
    chCells.push(c);
    chOwners.push(o + 1);
  };

  // Spawns: the best spread of a few random spots, away from the edges, each on a disc of land.
  const lo = START_R + 14;
  const hi = G - START_R - 14;
  for (let p = 0; p < n; p++) {
    let best = -1;
    for (let k = 0; k < 40; k++) {
      const px = lo + rng.next() * (hi - lo);
      const py = lo + rng.next() * (hi - lo);
      let m = Infinity;
      for (let q = 0; q < p; q++) m = Math.min(m, Math.hypot(px - x[q], py - y[q]));
      if (m > best) {
        best = m;
        x[p] = px;
        y[p] = py;
      }
    }
    const [ux, uy] = COMPASS[rng.int(16)];
    hx[p] = wx[p] = ux;
    hy[p] = wy[p] = uy;
    for (let cy = Math.floor(y[p] - START_R); cy <= y[p] + START_R; cy++)
      for (let cx = Math.floor(x[p] - START_R); cx <= x[p] + START_R; cx++) {
        if ((cx + 0.5 - x[p]) ** 2 + (cy + 0.5 - y[p]) ** 2 > START_R * START_R) continue;
        const c = cy * G + cx;
        if (owner[c] >= 0) land[owner[c]]--;
        setOwner(c, p);
        land[p]++;
      }
  }
  chT.push(0);
  chStart.push(0);
  let committed = chCells.length;

  const cellOf = (px: number, py: number) =>
    Math.min(G - 1, Math.max(0, Math.floor(py))) * G + Math.min(G - 1, Math.max(0, Math.floor(px)));
  const inBoard = (px: number, py: number) => px >= 0 && py >= 0 && px < G && py < G;

  /** The nearby coarse cell closest to home: where to head, and how far home is (board units). */
  const homeward = (p: number): { tx: number; ty: number; d: number } => {
    const D = dist[p];
    const cx0 = Math.floor(x[p] / K);
    const cy0 = Math.floor(y[p] / K);
    let best = INF;
    let tx = x[p] + hx[p];
    let ty = y[p] + hy[p];
    let bestR = Infinity;
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const cx = cx0 + dx;
        const cy = cy0 + dy;
        if ((!dx && !dy) || cx < 0 || cy < 0 || cx >= CG || cy >= CG) continue;
        const d = D[cy * CG + cx];
        const r = dx * dx + dy * dy;
        if (d < best || (d === best && r < bestR)) {
          best = d;
          bestR = r;
          tx = cx * K + K / 2;
          ty = cy * K + K / 2;
        }
      }
    return { tx, ty, d: best >= INF ? INF : (best + 1) * K };
  };

  /** Coarse distance from every coarse cell to p's land without crossing p's own trail. */
  const bfs = (p: number) => {
    const D = dist[p];
    const ct = ctrail[p];
    D.fill(INF);
    let qh = 0;
    let qt = 0;
    for (let cy = 0; cy < CG; cy++)
      for (let cx = 0; cx < CG; cx++) {
        const c = Math.min(G - 1, cy * K + 2) * G + Math.min(G - 1, cx * K + 2);
        if (owner[c] === p && !ct[cy * CG + cx]) {
          D[cy * CG + cx] = 0;
          queue[qt++] = cy * CG + cx;
        }
      }
    while (qh < qt) {
      const c = queue[qh++];
      const cx = c % CG;
      const d = D[c] + 1;
      if (cx > 0 && D[c - 1] === INF && !ct[c - 1]) {
        D[c - 1] = d;
        queue[qt++] = c - 1;
      }
      if (cx < CG - 1 && D[c + 1] === INF && !ct[c + 1]) {
        D[c + 1] = d;
        queue[qt++] = c + 1;
      }
      if (c >= CG && D[c - CG] === INF && !ct[c - CG]) {
        D[c - CG] = d;
        queue[qt++] = c - CG;
      }
      if (c < CG * (CG - 1) && D[c + CG] === INF && !ct[c + CG]) {
        D[c + CG] = d;
        queue[qt++] = c + CG;
      }
    }
    homeDist[p] = homeward(p).d;
  };

  /**
   * How long (look-ahead moves) p can fly turning toward (vx, vy) at its real turn rate before it
   * meets the edge or its own trail; ARC + 1 when the way is clear or reaches home.
   */
  const clearance = (p: number, vx: number, vy: number, step: number, calm: boolean): number => {
    let ax = x[p];
    let ay = y[p];
    let bx = hx[p];
    let by = hy[p];
    const out = owner[cellOf(ax, ay)] !== p;
    for (let k = 1; k <= ARC; k++) {
      const cross = bx * vy - by * vx;
      if (bx * vx + by * vy >= ARC_C) {
        bx = vx;
        by = vy;
      } else {
        const s = cross >= 0 ? ARC_S : -ARC_S;
        const nx = bx * ARC_C - by * s;
        const ny = bx * s + by * ARC_C;
        const l = Math.sqrt(nx * nx + ny * ny);
        bx = nx / l;
        by = ny / l;
      }
      ax += bx * SPEED * STEP * ARC_STEPS;
      ay += by * SPEED * STEP * ARC_STEPS;
      if (ax < 2 || ay < 2 || ax > G - 2 || ay > G - 2) return k;
      const c = cellOf(ax, ay);
      if (out && owner[c] === p) return ARC + 1;
      const tr = trail[c];
      if (tr === p && (stamp[c] < step - RECENT || (ax - x[p]) ** 2 + (ay - y[p]) ** 2 > 12)) return k;
      if (calm) {
        if (tr >= 0 && tr !== p) return k;
        for (let q = 0; q < n; q++)
          if (q !== p && alive[q] && (x[q] - ax) ** 2 + (y[q] - ay) ** 2 < 16) return k;
      }
    }
    return ARC + 1;
  };

  /** The wanted heading, or the clearest swerve near it. */
  const steerSafe = (p: number, vx: number, vy: number, step: number, calm: boolean) => {
    if (clearance(p, vx, vy, step, calm) > ARC) {
      wx[p] = vx;
      wy[p] = vy;
      return;
    }
    let bx = vx;
    let by = vy;
    let bs = -Infinity;
    const cands: [number, number][] = [
      [vx, vy],
      ...SWERVES.map(([c, s]) => [hx[p] * c - hy[p] * s, hx[p] * s + hy[p] * c] as [number, number]),
    ];
    for (const [cx, cy] of cands) {
      const score = clearance(p, cx, cy, step, calm) * 2 + (cx * vx + cy * vy) * 3;
      if (score > bs) {
        bs = score;
        bx = cx;
        by = cy;
      }
    }
    wx[p] = bx;
    wy[p] = by;
  };

  /** Steps (board units) from a point along a direction until `until` holds or the edge is near. */
  const march = (px: number, py: number, vx: number, vy: number, until: (c: number) => boolean) => {
    for (let d = 0; d < 2 * G; d++) {
      const qx = px + vx * d;
      const qy = py + vy * d;
      if (qx < 3 || qy < 3 || qx > G - 3 || qy > G - 3) return { d, edge: true };
      if (until(cellOf(qx, qy))) return { d, edge: false };
    }
    return { d: 2 * G, edge: true };
  };

  const makePlan = (p: number): Plan | null => {
    // Behind: roam further. Far ahead: play it safer.
    let total = 0;
    let count = 0;
    for (let q = 0; q < n; q++)
      if (alive[q]) {
        total += land[q];
        count++;
      }
    const avg = total / Math.max(1, count);
    const g = greed[p] * (land[p] < avg * 0.7 ? 1.3 : land[p] > avg * 1.6 ? 0.85 : 1);
    const maxD = G * 0.17 * g;
    const maxW = G * 0.2 * g;
    let best: Plan | null = null;
    let bestScore = -Infinity;
    for (const [ux, uy] of COMPASS) {
      const exit = march(x[p], y[p], ux, uy, (c) => owner[c] !== p);
      if (exit.edge) continue;
      const ex = x[p] + ux * exit.d;
      const ey = y[p] + uy * exit.d;
      const free = march(ex, ey, ux, uy, () => false).d;
      if (free < 14) continue;
      const room = (vx: number, vy: number) => march(ex, ey, vx, vy, () => false).d;
      let [sx, sy] = room(-uy, ux) > room(uy, -ux) ? [-uy, ux] : [uy, -ux];
      if (rng.next() < 0.3) [sx, sy] = [-sx, -sy];
      if (room(sx, sy) < 14) [sx, sy] = [-sx, -sy];
      const side = room(sx, sy);
      if (side < 14) continue;
      const D = Math.min(free - 6, 8 + rng.next() * maxD);
      const W = Math.min(side - 6, 8 + rng.next() * maxW);
      const score = rng.next() * 1.2 - exit.d * 0.02 + Math.min(free, 48) * 0.01;
      if (score > bestScore) {
        bestScore = score;
        const keep = (v: number) => Math.min(G - 16, Math.max(16, v));
        const p1: [number, number] = [keep(ex + ux * D), keep(ey + uy * D)];
        best = { wps: [p1, [keep(p1[0] + sx * W), keep(p1[1] + sy * W)]], idx: 0 };
      }
    }
    return best;
  };

  /** The closest point of a rival's trail p can reach before that rival gets home, or null. */
  const attackTarget = (p: number, progress: number): [number, number] | null => {
    if (trails[p].length > 60) return null;
    // Early on everyone builds; the hunting starts as the clock runs down.
    if (progress < CALM) return null;
    const R = 6 + 26 * aggro[p] * progress * progress;
    let best: [number, number] | null = null;
    let bestD = Infinity;
    for (let q = 0; q < n; q++) {
      if (q === p || !alive[q] || !trailPts[q].length) continue;
      for (const pt of trailPts[q]) {
        const m = Math.hypot(pt[0] - x[p], pt[1] - y[p]);
        if (m <= R && m < homeDist[q] && m < bestD) {
          bestD = m;
          best = pt;
        }
      }
    }
    return best;
  };

  const decide = (p: number, step: number, progress: number) => {
    const out = owner[cellOf(x[p], y[p])] !== p;
    const calm = progress < CALM;
    const toward = (tx: number, ty: number) => {
      const dx = tx - x[p];
      const dy = ty - y[p];
      const l = Math.hypot(dx, dy) || 1;
      steerSafe(p, dx / l, dy / l, step, calm);
    };
    const goHome = () => {
      const h = homeward(p);
      toward(h.tx, h.ty);
    };
    if (out && trailPts[p].length) {
      let threat = Infinity;
      for (let q = 0; q < n; q++) {
        if (q === p || !alive[q]) continue;
        for (const pt of trailPts[p]) threat = Math.min(threat, Math.hypot(pt[0] - x[q], pt[1] - y[q]));
      }
      const maxTrail = G * (1.5 + greed[p]);
      if (threat <= homeDist[p] + caution[p] || trails[p].length > maxTrail) {
        plan[p] = null;
        return goHome();
      }
    }
    const target = attackTarget(p, progress);
    if (target) {
      plan[p] = null;
      return toward(target[0], target[1]);
    }
    if (!plan[p]) {
      if (out) return goHome();
      plan[p] = makePlan(p);
      if (!plan[p]) return steerSafe(p, hx[p], hy[p], step, calm);
    }
    const pl = plan[p]!;
    while (pl.idx < pl.wps.length && Math.hypot(pl.wps[pl.idx][0] - x[p], pl.wps[pl.idx][1] - y[p]) < 4)
      pl.idx++;
    if (pl.idx >= pl.wps.length) {
      if (!out) plan[p] = null;
      return goHome();
    }
    toward(pl.wps[pl.idx][0], pl.wps[pl.idx][1]);
  };

  const events: PaperEvent[] = [];
  let cuts = 0;

  const clearTrail = (p: number) => {
    for (const c of trails[p]) if (trail[c] === p) trail[c] = -1;
    trails[p] = [];
    trailPts[p] = [];
    ctrail[p].fill(0);
  };

  const kill = (p: number, cause: PaperCause, by: number, t: number) => {
    alive[p] = 0;
    clearTrail(p);
    for (let c = 0; c < N; c++) if (owner[c] === p) setOwner(c, -1);
    land[p] = 0;
    plan[p] = null;
    if (by >= 0) cuts++;
    events.push({ t, type: 'cut', i: p, by, cause, x: x[p], y: y[p] });
  };

  /** p is home: its trail and everything it encloses becomes p's land. */
  const claim = (p: number, t: number) => {
    seen.fill(0);
    let qh = 0;
    let qt = 0;
    const wall = (c: number) => owner[c] === p || trail[c] === p;
    const visit = (c: number) => {
      if (seen[c] || wall(c)) return;
      seen[c] = 1;
      queue[qt++] = c;
    };
    for (let k = 0; k < G; k++) {
      visit(k);
      visit((G - 1) * G + k);
      visit(k * G);
      visit(k * G + G - 1);
    }
    while (qh < qt) {
      const c = queue[qh++];
      const cx = c % G;
      if (cx > 0) visit(c - 1);
      if (cx < G - 1) visit(c + 1);
      if (c >= G) visit(c - G);
      if (c < N - G) visit(c + G);
    }
    let gained = 0;
    let stolen = 0;
    let sx = 0;
    let sy = 0;
    for (let c = 0; c < N; c++) {
      if (seen[c] || owner[c] === p) continue;
      if (owner[c] >= 0) {
        land[owner[c]]--;
        stolen++;
      }
      setOwner(c, p);
      land[p]++;
      gained++;
      sx += (c % G) + 0.5;
      sy += ((c / G) | 0) + 0.5;
    }
    clearTrail(p);
    plan[p] = null;
    if (gained)
      events.push({ t, type: 'claim', i: p, cells: gained, stolen, x: sx / gained, y: sy / gained });
    // Anyone left without land is out.
    for (let q = 0; q < n; q++) if (q !== p && alive[q] && land[q] <= 0) kill(q, 'land', p, t);
  };

  /** Lays p's trail around its position (only off its own land). */
  const layTrail = (p: number, step: number) => {
    const c0x = Math.floor(x[p]);
    const c0y = Math.floor(y[p]);
    for (let cy = c0y - 2; cy <= c0y + 2; cy++)
      for (let cx = c0x - 2; cx <= c0x + 2; cx++) {
        if (!inBoard(cx, cy)) continue;
        if ((cx + 0.5 - x[p]) ** 2 + (cy + 0.5 - y[p]) ** 2 > TRAIL_R * TRAIL_R) continue;
        const c = cy * G + cx;
        if (owner[c] === p || trail[c] >= 0) continue;
        trail[c] = p;
        stamp[c] = step;
        trails[p].push(c);
        ctrail[p][Math.floor(cy / K) * CG + Math.floor(cx / K)] = 1;
      }
    const pts = trailPts[p];
    const last = pts[pts.length - 1];
    if (!last || Math.hypot(last[0] - x[p], last[1] - y[p]) > 2.5) pts.push([x[p], y[p]]);
  };

  // ------------------------------------------------------------------ recording

  const limitSteps = Math.max(1, Math.round(config.limit / STEP));
  const recEvery = Math.round(1 / STEP / REC_HZ);
  const maxFrames = Math.floor(limitSteps / recEvery) + 2;
  const pos = opts.record ? new Float32Array(maxFrames * n * 2) : null;
  const dirs = opts.record ? new Float32Array(maxFrames * n * 2) : null;
  const state = opts.record ? new Uint8Array(maxFrames * n) : null;
  let frames = 0;
  const snap = () => {
    if (!pos || !dirs || !state) return;
    for (let p = 0; p < n; p++) {
      const o = (frames * n + p) * 2;
      pos[o] = x[p];
      pos[o + 1] = y[p];
      dirs[o] = hx[p];
      dirs[o + 1] = hy[p];
      state[frames * n + p] = !alive[p] ? 0 : owner[cellOf(x[p], y[p])] === p ? 1 : 2;
    }
    frames++;
  };
  snap();

  // ------------------------------------------------------------------ play

  let leader = -1;
  let leadChanges = 0;
  let step = 0;
  let winnerIndex = -1;
  let lastStanding = false;
  let landBefore: number[] = Array.from(land);
  while (winnerIndex < 0) {
    step++;
    const t = step * STEP;
    const progress = step / limitSteps;
    if (step % DECIDE_EVERY === 1) {
      for (let p = 0; p < n; p++) if (alive[p] && trails[p].length) bfs(p);
      for (let p = 0; p < n; p++) if (alive[p]) decide(p, step, progress);
    }
    landBefore = Array.from(land);

    // Turn toward the wanted heading (at most TURN per second), then move.
    for (let p = 0; p < n; p++) {
      if (!alive[p]) continue;
      const cross = hx[p] * wy[p] - hy[p] * wx[p];
      const dot = hx[p] * wx[p] + hy[p] * wy[p];
      if (dot >= STEP_C) {
        hx[p] = wx[p];
        hy[p] = wy[p];
      } else {
        const s = cross >= 0 ? STEP_S : -STEP_S;
        const nx = hx[p] * STEP_C - hy[p] * s;
        const ny = hx[p] * s + hy[p] * STEP_C;
        const l = Math.sqrt(nx * nx + ny * ny);
        hx[p] = nx / l;
        hy[p] = ny / l;
      }
      x[p] += hx[p] * SPEED * STEP;
      y[p] += hy[p] * SPEED * STEP;
    }

    // Knock-outs: off the board, your own trail, a rival's trail, or a head-on meeting.
    const victims = new Map<number, { cause: PaperCause; by: number }>();
    for (let p = 0; p < n; p++) {
      if (!alive[p]) continue;
      if (x[p] < 0.5 || y[p] < 0.5 || x[p] > G - 0.5 || y[p] > G - 0.5) {
        x[p] = Math.min(G - 0.5, Math.max(0.5, x[p]));
        y[p] = Math.min(G - 0.5, Math.max(0.5, y[p]));
        victims.set(p, { cause: 'wall', by: -1 });
        continue;
      }
      const c = cellOf(x[p], y[p]);
      const tr = trail[c];
      if (tr === p) {
        if (stamp[c] < step - RECENT && !victims.has(p)) victims.set(p, { cause: 'self', by: -1 });
      } else if (tr >= 0 && alive[tr] && !victims.has(tr)) victims.set(tr, { cause: 'trail', by: p });
      for (let q = p + 1; q < n; q++) {
        if (!alive[q] || Math.hypot(x[q] - x[p], y[q] - y[p]) > 1.6) continue;
        const pHome = owner[c] === p;
        const qHome = owner[cellOf(x[q], y[q])] === q;
        if (pHome && qHome) continue;
        const loser = pHome
          ? [q]
          : qHome
            ? [p]
            : trails[p].length === trails[q].length
              ? [p, q]
              : trails[p].length > trails[q].length
                ? [p]
                : [q];
        for (const v of loser) if (!victims.has(v)) victims.set(v, { cause: 'head', by: v === p ? q : p });
      }
    }
    for (const [v, k] of victims) if (alive[v]) kill(v, k.cause, k.by, t);

    // Home closes a loop; outside grows the trail. A different flag goes first each step.
    for (let k = 0; k < n; k++) {
      const p = (step + k) % n;
      if (!alive[p]) continue;
      if (owner[cellOf(x[p], y[p])] === p) {
        if (trails[p].length) claim(p, t);
      } else layTrail(p, step);
    }
    if (chCells.length > committed) {
      chT.push(t);
      chStart.push(committed);
      committed = chCells.length;
    }

    // Who leads (with a margin), and is the game over?
    let big = -1;
    let left = 0;
    for (let p = 0; p < n; p++) {
      if (!alive[p]) continue;
      left++;
      if (big < 0 || land[p] > land[big]) big = p;
    }
    if (big >= 0) {
      if (leader < 0) leader = big;
      else if (big !== leader && (!alive[leader] || land[big] > land[leader] * LEAD_MARGIN)) {
        leadChanges++;
        leader = big;
      }
    }
    if (left <= 1 || step >= limitSteps) {
      lastStanding = left <= 1 && step < limitSteps;
      if (big >= 0) winnerIndex = big;
      else {
        // Everyone went out on the same step: the most land a moment before wins.
        winnerIndex = 0;
        for (let p = 1; p < n; p++) if (landBefore[p] > landBefore[winnerIndex]) winnerIndex = p;
      }
    }
    if (step % recEvery === 0 || winnerIndex >= 0) snap();
  }

  const winnerT = step * STEP;
  let rec: PaperTrack | null = null;
  if (pos && dirs && state) {
    chStart.push(chCells.length);
    rec = {
      hz: REC_HZ,
      frames,
      n,
      size: G,
      pos: pos.slice(0, frames * n * 2),
      dir: dirs.slice(0, frames * n * 2),
      state: state.slice(0, frames * n),
      changeT: Float32Array.from(chT),
      changeStart: Int32Array.from(chStart),
      cells: Int32Array.from(chCells),
      owners: Uint8Array.from(chOwners),
    };
  }
  const final = Array.from(land);
  if (!alive[winnerIndex]) final[winnerIndex] = landBefore[winnerIndex];
  return {
    events,
    winnerIndex,
    winnerT,
    endT: winnerT + opts.holdSec,
    land: final,
    lastStanding,
    leadChanges,
    cuts,
    rec,
  };
}
