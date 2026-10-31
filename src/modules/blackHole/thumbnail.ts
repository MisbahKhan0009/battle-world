import type { ContentFormat } from '../../autopilot/types';
import { BlackRenderer } from '../../render/black/renderer';
import { buildBlackScene, type BlackScene } from '../../render/black/scene';
import { composeThumbnail } from '../thumbnail';

/** Black Hole cover: the whole city right at the start, every hole still small (no spoilers). */
export function renderBlackThumbnail(args: {
  scene: BlackScene;
  format: ContentFormat;
  hook: string;
  sub: string;
}): Promise<Uint8Array> {
  const src = args.scene;
  const scene = buildBlackScene({
    result: src.result,
    fighters: src.fighters,
    look: { ...src.look, title: '', subtitle: '', showKillFeed: false, showCounter: false },
  });
  const v = scene.timeline.intro + 1.2;
  return composeThumbnail({
    format: args.format,
    theme: scene.look.theme,
    hook: args.hook,
    sub: args.sub,
    draw: (ctx, W, H) => new BlackRenderer(scene, W, H).render(ctx, v, { thumbnail: true }),
  });
}
