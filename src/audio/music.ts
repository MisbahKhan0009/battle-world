/**
 * Music instead of the game sounds: one track (from the user's music folder, e.g. YouTube's Audio
 * Library) plays under the whole video. It fades in, loops with a crossfade when the video is
 * longer than the track, and fades out over the last seconds. Same render interface as the Mixer.
 */
import { SAMPLE_RATE, type Stereo } from './synth';

/** A decoded track: planar stereo at SAMPLE_RATE. */
export type MusicBed = { L: Float32Array; R: Float32Array };

const FADE_IN = 0.4;
const FADE_OUT = 2.5;
/** Overlap when a short track loops. */
const LOOP_XF = 1.5;

export class MusicMix {
  private readonly total: number;
  private readonly period: number;
  private readonly xf: number;

  constructor(
    private readonly bed: MusicBed,
    totalSec: number,
    private readonly volume: number,
  ) {
    this.total = Math.round(totalSec * SAMPLE_RATE);
    const n = bed.L.length;
    this.xf = Math.min(Math.round(LOOP_XF * SAMPLE_RATE), Math.floor(n / 4));
    this.period = Math.max(1, n - this.xf);
  }

  /** The track's sample for video sample i, looping with a crossfade. */
  private at(ch: Float32Array, i: number): number {
    const { period, xf } = this;
    if (i < ch.length && i < period) return ch[i];
    const k = Math.floor(i / period);
    const j = i - k * period;
    if (j >= xf) return ch[j];
    // The start of this pass fades in over the tail of the previous one.
    const a = j / xf;
    return ch[j] * a + ch[period + j] * (1 - a);
  }

  render(start: number, frames: number): Stereo {
    const L = new Float32Array(frames);
    const R = new Float32Array(frames);
    const fin = FADE_IN * SAMPLE_RATE;
    const fout = FADE_OUT * SAMPLE_RATE;
    for (let f = 0; f < frames; f++) {
      const i = start + f;
      if (i >= this.total || this.bed.L.length === 0) break;
      const g = this.volume * Math.min(1, i / fin, (this.total - i) / fout);
      L[f] = this.at(this.bed.L, i) * g;
      R[f] = this.at(this.bed.R, i) * g;
    }
    return { L, R };
  }
}
