/**
 * Sound cues for Growing Ball, derived deterministically from the recorded show: a rising bloop
 * countdown, a water-drop bloop on every growing bounce whose note drops along a pentatonic scale
 * as the ball gets bigger, soft rubbery boings when balls bump, and bubbly bloop runs for heat
 * winners and the winner. No drums.
 */
import { ARENA, END_FILL } from '../engine/grow/sim';
import { hashFloat } from '../engine/rng';
import type { GrowScene } from '../render/grow/scene';
import type { Cue } from './mix';
import { phrase, rateOf } from './phrase';

const MIN_GAP = 0.05;
const MAX_PER_SEC = 12;
/** Major pentatonic, high to low: small balls ting high, big balls ring low. */
const SCALE = [21, 19, 16, 14, 12, 9, 7, 4, 2, 0];
const BASE = -7;

export function buildGrowCues(scene: GrowScene): Cue[] {
  const { timeline, result, seed } = scene;
  const cues: Cue[] = [];
  if (timeline.intro > 0) {
    // Three rising bloops, then GO an octave up.
    [0, 2, 4].forEach((s, k) =>
      cues.push({ at: 0.2 + k * 0.5, sound: 'bloop', gain: 0.55, rate: rateOf(s), pan: 0 }),
    );
    cues.push(...phrase(1.7, 'bloop', [7, 12], 0.06, 0.6));
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
        // Rubber balls bumping: a short, high, soft boing.
        cues.push({
          at,
          sound: 'boing',
          gain: 0.08 + 0.22 * f,
          rate: (1.5 + 0.3 * hashFloat(seed, e, 944)) * speed,
          pan,
        });
        continue;
      }
      // Bigger ball, deeper note.
      const grown = Math.max(0, Math.min(0.999, (ev.r - r0) / (rBig - r0)));
      const semis = BASE + SCALE[Math.floor(grown * SCALE.length)];
      cues.push({ at, sound: 'bloop', gain: 0.3 + 0.4 * f, rate: rateOf(semis) * speed, pan });
    }
    if (k < last) cues.push(...phrase(timeline.videoAt(off + round.winnerT), 'bloop', [0, 4, 7], 0.09, 0.55));
  });
  // A bubbly run up, then a springy boing to finish.
  cues.push(...phrase(timeline.vWinner, 'bloop', [0, 4, 7, 12, 16, 19], 0.09, 0.55));
  cues.push({ at: timeline.vWinner + 0.62, sound: 'boing', gain: 0.5, rate: 1.2, pan: 0 });
  return cues.sort((a, b) => a.at - b.at);
}
