/**
 * Race length control without bending the physics. A probe race runs on a long track; the
 * finish line is then placed at the section boundary the race front reaches closest to the
 * target time. Sections keep a clear band at their top, so nothing that happens above the line
 * depends on what comes after it: the real race (same track, ending at that line) produces the
 * same winner at exactly the probed time.
 */
import { hash32 } from '../rng';
import { buildTrack, finishLevel } from './track';
import { simulateRace } from './sim';
import type { RaceConfig, RaceResult } from './types';

/** Sim seconds to keep recording after the winner (winner card + a beat). */
export const RACE_HOLD_SEC = 4;
/** Photo finish: runner-up within this many seconds triggers the final slow motion. */
const PHOTO_FINISH_SEC = 0.6;

/** Marble radius for a field of n marbles (smaller marbles for bigger fields). */
export function marbleRadius(n: number): number {
  return Math.max(18, Math.min(30, 40 - n * 0.5));
}

export type RacePlanInput = {
  seed: number;
  ids: string[];
  /** Desired race length (sim seconds, from the start to the winner crossing the line). */
  targetSec: number;
  /** Never longer than this. */
  maxSec: number;
};

export function planRace(input: RacePlanInput): RaceConfig & { probeError: number } {
  const radius = marbleRadius(input.ids.length);
  let sections = Math.ceil(input.maxSec / 2.2) + 4;
  for (let attempt = 0; attempt < 5; attempt++) {
    const probe = buildTrack(input.seed, sections, radius, false);
    const levels = probe.sections.map((s) => finishLevel(s.y1, radius));
    const out = simulateRace({ seed: input.seed, ids: input.ids, radius, sections }, probe, {
      record: false,
      holdSec: 0,
      maxT: input.maxSec + 2,
      levels,
    });
    const reachedEnd = out.levelT[levels.length - 1] < input.maxSec;
    if (!reachedEnd || attempt === 4) {
      // Best boundary: closest to the target, never past the maximum, at least two sections.
      let best = 1;
      let bestErr = Infinity;
      out.levelT.forEach((t, k) => {
        if (k < 1 || t > input.maxSec) return;
        const err = Math.abs(t - input.targetSec);
        if (err < bestErr) {
          bestErr = err;
          best = k;
        }
      });
      return { seed: input.seed, ids: input.ids, radius, sections: best + 1, probeError: bestErr };
    }
    sections = Math.ceil(sections * 1.6);
  }
  throw new Error('unreachable');
}

/** How exciting a race is: lead changes, plus a bonus for a close finish. */
export function raceScore(r: Pick<RaceResult, 'leadChanges' | 'order' | 'finishT' | 'winnerT'>): number {
  const second = r.order[1];
  const gap = second === undefined ? Infinity : r.finishT[second] - r.winnerT;
  return Math.min(r.leadChanges, 25) + (gap < 1.5 ? 4 : 0) + (gap < 0.6 ? 3 : 0);
}

/**
 * Plans a few candidate tracks (seeds derived from the given one) and keeps the most exciting
 * race. Selection only: every candidate is plain, unmodified physics.
 */
export function planBestRace(input: RacePlanInput, candidates: number): RaceConfig {
  let best: RaceConfig | null = null;
  let bestScore = -Infinity;
  for (let k = 0; k < candidates; k++) {
    const { probeError, ...cfg } = planRace({
      ...input,
      seed: k === 0 ? input.seed : (hash32(input.seed, k, 0xbe57) % 999_983) + 1,
    });
    const res = runRace(cfg, { record: false });
    // Prefer exciting races, but not at the cost of missing the target length.
    const score = raceScore(res) - probeError * 1.5;
    if (score > bestScore) {
      bestScore = score;
      best = cfg;
    }
  }
  return best!;
}

export function runRace(config: RaceConfig, opts: { record: boolean }): RaceResult {
  const track = buildTrack(config.seed, config.sections, config.radius, true);
  const out = simulateRace(config, track, {
    record: opts.record,
    holdSec: RACE_HOLD_SEC,
    maxT: 900,
  });
  let winnerIndex = out.order[0] ?? -1;
  let winnerT = winnerIndex >= 0 ? out.finishT[winnerIndex] : out.endT;
  if (winnerIndex < 0) {
    // Safety net (should never happen): the deepest marble wins.
    winnerIndex = 0;
    winnerT = out.endT;
  }
  const second = out.order[1];
  const close = second !== undefined && out.finishT[second] - winnerT < PHOTO_FINISH_SEC;
  return {
    config,
    track,
    events: out.events,
    finishT: out.finishT,
    order: out.order,
    winnerIndex,
    winnerT,
    final2T: close ? Math.max(0, winnerT - 1.0) : null,
    endT: out.endT,
    leadChanges: out.leadChanges,
    rec: out.rec,
  };
}
