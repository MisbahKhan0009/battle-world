/**
 * What gets exported: builds the renderer and the sound cues for any game from its serializable
 * config. Used by the export worker and the real-time fallback, so every game exports the same way.
 */
import { buildRaceCues } from '../audio/raceCues';
import { buildRingsCues } from '../audio/ringCues';
import { buildGrowCues } from '../audio/growCues';
import { runShow as runGrowShow, type GrowShow } from '../engine/grow/show';
import { Mixer, type MixSettings } from '../audio/mix';
import { MusicMix, type MusicBed } from '../audio/music';
import type { Stereo } from '../audio/synth';
import { runRace } from '../engine/race/race';
import type { RaceConfig } from '../engine/race/types';
import { runShow, type RingsShow } from '../engine/rings/show';
import { simulate } from '../engine/sim';
import { WINNER_HOLD_SEC } from '../engine/timeline';
import type { Look, SimConfig } from '../engine/types';
import type { Ctx2D, ImageSource } from '../render/canvas';
import { buildRaceScene } from '../render/race/scene';
import { RaceRenderer } from '../render/race/renderer';
import { RingsRenderer } from '../render/rings/renderer';
import { GrowRenderer } from '../render/grow/renderer';
import { buildGrowScene } from '../render/grow/scene';
import { buildRingsScene } from '../render/rings/scene';
import { BattleRenderer } from '../render/renderer';
import { buildScene, type SceneFighter } from '../render/scene';

export type ExportContent =
  | { kind: 'flag-battle'; config: SimConfig }
  | { kind: 'marble-race'; config: RaceConfig }
  | { kind: 'ring-escape'; config: RingsShow }
  | { kind: 'growing-ball'; config: GrowShow };

/** Anything that renders the soundtrack in chunks: the game sounds, or a music track. */
export type Soundtrack = { render(start: number, frames: number): Stereo };

export type Production = {
  total: number;
  render(ctx: Ctx2D, v: number): void;
  mixer(settings: MixSettings): Soundtrack;
};

type ProductionArgs = {
  content: ExportContent;
  look: Look;
  fighters: SceneFighter[];
  winnerImage: ImageSource | null;
  W: number;
  H: number;
  /** A music track to play instead of the game sounds. */
  music?: MusicBed | null;
};

export function buildProduction(args: ProductionArgs): Production {
  const game = buildGameProduction(args);
  const { music } = args;
  if (!music) return game;
  return { ...game, mixer: (settings) => new MusicMix(music, game.total, settings.sfxVolume) };
}

function buildGameProduction(args: ProductionArgs): Production {
  const { content, look, fighters, winnerImage, W, H } = args;
  if (content.kind === 'marble-race') {
    const result = runRace(content.config, { record: true });
    const scene = buildRaceScene({ result, look, fighters, winnerImage });
    const renderer = new RaceRenderer(scene, W, H);
    return {
      total: scene.timeline.total,
      render: (ctx, v) => renderer.render(ctx, v),
      mixer: (settings) => new Mixer(null, settings, buildRaceCues(scene)),
    };
  }
  if (content.kind === 'growing-ball') {
    const result = runGrowShow(content.config, { record: true });
    const scene = buildGrowScene({ result, look, fighters, winnerImage });
    const renderer = new GrowRenderer(scene, W, H);
    return {
      total: scene.timeline.total,
      render: (ctx, v) => renderer.render(ctx, v),
      mixer: (settings) => new Mixer(null, settings, buildGrowCues(scene)),
    };
  }
  if (content.kind === 'ring-escape') {
    const result = runShow(content.config, { record: true });
    const scene = buildRingsScene({ result, look, fighters, winnerImage });
    const renderer = new RingsRenderer(scene, W, H);
    return {
      total: scene.timeline.total,
      render: (ctx, v) => renderer.render(ctx, v),
      mixer: (settings) => new Mixer(null, settings, buildRingsCues(scene)),
    };
  }
  const result = simulate(content.config, { record: true, holdSec: WINNER_HOLD_SEC + 1 });
  const scene = buildScene({ result, look, fighters, winnerImage });
  const renderer = new BattleRenderer(scene, W, H);
  return {
    total: scene.timeline.total,
    render: (ctx, v) => renderer.render(ctx, v),
    mixer: (settings) => new Mixer(scene, settings),
  };
}
