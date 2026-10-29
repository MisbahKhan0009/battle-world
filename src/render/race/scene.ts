/**
 * Everything the race renderer needs, derived once from a recorded race: the timeline, a smooth
 * camera path that follows the front of the race, bumper hit times for flashes, and helpers to
 * read positions and the live standings at any moment.
 */
import type { RaceResult } from '../../engine/race/types';
import { Timeline } from '../../engine/timeline';
import type { Look } from '../../engine/types';
import type { ImageSource } from '../canvas';
import type { SceneFighter } from '../scene';

export type RaceScene = {
  result: RaceResult;
  timeline: Timeline;
  look: Look;
  fighters: SceneFighter[];
  winnerImage: ImageSource | null;
  seed: number;
  /** Camera focus (world y at the screen's focus line) per recorded frame. */
  camY: Float32Array;
  /** Hit times per bumper (index into track.pegs). */
  bumperHits: Map<number, number[]>;
  /** When the race front entered the last section (sim seconds), for the "final stretch" banner. */
  finalStretchT: number | null;
};

/** How far below the front the camera looks (world units). */
const LOOK_AHEAD = 260;

export function buildRaceScene(args: {
  result: RaceResult;
  look: Look;
  fighters: SceneFighter[];
  winnerImage?: ImageSource | null;
}): RaceScene {
  const { result } = args;
  const rec = result.rec!;
  const { n, frames, hz, data } = rec;
  const { track } = result;

  // Raw target: mostly the leader, partly the chasing pack; after the win, the finish area.
  const raw = new Float32Array(frames);
  const ys: number[] = new Array(n);
  let stretch: number | null = null;
  const lastSection = track.sections[track.sections.length - 1];
  for (let f = 0; f < frames; f++) {
    const t = f / hz;
    for (let i = 0; i < n; i++) ys[i] = data[(f * n + i) * 3 + 1];
    const sorted = [...ys].sort((a, b) => b - a);
    const lead = sorted[0];
    const pack = sorted[Math.min(n - 1, 3)];
    if (stretch === null && lastSection && lead >= lastSection.y0) stretch = t;
    raw[f] = t >= result.winnerT ? track.finishY + 120 : Math.max(0, 0.7 * lead + 0.3 * pack + LOOK_AHEAD);
  }
  // Zero-phase smoothing (forward then backward), so the camera eases without lagging.
  const a = 1 - Math.exp(-1 / (hz * 0.45));
  const cam = Float32Array.from(raw);
  for (let f = 1; f < frames; f++) cam[f] = cam[f - 1] + (cam[f] - cam[f - 1]) * a;
  for (let f = frames - 2; f >= 0; f--) cam[f] = cam[f + 1] + (cam[f] - cam[f + 1]) * a;

  const bumperHits = new Map<number, number[]>();
  for (const e of result.events) {
    if (e.type === 'hit' && e.kind === 'bumper' && e.obstacle !== undefined) {
      const list = bumperHits.get(e.obstacle) ?? [];
      list.push(e.t);
      bumperHits.set(e.obstacle, list);
    }
  }

  return {
    result,
    look: args.look,
    fighters: args.fighters,
    winnerImage: args.winnerImage ?? null,
    seed: result.config.seed,
    timeline: new Timeline(result, { intro: args.look.intro, outro: args.look.outro }),
    camY: cam,
    bumperHits,
    finalStretchT: stretch !== null && stretch < result.winnerT - 1.5 ? stretch : null,
  };
}

/** Interpolated x, y, angle of marble i at sim time t. */
export function marbleAt(scene: RaceScene, i: number, t: number): [number, number, number] {
  const { data, frames, n, hz } = scene.result.rec!;
  const f = Math.max(0, Math.min(frames - 1, t * hz));
  const f0 = Math.floor(f);
  const f1 = Math.min(frames - 1, f0 + 1);
  const a = f - f0;
  const o0 = (f0 * n + i) * 3;
  const o1 = (f1 * n + i) * 3;
  return [
    data[o0] + (data[o1] - data[o0]) * a,
    data[o0 + 1] + (data[o1 + 1] - data[o0 + 1]) * a,
    data[o0 + 2] + (data[o1 + 2] - data[o0 + 2]) * a,
  ];
}

export function cameraAt(scene: RaceScene, t: number): number {
  const { camY, result } = scene;
  const hz = result.rec!.hz;
  const f = Math.max(0, Math.min(camY.length - 1, t * hz));
  const f0 = Math.floor(f);
  const f1 = Math.min(camY.length - 1, f0 + 1);
  return camY[f0] + (camY[f1] - camY[f0]) * (f - f0);
}

/** Standings at sim time t: finishers by time, then everyone else by how far down they are. */
export function standingsAt(scene: RaceScene, t: number): number[] {
  const { finishT } = scene.result;
  const n = scene.fighters.length;
  const ys = Array.from({ length: n }, (_, i) => marbleAt(scene, i, t)[1]);
  return Array.from({ length: n }, (_, i) => i).sort((a, b) => {
    const fa = finishT[a] <= t ? finishT[a] : Infinity;
    const fb = finishT[b] <= t ? finishT[b] : Infinity;
    if (fa !== fb) return fa - fb;
    return ys[b] - ys[a] || a - b;
  });
}
