/** Video-time layout of a battle: intro, battle (with final-2 slow motion), winner hold, outro. */

export const INTRO_SEC = 2;
export const WINNER_HOLD_SEC = 3;
export const OUTRO_SEC = 3;
/** Final-2 slow motion: video seconds, ramp time and minimum speed. */
export const SLOWMO_SEC = 1.5;
const SLOWMO_RAMP = 0.3;
const SLOWMO_MIN = 0.6;
const SLOW_DEPTH = 1 - SLOWMO_MIN;

/** Integral of the slow-motion weight (trapezoid 0..1..0) from 0 to u. */
function weightIntegral(u: number): number {
  const a = SLOWMO_RAMP;
  const D = SLOWMO_SEC;
  if (u <= 0) return 0;
  if (u <= a) return (u * u) / (2 * a);
  if (u <= D - a) return a / 2 + (u - a);
  if (u <= D) {
    const v = u - (D - a);
    return a / 2 + (D - 2 * a) + v - (v * v) / (2 * a);
  }
  return D - a;
}

/** Sim seconds that elapse during `u` video seconds of slow motion. */
function slowAdvance(u: number): number {
  return u - SLOW_DEPTH * weightIntegral(u);
}

/** Extra video seconds the slow-motion window adds. */
export const SLOWMO_EXTRA = SLOWMO_SEC - slowAdvance(SLOWMO_SEC);

export type Phase = 'intro' | 'battle' | 'winner' | 'outro';

export type TimelineInput = { final2T: number | null; winnerT: number; endT: number };

export class Timeline {
  readonly intro: number;
  readonly outro: number;
  readonly final2T: number | null;
  readonly winnerT: number;
  readonly endT: number;
  /** Video time at which the winner is decided. */
  readonly vWinner: number;
  readonly vFinal2: number | null;
  readonly vOutro: number;
  readonly total: number;

  constructor(sim: TimelineInput, opts: { intro: boolean; outro: boolean }) {
    this.intro = opts.intro ? INTRO_SEC : 0;
    this.outro = opts.outro ? OUTRO_SEC : 0;
    this.final2T = sim.final2T;
    this.winnerT = sim.winnerT;
    this.endT = sim.endT;
    this.vFinal2 = sim.final2T === null ? null : this.intro + sim.final2T;
    this.vWinner = this.videoAt(sim.winnerT);
    this.vOutro = this.vWinner + WINNER_HOLD_SEC;
    this.total = this.vOutro + this.outro;
  }

  /** Sim time shown at video time v. */
  simAt(v: number): number {
    const u = v - this.intro;
    if (u <= 0) return 0;
    let t: number;
    if (this.final2T === null || u <= this.final2T) t = u;
    else {
      const w = u - this.final2T;
      t = w <= SLOWMO_SEC ? this.final2T + slowAdvance(w) : this.final2T + slowAdvance(SLOWMO_SEC) + (w - SLOWMO_SEC);
    }
    return Math.min(t, this.endT);
  }

  /** Video time at which sim time t is shown (inverse of simAt). */
  videoAt(t: number): number {
    if (this.final2T === null || t <= this.final2T) return this.intro + t;
    let lo = this.intro + this.final2T;
    let hi = lo + (t - this.final2T) / SLOWMO_MIN + 1e-6;
    for (let i = 0; i < 48; i++) {
      const mid = (lo + hi) / 2;
      if (this.simAtUnclamped(mid) < t) lo = mid;
      else hi = mid;
    }
    return hi;
  }

  private simAtUnclamped(v: number): number {
    const u = v - this.intro;
    if (this.final2T === null || u <= this.final2T) return u;
    const w = u - this.final2T;
    return w <= SLOWMO_SEC ? this.final2T + slowAdvance(w) : this.final2T + slowAdvance(SLOWMO_SEC) + (w - SLOWMO_SEC);
  }

  /** Playback speed factor (1 = normal) at video time v; used for audio and UI. */
  speedAt(v: number): number {
    if (this.vFinal2 === null) return 1;
    const w = v - this.vFinal2;
    if (w <= 0 || w >= SLOWMO_SEC) return 1;
    const a = SLOWMO_RAMP;
    const weight = w < a ? w / a : w > SLOWMO_SEC - a ? (SLOWMO_SEC - w) / a : 1;
    return 1 - SLOW_DEPTH * weight;
  }

  phaseAt(v: number): Phase {
    if (v < this.intro) return 'intro';
    if (v < this.vWinner) return 'battle';
    if (v < this.vOutro) return 'winner';
    return 'outro';
  }
}

/** Video overhead around the battle itself (used by duration tuning). */
export function videoOverhead(opts: { intro: boolean; outro: boolean }, hasFinal2: boolean): number {
  return (opts.intro ? INTRO_SEC : 0) + (hasFinal2 ? SLOWMO_EXTRA : 0) + WINNER_HOLD_SEC + (opts.outro ? OUTRO_SEC : 0);
}
