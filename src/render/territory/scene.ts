/**
 * Everything the Territory Wars renderer needs, derived once from a recorded war: the video
 * timeline, the map, one solid color per country (borders and the board), and the banner moments
 * (falls, new leaders, comebacks) spaced so they never pile up. Helpers read each country's size
 * and countryball spot at any moment.
 */
import { buildMap, type TerritoryMap } from '../../engine/territory/map';
import type { TerritoryShowResult } from '../../engine/territory/show';
import type { TerritoryResult } from '../../engine/territory/types';
import { Timeline } from '../../engine/timeline';
import type { Look } from '../../engine/types';
import type { ImageSource } from '../canvas';
import { assignColors } from '../paper/scene';
import type { SceneFighter } from '../scene';

export type Moment = { t: number; kind: 'out' | 'lead' | 'surge'; i: number; life: number };

export type TerritoryScene = {
  result: TerritoryShowResult;
  round: TerritoryResult;
  map: TerritoryMap;
  timeline: Timeline;
  look: Look;
  fighters: SceneFighter[];
  winnerImage: ImageSource | null;
  seed: number;
  colors: string[];
  /** Banner moments in time order (each shown for `life` seconds). */
  moments: Moment[];
  /** When each country fell (Infinity if it never did). */
  outT: number[];
};

/** Banners show this long, or until the next one. */
const LIFE = 1.4;
/** Comebacks and new leaders only show after the opening land grab. */
const OPENING = 3;

export function buildTerritoryScene(args: {
  result: TerritoryShowResult;
  look: Look;
  fighters: SceneFighter[];
  winnerImage?: ImageSource | null;
}): TerritoryScene {
  const { result } = args;
  const round = result.rounds[0];
  const n = round.config.ids.length;
  const outT = Array.from({ length: n }, () => Infinity);
  const raw: Moment[] = [];
  let lastSurge = -Infinity;
  for (const e of round.events) {
    if (e.t > round.winnerT) break;
    if (e.type === 'out') {
      outT[e.i] = e.t;
      raw.push({ t: e.t, kind: 'out', i: e.i, life: LIFE });
    } else if (e.type === 'lead' && e.t > OPENING) raw.push({ t: e.t, kind: 'lead', i: e.i, life: LIFE });
    else if (e.type === 'surge' && e.t > OPENING && e.t - lastSurge > 6) {
      lastSurge = e.t;
      raw.push({ t: e.t, kind: 'surge', i: e.i, life: LIFE });
    }
  }
  // Falls always show; the others only when nothing else is on screen.
  const moments: Moment[] = [];
  for (const m of raw) {
    const prev = moments[moments.length - 1];
    if (prev && m.t - prev.t < LIFE * 0.6 && m.kind !== 'out') continue;
    if (prev) prev.life = Math.min(prev.life, m.t - prev.t);
    moments.push({ ...m });
  }
  return {
    result,
    round,
    map: buildMap(round.config.isos),
    look: args.look,
    fighters: args.fighters,
    winnerImage: args.winnerImage ?? null,
    seed: round.config.seed,
    timeline: new Timeline(result, { intro: args.look.intro, outro: args.look.outro }),
    colors: assignColors(args.fighters, result.show.entrants),
    moments,
    outT,
  };
}

/** Recorded tick at sim time t (frozen once the war is over). */
export function tickAt(scene: TerritoryScene, t: number): number {
  const { rec, config } = scene.round;
  return Math.max(0, Math.min(rec!.ticks - 1, Math.floor(t * config.rate)));
}

/** Cells each country holds at sim time t. */
export function landAt(scene: TerritoryScene, t: number): number[] {
  const { stats, n } = scene.round.rec!;
  const o = tickAt(scene, t) * n * 3;
  return Array.from({ length: n }, (_, i) => stats[o + i * 3]);
}

/** Where country i's countryball sits at sim time t (cell units, interpolated between ticks). */
export function spotAt(scene: TerritoryScene, i: number, t: number): [number, number] {
  const { stats, n, ticks } = scene.round.rec!;
  const f = Math.max(0, Math.min(ticks - 1, t * scene.round.config.rate));
  // Glide over a few ticks so the ball doesn't jump when its territory changes shape.
  const span = 6;
  let x = 0;
  let y = 0;
  let w = 0;
  for (let k = 0; k <= span; k++) {
    const g = Math.max(0, Math.floor(f) - k);
    const o = (g * n + i) * 3;
    if (!stats[o]) continue;
    const wk = span + 1 - k;
    x += stats[o + 1] * wk;
    y += stats[o + 2] * wk;
    w += wk;
  }
  return w ? [x / w + 0.5, y / w + 0.5] : [-1, -1];
}

/** The country holding the most land at sim time t (-1 before anyone does). */
export function leaderAt(scene: TerritoryScene, t: number): number {
  let lead = -1;
  for (const e of scene.round.events) {
    if (e.t > t) break;
    if (e.type === 'lead') lead = e.i;
  }
  if (lead >= 0) return lead;
  // The first leader (set on the first tick, without an event), like the sim picks it.
  const land = landAt(scene, 1 / scene.round.config.rate);
  return land.indexOf(Math.max(...land));
}
