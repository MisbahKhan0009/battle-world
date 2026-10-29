/**
 * Sound cues for a Marble Race, derived deterministically from the recorded race: countdown,
 * glassy clacks when marbles knock together, thuds on the track, bumper boings, a chime for
 * each podium finisher and the winner fanfare. Density is capped so big fields stay pleasant.
 */
import { TRACK_W } from '../engine/race/track';
import { hashFloat } from '../engine/rng';
import type { RaceScene } from '../render/race/scene';
import type { Cue } from './mix';
import type { SoundId } from './synth';

const MIN_GAP = 0.035;
const MAX_PER_SEC = 16;

export function buildRaceCues(scene: RaceScene): Cue[] {
  const { timeline, result, seed } = scene;
  const cues: Cue[] = [];
  if (timeline.intro > 0) {
    for (const at of [0.2, 0.7, 1.2]) cues.push({ at, sound: 'tick', gain: 0.55, rate: 1, pan: 0 });
    cues.push({ at: 1.7, sound: 'boom', gain: 0.75, rate: 1.15, pan: 0 });
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
      cues.push({ at, sound: 'boing', gain: 0.5, rate: 0.9 + 0.25 * hashFloat(seed, k, 911), pan });
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
      const v = Math.floor(hashFloat(seed, k, 914) * 5);
      cues.push({
        at,
        sound: `hit${v}` as SoundId,
        gain: (e.kind === 'spinner' ? 0.35 : 0.12) + 0.4 * f,
        rate: (1.25 + 0.3 * hashFloat(seed, k, 915)) * speed,
        pan,
      });
    }
  }
  for (const e of result.events) {
    if (e.type !== 'finish' || e.place > 3) continue;
    const at = timeline.videoAt(e.t);
    if (at >= timeline.vOutro) continue;
    cues.push({ at, sound: 'ding', gain: e.place === 1 ? 0.8 : 0.5, rate: e.place === 1 ? 1 : 0.84, pan: 0 });
  }
  if (timeline.vFinal2 !== null)
    cues.push({ at: timeline.vFinal2 + 0.05, sound: 'whoosh', gain: 0.7, rate: 1, pan: 0 });
  cues.push({ at: timeline.vWinner + 0.45, sound: 'fanfare', gain: 0.8, rate: 1, pan: 0 });
  return cues.sort((a, b) => a.at - b.at);
}
