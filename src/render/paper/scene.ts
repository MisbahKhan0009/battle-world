/**
 * Everything the Paper Land renderer needs, derived once from a recorded show: the video timeline
 * over all rounds, one distinct color per country, land counts after every change, lead changes,
 * cuts and the "10 seconds left" moment per round, and helpers to read flag positions, headings
 * and trails at any moment.
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
  /** One solid color per fighter, distinct from everyone it plays against. */
  colors: string[];
  /** Land (cells) of every flag after each change group, per round: [group][flag]. */
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

/** Bright, well-separated colors for countries whose own colors are taken. */
const SPARE = [
  '#FF4D5E',
  '#3D8BFF',
  '#FFC531',
  '#2ED47A',
  '#A86BFF',
  '#FF8A3D',
  '#22C7E0',
  '#FF5CC8',
  '#7BD13F',
  '#5B6CFF',
  '#1FB59A',
  '#E05A2B',
];

function rgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return null;
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** Rough perceptual distance between two colors (weighted RGB). */
function colorDist(a: [number, number, number], b: [number, number, number]): number {
  const rm = (a[0] + b[0]) / 2;
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
}

/** A flag color that works as land on a pale board: not white, not gray. */
function usable(c: [number, number, number]): boolean {
  const max = Math.max(...c);
  const min = Math.min(...c);
  const light = (max + min) / 510;
  const sat = max === min ? 0 : (max - min) / (255 - Math.abs(max + min - 255));
  return light < 0.86 && (sat > 0.3 || light < 0.2);
}

/**
 * Gives every fighter one color from its own flag, as far as possible from the colors of everyone
 * it shares a round with; a spare color when its flag's colors are all taken.
 */
export function assignColors(fighters: SceneFighter[], entrants: number[][]): string[] {
  const out: string[] = [];
  const rivals = fighters.map((_, i) => new Set(entrants.filter((e) => e.includes(i)).flat()));
  fighters.forEach((f, i) => {
    const taken = out
      .map((c, j) => (rivals[i].has(j) ? rgb(c) : null))
      .filter((c): c is [number, number, number] => !!c);
    const far = (c: [number, number, number]) => Math.min(Infinity, ...taken.map((t) => colorDist(c, t)));
    const own = [f.accent, ...f.palette]
      .map((h) => ({ h, c: rgb(h) }))
      .filter((o): o is { h: string; c: [number, number, number] } => !!o.c && usable(o.c));
    let best = own[0]?.h;
    let bestD = own.length ? far(own[0].c) : -1;
    for (const o of own) {
      const d = far(o.c);
      if (d > bestD + 40) {
        best = o.h;
        bestD = d;
      }
    }
    if (!best || bestD < 150) {
      for (const h of SPARE) {
        const d = far(rgb(h)!);
        if (!best || d > bestD) {
          best = h;
          bestD = d;
        }
      }
    }
    out.push(best!);
  });
  return out;
}

export function buildPaperScene(args: {
  result: PaperShowResult;
  look: Look;
  fighters: SceneFighter[];
  winnerImage?: ImageSource | null;
}): PaperScene {
  const { result } = args;
  const counts = result.rounds.map((round) => {
    const { changeStart, cells, owners, n, size } = round.rec!;
    const grid = new Uint8Array(size * size);
    const c = new Int32Array(n);
    const out: Int32Array[] = [];
    for (let g = 0; g + 1 < changeStart.length; g++) {
      for (let k = changeStart[g]; k < changeStart[g + 1]; k++) {
        const was = grid[cells[k]];
        if (was) c[was - 1]--;
        grid[cells[k]] = owners[k];
        if (owners[k]) c[owners[k] - 1]++;
      }
      out.push(c.slice());
    }
    return out;
  });
  const leads = result.rounds.map((round, k) => {
    const out: { t: number; i: number }[] = [];
    let cur = -1;
    counts[k].forEach((c, g) => {
      const t = round.rec!.changeT[g];
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
    colors: assignColors(args.fighters, result.show.entrants),
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

/** Fractional recorded frame at a round's local time (frozen once the round is over). */
export function frameAt(round: PaperResult, local: number): number {
  const { hz, frames } = round.rec!;
  return Math.max(0, Math.min(frames - 1, local * hz));
}

/** Index of the last land change group at or before a round's local time. */
export function groupAt(round: PaperResult, local: number): number {
  const g = round.rec!.changeT;
  let lo = 0;
  let hi = g.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (g[mid] <= local) lo = mid + 1;
    else hi = mid;
  }
  return Math.max(0, lo - 1);
}

/** 0 out of the game, 1 home, 2 drawing a trail. */
export function stateAt(round: PaperResult, i: number, frame: number): number {
  const { state, n } = round.rec!;
  return state[frame * n + i];
}

export function pointAt(round: PaperResult, i: number, frame: number): [number, number] {
  const { pos, n } = round.rec!;
  return [pos[(frame * n + i) * 2], pos[(frame * n + i) * 2 + 1]];
}

/** Smooth position and heading of flag i at a fractional frame. */
export function headAt(
  round: PaperResult,
  i: number,
  ft: number,
): { x: number; y: number; dx: number; dy: number } {
  const { pos, dir, n, frames } = round.rec!;
  const f0 = Math.floor(ft);
  const f1 = Math.min(frames - 1, f0 + 1);
  const a = f1 === f0 || stateAt(round, i, f1) === 0 ? 0 : ft - f0;
  const o0 = (f0 * n + i) * 2;
  const o1 = (f1 * n + i) * 2;
  const dx = dir[o0] + (dir[o1] - dir[o0]) * a;
  const dy = dir[o0 + 1] + (dir[o1 + 1] - dir[o0 + 1]) * a;
  const l = Math.hypot(dx, dy) || 1;
  return {
    x: pos[o0] + (pos[o1] - pos[o0]) * a,
    y: pos[o0 + 1] + (pos[o1 + 1] - pos[o0 + 1]) * a,
    dx: dx / l,
    dy: dy / l,
  };
}

/** Flag i's trail at a whole frame: its path since it left its land (empty when home). */
export function trailAt(round: PaperResult, i: number, frame: number): [number, number][] {
  if (stateAt(round, i, frame) !== 2) return [];
  let j = frame;
  while (j > 0 && stateAt(round, i, j - 1) === 2) j--;
  const out: [number, number][] = [];
  for (let k = Math.max(0, j - 1); k <= frame; k++) out.push(pointAt(round, i, k));
  return out;
}

/** Share of the board each flag of a round owns at its local time. */
export function sharesAt(scene: PaperScene, k: number, local: number): number[] {
  const round = scene.result.rounds[k];
  const { size } = round.rec!;
  const c = scene.counts[k][groupAt(round, local)];
  return Array.from(c, (v) => v / (size * size));
}

/** The flag clearly in the lead at a round's local time, or -1 before the first change. */
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
