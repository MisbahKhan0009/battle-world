/**
 * Sound cues for Territory Wars, derived deterministically from the recorded war: a war-drum
 * countdown with a horn on GO, drums that roll louder the more land changes hands, a deep drum and
 * a falling horn when a country falls, a horn call for a new leader and a rising one for a rally,
 * and a horn fanfare over the drums for the winner.
 */
import { hashFloat } from '../engine/rng';
import type { TerritoryScene } from '../render/territory/scene';
import type { Cue } from './mix';
import { phrase, rateOf } from './phrase';

/** Battle drums are counted in windows of this many video seconds. */
const WINDOW = 0.2;

export function buildTerritoryCues(scene: TerritoryScene): Cue[] {
  const { timeline, round, moments, seed } = scene;
  const cues: Cue[] = [];
  if (timeline.intro > 0) {
    [0, 1, 2].forEach((k) =>
      cues.push({ at: 0.2 + k * 0.5, sound: 'wardrum', gain: 0.6, rate: 1 + k * 0.06, pan: 0 }),
    );
    cues.push({ at: 1.7, sound: 'wardrum', gain: 0.75, rate: 0.85, pan: 0 });
    cues.push({ at: 1.7, sound: 'horn', gain: 0.45, rate: 1, pan: 0 });
  }
  // Fighting: land taken from rivals per window sets how hard the drums hit.
  const { taken } = round.rec!;
  const rate = round.config.rate;
  const busy = Math.max(2, round.total * 0.0015);
  let win = -1;
  let sum = 0;
  const flush = () => {
    if (win < 0 || sum < busy) return;
    const at = win * WINDOW;
    const f = Math.min(1, sum / (busy * 6));
    cues.push({
      at,
      sound: 'wardrum',
      gain: 0.12 + 0.33 * f,
      rate: (1.05 + 0.25 * hashFloat(seed, win, 0x7d1) - 0.15 * f) * timeline.speedAt(at),
      pan: (hashFloat(seed, win, 0x7d2) - 0.5) * 0.8,
    });
  };
  for (let g = 1; g < taken.length; g++) {
    const t = g / rate;
    if (t > round.winnerT) break;
    const w = Math.floor(timeline.videoAt(t) / WINDOW);
    if (w !== win) {
      flush();
      win = w;
      sum = 0;
    }
    sum += taken[g];
  }
  flush();
  for (const m of moments) {
    const at = timeline.videoAt(m.t);
    const speed = timeline.speedAt(at);
    if (m.kind === 'out') {
      cues.push({ at, sound: 'wardrum', gain: 0.85, rate: 0.72 * speed, pan: 0 });
      cues.push({ at: at + 0.05, sound: 'horn', gain: 0.32, rate: rateOf(-5) * speed, pan: 0 });
      cues.push({ at: at + 0.3, sound: 'horn', gain: 0.28, rate: rateOf(-10) * speed, pan: 0 });
    } else if (m.kind === 'lead') {
      cues.push({ at, sound: 'horn', gain: 0.3, rate: rateOf(0) * speed, pan: 0 });
      cues.push({ at: at + 0.16, sound: 'horn', gain: 0.32, rate: rateOf(5) * speed, pan: 0 });
    } else {
      cues.push(...phrase(at, 'horn', [0, 4, 7], 0.11, 0.3));
      cues.push({ at, sound: 'wardrum', gain: 0.5, rate: 1.1 * speed, pan: 0 });
    }
  }
  // Fanfare over a drum roll.
  cues.push(...phrase(timeline.vWinner, 'horn', [0, 4, 7, 12], 0.14, 0.42));
  cues.push(...phrase(timeline.vWinner + 0.56, 'horn', [0, 7, 12], 0, 0.32));
  for (let k = 0; k < 6; k++)
    cues.push({
      at: timeline.vWinner + k * 0.1,
      sound: 'wardrum',
      gain: 0.35 + k * 0.08,
      rate: 1 + k * 0.02,
      pan: 0,
    });
  return cues.sort((a, b) => a.at - b.at);
}
