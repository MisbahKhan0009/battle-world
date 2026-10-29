import type { ContentFormat } from '../../autopilot/types';
import { buildRaceScene, marbleAt, type RaceScene } from '../../render/race/scene';
import { RaceRenderer } from '../../render/race/renderer';
import { composeThumbnail } from '../thumbnail';

/** Marble Race cover: the pack early in the race, without standings (they would hint at the winner). */
export function renderRaceThumbnail(args: {
  scene: RaceScene;
  format: ContentFormat;
  hook: string;
  sub: string;
}): Promise<Uint8Array> {
  const src = args.scene;
  const scene = buildRaceScene({
    result: src.result,
    fighters: src.fighters,
    look: { ...src.look, title: '', subtitle: '', showKillFeed: false, showCounter: false },
  });
  const tl = scene.timeline;
  // Early in the race, with the camera on the middle of the pack so every flag is in view.
  const v = tl.intro + 2.2;
  const t = tl.simAt(v);
  const ys = scene.fighters.map((_, i) => marbleAt(scene, i, t)[1]).sort((a, b) => a - b);
  const camY = ys[Math.floor(ys.length / 2)] + 120;
  return composeThumbnail({
    format: args.format,
    theme: scene.look.theme,
    hook: args.hook,
    sub: args.sub,
    draw: (ctx, W, H) => new RaceRenderer(scene, W, H).render(ctx, v, { camY }),
  });
}
