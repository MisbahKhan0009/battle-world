import { buildTerritoryCues } from '../../audio/territoryCues';
import { loadCountries } from '../../data/countries';
import { loadSceneFighters } from '../../lib/battle';
import { loadFlagSafe, WINNER_RASTER } from '../../lib/flags';
import { TerritoryClient } from '../../lib/territoryClient';
import { planTerritoryWars } from '../../modules/territoryWars/content';
import { TerritoryRenderer } from '../../render/territory/renderer';
import { buildTerritoryScene } from '../../render/territory/scene';
import type { PreviewGame } from './PreviewPage';

/** Territory Wars on the preview page (kept apart so PreviewPage.tsx stays small). */
export const TERRITORY_WARS: PreviewGame = {
  id: 'territory-wars',
  title: 'Territory Wars',
  newLabel: 'New war',
  busyText: 'Fighting the war…',
  load: async (format, seed) => {
    const plan = planTerritoryWars({ format, seed }, await loadCountries(), []);
    const client = new TerritoryClient();
    try {
      const { config, result } = await client.run({
        seed: plan.gameSeed,
        ids: plan.fighters.map((f) => f.id),
        isos: plan.fighters.map((f) => f.iso2 ?? ''),
        targetSec: plan.targetSec,
        maxSec: plan.maxSec,
      });
      const fighters = await loadSceneFighters(plan.fighters);
      const w = plan.fighters[result.winnerIndex];
      const winnerImage = w ? (await loadFlagSafe(w.imageSrc, WINNER_RASTER)).bitmap : null;
      const scene = buildTerritoryScene({ result, look: plan.look, fighters, winnerImage });
      const round = result.rounds[0];
      return {
        meta: plan.meta,
        look: plan.look,
        content: { kind: 'territory-wars', config },
        fighters,
        winnerImage,
        total: scene.timeline.total,
        renderer: (W, H) => new TerritoryRenderer(scene, W, H),
        cues: () => buildTerritoryCues(scene),
        summary:
          `${fighters.length} countries on a ${scene.map.cols}×${scene.map.rows} map, ` +
          `${round.endTick} turns at ${round.config.rate.toFixed(0)} a second` +
          (round.conquered ? ', fought to a full conquest.' : ', won on land when time ran out.') +
          ' Every war is new: the lineup, map and winner change each time, the same way the autopilot makes them.',
      };
    } finally {
      client.dispose();
    }
  },
};
