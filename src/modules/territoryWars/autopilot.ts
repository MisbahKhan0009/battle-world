/**
 * Headless Territory Wars rendering for the autopilot: plan from a seed and the content history,
 * play the war in a worker, render with the shared export pipeline, and return the MP4, a
 * spoiler-free thumbnail and the metadata. No relabelling: countries sit on their real land.
 */
import type { RenderResult } from '../../autopilot/engine';
import { loadCountries } from '../../data/countries';
import { runExport } from '../../export/exporter';
import { loadSceneFighters } from '../../lib/battle';
import { loadFlagSafe, WINNER_RASTER } from '../../lib/flags';
import { TerritoryClient } from '../../lib/territoryClient';
import { buildTerritoryScene } from '../../render/territory/scene';
import { keyOf } from '../common';
import type { RenderJob } from '../registry';
import { planTerritoryWars, territoryRecord } from './content';
import { renderTerritoryThumbnail } from './thumbnail';

export async function renderTerritoryWars(
  job: RenderJob,
  onProgress: (p: number) => void,
  signal: AbortSignal,
): Promise<RenderResult> {
  const recent = job.recent ?? [];
  const plan = planTerritoryWars(job, await loadCountries(), recent);
  const client = new TerritoryClient();
  try {
    onProgress(0.01);
    const { config, result } = await client.run({
      seed: plan.gameSeed,
      ids: plan.fighters.map((f) => f.id),
      isos: plan.fighters.map((f) => f.iso2 ?? ''),
      avoid: plan.avoid,
      targetSec: plan.targetSec,
      maxSec: plan.maxSec,
    });
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    const winner = plan.fighters[result.winnerIndex];
    const runnerUp = plan.fighters[result.runnerUp];
    const outcome = { winner: winner && keyOf(winner), runnerUp: runnerUp && keyOf(runnerUp) };
    const fighters = await loadSceneFighters(plan.fighters);
    const winnerImage = winner ? (await loadFlagSafe(winner.imageSrc, WINNER_RASTER)).bitmap : null;
    const out = await runExport({
      content: { kind: 'territory-wars', config },
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
      const scene = buildTerritoryScene({ result, look: plan.look, fighters });
      thumbnail = await renderTerritoryThumbnail({ scene, format: job.format, ...plan.thumb });
    } catch (err) {
      console.warn('thumbnail failed', err);
    }
    return { bytes, ext: out.ext, meta: plan.meta, thumbnail, content: territoryRecord(plan, outcome) };
  } finally {
    client.dispose();
  }
}
