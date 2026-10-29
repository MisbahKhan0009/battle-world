import type { ContentFormat } from '../../autopilot/types';
import { RingsRenderer } from '../../render/rings/renderer';
import { buildRingsScene, type RingsScene } from '../../render/rings/scene';
import { composeThumbnail } from '../thumbnail';

/** Ring Escape cover: every ring of the first game with the flags still inside (no spoilers). */
export function renderRingsThumbnail(args: {
  scene: RingsScene;
  format: ContentFormat;
  hook: string;
  sub: string;
}): Promise<Uint8Array> {
  const src = args.scene;
  const scene = buildRingsScene({
    result: src.result,
    fighters: src.fighters,
    look: { ...src.look, title: '', subtitle: '', showKillFeed: false, showCounter: false },
  });
  const v = scene.timeline.intro + 0.6;
  return composeThumbnail({
    format: args.format,
    theme: scene.look.theme,
    hook: args.hook,
    sub: args.sub,
    draw: (ctx, W, H) => new RingsRenderer(scene, W, H).render(ctx, v, { full: true, thumbnail: true }),
  });
}
