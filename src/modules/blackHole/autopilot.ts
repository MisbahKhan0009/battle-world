/**
 * Headless Black Hole rendering for the autopilot: plan from a seed and the content history, run
 * the show in a worker, relabel the outcome so it is fresh, render with the shared export
 * pipeline, and return the MP4, a spoiler-free thumbnail and the metadata.
 */
import type { RenderResult } from '../../autopilot/engine';
import { loadCountries } from '../../data/countries';
import { runExport } from '../../export/exporter';
import { loadSceneFighters } from '../../lib/battle';
import { BlackClient } from '../../lib/blackClient';
import { loadFlagSafe, WINNER_RASTER } from '../../lib/flags';
import { buildBlackScene } from '../../render/black/scene';
import { freshenPair } from '../common';
import type { RenderJob } from '../registry';
import { blackRecord, planBlackHole } from './content';
import { renderBlackThumbnail } from './thumbnail';

export async function renderBlackHole(
  job: RenderJob,
  onProgress: (p: number) => void,
  signal: AbortSignal,
): Promise<RenderResult> {
  const recent = job.recent ?? [];
  const plan = planBlackHole(job, await loadCountries(), recent);
  const client = new BlackClient();
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
      content: { kind: 'black-hole', config },
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
      const scene = buildBlackScene({ result, look: plan.look, fighters });
      thumbnail = await renderBlackThumbnail({ scene, format: job.format, ...plan.thumb });
    } catch (err) {
      console.warn('thumbnail failed', err);
    }
    return { bytes, ext: out.ext, meta: plan.meta, thumbnail, content: blackRecord(plan, outcome) };
  } finally {
    client.dispose();
  }
}
