/**
 * Everything the Paper Land renderer needs, derived once from a recorded show: the video timeline
 * over all rounds, land counts per stored board, lead changes, cuts and the "10 seconds left"
 * moment per round, and helpers to read flag positions, trails and land at any moment.
 */
import type { PaperShowResult } from '../../engine/paper/show';
import type { PaperResult } from '../../engine/paper/types';
import { Timeline } from '../../engine/timeline';
import type { Look } from '../../engine/types';
import type { ImageSource } from '../canvas';
import type { SceneFighter } from '../scene';
import { roundIndexAt } from '../show';

export type Cut = { t: number; i: number; by: number; cause: string; x: number; y: number };

export type PaperScene = {
  result: PaperShowResult;
  timeline: Timeline;
  look: Look;
  fighters: SceneFighter[];
  winnerImage: ImageSource | null;
  seed: number;
  /** Land (cells) of every flag on each stored board, per round: [board][flag]. */
  counts: Int32Array[][];
  /** When a different flag clearly took the most land, per round. */
  leads: { t: number; i: number }[][];
  /** Knock-outs per round, in time order. */
  cuts: Cut[][];
  /** "10 seconds left" per round (null when the round is too short or ends before it). */
  tenT: (number | null)[];
};

/** A flag takes the lead once it has this much more land than the leader. */
const LEAD_MARGIN = 1.05;

export function buildPaperScene(args: {
  result: PaperShowResult;
  look: Look;
  fighters: SceneFighter[];
  winnerImage?: ImageSource | null;
}): PaperScene {
  const { result } = args;
  const counts = result.rounds.map((round) => {
    const { grids, gridTicks, n, size } = round.rec!;
    const N = size * size;
    return Array.from(gridTicks, (_, s) => {
      const c = new Int32Array(n);
      for (let k = s * N; k < (s + 1) * N; k++) if (grids[k]) c[grids[k] - 1]++;
      return c;
    });
  });
  const leads = result.rounds.map((round, k) => {
    const { gridTicks, hz } = round.rec!;
    const out: { t: number; i: number }[] = [];
    let cur = -1;
    counts[k].forEach((c, s) => {
      const t = gridTicks[s] / hz;
      if (t > round.winnerT) return;
      let big = 0;
      for (let i = 1; i < c.length; i++) if (c[i] > c[big]) big = i;
      if (big !== cur && (cur < 0 || c[cur] === 0 || c[big] > c[cur] * LEAD_MARGIN)) {
        cur = big;
        out.push({ t, i: big });
      }
    });
    return out;
  });
  const cuts = result.rounds.map((r) =>
    r.events.flatMap((e) =>
      e.type === 'cut' ? [{ t: e.t, i: e.i, by: e.by, cause: e.cause, x: e.x, y: e.y }] : [],
    ),
  );
  const tenT = result.rounds.map((r) => {
    const at = r.config.limit - 10;
    return r.config.limit >= 20 && r.winnerT > at + 0.05 ? at : null;
  });
  return {
    result,
    look: args.look,
    fighters: args.fighters,
    winnerImage: args.winnerImage ?? null,
    seed: result.show.rounds[0].seed,
    timeline: new Timeline(result, { intro: args.look.intro, outro: args.look.outro }),
    counts,
    leads,
    cuts,
    tenT,
  };
}

export function roundOf(scene: PaperScene, t: number): { k: number; local: number; round: PaperResult } {
  const { k, local } = roundIndexAt(scene.result.offsets, t);
  return { k, local, round: scene.result.rounds[k] };
}

/** Fractional move tick at a round's local time (frozen once the round is over). */
export function tickAt(round: PaperResult, local: number): number {
  const { hz, ticks } = round.rec!;
  return Math.max(0, Math.min(ticks - 1, local * hz));
}

/** Index of the stored board in effect at a (whole) tick. */
export function boardAt(round: PaperResult, tick: number): number {
  const g = round.rec!.gridTicks;
  let lo = 0;
  let hi = g.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (g[mid] <= tick) lo = mid + 1;
    else hi = mid;
  }
  return Math.max(0, lo - 1);
}

/** 0 out of the game, 1 home, 2 drawing a trail. */
export function stateAt(round: PaperResult, i: number, tick: number): number {
  const { state, n } = round.rec!;
  return state[tick * n + i];
}

export function cellAt(round: PaperResult, i: number, tick: number): [number, number] {
  const { pos, n } = round.rec!;
  return [pos[(tick * n + i) * 2], pos[(tick * n + i) * 2 + 1]];
}

/** Smooth head position (cells) of flag i at a fractional tick. */
export function headAt(round: PaperResult, i: number, ft: number): [number, number] {
  const f0 = Math.floor(ft);
  const f1 = Math.min(round.rec!.ticks - 1, f0 + 1);
  const a = ft - f0;
  const [x0, y0] = cellAt(round, i, f0);
  if (f1 === f0 || stateAt(round, i, f1) === 0) return [x0, y0];
  const [x1, y1] = cellAt(round, i, f1);
  return [x0 + (x1 - x0) * a, y0 + (y1 - y0) * a];
}

/** Cells of flag i's trail at a whole tick, starting from the land cell it left (empty when home). */
export function trailAt(round: PaperResult, i: number, tick: number): [number, number][] {
  if (stateAt(round, i, tick) !== 2) return [];
  let j = tick;
  while (j > 0 && stateAt(round, i, j - 1) === 2) j--;
  const out: [number, number][] = [];
  for (let k = Math.max(0, j - 1); k <= tick; k++) out.push(cellAt(round, i, k));
  return out;
}

/** Share of the board each flag of a round owns at its local time. */
export function sharesAt(scene: PaperScene, k: number, local: number): number[] {
  const round = scene.result.rounds[k];
  const { size } = round.rec!;
  const c = scene.counts[k][boardAt(round, Math.floor(tickAt(round, local)))];
  return Array.from(c, (v) => v / (size * size));
}

/** The flag clearly in the lead at a round's local time, or -1 before the first board. */
export function leaderAt(scene: PaperScene, k: number, local: number): number {
  const list = scene.leads[k];
  const q = lastBefore(list, local);
  return q >= 0 ? list[q].i : -1;
}

/** Latest entry of a time-ordered list at or before t (binary search), or -1. */
export function lastBefore(list: { t: number }[], t: number): number {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].t <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}
