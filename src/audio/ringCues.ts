/**
 * Sound cues for Ring Escape, derived deterministically from the recorded show: a countdown,
 * soft "ting" notes on ring bounces that walk up a pentatonic scale (each new ring starts a step
 * higher), light clacks when balls touch, a glassy shatter when a ring breaks, a chime for each
 * heat winner and the fanfare. No drums or booms.
 */
import { hashFloat } from '../engine/rng';
import type { RingsScene } from '../render/rings/scene';
import type { Cue } from './mix';
import type { SoundId } from './synth';

const MIN_GAP = 0.05;
const MAX_PER_SEC = 12;
/** Major pentatonic, in semitones above the base note. */
const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];
/** The pluck sample is an E5; start a fourth lower so the climb stays pleasant. */
const BASE = -5;

const rateOf = (semis: number) => Math.pow(2, semis / 12);

export function buildRingsCues(scene: RingsScene): Cue[] {
  const { timeline, result, seed } = scene;
  const cues: Cue[] = [];
  if (timeline.intro > 0) {
    for (const at of [0.2, 0.7, 1.2]) cues.push({ at, sound: 'tick', gain: 0.55, rate: 1, pan: 0 });
    cues.push({ at: 1.7, sound: 'ding', gain: 0.75, rate: 1.26, pan: 0 });
  }
  const last = result.rounds.length - 1;
  result.rounds.forEach((round, k) => {
    const off = result.offsets[k];
    const outer = round.rings[round.rings.length - 1].R;
    const recent: number[] = [];
    let prev = -Infinity;
    let ring = -1;
    let step = 0;
    let e = 0;
    for (const ev of round.events) {
      e++;
      if (ev.t > round.winnerT) break;
      const at = timeline.videoAt(off + ev.t);
      if (ev.type === 'shatter') {
        cues.push({
          at,
          sound: 'shatter',
          gain: 0.8,
          rate: 0.92 + 0.16 * hashFloat(seed, k * 131 + ev.ring, 921),
          pan: 0,
        });
        continue;
      }
      if (at - prev < MIN_GAP) continue;
      while (recent.length && at - recent[0] > 1) recent.shift();
      const f = Math.min(1, ev.impulse / 1400);
      if (recent.length >= MAX_PER_SEC && f < 0.6) continue;
      recent.push(at);
      prev = at;
      const speed = timeline.speedAt(at);
      const pan = Math.max(-0.6, Math.min(0.6, (ev.x / outer) * 0.6));
      if (ev.kind === 'ball') {
        cues.push({
          at,
          sound: `clack${Math.floor(hashFloat(seed, e, 922) * 3)}` as SoundId,
          gain: 0.08 + 0.3 * f,
          rate: (0.95 + 0.1 * hashFloat(seed, e, 923)) * speed,
          pan,
        });
        continue;
      }
      if (ev.ring !== ring) {
        ring = ev.ring ?? 0;
        step = 0;
      }
      // Each bounce climbs one note; the scale wraps after two octaves.
      const semis = BASE + SCALE[(step + ring) % SCALE.length];
      step++;
      cues.push({
        at,
        sound: 'pluck',
        gain: (ev.kind === 'edge' ? 0.4 : 0.22) + 0.4 * f,
        rate: rateOf(semis) * speed,
        pan,
      });
    }
    const winAt = timeline.videoAt(off + round.winnerT);
    if (k < last) cues.push({ at: winAt, sound: 'ding', gain: 0.75, rate: 1, pan: 0 });
  });
  if (timeline.vFinal2 !== null)
    cues.push({ at: timeline.vFinal2 + 0.05, sound: 'whoosh', gain: 0.6, rate: 1, pan: 0 });
  cues.push({ at: timeline.vWinner, sound: 'ding', gain: 0.8, rate: 1, pan: 0 });
  cues.push({ at: timeline.vWinner + 0.45, sound: 'fanfare', gain: 0.8, rate: 1, pan: 0 });
  return cues.sort((a, b) => a.at - b.at);
}
