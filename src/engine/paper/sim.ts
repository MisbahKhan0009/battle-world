/**
 * Paper Land rules and steering, like Paper.io. Every flag starts on a small square of land on a
 * grid board and moves one cell per tick. Outside its land it leaves a trail; coming home closes
 * the loop and everything the trail encloses becomes its land (taken from whoever owned it).
 * Running into a rival's trail knocks that rival out (its land is wiped); running into your own
 * trail or off the board knocks you out. When the clock runs out the most land wins, or the last
 * flag left wins early.
 *
 * Integer grid logic and a seeded RNG keep it deterministic: the same config is the same game.
 */
import { hash32, Rng } from '../rng';
import type { PaperCause, PaperConfig, PaperEvent, PaperTrack } from './types';

/** Cells moved per second. */
export const MOVE_HZ = 10;
/** Starting land is a square of (2 * START_R + 1) cells a side. */
export const START_R = 2;
/** A flag counts as the new leader once it has this much more land (no flicker on near-ties). */
const LEAD_MARGIN = 1.05;
const INF = 0x3fffffff;

/** Directions: right, down, left, up. */
const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];
const back = (d: number) => (d + 2) & 3;

/** Board side for n flags: a few hundred cells of room each. */
export function boardSize(n: number): number {
  return Math.max(30, Math.min(64, Math.round(Math.sqrt(n * 400))));
}

/** One excursion: out along d0 for D cells past the land, across W cells, then back home. */
type Plan = { d0: number; side: number; D: number; W: number; phase: 0 | 1 | 2 | 3; cnt: number };

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
  const { size } = config;
  const n = config.ids.length;
  const N = size * size;
  const owner = new Int8Array(N).fill(-1);
  const trail = new Int8Array(N).fill(-1);
  const trails: number[][] = config.ids.map(() => []);
  const land = new Int32Array(n);
  const hx = new Int32Array(n);
  const hy = new Int32Array(n);
  const dir = new Int32Array(n);
  const alive = new Uint8Array(n).fill(1);
  const plan: (Plan | null)[] = config.ids.map(() => null);
  const dist = config.ids.map(() => new Int32Array(N));
  const homeDist = new Int32Array(n);
  const queue = new Int32Array(N);
  const seen = new Uint8Array(N);
  const rng = new Rng(hash32(config.seed, 0x9a9e));

  // Each flag gets its own temperament (how far it roams, how early it turns back, how keen it is
  // to cut). Winners are relabelled after the game, so this only adds variety.
  const greed = config.ids.map(() => 0.75 + 0.5 * rng.next());
  const caution = config.ids.map(() => 2 + rng.int(3));
  const aggro = config.ids.map(() => 0.3 + 0.7 * rng.next());

  // Spawns: the best spread of a few random spots, away from the edges.
  const lo = START_R + 3;
  const hi = size - START_R - 4;
  for (let p = 0; p < n; p++) {
    let bx = lo;
    let by = lo;
    let best = -1;
    for (let k = 0; k < 40; k++) {
      const x = lo + rng.int(hi - lo + 1);
      const y = lo + rng.int(hi - lo + 1);
      let m = INF;
      for (let q = 0; q < p; q++) m = Math.min(m, Math.abs(x - hx[q]) + Math.abs(y - hy[q]));
      if (m > best) {
        best = m;
        bx = x;
        by = y;
      }
    }
    hx[p] = bx;
    hy[p] = by;
    dir[p] = rng.int(4);
    for (let y = by - START_R; y <= by + START_R; y++)
      for (let x = bx - START_R; x <= bx + START_R; x++) {
        const c = y * size + x;
        if (owner[c] >= 0) land[owner[c]]--;
        owner[c] = p;
        land[p]++;
      }
  }

  const inBoard = (x: number, y: number) => x >= 0 && y >= 0 && x < size && y < size;

  /** Distance from every cell to p's land without crossing p's own trail. */
  const bfs = (p: number) => {
    const D = dist[p];
    D.fill(INF);
    let qh = 0;
    let qt = 0;
    for (let c = 0; c < N; c++)
      if (owner[c] === p) {
        D[c] = 0;
        queue[qt++] = c;
      }
    while (qh < qt) {
      const c = queue[qh++];
      const x = c % size;
      const y = (c / size) | 0;
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d];
        const ny = y + DY[d];
        if (!inBoard(nx, ny)) continue;
        const nc = ny * size + nx;
        if (D[nc] !== INF || trail[nc] === p) continue;
        D[nc] = D[c] + 1;
        queue[qt++] = nc;
      }
    }
    let best = INF;
    for (let d = 0; d < 4; d++) {
      const nx = hx[p] + DX[d];
      const ny = hy[p] + DY[d];
      if (inBoard(nx, ny)) best = Math.min(best, dist[p][ny * size + nx] + 1);
    }
    homeDist[p] = best;
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
    const maxD = Math.max(3, Math.round(size * 0.17 * g));
    const maxW = Math.max(3, Math.round(size * 0.2 * g));
    let best: Plan | null = null;
    let bestScore = -Infinity;
    for (let d0 = 0; d0 < 4; d0++) {
      if (d0 === back(dir[p])) continue;
      let x = hx[p];
      let y = hy[p];
      let s = 0;
      while (inBoard(x, y) && owner[y * size + x] === p) {
        x += DX[d0];
        y += DY[d0];
        s++;
      }
      if (!inBoard(x, y)) continue;
      const free = d0 === 0 ? size - 1 - x : d0 === 1 ? size - 1 - y : d0 === 2 ? x : y;
      if (free < 3) continue;
      const room = (d: number) => (d === 0 ? size - 1 - x : d === 1 ? size - 1 - y : d === 2 ? x : y);
      const l = (d0 + 3) & 3;
      const r = (d0 + 1) & 3;
      let side = room(l) > room(r) ? l : r;
      if (rng.next() < 0.3) side = side === l ? r : l;
      if (room(side) < 3) side = side === l ? r : l;
      if (room(side) < 3) continue;
      const D = Math.min(free - 1, 2 + rng.int(maxD - 1));
      const W = Math.min(room(side) - 1, 2 + rng.int(maxW - 1));
      const score = rng.next() * 1.2 - s * 0.08 + Math.min(free, 12) * 0.04;
      if (score > bestScore) {
        bestScore = score;
        best = { d0, side, D, W, phase: 0, cnt: 0 };
      }
    }
    return best;
  };

  /** The closest cell of a rival's trail p can reach before that rival gets home, or -1. */
  const attackTarget = (p: number, progress: number): number => {
    if (trails[p].length > 6) return -1;
    // Early on everyone builds; the hunting starts as the clock runs down.
    const R = Math.round(1 + 5 * aggro[p] * progress * progress);
    let best = -1;
    let bestD = INF;
    for (let q = 0; q < n; q++) {
      if (q === p || !alive[q] || !trails[q].length) continue;
      for (const c of trails[q]) {
        const m = Math.abs((c % size) - hx[p]) + Math.abs(((c / size) | 0) - hy[p]);
        if (m <= R && m < homeDist[q] && m < bestD) {
          bestD = m;
          best = c;
        }
      }
    }
    return best;
  };

  const decide = (p: number, progress: number): number => {
    const d = dir[p];
    const x = hx[p];
    const y = hy[p];
    const next = (nd: number) => (y + DY[nd]) * size + x + DX[nd];
    const ok: number[] = [];
    for (const nd of [d, (d + 3) & 3, (d + 1) & 3]) {
      if (inBoard(x + DX[nd], y + DY[nd]) && trail[next(nd)] !== p) ok.push(nd);
    }
    if (!ok.length) return d;
    const out = trails[p].length > 0;
    const D = dist[p];
    let pool = out ? ok.filter((nd) => D[next(nd)] < INF) : ok;
    if (!pool.length) pool = ok;
    // Early on, flags build rather than fight: they steer clear of rival trails and heads.
    if (progress < 0.35) {
      const calm = pool.filter((nd) => {
        const c = next(nd);
        if (trail[c] >= 0) return false;
        for (let q = 0; q < n; q++)
          if (q !== p && alive[q] && Math.abs(hx[q] - x - DX[nd]) + Math.abs(hy[q] - y - DY[nd]) <= 1)
            return false;
        return true;
      });
      if (calm.length) pool = calm;
    }
    const homeward = () => {
      let b = pool[0];
      for (const nd of pool) if (D[next(nd)] < D[next(b)]) b = nd;
      return b;
    };
    if (out) {
      let threat = INF;
      for (let q = 0; q < n; q++) {
        if (q === p || !alive[q]) continue;
        for (const c of trails[p])
          threat = Math.min(threat, Math.abs((c % size) - hx[q]) + Math.abs(((c / size) | 0) - hy[q]));
      }
      const maxTrail = Math.round(size * (0.6 + 0.5 * greed[p]));
      if (threat <= homeDist[p] + caution[p] || trails[p].length > maxTrail || plan[p]?.phase === 3) {
        if (plan[p]) plan[p]!.phase = 3;
        return homeward();
      }
    }
    const target = attackTarget(p, progress);
    if (target >= 0) {
      plan[p] = null;
      const tx = target % size;
      const ty = (target / size) | 0;
      let b = pool[0];
      let bd = INF;
      for (const nd of pool) {
        const m = Math.abs(x + DX[nd] - tx) + Math.abs(y + DY[nd] - ty);
        if (m < bd) {
          bd = m;
          b = nd;
        }
      }
      return b;
    }
    if (!plan[p]) {
      if (out) return homeward();
      plan[p] = makePlan(p);
      if (!plan[p]) return pool[rng.int(pool.length)];
    }
    const pl = plan[p]!;
    const want = pl.phase === 0 ? pl.d0 : pl.phase === 1 ? pl.side : back(pl.d0);
    if (pool.includes(want)) return want;
    if (out) {
      pl.phase = 3;
      return homeward();
    }
    plan[p] = null;
    return pool[0];
  };

  const events: PaperEvent[] = [];
  let gridChanged = true;
  let cuts = 0;

  const kill = (p: number, cause: PaperCause, by: number, t: number) => {
    alive[p] = 0;
    for (const c of trails[p]) if (trail[c] === p) trail[c] = -1;
    trails[p] = [];
    for (let c = 0; c < N; c++) if (owner[c] === p) owner[c] = -1;
    land[p] = 0;
    plan[p] = null;
    gridChanged = true;
    if (by >= 0) cuts++;
    events.push({ t, type: 'cut', i: p, by, cause, x: hx[p], y: hy[p] });
  };

  /** p is home: its trail and everything it encloses becomes p's land. */
  const claim = (p: number, t: number) => {
    seen.fill(0);
    let qh = 0;
    let qt = 0;
    const wall = (c: number) => owner[c] === p || trail[c] === p;
    for (let k = 0; k < size; k++) {
      for (const c of [k, (size - 1) * size + k, k * size, k * size + size - 1]) {
        if (seen[c] || wall(c)) continue;
        seen[c] = 1;
        queue[qt++] = c;
      }
    }
    while (qh < qt) {
      const c = queue[qh++];
      const x = c % size;
      const y = (c / size) | 0;
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d];
        const ny = y + DY[d];
        if (!inBoard(nx, ny)) continue;
        const nc = ny * size + nx;
        if (seen[nc] || wall(nc)) continue;
        seen[nc] = 1;
        queue[qt++] = nc;
      }
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
      owner[c] = p;
      land[p]++;
      gained++;
      sx += c % size;
      sy += (c / size) | 0;
    }
    for (const c of trails[p]) if (trail[c] === p) trail[c] = -1;
    trails[p] = [];
    plan[p] = null;
    gridChanged = true;
    events.push({ t, type: 'claim', i: p, cells: gained, stolen, x: sx / gained, y: sy / gained });
    // Anyone left without land is out.
    for (let q = 0; q < n; q++) if (q !== p && alive[q] && land[q] <= 0) kill(q, 'land', p, t);
  };

  // ------------------------------------------------------------------ recording

  const limitTicks = Math.max(1, Math.round(config.limit * MOVE_HZ));
  const pos = opts.record ? new Int16Array((limitTicks + 1) * n * 2) : null;
  const state = opts.record ? new Uint8Array((limitTicks + 1) * n) : null;
  const gridTicks: number[] = [];
  const grids: Uint8Array[] = [];
  const snap = (tick: number) => {
    if (!pos || !state) return;
    for (let p = 0; p < n; p++) {
      pos[(tick * n + p) * 2] = hx[p];
      pos[(tick * n + p) * 2 + 1] = hy[p];
      state[tick * n + p] = !alive[p] ? 0 : trails[p].length ? 2 : 1;
    }
    if (gridChanged) {
      const g = new Uint8Array(N);
      for (let c = 0; c < N; c++) g[c] = owner[c] + 1;
      gridTicks.push(tick);
      grids.push(g);
    }
    gridChanged = false;
  };
  snap(0);

  // ------------------------------------------------------------------ play

  let leader = -1;
  let leadChanges = 0;
  let tick = 0;
  let winnerIndex = -1;
  let lastStanding = false;
  let landBefore: number[] = Array.from(land);
  while (winnerIndex < 0) {
    tick++;
    const t = tick / MOVE_HZ;
    for (let p = 0; p < n; p++) if (alive[p] && trails[p].length) bfs(p);
    const nd = new Int32Array(n);
    for (let p = 0; p < n; p++) if (alive[p]) nd[p] = decide(p, tick / limitTicks);
    landBefore = Array.from(land);

    // Move; leaving the board is a knock-out.
    const moved: number[] = [];
    for (let p = 0; p < n; p++) {
      if (!alive[p]) continue;
      dir[p] = nd[p];
      const x = hx[p] + DX[nd[p]];
      const y = hy[p] + DY[nd[p]];
      if (!inBoard(x, y)) {
        kill(p, 'wall', -1, t);
        continue;
      }
      hx[p] = x;
      hy[p] = y;
      moved.push(p);
    }

    // Trails cut: your own, a rival's, or a head-on meeting outside both lands.
    const victims = new Map<number, { cause: PaperCause; by: number }>();
    for (const p of moved) {
      const c = hy[p] * size + hx[p];
      const tr = trail[c];
      if (tr === p) {
        if (!victims.has(p)) victims.set(p, { cause: 'self', by: -1 });
      } else if (tr >= 0 && alive[tr]) {
        if (!victims.has(tr)) victims.set(tr, { cause: 'trail', by: p });
      }
      for (const q of moved) {
        if (q <= p || hx[q] !== hx[p] || hy[q] !== hy[p]) continue;
        const o = owner[c];
        const loser =
          o === p
            ? [q]
            : o === q
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

    // Home closes a loop; outside grows the trail. A different flag goes first each tick.
    for (let k = 0; k < n; k++) {
      const p = (tick + k) % n;
      if (!alive[p]) continue;
      const c = hy[p] * size + hx[p];
      if (owner[c] === p) {
        if (trails[p].length) claim(p, t);
      } else {
        trail[c] = p;
        trails[p].push(c);
      }
    }
    for (let p = 0; p < n; p++) {
      const pl = plan[p];
      if (!alive[p] || !pl) continue;
      const outside = owner[hy[p] * size + hx[p]] !== p;
      if (pl.phase === 0 && outside && ++pl.cnt >= pl.D) {
        pl.phase = 1;
        pl.cnt = 0;
      } else if (pl.phase === 1 && ++pl.cnt >= pl.W) pl.phase = 2;
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
    if (left <= 1 || tick >= limitTicks) {
      lastStanding = left <= 1 && tick < limitTicks;
      if (big >= 0) winnerIndex = big;
      else {
        // Everyone went out on the same tick: the most land a moment before wins.
        winnerIndex = 0;
        for (let p = 1; p < n; p++) if (landBefore[p] > landBefore[winnerIndex]) winnerIndex = p;
      }
    }
    snap(tick);
  }

  const winnerT = tick / MOVE_HZ;
  let rec: PaperTrack | null = null;
  if (pos && state) {
    const data = new Uint8Array(grids.length * N);
    grids.forEach((g, k) => data.set(g, k * N));
    rec = {
      hz: MOVE_HZ,
      ticks: tick + 1,
      n,
      size,
      pos: pos.slice(0, (tick + 1) * n * 2),
      state: state.slice(0, (tick + 1) * n),
      gridTicks: Int32Array.from(gridTicks),
      grids: data,
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
