import type { ContentFormat } from '../../autopilot/types';
import { GrowRenderer } from '../../render/grow/renderer';
import { buildGrowScene, type GrowScene } from '../../render/grow/scene';
import { composeThumbnail } from '../thumbnail';

/** Growing Ball cover: the first game a quarter of the way in, with no leader marked (no spoilers). */
export function renderGrowThumbnail(args: {
  scene: GrowScene;
  format: ContentFormat;
  hook: string;
  sub: string;
}): Promise<Uint8Array> {
  const src = args.scene;
  const scene = buildGrowScene({
    result: src.result,
    fighters: src.fighters,
    look: { ...src.look, title: '', subtitle: '', showKillFeed: false, showCounter: false },
  });
  const v = scene.timeline.intro + scene.result.rounds[0].winnerT * 0.25;
  return composeThumbnail({
    format: args.format,
    theme: scene.look.theme,
    hook: args.hook,
    sub: args.sub,
    draw: (ctx, W, H) => new GrowRenderer(scene, W, H).render(ctx, v, { thumbnail: true }),
  });
}
