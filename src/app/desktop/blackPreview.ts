/**
 * Loads a Black Hole sample for the preview page (kept out of PreviewPage.tsx, which is already
 * long). `art` is the page's flag loader.
 */
import { buildBlackCues } from '../../audio/blackCues';
import type { ContentFormat } from '../../autopilot/types';
import { loadCountries } from '../../data/countries';
import type { Fighter } from '../../engine/types';
import { BlackClient } from '../../lib/blackClient';
import { planBlackHole } from '../../modules/blackHole/content';
import { BlackRenderer } from '../../render/black/renderer';
import { buildBlackScene } from '../../render/black/scene';
import type { SceneFighter } from '../../render/scene';
import type { Loaded } from './PreviewPage';

type Art = (
  fighters: Fighter[],
  winner: number,
) => Promise<{ scene: SceneFighter[]; winnerImage: ImageBitmap | null }>;

export async function loadBlackHole(format: ContentFormat, seed: number, art: Art): Promise<Loaded> {
  const plan = planBlackHole({ format, seed }, await loadCountries(), []);
  const client = new BlackClient();
  try {
    const { config, result } = await client.run({
      seed: plan.gameSeed,
      ids: plan.fighters.map((f) => f.id),
      heats: plan.heats,
      targetSec: plan.targetSec,
      maxSec: plan.maxSec,
    });
    const { scene: fighters, winnerImage } = await art(plan.fighters, result.winnerIndex);
    const scene = buildBlackScene({ result, look: plan.look, fighters, winnerImage });
    const sizes = config.rounds.map((r) => `${r.blocks}×${r.blocks}`);
    return {
      meta: plan.meta,
      look: plan.look,
      content: { kind: 'black-hole', config },
      fighters,
      winnerImage,
      total: scene.timeline.total,
      renderer: (W, H) => new BlackRenderer(scene, W, H),
      cues: () => buildBlackCues(scene),
      summary:
        (plan.heats
          ? `${fighters.length} holes in ${plan.heats.length} heats and a final in a city of ${sizes[sizes.length - 1]} blocks.`
          : `${fighters.length} holes in a city of ${sizes[0]} blocks.`) +
        ' Every game is new: the city, lineup, hole count and winner change each time, the same way the autopilot makes them.',
    };
  } finally {
    client.dispose();
  }
}
