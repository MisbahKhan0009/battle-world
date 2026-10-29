/**
 * A Paper Land video: one game for a Short, or a knockout for a long video (heats of a few flags,
 * then a final between the heat winners). Each game runs on a clock, so its length is set
 * directly; a few starts are played in full and the liveliest is kept (lead changes, a few cuts
 * but not too many, a board still well covered at the end, a close finish, lasting the whole clock).
 */
import { hash32 } from '../rng';
import { boardSize, simulatePaper } from './sim';
import type { PaperConfig, PaperResult } from './types';

/** Sim seconds between rounds (heat winner callout), and after the final. */
export const ROUND_BREAK_SEC = 2.6;
export const PAPER_HOLD_SEC = 4;
/** The finish plays in slow motion, starting this long before it. */
const SLOWMO_LEAD = 0.9;
/** Shortest game clock (sim seconds). */
const MIN_LIMIT = 12;

export type PaperShow = {
  rounds: PaperConfig[];
  /** Fighter index (into the video's fighters) for each flag of each round. */
  entrants: number[][];
};

export type PaperShowResult = {
  show: PaperShow;
  rounds: PaperResult[];
  /** Video-wide sim time at which each round starts. */
  offsets: number[];
  /** Winner and runner-up as fighter indices. */
  winnerIndex: number;
  runnerUp: number;
  winnerT: number;
  final2T: number | null;
  endT: number;
};

export type PaperPlanInput = {
  seed: number;
  /** Every competitor's id, in fighter order. */
  ids: string[];
  /** Heats as groups of fighter indices, or null for a single game with everyone. */
  heats: number[][] | null;
  /** Desired and maximum length (sim seconds, start to the final win). */
  targetSec: number;
  maxSec: number;
};

export function runRound(config: PaperConfig, opts: { record: boolean; holdSec: number }): PaperResult {
  const out = simulatePaper(config, opts);
  return { config, ...out, final2T: Math.max(0, out.winnerT - SLOWMO_LEAD) };
}

/** Plays a few starts on a clock of the target length and keeps the liveliest game. */
export function planRound(
  seed: number,
  ids: string[],
  targetSec: number,
  maxSec: number,
  starts: number,
): PaperConfig {
  const size = boardSize(ids.length);
  const limit = Math.round(Math.max(MIN_LIMIT, Math.min(targetSec, maxSec)) * 10) / 10;
  let best: PaperConfig | null = null;
  let bestScore = -Infinity;
  for (let k = 0; k < starts; k++) {
    const s = k === 0 ? seed : (hash32(seed, k, 0xa9e) % 999_983) + 1;
    const cfg: PaperConfig = { seed: s, ids, size, limit };
    const out = simulatePaper(cfg, { record: false, holdSec: 0 });
    const land = [...out.land].sort((a, b) => b - a);
    const margin = land.length > 1 && land[0] > 0 ? (land[0] - land[1]) / land[0] : 1;
    // A few knock-outs are drama; too many leave an empty board. A full board at the end is best.
    const fill = land.reduce((a, b) => a + b, 0) / (size * size);
    const cutsWanted = Math.max(1, Math.round(ids.length / 3));
    const score =
      Math.min(out.leadChanges, 8) * 0.6 +
      Math.min(out.cuts, cutsWanted) * 1.2 -
      Math.max(0, out.cuts - cutsWanted - 1) * 1.5 +
      fill * 6 +
      (margin < 0.1 ? 3 : margin < 0.25 ? 1.5 : 0) -
      Math.abs(out.winnerT - targetSec) * 0.8;
    if (score > bestScore) {
      bestScore = score;
      best = cfg;
    }
  }
  return best!;
}

/** Plans every round. Heats are played to find who reaches the final. */
export function planShow(input: PaperPlanInput, starts: number): PaperShow {
  const { seed, ids } = input;
  const roundSeed = (k: number) => (hash32(seed, k, 0x7a1) % 999_983) + 1;
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
  const rounds: PaperConfig[] = [];
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
export function runShow(show: PaperShow, opts: { record: boolean }): PaperShowResult {
  const last = show.rounds.length - 1;
  const rounds: PaperResult[] = [];
  const offsets: number[] = [];
  let at = 0;
  show.rounds.forEach((cfg, k) => {
    const res = runRound(cfg, {
      record: opts.record,
      holdSec: k === last ? PAPER_HOLD_SEC : ROUND_BREAK_SEC,
    });
    offsets.push(at);
    rounds.push(res);
    at += res.winnerT + ROUND_BREAK_SEC;
  });
  const fin = rounds[last];
  const finEntrants = show.entrants[last];
  // Runner-up: the finalist with the second most land at the end, or the last one cut.
  const outAt = fin.land.map(() => Infinity);
  for (const e of fin.events) if (e.type === 'cut') outAt[e.i] = e.t;
  let ru = -1;
  fin.land.forEach((l, i) => {
    if (i === fin.winnerIndex) return;
    if (ru < 0 || l > fin.land[ru] || (l === fin.land[ru] && outAt[i] > outAt[ru])) ru = i;
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
