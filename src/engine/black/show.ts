/**
 * A Black Hole video: one game for a Short, or a knockout for a long video (heats of a few holes,
 * then a final between the heat winners). Each game runs on a clock, so its length is set
 * directly; a few cities are played in full and the liveliest is kept (lead changes, a hole or two
 * swallowed but not everyone, a close finish, lasting the whole clock).
 */
import { hash32 } from '../rng';
import { cityBlocks, simulateBlack } from './sim';
import type { BlackConfig, BlackResult } from './types';

/** Sim seconds between rounds (heat winner callout), and after the final. */
export const ROUND_BREAK_SEC = 2.6;
export const BLACK_HOLD_SEC = 4;
/** The finish plays in slow motion, starting this long before it. */
const SLOWMO_LEAD = 0.9;
/** Shortest game clock (sim seconds). */
const MIN_LIMIT = 12;

export type BlackShow = {
  rounds: BlackConfig[];
  /** Fighter index (into the video's fighters) for each hole of each round. */
  entrants: number[][];
};

export type BlackShowResult = {
  show: BlackShow;
  rounds: BlackResult[];
  /** Video-wide sim time at which each round starts. */
  offsets: number[];
  /** Winner and runner-up as fighter indices. */
  winnerIndex: number;
  runnerUp: number;
  winnerT: number;
  final2T: number | null;
  endT: number;
};

export type BlackPlanInput = {
  seed: number;
  /** Every competitor's id, in fighter order. */
  ids: string[];
  /** Heats as groups of fighter indices, or null for a single game with everyone. */
  heats: number[][] | null;
  /** Desired and maximum length (sim seconds, start to the final win). */
  targetSec: number;
  maxSec: number;
};

export function runRound(config: BlackConfig, opts: { record: boolean; holdSec: number }): BlackResult {
  const out = simulateBlack(config, opts);
  return { config, ...out, final2T: Math.max(0, out.winnerT - SLOWMO_LEAD) };
}

/** Plays a few cities on a clock of the target length and keeps the liveliest game. */
export function planRound(
  seed: number,
  ids: string[],
  targetSec: number,
  maxSec: number,
  starts: number,
): BlackConfig {
  const limit = Math.round(Math.max(MIN_LIMIT, Math.min(targetSec, maxSec)) * 10) / 10;
  const blocks = cityBlocks(ids.length, limit);
  let best: BlackConfig | null = null;
  let bestScore = -Infinity;
  for (let k = 0; k < starts; k++) {
    const s = k === 0 ? seed : (hash32(seed, k, 0xb4c) % 999_983) + 1;
    const cfg: BlackConfig = { seed: s, ids, blocks, limit };
    const out = simulateBlack(cfg, { record: false, holdSec: 0 });
    const radii = [...out.radii].sort((a, b) => b - a);
    const margin = radii.length > 1 && radii[0] > 0 ? (radii[0] - radii[1]) / radii[0] : 1;
    // A swallow or two is drama; a city with one hole left long before the end is not.
    const wanted = Math.max(1, Math.round(ids.length / 3));
    const score =
      Math.min(out.leadChanges, 8) * 0.6 +
      Math.min(out.swallows, wanted) * 1.5 -
      Math.max(0, out.swallows - wanted - 1) * 1.2 +
      (margin < 0.08 ? 3 : margin < 0.2 ? 1.5 : 0) -
      Math.abs(out.winnerT - limit) * 0.8;
    if (score > bestScore) {
      bestScore = score;
      best = cfg;
    }
  }
  return best!;
}

/** Plans every round. Heats are played to find who reaches the final. */
export function planShow(input: BlackPlanInput, starts: number): BlackShow {
  const { seed, ids } = input;
  const roundSeed = (k: number) => (hash32(seed, k, 0xb7e) % 999_983) + 1;
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
  const rounds: BlackConfig[] = [];
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
export function runShow(show: BlackShow, opts: { record: boolean }): BlackShowResult {
  const last = show.rounds.length - 1;
  const rounds: BlackResult[] = [];
  const offsets: number[] = [];
  let at = 0;
  show.rounds.forEach((cfg, k) => {
    const res = runRound(cfg, {
      record: opts.record,
      holdSec: k === last ? BLACK_HOLD_SEC : ROUND_BREAK_SEC,
    });
    offsets.push(at);
    rounds.push(res);
    at += res.winnerT + ROUND_BREAK_SEC;
  });
  const fin = rounds[last];
  const finEntrants = show.entrants[last];
  // Runner-up: the biggest other hole at the end, or the last one swallowed.
  const outAt = fin.radii.map(() => Infinity);
  for (const e of fin.events) if (e.type === 'swallow') outAt[e.j] = e.t;
  let ru = -1;
  fin.radii.forEach((rad, i) => {
    if (i === fin.winnerIndex) return;
    if (ru < 0 || rad > fin.radii[ru] || (rad === fin.radii[ru] && outAt[i] > outAt[ru])) ru = i;
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
export function roundAt(res: BlackShowResult, t: number): { k: number; local: number } {
  let k = 0;
  while (k + 1 < res.offsets.length && t >= res.offsets[k + 1]) k++;
  return { k, local: t - res.offsets[k] };
}
