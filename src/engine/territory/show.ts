/**
 * A Territory Wars video: one war on one map (Shorts with a few countries, long videos with many).
 * Length is fitted without bending the rules: a few seeds are played in full, and the playback
 * rate (ticks per second) is set so the war fills its share of the video. The liveliest war is
 * kept: one that ends in a conquest, with lead changes and falls spread through it, and a winner
 * that has not won lately.
 */
import { hash32 } from '../rng';
import { simulateTerritory } from './sim';
import type { TerritoryConfig, TerritoryResult } from './types';

export const TERRITORY_HOLD_SEC = 4;
/** The finish plays in slow motion, starting this long before it. */
const SLOWMO_LEAD = 0.9;
/** Playback rates the war may run at (ticks per sim second). */
const RATE_MIN = 8;
const RATE_MAX = 110;
const MAX_TICKS = 6000;

export type TerritoryShow = {
  rounds: TerritoryConfig[];
  /** Fighter index (into the video's fighters) for each country of each round. */
  entrants: number[][];
};

export type TerritoryShowResult = {
  show: TerritoryShow;
  rounds: TerritoryResult[];
  offsets: number[];
  /** Winner and runner-up as fighter indices. */
  winnerIndex: number;
  runnerUp: number;
  winnerT: number;
  final2T: number | null;
  endT: number;
};

export type TerritoryPlanInput = {
  seed: number;
  /** Every competitor's id and country code, in fighter order. */
  ids: string[];
  isos: string[];
  /** Desired and maximum length (sim seconds, start to the win). */
  targetSec: number;
  maxSec: number;
  /** Fighter indices that won recently: a war they win is the last choice. */
  avoid?: number[];
};

export function runRound(
  config: TerritoryConfig,
  opts: { record: boolean; holdSec: number },
): TerritoryResult {
  const out = simulateTerritory(config, opts);
  const winnerT = out.endTick / config.rate;
  return {
    config,
    ...out,
    winnerT,
    final2T: Math.max(0, winnerT - SLOWMO_LEAD),
    endT: winnerT + opts.holdSec,
  };
}

/** Plays a few seeds and keeps the liveliest war, at the rate that fits it to the target. */
export function planShow(input: TerritoryPlanInput, starts: number): TerritoryShow {
  const { ids, isos, targetSec } = input;
  const n = ids.length;
  const maxTicks = Math.min(MAX_TICKS, Math.floor(targetSec * RATE_MAX));
  const avoid = new Set(input.avoid ?? []);
  let best: TerritoryConfig | null = null;
  let bestScore = -Infinity;
  for (let k = 0; k < starts; k++) {
    const seed = k === 0 ? input.seed : (hash32(input.seed, k, 0x7e5) % 999_983) + 1;
    const out = simulateTerritory({ seed, ids, isos, rate: 1, maxTicks }, { record: false });
    const rate = Math.max(RATE_MIN, Math.min(RATE_MAX, out.endTick / targetSec));
    const sec = out.endTick / rate;
    if (sec > input.maxSec) continue;
    // Falls spread over the war beat a burst at the start and a long, empty end.
    const spread = out.outTicks.length
      ? 1 - Math.abs(out.outTicks[Math.floor(out.outTicks.length / 2)] / out.endTick - 0.5) * 2
      : 0;
    const land = [...out.land].sort((a, b) => b - a);
    const margin = land.length > 1 ? (land[0] - land[1]) / Math.max(1, land[0]) : 1;
    const score =
      (out.conquered ? 4 : margin < 0.1 ? 2 : 0) +
      Math.min(out.leadChanges, 6) * 0.8 +
      (out.outTicks.length / Math.max(1, n - 1)) * 2 +
      spread * 1.5 -
      Math.abs(sec - targetSec) * 0.3 -
      (avoid.has(out.winnerIndex) ? 10 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = { seed, ids, isos, rate, maxTicks };
    }
  }
  return {
    rounds: [best ?? { seed: input.seed, ids, isos, rate: RATE_MAX, maxTicks }],
    entrants: [ids.map((_, i) => i)],
  };
}

/** Runs (and records) the planned war. */
export function runShow(show: TerritoryShow, opts: { record: boolean }): TerritoryShowResult {
  const res = runRound(show.rounds[0], { record: opts.record, holdSec: TERRITORY_HOLD_SEC });
  const entrants = show.entrants[0];
  // Runner-up: the last to fall in a conquest, otherwise the second biggest.
  let ru = -1;
  const outs = res.events.filter((e) => e.type === 'out');
  if (res.conquered && outs.length) ru = outs[outs.length - 1].i;
  else
    res.land.forEach((c, i) => {
      if (i !== res.winnerIndex && (ru < 0 || c > res.land[ru])) ru = i;
    });
  return {
    show,
    rounds: [res],
    offsets: [0],
    winnerIndex: entrants[res.winnerIndex],
    runnerUp: ru >= 0 ? entrants[ru] : -1,
    winnerT: res.winnerT,
    final2T: res.final2T,
    endT: res.endT,
  };
}
