/**
 * Everything the Growing Ball renderer needs, derived once from a recorded show: the video
 * timeline over all rounds, wall hits, lead changes and the "almost full" moment per round, and
 * helpers to read each ball's position and size at any moment.
 */
import { ARENA, END_FILL } from '../../engine/grow/sim';
import type { GrowShowResult } from '../../engine/grow/show';
import type { GrowResult } from '../../engine/grow/types';
import { Timeline } from '../../engine/timeline';
import type { Look } from '../../engine/types';
import type { ImageSource } from '../canvas';
import type { SceneFighter } from '../scene';
import { roundIndexAt } from '../show';

export type Hit = { t: number; i: number; x: number; y: number };

export type GrowScene = {
  result: GrowShowResult;
  timeline: Timeline;
  look: Look;
  fighters: SceneFighter[];
  winnerImage: ImageSource | null;
  seed: number;
  /** Growing wall bounces per round, in time order. */
  walls: Hit[][];
  /** When a different ball became clearly the biggest, per round. */
  leads: { t: number; i: number }[][];
  /** When each round's arena got almost full (null if it never showed). */
  almostT: (number | null)[];
};

/** "Almost full" shows at this share of the finishing fill. */
const ALMOST = 0.85;

export function buildGrowScene(args: {
  result: GrowShowResult;
  look: Look;
  fighters: SceneFighter[];
  winnerImage?: ImageSource | null;
}): GrowScene {
  const { result } = args;
  const walls = result.rounds.map((r) =>
    r.events.flatMap((e) => (e.type === 'wall' ? [{ t: e.t, i: e.i, x: e.x, y: e.y }] : [])),
  );
  const leads = result.rounds.map((round) => {
    const { data, frames, n, hz } = round.rec!;
    const out: { t: number; i: number }[] = [];
    const rad = (f: number, i: number) => data[(f * n + i) * 3 + 2];
    let cur = -1;
    for (let f = 0; f < frames && f / hz < round.winnerT; f++) {
      let big = 0;
      for (let i = 1; i < n; i++) if (rad(f, i) > rad(f, big)) big = i;
      let second = -1;
      for (let i = 0; i < n; i++) if (i !== big && (second < 0 || rad(f, i) > rad(f, second))) second = i;
      // A ball takes the lead once it is clearly (3%) bigger than the one it passes.
      const rival = cur < 0 ? second : cur;
      if (big !== cur && (rival < 0 || rad(f, big) > rad(f, rival) * 1.03)) {
        cur = big;
        out.push({ t: f / hz, i: big });
      }
    }
    return out;
  });
  const almostT = result.rounds.map((round) => {
    const r = round.config.ids.map(() => round.config.r0);
    for (const e of round.events) {
      if (e.type !== 'wall' || e.t > round.winnerT) continue;
      r[e.i] = e.r;
      if (r.reduce((s, x) => s + x * x, 0) / (ARENA * ARENA) >= END_FILL * ALMOST) return e.t;
    }
    return null;
  });
  return {
    result,
    look: args.look,
    fighters: args.fighters,
    winnerImage: args.winnerImage ?? null,
    seed: result.show.rounds[0].seed,
    timeline: new Timeline(result, { intro: args.look.intro, outro: args.look.outro }),
    walls,
    leads,
    almostT,
  };
}

export function roundOf(scene: GrowScene, t: number): { k: number; local: number; round: GrowResult } {
  const { k, local } = roundIndexAt(scene.result.offsets, t);
  return { k, local, round: scene.result.rounds[k] };
}

/** Interpolated x, y and radius of ball i of a round at its local time. */
export function ballAt(round: GrowResult, i: number, local: number): [number, number, number] {
  const { data, frames, n, hz } = round.rec!;
  const f = Math.max(0, Math.min(frames - 1, local * hz));
  const f0 = Math.floor(f);
  const f1 = Math.min(frames - 1, f0 + 1);
  const a = f - f0;
  const o0 = (f0 * n + i) * 3;
  const o1 = (f1 * n + i) * 3;
  return [
    data[o0] + (data[o1] - data[o0]) * a,
    data[o0 + 1] + (data[o1 + 1] - data[o0 + 1]) * a,
    data[o0 + 2] + (data[o1 + 2] - data[o0 + 2]) * a,
  ];
}

/** Share of the arena each ball of a round fills at its local time. */
export function sharesAt(round: GrowResult, local: number): number[] {
  return round.config.ids.map((_, i) => {
    const r = ballAt(round, i, local)[2];
    return (r * r) / (ARENA * ARENA);
  });
}

/** The ball clearly in the lead at a round's local time, or -1 before anyone pulls ahead. */
export function leaderAt(scene: GrowScene, k: number, local: number): number {
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
