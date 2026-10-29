import type { ContentFormat } from '../../autopilot/types';
import { TerritoryRenderer } from '../../render/territory/renderer';
import { buildTerritoryScene, type TerritoryScene } from '../../render/territory/scene';
import { composeThumbnail } from '../thumbnail';

/** Territory Wars cover: the map early in the land grab, everyone still in, no leader marked. */
export function renderTerritoryThumbnail(args: {
  scene: TerritoryScene;
  format: ContentFormat;
  hook: string;
  sub: string;
}): Promise<Uint8Array> {
  const src = args.scene;
  const scene = buildTerritoryScene({
    result: src.result,
    fighters: src.fighters,
    look: { ...src.look, title: '', subtitle: '', showKillFeed: false, showCounter: false },
  });
  const outs = scene.round.outTicks;
  // Before the first country falls, and early enough that nobody dominates yet.
  const first = outs.length ? outs[0] / scene.round.config.rate : scene.round.winnerT;
  const v = scene.timeline.intro + Math.min(scene.round.winnerT * 0.08, first * 0.6);
  return composeThumbnail({
    format: args.format,
    theme: scene.look.theme,
    hook: args.hook,
    sub: args.sub,
    draw: (ctx, W, H) => new TerritoryRenderer(scene, W, H).render(ctx, v, { thumbnail: true }),
  });
}
