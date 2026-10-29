/**
 * Sound cues for Growing Ball, derived deterministically from the recorded show: a countdown,
 * a soft "ting" on every growing bounce whose note drops along a pentatonic scale as the ball
 * gets bigger, light clacks when balls bump, a chime for each heat winner and the fanfare.
 * No drums.
 */
import { ARENA, END_FILL } from '../engine/grow/sim';
import { hashFloat } from '../engine/rng';
import type { GrowScene } from '../render/grow/scene';
import type { Cue } from './mix';
import type { SoundId } from './synth';

const MIN_GAP = 0.05;
const MAX_PER_SEC = 12;
/** Major pentatonic, high to low: small balls ting high, big balls ring low. */
const SCALE = [21, 19, 16, 14, 12, 9, 7, 4, 2, 0];
const BASE = -7;

const rateOf = (semis: number) => Math.pow(2, semis / 12);

export function buildGrowCues(scene: GrowScene): Cue[] {
  const { timeline, result, seed } = scene;
  const cues: Cue[] = [];
  if (timeline.intro > 0) {
    for (const at of [0.2, 0.7, 1.2]) cues.push({ at, sound: 'tick', gain: 0.55, rate: 1, pan: 0 });
    cues.push({ at: 1.7, sound: 'ding', gain: 0.75, rate: 1.26, pan: 0 });
  }
  const last = result.rounds.length - 1;
  result.rounds.forEach((round, k) => {
    const off = result.offsets[k];
    const r0 = round.config.r0;
    // About the size of a winner: a fair share of the full arena, plus some.
    const rBig = ARENA * Math.sqrt(END_FILL / round.config.ids.length) * 1.3;
    const recent: number[] = [];
    let prev = -Infinity;
    let e = 0;
    for (const ev of round.events) {
      e++;
      if (ev.t > round.winnerT) break;
      const at = timeline.videoAt(off + ev.t);
      const speed = timeline.speedAt(at);
      const pan = Math.max(-0.6, Math.min(0.6, (ev.x / ARENA) * 0.6));
      if (at - prev < MIN_GAP) continue;
      while (recent.length && at - recent[0] > 1) recent.shift();
      const f = Math.min(1, ev.impulse / 1200);
      if (recent.length >= MAX_PER_SEC && f < 0.6) continue;
      recent.push(at);
      prev = at;
      if (ev.type === 'bump') {
        cues.push({
          at,
          sound: `clack${Math.floor(hashFloat(seed, e, 943) * 3)}` as SoundId,
          gain: 0.1 + 0.3 * f,
          rate: (0.95 + 0.1 * hashFloat(seed, e, 944)) * speed,
          pan,
        });
        continue;
      }
      // Bigger ball, deeper note.
      const grown = Math.max(0, Math.min(0.999, (ev.r - r0) / (rBig - r0)));
      const semis = BASE + SCALE[Math.floor(grown * SCALE.length)];
      cues.push({ at, sound: 'pluck', gain: 0.25 + 0.4 * f, rate: rateOf(semis) * speed, pan });
    }
    if (k < last)
      cues.push({ at: timeline.videoAt(off + round.winnerT), sound: 'ding', gain: 0.75, rate: 1, pan: 0 });
  });
  if (timeline.vFinal2 !== null)
    cues.push({ at: timeline.vFinal2 + 0.05, sound: 'whoosh', gain: 0.6, rate: 1, pan: 0 });
  cues.push({ at: timeline.vWinner, sound: 'ding', gain: 0.8, rate: 1, pan: 0 });
  cues.push({ at: timeline.vWinner + 0.45, sound: 'fanfare', gain: 0.8, rate: 1, pan: 0 });
  return cues.sort((a, b) => a.at - b.at);
}
