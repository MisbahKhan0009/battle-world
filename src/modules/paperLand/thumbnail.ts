import type { ContentFormat } from '../../autopilot/types';
import { PaperRenderer } from '../../render/paper/renderer';
import { buildPaperScene, type PaperScene } from '../../render/paper/scene';
import { composeThumbnail } from '../thumbnail';

/** Paper Land cover: the first game a third of the way in, with no leader marked (no spoilers). */
export function renderPaperThumbnail(args: {
  scene: PaperScene;
  format: ContentFormat;
  hook: string;
  sub: string;
}): Promise<Uint8Array> {
  const src = args.scene;
  const scene = buildPaperScene({
    result: src.result,
    fighters: src.fighters,
    look: { ...src.look, title: '', subtitle: '', showKillFeed: false, showCounter: false },
  });
  const v = scene.timeline.intro + scene.result.rounds[0].winnerT * 0.35;
  return composeThumbnail({
    format: args.format,
    theme: scene.look.theme,
    hook: args.hook,
    sub: args.sub,
    draw: (ctx, W, H) => new PaperRenderer(scene, W, H).render(ctx, v, { thumbnail: true }),
  });
}
