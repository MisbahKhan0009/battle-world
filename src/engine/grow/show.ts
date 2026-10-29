/**
 * A Growing Ball video: one game for a Short, or a knockout for a long video (heats of a few
 * flags, then a final between the heat winners). Length is fitted without bending the physics:
 * a few growth rates (and starts) are played in full, and the game whose finish lands closest to
 * its share of the target time, with the most lead changes and the closest finish, is kept.
 */
import { hash32 } from '../rng';
import { simulateGrow, startRadius } from './sim';
import type { GrowConfig, GrowResult } from './types';

/** Sim seconds between rounds (heat winner callout), and after the final. */
export const ROUND_BREAK_SEC = 2.6;
export const GROW_HOLD_SEC = 4;
/** The finish plays in slow motion, starting this long before it. */
const SLOWMO_LEAD = 0.9;
/** Growth per bounce to try (share of the arena's area), smallest to largest. */
const GROWTH = [
  0.0006, 0.0007, 0.00083, 0.00098, 0.00116, 0.00137, 0.00162, 0.0019, 0.00225, 0.00266, 0.0031, 0.0037,
];

export type GrowShow = {
  rounds: GrowConfig[];
  /** Fighter index (into the video's fighters) for each ball of each round. */
  entrants: number[][];
};

export type GrowShowResult = {
  show: GrowShow;
  rounds: GrowResult[];
  /** Video-wide sim time at which each round starts. */
  offsets: number[];
  /** Winner and runner-up as fighter indices. */
  winnerIndex: number;
  runnerUp: number;
  winnerT: number;
  final2T: number | null;
  endT: number;
};

export type GrowPlanInput = {
  seed: number;
  /** Every competitor's id, in fighter order. */
  ids: string[];
  /** Heats as groups of fighter indices, or null for a single game with everyone. */
  heats: number[][] | null;
  /** Desired and maximum length (sim seconds, start to the final win). */
  targetSec: number;
  maxSec: number;
};

export function runRound(config: GrowConfig, opts: { record: boolean; holdSec: number }): GrowResult {
  const out = simulateGrow(config, { record: opts.record, holdSec: opts.holdSec, maxT: 600 });
  return { config, ...out, final2T: Math.max(0, out.winnerT - SLOWMO_LEAD) };
}

/** Radius of every ball of a round when it ended. */
export function finalRadii(res: Pick<GrowResult, 'config' | 'events' | 'winnerT'>): number[] {
  const r = res.config.ids.map(() => res.config.r0);
  for (const e of res.events) {
    if (e.t > res.winnerT) break;
    if (e.type === 'wall') r[e.i] = e.r;
  }
  return r;
}

/** Plays a few growth rates (and starts) and keeps the closest, liveliest game. */
export function planRound(
  seed: number,
  ids: string[],
  targetSec: number,
  maxSec: number,
  starts: number,
): GrowConfig {
  const r0 = startRadius(ids.length);
  let best: GrowConfig | null = null;
  let bestScore = -Infinity;
  for (let k = 0; k < starts; k++) {
    const s = k === 0 ? seed : (hash32(seed, k, 0x96b) % 999_983) + 1;
    for (const growth of GROWTH) {
      const cfg: GrowConfig = { seed: s, ids, r0, growth };
      const out = simulateGrow(cfg, { record: false, holdSec: 0, maxT: maxSec + 0.5 });
      if (out.winnerT > maxSec) continue;
      const r = finalRadii({ config: cfg, events: out.events, winnerT: out.winnerT }).sort((a, b) => b - a);
      const margin = r.length > 1 ? (r[0] - r[1]) / r[0] : 1;
      const score =
        Math.min(out.leadChanges, 6) * 1.5 +
        (margin < 0.05 ? 3 : margin < 0.1 ? 1.5 : 0) -
        Math.abs(out.winnerT - targetSec) * 1.5;
      if (score > bestScore) {
        bestScore = score;
        best = cfg;
      }
    }
  }
  // Nothing finished in time: grow as fast as allowed.
  return best ?? { seed, ids, r0, growth: GROWTH[GROWTH.length - 1] };
}

/** Plans every round. Heats are played to find who reaches the final. */
export function planShow(input: GrowPlanInput, starts: number): GrowShow {
  const { seed, ids } = input;
  const roundSeed = (k: number) => (hash32(seed, k, 0x6b3) % 999_983) + 1;
  if (!input.heats) {
    return {
      rounds: [planRound(seed, ids, input.targetSec, input.maxSec, starts)],
      entrants: [ids.map((_, i) => i)],
    };
  }
  const H = input.heats.length;
  // The final gets a bit more time than a heat.
  const share = (input.targetSec - ROUND_BREAK_SEC * H) / (H + 1.4);
  const maxShare = (input.maxSec - ROUND_BREAK_SEC * H) / (H + 1.4);
  const rounds: GrowConfig[] = [];
  const entrants: number[][] = [];
  const finalists: number[] = [];
  input.heats.forEach((group, h) => {
    const cfg = planRound(
      roundSeed(h),
      group.map((i) => ids[i]),
      share,
      maxShare,
      starts,
    );
    rounds.push(cfg);
    entrants.push(group);
    finalists.push(group[runRound(cfg, { record: false, holdSec: 0 }).winnerIndex]);
  });
  rounds.push(
    planRound(
      roundSeed(H),
      finalists.map((i) => ids[i]),
      share * 1.4,
      maxShare * 1.4,
      starts,
    ),
  );
  entrants.push(finalists);
  return { rounds, entrants };
}

/** Runs (and records) every round of a planned show on one video-wide sim clock. */
export function runShow(show: GrowShow, opts: { record: boolean }): GrowShowResult {
  const last = show.rounds.length - 1;
  const rounds: GrowResult[] = [];
  const offsets: number[] = [];
  let at = 0;
  show.rounds.forEach((cfg, k) => {
    const res = runRound(cfg, { record: opts.record, holdSec: k === last ? GROW_HOLD_SEC : ROUND_BREAK_SEC });
    offsets.push(at);
    rounds.push(res);
    at += res.winnerT + ROUND_BREAK_SEC;
  });
  const fin = rounds[last];
  const finEntrants = show.entrants[last];
  // Runner-up: the second biggest finalist when the final ended.
  const size = finalRadii(fin);
  let ru = -1;
  size.forEach((r, i) => {
    if (i !== fin.winnerIndex && (ru < 0 || r > size[ru])) ru = i;
  });
  const winnerT = offsets[last] + fin.winnerT;
  return {
    show,
    rounds,
    offsets,
    winnerIndex: finEntrants[fin.winnerIndex],
    runnerUp: ru >= 0 ? finEntrants[ru] : -1,
    winnerT,
    final2T: Math.max(0, winnerT - SLOWMO_LEAD),
    endT: offsets[last] + fin.endT,
  };
}

/** Which round is on screen at video-wide sim time t, and the time inside it. */
export function roundAt(res: GrowShowResult, t: number): { k: number; local: number } {
  let k = 0;
  while (k + 1 < res.offsets.length && t >= res.offsets[k + 1]) k++;
  return { k, local: t - res.offsets[k] };
}
