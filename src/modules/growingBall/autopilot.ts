/**
 * Headless Growing Ball rendering for the autopilot: plan from a seed and the content history,
 * run the show in a worker, relabel the outcome so it is fresh, render with the shared export
 * pipeline, and return the MP4, a spoiler-free thumbnail and the metadata.
 */
import type { RenderResult } from '../../autopilot/engine';
import { loadCountries } from '../../data/countries';
import { runExport } from '../../export/exporter';
import { loadSceneFighters } from '../../lib/battle';
import { loadFlagSafe, WINNER_RASTER } from '../../lib/flags';
import { GrowClient } from '../../lib/growClient';
import { buildGrowScene } from '../../render/grow/scene';
import { freshenPair } from '../common';
import type { RenderJob } from '../registry';
import { planGrowingBall, growRecord } from './content';
import { renderGrowThumbnail } from './thumbnail';

export async function renderGrowingBall(
  job: RenderJob,
  onProgress: (p: number) => void,
  signal: AbortSignal,
): Promise<RenderResult> {
  const recent = job.recent ?? [];
  const plan = planGrowingBall(job, await loadCountries(), recent);
  const client = new GrowClient();
  try {
    onProgress(0.01);
    const { config, result } = await client.run({
      seed: plan.gameSeed,
      ids: plan.fighters.map((f) => f.id),
      heats: plan.heats,
      targetSec: plan.targetSec,
      maxSec: plan.maxSec,
    });
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    const outcome = freshenPair(plan.fighters, result.winnerIndex, result.runnerUp, recent, job.seed);
    const fighters = await loadSceneFighters(plan.fighters);
    const winner = plan.fighters[result.winnerIndex];
    const winnerImage = winner ? (await loadFlagSafe(winner.imageSrc, WINNER_RASTER)).bitmap : null;
    const out = await runExport({
      content: { kind: 'growing-ball', config },
      look: plan.look,
      fighters,
      winnerImage,
      fps: job.format === 'short' ? 60 : 30,
      quality: 'high',
      audio: { enabled: true, sfxVolume: 0.85 },
      music: job.music,
      onProgress: (p) => onProgress(Math.max(0.02, p.percent / 100)),
      onThumb: (b) => b.close(),
      signal,
    });
    const bytes = new Uint8Array(await out.blob.arrayBuffer());
    let thumbnail: Uint8Array | undefined;
    try {
      const scene = buildGrowScene({ result, look: plan.look, fighters });
      thumbnail = await renderGrowThumbnail({ scene, format: job.format, ...plan.thumb });
    } catch (err) {
      console.warn('thumbnail failed', err);
    }
    return { bytes, ext: out.ext, meta: plan.meta, thumbnail, content: growRecord(plan, outcome) };
  } finally {
    client.dispose();
  }
}
