/**
 * Sound cues for Black Hole, derived deterministically from the recorded show: a gulp countdown,
 * a gulp for every thing that falls in (small things pop high, towers drop low along a pentatonic
 * scale), a deep whomp when a hole swallows a hole, soft high gulps over the clock's last five
 * seconds, and gulp runs for heat winners and the winner. No drums.
 */
import type { BlackScene } from '../render/black/scene';
import type { Cue } from './mix';
import { phrase, rateOf } from './phrase';

const MIN_GAP = 0.045;
const MAX_PER_SEC = 12;
/** Major pentatonic, high to low: small things pop high, big ones go down deep. */
const SCALE = [16, 14, 12, 9, 7, 4, 2, 0, -3, -5];
/** Object size (bounding radius) that rings the lowest note. */
const BIG = 75;

export function buildBlackCues(scene: BlackScene): Cue[] {
  const { timeline, result } = scene;
  const cues: Cue[] = [];
  if (timeline.intro > 0) {
    [0, 2, 4].forEach((s, k) =>
      cues.push({ at: 0.2 + k * 0.5, sound: 'gulp', gain: 0.5, rate: rateOf(s), pan: 0 }),
    );
    cues.push(...phrase(1.7, 'gulp', [7, 12], 0.06, 0.55));
  }
  const last = result.rounds.length - 1;
  result.rounds.forEach((round, k) => {
    const off = result.offsets[k];
    const S = round.city.size;
    const recent: number[] = [];
    let prev = -Infinity;
    for (const ev of round.events) {
      if (ev.t > round.winnerT) break;
      const at = timeline.videoAt(off + ev.t);
      const speed = timeline.speedAt(at);
      if (ev.type === 'swallow') {
        const pan = Math.max(-0.6, Math.min(0.6, (ev.x / S - 0.5) * 1.2));
        cues.push({ at, sound: 'whomp', gain: 0.85, rate: speed, pan });
        cues.push({ at: at + 0.05, sound: 'gulp', gain: 0.4, rate: rateOf(-12) * speed, pan });
        continue;
      }
      const o = round.city.objects[ev.o];
      const pan = Math.max(-0.6, Math.min(0.6, (o.x / S - 0.5) * 1.2));
      const f = Math.min(1, o.s / BIG);
      if (at - prev < MIN_GAP && f < 0.5) continue;
      while (recent.length && at - recent[0] > 1) recent.shift();
      if (recent.length >= MAX_PER_SEC && f < 0.4) continue;
      recent.push(at);
      prev = at;
      const semis = SCALE[Math.min(SCALE.length - 1, Math.floor(f * SCALE.length))];
      cues.push({ at, sound: 'gulp', gain: 0.18 + 0.5 * f, rate: rateOf(semis) * speed, pan });
    }
    // The clock's last five seconds.
    if (!round.lastStanding)
      for (let s = 5; s >= 1; s--) {
        const at = timeline.videoAt(off + round.config.limit - s);
        cues.push({ at, sound: 'gulp', gain: 0.3, rate: rateOf(s === 1 ? 19 : 14), pan: 0 });
      }
    if (k < last) cues.push(...phrase(timeline.videoAt(off + round.winnerT), 'gulp', [0, 4, 7], 0.09, 0.55));
  });
  // A run up, then the deep whomp.
  cues.push(...phrase(timeline.vWinner, 'gulp', [0, 4, 7, 12, 16, 19], 0.08, 0.5));
  cues.push({ at: timeline.vWinner + 0.56, sound: 'whomp', gain: 0.6, rate: 1, pan: 0 });
  return cues.sort((a, b) => a.at - b.at);
}
