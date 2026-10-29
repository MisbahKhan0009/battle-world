/**
 * Headless Flag Battle rendering for the autopilot: plan from a seed, tune, render with the same
 * WebCodecs pipeline as manual export, and return the MP4 bytes plus metadata.
 */
import type { RenderResult } from '../../autopilot/engine';
import { loadCountries } from '../../data/countries';
import { runExport } from '../../export/exporter';
import { loadSceneFighters } from '../../lib/battle';
import { loadFlagSafe, WINNER_RASTER } from '../../lib/flags';
import { SimClient } from '../../lib/simClient';
import { simFighters } from '../../store/app';
import type { RenderJob } from '../registry';
import { planFlagBattle } from './content';

export async function renderFlagBattle(
  job: RenderJob,
  onProgress: (p: number) => void,
  signal: AbortSignal,
): Promise<RenderResult> {
  const plan = planFlagBattle(job, await loadCountries());
  const client = new SimClient();
  try {
    onProgress(0.01);
    const sim = await client.run({
      fighters: simFighters(plan.fighters, false),
      rules: plan.rules,
      intro: plan.look.intro,
      outro: plan.look.outro,
    });
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    const fighters = await loadSceneFighters(plan.fighters);
    const winner = plan.fighters[sim.result.winnerIndex];
    const winnerImage = winner ? (await loadFlagSafe(winner.imageSrc, WINNER_RASTER)).bitmap : null;
    const out = await runExport({
      config: sim.config,
      look: plan.look,
      fighters,
      winnerImage,
      // Shorts at 60 fps; long videos at 30 fps keep background rendering light.
      fps: job.format === 'short' ? 60 : 30,
      quality: 'high',
      audio: { enabled: true, sfxVolume: 0.85 },
      onProgress: (p) => onProgress(Math.max(0.02, p.percent / 100)),
      onThumb: (b) => b.close(),
      signal,
    });
    const bytes = new Uint8Array(await out.blob.arrayBuffer());
    return { bytes, ext: out.ext, meta: plan.meta };
  } finally {
    client.dispose();
  }
}
