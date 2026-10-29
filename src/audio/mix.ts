/**
 * Sound-effect mixing (no background music). Cues are derived deterministically from the battle (video-time positions,
 * seeded variant and pitch choice, density capping). The mixer renders any sample range on
 * demand in plain JS, so the exporter can stream audio in chunks inside a worker without ever
 * holding the whole soundtrack in memory.
 */
import { ARENA_R } from '../engine/physics';
import { hashFloat } from '../engine/rng';
import type { Scene } from '../render/scene';
import { SAMPLE_RATE, getSound, type SoundId, type Stereo } from './synth';

export type Cue = { at: number; sound: SoundId; gain: number; rate: number; pan: number };

export type MixSettings = { sfxVolume: number };

const MIN_HIT_GAP = 0.045;
const MAX_HITS_PER_SEC = 14;

export function buildCues(scene: Scene): Cue[] {
  const { timeline, fx, seed, fighters } = scene;
  const cues: Cue[] = [];
  if (timeline.intro > 0) {
    for (const at of [0.15, 0.55, 0.95]) cues.push({ at, sound: 'tick', gain: 0.55, rate: 1, pan: 0 });
    cues.push({ at: timeline.intro - 0.75, sound: 'boom', gain: 0.85, rate: 1, pan: 0 });
  }
  const recent: number[] = [];
  let last = -Infinity;
  for (let k = 0; k < fx.hitT.length; k++) {
    const at = timeline.videoAt(fx.hitT[k]);
    if (at >= timeline.vWinner) break;
    if (at - last < MIN_HIT_GAP) continue;
    while (recent.length && at - recent[0] > 1) recent.shift();
    const f = Math.min(1, fx.hitImpact[k] / 650);
    // Under the density cap, only strong hits get through.
    if (recent.length >= MAX_HITS_PER_SEC && f < 0.7) continue;
    recent.push(at);
    last = at;
    const variant = Math.floor(hashFloat(seed, k, 901) * 5);
    cues.push({
      at,
      sound: `hit${variant}` as SoundId,
      // Bumps are softer in escape mode, where collisions do no damage.
      gain: (0.22 + 0.6 * f) * (scene.result.config.mode === 'escape' ? 0.6 : 1),
      rate: (0.9 + 0.22 * hashFloat(seed, k, 902)) * timeline.speedAt(at),
      pan: Math.max(-0.6, Math.min(0.6, (fx.hitX[k] / ARENA_R) * 0.6)),
    });
  }
  for (const e of fx.elims) {
    const at = timeline.videoAt(e.t);
    cues.push({
      at,
      sound: e.escaped ? 'exit' : 'elim',
      gain: e.escaped ? 0.75 : 0.85,
      rate: 0.95 + 0.1 * hashFloat(seed, e.i, 903),
      pan: (e.x / ARENA_R) * 0.4,
    });
  }
  if (timeline.vFinal2 !== null)
    cues.push({ at: timeline.vFinal2 + 0.05, sound: 'whoosh', gain: 0.7, rate: 1, pan: 0 });
  if (fighters.length > 1)
    cues.push({ at: timeline.vWinner + 0.45, sound: 'fanfare', gain: 0.8, rate: 1, pan: 0 });
  return cues.sort((a, b) => a.at - b.at);
}

export class Mixer {
  private readonly cues: Cue[];
  private maxCueLen = 0;

  /** Pass the scene of a Flag Battle, or ready-made cues for any other game. */
  constructor(
    scene: Scene | null,
    private readonly settings: MixSettings,
    cues?: Cue[],
  ) {
    this.cues = cues ?? buildCues(scene!);
    for (const c of this.cues) this.maxCueLen = Math.max(this.maxCueLen, getSound(c.sound).length / c.rate);
  }

  /** Renders [start, start + frames) at 48 kHz into planar stereo buffers. */
  render(start: number, frames: number): Stereo {
    const L = new Float32Array(frames);
    const R = new Float32Array(frames);
    const { sfxVolume } = this.settings;

    if (sfxVolume > 0) {
      const endFrame = start + frames;
      const fromTime = (start - this.maxCueLen) / SAMPLE_RATE;
      let lo = 0;
      let hi = this.cues.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (this.cues[mid].at < fromTime) lo = mid + 1;
        else hi = mid;
      }
      for (let c = lo; c < this.cues.length; c++) {
        const cue = this.cues[c];
        const cs = Math.round(cue.at * SAMPLE_RATE);
        if (cs >= endFrame) break;
        const src = getSound(cue.sound);
        const len = Math.floor((src.length - 1) / cue.rate);
        if (cs + len <= start) continue;
        const gl = Math.cos(((cue.pan + 1) * Math.PI) / 4) * cue.gain * sfxVolume * 1.2;
        const gr = Math.sin(((cue.pan + 1) * Math.PI) / 4) * cue.gain * sfxVolume * 1.2;
        const i0 = Math.max(0, cs - start);
        const i1 = Math.min(frames, cs + len - start);
        for (let i = i0; i < i1; i++) {
          const pos = (start + i - cs) * cue.rate;
          const p0 = pos | 0;
          const v = src[p0] + (src[p0 + 1] - src[p0]) * (pos - p0);
          L[i] += v * gl;
          R[i] += v * gr;
        }
      }
    }

    // Soft limiter.
    for (let i = 0; i < frames; i++) {
      L[i] = soft(L[i]);
      R[i] = soft(R[i]);
    }
    return { L, R };
  }
}

function soft(x: number): number {
  const a = Math.abs(x);
  if (a <= 0.8) return x;
  return Math.sign(x) * (0.8 + 0.2 * Math.tanh((a - 0.8) / 0.2));
}
