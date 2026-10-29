/**
 * Everything the Ring Escape renderer needs, derived once from a recorded show: the video
 * timeline over all rounds, a smooth camera per round, and helpers to read ball positions, the
 * current ring and rings broken per flag at any moment.
 */
import type { RingsShowResult } from '../../engine/rings/show';
import { roundAt } from '../../engine/rings/show';
import type { Ring, RingsResult } from '../../engine/rings/types';
import { Timeline } from '../../engine/timeline';
import type { Look } from '../../engine/types';
import type { ImageSource } from '../canvas';
import type { SceneFighter } from '../scene';

export type RingsScene = {
  result: RingsShowResult;
  timeline: Timeline;
  look: Look;
  fighters: SceneFighter[];
  winnerImage: ImageSource | null;
  seed: number;
  /** Smoothed center of the balls and the radius around it that holds them all, per recorded frame and round ([frame][x, y, spread]). */
  cam: Float32Array[];
};

export function buildRingsScene(args: {
  result: RingsShowResult;
  look: Look;
  fighters: SceneFighter[];
  winnerImage?: ImageSource | null;
}): RingsScene {
  const { result } = args;
  const cam = result.rounds.map((round) => {
    const { n, frames, hz, data } = round.rec!;
    const r = round.config.radius;
    const out = new Float32Array(frames * 3);
    for (let f = 0; f < frames; f++) {
      // Once the winner is out, settle back on the middle.
      if (f / hz >= round.winnerT) {
        out[f * 3 + 2] = out[(f - 1) * 3 + 2] || r * 12;
        continue;
      }
      let sx = 0;
      let sy = 0;
      for (let i = 0; i < n; i++) {
        sx += data[(f * n + i) * 2];
        sy += data[(f * n + i) * 2 + 1];
      }
      const cx = sx / n;
      const cy = sy / n;
      let spread = 0;
      for (let i = 0; i < n; i++)
        spread = Math.max(spread, Math.hypot(data[(f * n + i) * 2] - cx, data[(f * n + i) * 2 + 1] - cy));
      out[f * 3] = cx;
      out[f * 3 + 1] = cy;
      out[f * 3 + 2] = spread + r * 2.5;
    }
    // Zero-phase smoothing so the camera eases without lagging. The zoom keeps the widest
    // nearby spread, so nobody slips off screen while it eases.
    const a = 1 - Math.exp(-1 / (hz * 0.6));
    const win = Math.round(hz * 0.5);
    const raw = out.slice();
    for (let f = 0; f < frames; f++) {
      let m = 0;
      for (let g = Math.max(0, f - win); g <= Math.min(frames - 1, f + win); g++)
        m = Math.max(m, raw[g * 3 + 2]);
      out[f * 3 + 2] = m;
    }
    for (const o of [0, 1, 2]) {
      for (let f = 1; f < frames; f++) out[f * 3 + o] += (out[(f - 1) * 3 + o] - out[f * 3 + o]) * (1 - a);
      for (let f = frames - 2; f >= 0; f--)
        out[f * 3 + o] += (out[(f + 1) * 3 + o] - out[f * 3 + o]) * (1 - a);
    }
    return out;
  });
  return {
    result,
    look: args.look,
    fighters: args.fighters,
    winnerImage: args.winnerImage ?? null,
    seed: result.show.rounds[0].seed,
    timeline: new Timeline(result, { intro: args.look.intro, outro: args.look.outro }),
    cam,
  };
}

/** Round on screen at video-wide sim time t. */
export function roundOf(scene: RingsScene, t: number): { k: number; local: number; round: RingsResult } {
  const { k, local } = roundAt(scene.result, t);
  return { k, local, round: scene.result.rounds[k] };
}

const lerpFrame = (arr: Float32Array, stride: number, o: number, frames: number, f: number) => {
  const f0 = Math.floor(f);
  const f1 = Math.min(frames - 1, f0 + 1);
  const a = f - f0;
  return arr[f0 * stride + o] + (arr[f1 * stride + o] - arr[f0 * stride + o]) * a;
};

/** Interpolated x, y of ball i of a round at its local time. */
export function ballAt(round: RingsResult, i: number, local: number): [number, number] {
  const { data, frames, n, hz } = round.rec!;
  const f = Math.max(0, Math.min(frames - 1, local * hz));
  return [lerpFrame(data, n * 2, i * 2, frames, f), lerpFrame(data, n * 2, i * 2 + 1, frames, f)];
}

/** Camera center and the view radius that keeps every ball in the picture. */
export function camAt(scene: RingsScene, k: number, local: number): [number, number, number] {
  const round = scene.result.rounds[k];
  const { frames, hz } = round.rec!;
  const f = Math.max(0, Math.min(frames - 1, local * hz));
  const c = scene.cam[k];
  return [lerpFrame(c, 3, 0, frames, f), lerpFrame(c, 3, 1, frames, f), lerpFrame(c, 3, 2, frames, f)];
}

/** Rings broken so far, and the index of the ring the balls are in (rings.length once out). */
export function brokenAt(round: RingsResult, local: number): number {
  let c = 0;
  while (c < round.shatterT.length && round.shatterT[c] <= local) c++;
  return Math.min(c, round.rings.length);
}

/** Rings each ball of a round has broken by its local time. */
export function breaksAt(round: RingsResult, local: number): number[] {
  const out = new Array<number>(round.config.ids.length).fill(0);
  for (let k = 0; k < round.shatterT.length && round.shatterT[k] <= local; k++) out[round.shatterBy[k]]++;
  return out;
}

/** Gap center angle of a ring at local time (same formula as the physics). */
export const gapAngle = (ring: Ring, local: number) => ring.phase + ring.omega * local;
