import { ARENA_R } from '../engine/physics';
import { Timeline } from '../engine/timeline';
import type { Look, SimResult } from '../engine/types';
import type { ImageSource } from './canvas';

export type SceneFighter = {
  id: string;
  name: string;
  isCountry: boolean;
  accent: string;
  palette: string[];
  /** Square flag raster (any size, drawn clipped to a circle). */
  image: ImageSource | null;
};

/** Hit and elimination data in flat, time-sorted arrays for fast per-frame lookups. */
export type EffectsIndex = {
  hitT: Float64Array;
  hitA: Int32Array;
  hitB: Int32Array;
  hitImpact: Float32Array;
  hitX: Float32Array;
  hitY: Float32Array;
  hitDmgA: Float32Array;
  hitDmgB: Float32Array;
  /** Per fighter: sorted times it took a hit. */
  hitsOf: Float64Array[];
  elims: {
    t: number;
    i: number;
    by: number;
    x: number;
    y: number;
    escaped: boolean;
    vx: number;
    vy: number;
  }[];
};

export type Scene = {
  result: SimResult;
  timeline: Timeline;
  look: Look;
  fighters: SceneFighter[];
  /** High-resolution winner flag for the winner lockup and outro. */
  winnerImage: ImageSource | null;
  fx: EffectsIndex;
  seed: number;
};

export function buildEffectsIndex(result: SimResult, ids: string[]): EffectsIndex {
  const index = new Map(ids.map((id, i) => [id, i]));
  const hits = result.events.filter((e) => e.type === 'hit');
  const n = hits.length;
  const fx: EffectsIndex = {
    hitT: new Float64Array(n),
    hitA: new Int32Array(n),
    hitB: new Int32Array(n),
    hitImpact: new Float32Array(n),
    hitX: new Float32Array(n),
    hitY: new Float32Array(n),
    hitDmgA: new Float32Array(n),
    hitDmgB: new Float32Array(n),
    hitsOf: [],
    elims: [],
  };
  const per: number[][] = ids.map(() => []);
  hits.forEach((h, k) => {
    if (h.type !== 'hit') return;
    const a = index.get(h.a)!;
    const b = index.get(h.b)!;
    fx.hitT[k] = h.t;
    fx.hitA[k] = a;
    fx.hitB[k] = b;
    fx.hitImpact[k] = h.impact;
    fx.hitX[k] = h.x;
    fx.hitY[k] = h.y;
    fx.hitDmgA[k] = h.dmgA;
    fx.hitDmgB[k] = h.dmgB;
    per[a].push(h.t);
    per[b].push(h.t);
  });
  fx.hitsOf = per.map((p) => Float64Array.from(p));
  for (const e of result.events) {
    if (e.type !== 'eliminate') continue;
    fx.elims.push({
      t: e.t,
      i: index.get(e.id)!,
      by: e.by ? index.get(e.by)! : -1,
      x: e.x,
      y: e.y,
      escaped: !!e.escaped,
      vx: e.vx ?? 0,
      vy: e.vy ?? 0,
    });
  }
  return fx;
}

export function buildScene(args: {
  result: SimResult;
  look: Look;
  fighters: SceneFighter[];
  winnerImage?: ImageSource | null;
}): Scene {
  const { result, look, fighters } = args;
  return {
    result,
    look,
    fighters,
    winnerImage: args.winnerImage ?? null,
    timeline: new Timeline(result, { intro: look.intro, outro: look.outro }),
    fx: buildEffectsIndex(
      result,
      fighters.map((f) => f.id),
    ),
    seed: result.config.seed,
  };
}

/** Largest index with arr[index] <= t, or -1. */
export function upperIndex(arr: Float64Array, t: number): number {
  let lo = 0;
  let hi = arr.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

export { ARENA_R };
