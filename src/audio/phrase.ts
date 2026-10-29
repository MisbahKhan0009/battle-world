/** Small helpers for building a game's musical cues from one of its voices. */
import type { Cue } from './mix';
import type { SoundId } from './synth';

/** Playback rate for a pitch shift in semitones. */
export const rateOf = (semis: number) => Math.pow(2, semis / 12);

/** A run of notes on one voice, `step` seconds apart (0 = a chord). */
export function phrase(at: number, sound: SoundId, semis: number[], step: number, gain: number): Cue[] {
  return semis.map((s, k) => ({ at: at + k * step, sound, gain, rate: rateOf(s), pan: 0 }));
}
