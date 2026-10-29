/**
 * A Ring Escape video: one game for a Short, or a knockout tournament for a long video (heats of
 * a few flags, then a final between the heat winners). Length is fitted without bending the
 * physics: a probe game runs with plenty of rings, and each game keeps the ring count whose
 * last escape lands closest to its share of the target time.
 */
import { hash32 } from '../rng';
import { ballRadius, buildRings, simulateRings } from './sim';
import type { RingsConfig, RingsResult } from './types';

/** Sim seconds between rounds (heat winner callout), and after the final escape. */
export const ROUND_BREAK_SEC = 2.6;
export const RINGS_HOLD_SEC = 4;
/** The final escape plays in slow motion, starting this long before it. */
const SLOWMO_LEAD = 0.9;
const PROBE_RINGS = 70;

export type RingsShow = {
  rounds: RingsConfig[];
  /** Fighter index (into the video's fighters) for each ball of each round. */
  entrants: number[][];
};

export type RingsShowResult = {
  show: RingsShow;
  rounds: RingsResult[];
  /** Video-wide sim time at which each round starts. */
  offsets: number[];
  /** Winner and runner-up as fighter indices. */
  winnerIndex: number;
  runnerUp: number;
  winnerT: number;
  final2T: number | null;
  endT: number;
};

export type RingsPlanInput = {
  seed: number;
  /** Every competitor's id, in fighter order. */
  ids: string[];
  /** Heats as groups of fighter indices, or null for a single game with everyone. */
  heats: number[][] | null;
  /** Desired and maximum length (sim seconds, start to the final escape). */
  targetSec: number;
  maxSec: number;
};

/** How exciting a game is: many different ring breakers and changes at the top. */
export function roundScore(r: Pick<RingsResult, 'shatterBy'>): number {
  const count = new Map<number, number>();
  let leader = -1;
  let changes = 0;
  for (const b of r.shatterBy) {
    count.set(b, (count.get(b) ?? 0) + 1);
    if (leader !== b && (count.get(b) ?? 0) > (count.get(leader) ?? 0)) {
      if (leader >= 0) changes++;
      leader = b;
    }
  }
  return count.size * 1.5 + Math.min(changes, 8);
}

/** Picks the ring count for one game from a probe run. */
export function planRound(
  seed: number,
  ids: string[],
  targetSec: number,
  maxSec: number,
  minRings = 4,
  maxRings = 12,
): RingsConfig & { probeError: number } {
  const radius = ballRadius(ids.length);
  const probe = simulateRings(
    { seed, ids, radius, rings: PROBE_RINGS },
    { record: false, holdSec: 0, maxT: maxSec + 1, ringLimit: PROBE_RINGS },
  );
  let best = Math.max(1, Math.min(minRings, probe.shatterT.length));
  let bestErr = Infinity;
  probe.shatterT.forEach((t, k) => {
    if (k < minRings - 1 || k >= maxRings || t > maxSec) return;
    const err = Math.abs(t - targetSec);
    if (err < bestErr) {
      bestErr = err;
      best = k + 1;
    }
  });
  return { seed, ids, radius, rings: best, probeError: Number.isFinite(bestErr) ? bestErr : targetSec };
}

function planBestRound(
  seed: number,
  ids: string[],
  targetSec: number,
  maxSec: number,
  candidates: number,
  minRings = 4,
) {
  let best: RingsConfig | null = null;
  let bestScore = -Infinity;
  for (let k = 0; k < candidates; k++) {
    const s = k === 0 ? seed : (hash32(seed, k, 0x5917) % 999_983) + 1;
    const { probeError, ...cfg } = planRound(s, ids, targetSec, maxSec, minRings);
    const res = runRound(cfg, { record: false, holdSec: 0 });
    const score = roundScore(res) - probeError * 1.5;
    if (score > bestScore) {
      bestScore = score;
      best = cfg;
    }
  }
  return best!;
}

export function runRound(config: RingsConfig, opts: { record: boolean; holdSec: number }): RingsResult {
  const out = simulateRings(config, { record: opts.record, holdSec: opts.holdSec, maxT: 900 });
  let { winnerIndex, winnerT } = out;
  if (winnerIndex < 0) {
    // Safety net (never expected): whoever broke the most recent ring wins.
    winnerIndex = out.shatterBy[out.shatterBy.length - 1] ?? 0;
    winnerT = out.endT;
  }
  return {
    config,
    rings: buildRings(config),
    events: out.events,
    shatterT: out.shatterT,
    shatterBy: out.shatterBy,
    winnerIndex,
    winnerT,
    final2T: Math.max(0, winnerT - SLOWMO_LEAD),
    endT: out.endT,
    rec: out.rec,
  };
}

/** Plans every round. Heats are run to find who reaches the final. */
export function planShow(input: RingsPlanInput, candidates: number): RingsShow {
  const { seed, ids } = input;
  const roundSeed = (k: number) => (hash32(seed, k, 0x7a3) % 999_983) + 1;
  if (!input.heats) {
    const all = ids.map((_, i) => i);
    return {
      rounds: [planBestRound(seed, ids, input.targetSec, input.maxSec, candidates)],
      entrants: [all],
    };
  }
  const H = input.heats.length;
  // The final gets a bit more time than a heat.
  const share = (input.targetSec - ROUND_BREAK_SEC * H) / (H + 1.4);
  const maxShare = (input.maxSec - ROUND_BREAK_SEC * H) / (H + 1.4);
  const rounds: RingsConfig[] = [];
  const entrants: number[][] = [];
  const finalists: number[] = [];
  input.heats.forEach((group, h) => {
    const cfg = planBestRound(
      roundSeed(h),
      group.map((i) => ids[i]),
      share,
      maxShare,
      candidates,
    );
    rounds.push(cfg);
    entrants.push(group);
    finalists.push(group[runRound(cfg, { record: false, holdSec: 0 }).winnerIndex]);
  });
  rounds.push(
    planBestRound(
      roundSeed(H),
      finalists.map((i) => ids[i]),
      share * 1.4,
      maxShare * 1.4,
      candidates,
      6,
    ),
  );
  entrants.push(finalists);
  return { rounds, entrants };
}

/** Runs (and records) every round of a planned show on one video-wide sim clock. */
export function runShow(show: RingsShow, opts: { record: boolean }): RingsShowResult {
  const last = show.rounds.length - 1;
  const rounds: RingsResult[] = [];
  const offsets: number[] = [];
  let at = 0;
  show.rounds.forEach((cfg, k) => {
    const res = runRound(cfg, {
      record: opts.record,
      holdSec: k === last ? RINGS_HOLD_SEC : ROUND_BREAK_SEC,
    });
    offsets.push(at);
    rounds.push(res);
    at += res.winnerT + ROUND_BREAK_SEC;
  });
  const fin = rounds[last];
  const finEntrants = show.entrants[last];
  // Runner-up: the finalist who broke the most rings (the later breaker wins a tie).
  const breaks = new Map<number, { n: number; last: number }>();
  fin.shatterBy.forEach((b, k) => {
    if (b === fin.winnerIndex) return;
    const s = breaks.get(b) ?? { n: 0, last: 0 };
    breaks.set(b, { n: s.n + 1, last: k });
  });
  let ru = fin.winnerIndex === 0 ? 1 : 0;
  let top = { n: 0, last: -1 };
  for (const [b, s] of breaks)
    if (s.n > top.n || (s.n === top.n && s.last > top.last)) {
      top = s;
      ru = b;
    }
  const winnerT = offsets[last] + fin.winnerT;
  return {
    show,
    rounds,
    offsets,
    winnerIndex: finEntrants[fin.winnerIndex],
    runnerUp: ru < finEntrants.length ? finEntrants[ru] : -1,
    winnerT,
    final2T: Math.max(0, winnerT - SLOWMO_LEAD),
    endT: offsets[last] + fin.endT,
  };
}

/** Which round is on screen at video-wide sim time t, and the time inside it. */
export function roundAt(res: RingsShowResult, t: number): { k: number; local: number } {
  let k = 0;
  while (k + 1 < res.offsets.length && t >= res.offsets[k + 1]) k++;
  return { k, local: t - res.offsets[k] };
}
