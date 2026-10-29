/**
 * Sound cues for Paper Land, derived deterministically from the recorded show: a marimba
 * countdown, a marimba note on every claim (bigger claims ring higher, and stolen land adds a
 * fifth on top), a scissor snip when a flag is cut, a ticking marimba over the last five seconds,
 * and marimba runs for heat winners and the winner. No drums.
 */
import type { PaperScene } from '../render/paper/scene';
import type { Cue } from './mix';
import { phrase, rateOf } from './phrase';

const MIN_GAP = 0.05;
const MAX_PER_SEC = 10;
/** Major pentatonic, low to high: small claims sit low, big ones ring out. */
const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];
const BASE = -12;

export function buildPaperCues(scene: PaperScene): Cue[] {
  const { timeline, result } = scene;
  const cues: Cue[] = [];
  if (timeline.intro > 0) {
    [0, 2, 4].forEach((s, k) =>
      cues.push({ at: 0.2 + k * 0.5, sound: 'marimba', gain: 0.5, rate: rateOf(s - 5), pan: 0 }),
    );
    cues.push(...phrase(1.7, 'marimba', [2, 7], 0, 0.5));
  }
  const last = result.rounds.length - 1;
  result.rounds.forEach((round, k) => {
    const off = result.offsets[k];
    const size = round.config.size;
    const recent: number[] = [];
    let prev = -Infinity;
    for (const ev of round.events) {
      if (ev.t > round.winnerT) break;
      const at = timeline.videoAt(off + ev.t);
      const speed = timeline.speedAt(at);
      const pan = Math.max(-0.6, Math.min(0.6, (ev.x / size - 0.5) * 1.2));
      if (ev.type === 'cut') {
        cues.push({ at, sound: 'snip', gain: 0.75, rate: speed, pan });
        cues.push({ at: at + 0.02, sound: 'marimba', gain: 0.35, rate: rateOf(-17) * speed, pan });
        continue;
      }
      if (at - prev < MIN_GAP) continue;
      while (recent.length && at - recent[0] > 1) recent.shift();
      // A claim of 3% of the board rings the highest note.
      const f = Math.min(1, ev.cells / (size * size * 0.03));
      if (recent.length >= MAX_PER_SEC && f < 0.5) continue;
      recent.push(at);
      prev = at;
      const semis = BASE + SCALE[Math.min(SCALE.length - 1, Math.floor(f * SCALE.length))];
      cues.push({ at, sound: 'marimba', gain: 0.22 + 0.35 * f, rate: rateOf(semis) * speed, pan });
      if (ev.stolen > 3)
        cues.push({
          at: at + 0.06,
          sound: 'marimba',
          gain: 0.2 + 0.2 * f,
          rate: rateOf(semis + 7) * speed,
          pan,
        });
    }
    // The clock's last five seconds tick on a high bar.
    if (!round.lastStanding)
      for (let s = 5; s >= 1; s--) {
        const at = timeline.videoAt(off + round.config.limit - s);
        cues.push({ at, sound: 'marimba', gain: 0.28, rate: rateOf(s === 1 ? 12 : 7), pan: 0 });
      }
    if (k < last)
      cues.push(...phrase(timeline.videoAt(off + round.winnerT), 'marimba', [0, 4, 7], 0.09, 0.5));
  });
  // A run up two octaves, then a chord.
  cues.push(...phrase(timeline.vWinner, 'marimba', [0, 4, 7, 12, 16, 19], 0.08, 0.5));
  cues.push(...phrase(timeline.vWinner + 0.56, 'marimba', [12, 16, 19, 24], 0, 0.4));
  return cues.sort((a, b) => a.at - b.at);
}
