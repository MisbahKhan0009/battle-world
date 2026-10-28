import { DEFAULT_BASE_DAMAGE, DEFAULT_RAMP, simulate } from './sim';
import { videoOverhead } from './timeline';
import type { Rules, SimConfig, SimResult } from './types';

export type TuneInput = {
  fighters: SimConfig['fighters'];
  rules: Rules;
  intro: boolean;
  outro: boolean;
};

export type TuneResult = {
  config: SimConfig;
  /** Winner time of the chosen config (sim seconds). */
  winnerT: number;
  runs: number;
  /** Video-length error of the chosen config in seconds (0 for auto). */
  error: number;
};

const MAX_RUNS = 8;
const TOLERANCE = 1;

function baseConfig(input: TuneInput): SimConfig {
  const { rules } = input;
  return {
    fighters: input.fighters,
    arena: rules.arena,
    shrink: { ...rules.shrink },
    damageModel: rules.damageModel,
    baseDamage: DEFAULT_BASE_DAMAGE,
    damageRamp: rules.damageRamp,
    seed: rules.seed,
  };
}

/**
 * Finds baseDamage/damageRamp so the full video lands near the target duration.
 * Battle length falls roughly as 1/damage, so it searches a single scale k in log space:
 * proportional steps until the target is bracketed, then geometric bisection.
 * Each probe is a fast headless run (no track recording).
 */
export function tune(input: TuneInput): TuneResult {
  const base = baseConfig(input);
  const target = input.rules.targetDurationSec;
  if (target === 'auto' || input.fighters.length < 2) {
    const r = simulate(base);
    return { config: base, winnerT: r.winnerT, runs: 1, error: 0 };
  }

  const n = input.fighters.length;
  const winTarget = Math.max(4, target - videoOverhead(input, n > 2));
  // Normalize the ramp to the target so the late-game multiplier is the same as a 60s battle.
  const rampAtTarget = (input.rules.damageRamp || DEFAULT_RAMP) * (60 / winTarget);

  const configFor = (k: number, directorT: number): SimConfig => ({
    ...base,
    baseDamage: DEFAULT_BASE_DAMAGE * k,
    damageRamp: rampAtTarget * k,
    targetWinSec: directorT,
  });

  // The in-sim director does most of the pacing. Each probe (1) recalibrates base damage so
  // the director's average multiplier sits near 1 (natural-looking hits) and (2) corrects the
  // director's own deadline by the observed overshoot. The closest run wins.
  let k = Math.min(2, 30 / winTarget);
  let directorT = winTarget;
  let best: { cfg: SimConfig; result: SimResult; err: number } | null = null;
  let runs = 0;
  while (runs < MAX_RUNS) {
    const cfg = configFor(k, directorT);
    const result = simulate(cfg, { maxSec: winTarget * 4 + 30 });
    runs++;
    const err = result.winnerT - winTarget;
    if (!best || Math.abs(err) < Math.abs(best.err)) best = { cfg, result, err };
    if (Math.abs(best.err) <= TOLERANCE && (runs >= 2 || Math.abs(Math.log(result.meanDirector)) < 0.4)) break;
    k *= Math.min(3, Math.max(0.33, result.meanDirector));
    directorT = Math.max(winTarget * 0.6, Math.min(winTarget * 1.3, directorT - err * 0.8));
  }

  return { config: best!.cfg, winnerT: best!.result.winnerT, runs, error: best!.err };
}
