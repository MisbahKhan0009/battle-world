import type { ContentFormat } from '../../autopilot/types';
import { BattleRenderer } from '../../render/renderer';
import { buildScene, type Scene } from '../../render/scene';
import { composeThumbnail } from '../thumbnail';

/** Flag Battle cover: early in the fight, before anyone is out, without the in-video HUD. */
export function renderThumbnail(args: {
  scene: Scene;
  format: ContentFormat;
  hook: string;
  sub: string;
}): Promise<Uint8Array> {
  const src = args.scene;
  const scene = buildScene({
    result: src.result,
    fighters: src.fighters,
    look: {
      ...src.look,
      title: '',
      subtitle: '',
      showCounter: false,
      showKillFeed: false,
      showHpNumbers: false,
      showDamageNumbers: false,
    },
  });
  const tl = scene.timeline;
  const v = tl.intro + Math.min(3.5, Math.max(0.8, (tl.vWinner - tl.intro) * 0.1));
  return composeThumbnail({
    format: args.format,
    theme: scene.look.theme,
    hook: args.hook,
    sub: args.sub,
    draw: (ctx, W, H) => new BattleRenderer(scene, W, H).render(ctx, v),
  });
}
