/**
 * Everything the Black Hole renderer needs, derived once from a recorded show: the video timeline
 * over all rounds, when each object fell and into which hole, swallows, lead changes and the
 * "10 seconds left" moment per round, and helpers to read each hole's position and size.
 */
import type { BlackShowResult } from '../../engine/black/show';
import type { BlackResult } from '../../engine/black/types';
import { Timeline } from '../../engine/timeline';
import type { Look } from '../../engine/types';
import type { ImageSource } from '../canvas';
import type { SceneFighter } from '../scene';
import { roundIndexAt } from '../show';

export type Swallow = { t: number; i: number; j: number; x: number; y: number };

export type BlackScene = {
  result: BlackShowResult;
  timeline: Timeline;
  look: Look;
  fighters: SceneFighter[];
  winnerImage: ImageSource | null;
  seed: number;
  /** Per round: when each object fell (Infinity if never) and into which hole. */
  eatT: Float64Array[];
  eatBy: Int16Array[];
  /** Per round: object indices in the order they fell (for the renderer's falling window). */
  eatOrder: Int32Array[];
  swallows: Swallow[][];
  /** When a different hole became clearly the biggest, per round. */
  leads: { t: number; i: number }[][];
  /** When each round's clock showed 10 seconds left (null if it ended sooner). */
  tenT: (number | null)[];
};

export function buildBlackScene(args: {
  result: BlackShowResult;
  look: Look;
  fighters: SceneFighter[];
  winnerImage?: ImageSource | null;
}): BlackScene {
  const { result } = args;
  const eatT: Float64Array[] = [];
  const eatBy: Int16Array[] = [];
  const eatOrder: Int32Array[] = [];
  const swallows: Swallow[][] = [];
  for (const round of result.rounds) {
    const m = round.city.objects.length;
    const t = new Float64Array(m).fill(Infinity);
    const by = new Int16Array(m).fill(-1);
    const order: number[] = [];
    const sw: Swallow[] = [];
    for (const e of round.events) {
      if (e.type === 'eat') {
        t[e.o] = e.t;
        by[e.o] = e.i;
        order.push(e.o);
      } else sw.push({ t: e.t, i: e.i, j: e.j, x: e.x, y: e.y });
    }
    eatT.push(t);
    eatBy.push(by);
    eatOrder.push(Int32Array.from(order));
    swallows.push(sw);
  }
  const leads = result.rounds.map((round) => {
    const { data, frames, n, hz } = round.rec!;
    const out: { t: number; i: number }[] = [];
    const rad = (f: number, i: number) => data[(f * n + i) * 3 + 2];
    let cur = -1;
    for (let f = 0; f < frames && f / hz <= round.winnerT; f++) {
      let big = 0;
      for (let i = 1; i < n; i++) if (rad(f, i) > rad(f, big)) big = i;
      // A hole takes the lead once it is clearly (4%) bigger than the one it passes, or that one is gone.
      if (big !== cur && (cur < 0 || rad(f, cur) === 0 || rad(f, big) > rad(f, cur) * 1.04)) {
        cur = big;
        out.push({ t: f / hz, i: big });
      }
    }
    return out;
  });
  const tenT = result.rounds.map((r) =>
    r.winnerT > r.config.limit - 10 + 0.01 ? r.config.limit - 10 : null,
  );
  return {
    result,
    look: args.look,
    fighters: args.fighters,
    winnerImage: args.winnerImage ?? null,
    seed: result.show.rounds[0].seed,
    timeline: new Timeline(result, { intro: args.look.intro, outro: args.look.outro }),
    eatT,
    eatBy,
    eatOrder,
    swallows,
    leads,
    tenT,
  };
}

export function roundOf(scene: BlackScene, t: number): { k: number; local: number; round: BlackResult } {
  const { k, local } = roundIndexAt(scene.result.offsets, t);
  return { k, local, round: scene.result.rounds[k] };
}

/** Interpolated x, y and radius of hole i of a round at its local time (radius 0 once swallowed). */
export function holeAt(round: BlackResult, i: number, local: number): [number, number, number] {
  const { data, frames, n, hz } = round.rec!;
  const f = Math.max(0, Math.min(frames - 1, local * hz));
  const f0 = Math.floor(f);
  const f1 = Math.min(frames - 1, f0 + 1);
  const a = f - f0;
  const o0 = (f0 * n + i) * 3;
  const o1 = (f1 * n + i) * 3;
  if (data[o1 + 2] === 0 || data[o0 + 2] === 0) return [data[o0], data[o0 + 1], data[o0 + 2]];
  return [
    data[o0] + (data[o1] - data[o0]) * a,
    data[o0 + 1] + (data[o1 + 1] - data[o0 + 1]) * a,
    data[o0 + 2] + (data[o1 + 2] - data[o0 + 2]) * a,
  ];
}

/** The hole clearly in the lead at a round's local time. */
export function leaderAt(scene: BlackScene, k: number, local: number): number {
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
