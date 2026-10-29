/**
 * Sound cues for a Marble Race, derived deterministically from the recorded race: start-light
 * beeps, glassy clacks when marbles knock together, dry wooden clicks on the track, pegs and
 * spinners, a lower glass knock on bumpers, a ratchet into the photo finish, and a tubular bell
 * for the winner with a bell arpeggio. No drum-like thuds. Density is capped so big fields stay
 * pleasant.
 */
import { TRACK_W } from '../engine/race/track';
import { hashFloat } from '../engine/rng';
import type { RaceScene } from '../render/race/scene';
import type { Cue } from './mix';
import { phrase } from './phrase';
import type { SoundId } from './synth';

const MIN_GAP = 0.035;
const MAX_PER_SEC = 16;

export function buildRaceCues(scene: RaceScene): Cue[] {
  const { timeline, result, seed } = scene;
  const cues: Cue[] = [];
  if (timeline.intro > 0) {
    // Start lights: three low beeps, then GO an octave up.
    for (const at of [0.2, 0.7, 1.2]) cues.push({ at, sound: 'beep', gain: 0.5, rate: 1, pan: 0 });
    cues.push({ at: 1.7, sound: 'beep', gain: 0.6, rate: 2, pan: 0 });
  }
  const recent: number[] = [];
  let last = -Infinity;
  let k = 0;
  for (const e of result.events) {
    if (e.type !== 'hit') continue;
    k++;
    const at = timeline.videoAt(e.t);
    if (at >= timeline.vOutro) break;
    const pan = Math.max(-0.6, Math.min(0.6, (e.x / TRACK_W - 0.5) * 1.2));
    if (e.kind === 'bumper') {
      cues.push({
        at,
        sound: `clack${Math.floor(hashFloat(seed, k, 910) * 3)}` as SoundId,
        gain: 0.55,
        rate: 0.62 + 0.12 * hashFloat(seed, k, 911),
        pan,
      });
      continue;
    }
    if (at - last < MIN_GAP) continue;
    while (recent.length && at - recent[0] > 1) recent.shift();
    const f = Math.min(1, e.impulse / 700);
    if (recent.length >= MAX_PER_SEC && f < 0.6) continue;
    recent.push(at);
    last = at;
    const speed = timeline.speedAt(at);
    if (e.kind === 'marble') {
      const v = Math.floor(hashFloat(seed, k, 912) * 3);
      cues.push({
        at,
        sound: `clack${v}` as SoundId,
        gain: 0.12 + 0.45 * f,
        rate: (0.92 + 0.16 * hashFloat(seed, k, 913)) * speed,
        pan,
      });
    } else {
      const v = Math.floor(hashFloat(seed, k, 914) * 3);
      cues.push({
        at,
        sound: `tock${v}` as SoundId,
        gain: (e.kind === 'spinner' ? 0.38 : 0.16) + 0.5 * f,
        rate: (0.9 + 0.25 * hashFloat(seed, k, 915)) * speed,
        pan,
      });
    }
  }
  // Photo finish: a wooden ratchet that speeds up into the slow motion.
  if (timeline.vFinal2 !== null) {
    let at = timeline.vFinal2;
    for (let k = 0; k < 14; k++, at += 0.11 * Math.pow(0.86, k))
      cues.push({ at, sound: `tock${k % 3}` as SoundId, gain: 0.3 + k * 0.02, rate: 1.1 + k * 0.03, pan: 0 });
  }
  // Only the winner gets the bell (no 2nd or 3rd place), then a bell arpeggio and chord.
  cues.push({ at: timeline.vWinner, sound: 'bell', gain: 0.75, rate: 1, pan: 0 });
  cues.push(...phrase(timeline.vWinner + 0.5, 'bell', [0, 4, 7, 12], 0.16, 0.5));
  cues.push(...phrase(timeline.vWinner + 1.2, 'bell', [0, 7, 12], 0, 0.42));
  return cues.sort((a, b) => a.at - b.at);
}
