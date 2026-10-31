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
import { buildScene } from '../../render/scene';
import { contentRecord, freshenOutcome, planFlagBattle } from './content';
import { renderThumbnail } from './thumbnail';

export async function renderFlagBattle(
  job: RenderJob,
  onProgress: (p: number) => void,
  signal: AbortSignal,
): Promise<RenderResult> {
  const recent = job.recent ?? [];
  const plan = planFlagBattle(job, await loadCountries(), recent);
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
    // Put a fresh country on the winning ball (and a fresh final pairing) before drawing.
    const outcome = freshenOutcome(plan.fighters, sim.result, recent, job.seed);
    const fighters = await loadSceneFighters(plan.fighters);
    const winner = plan.fighters[sim.result.winnerIndex];
    const winnerImage = winner ? (await loadFlagSafe(winner.imageSrc, WINNER_RASTER)).bitmap : null;
    const out = await runExport({
      content: { kind: 'flag-battle', config: sim.config },
      look: plan.look,
      fighters,
      winnerImage,
      // Shorts at 60 fps; long videos at 30 fps keep background rendering light.
      fps: job.format === 'short' ? 60 : 30,
      // Long videos at YouTube's recommended 8 Mbps for 1080p keep files and memory small.
      quality: job.format === 'short' ? 'high' : 'standard',
      audio: { enabled: true, sfxVolume: 0.85 },
      music: job.music,
      onProgress: (p) => onProgress(Math.max(0.02, p.percent / 100)),
      onThumb: (b) => b.close(),
      signal,
      sink: job.sink,
    });
    // Streamed straight to disk when the autopilot gave a sink; otherwise the bytes come back.
    const bytes = out.blob ? new Uint8Array(await out.blob.arrayBuffer()) : undefined;
    let thumbnail: Uint8Array | undefined;
    try {
      const scene = buildScene({ result: sim.result, look: plan.look, fighters });
      thumbnail = await renderThumbnail({ scene, format: job.format, ...plan.thumb });
    } catch (err) {
      console.warn('thumbnail failed', err);
    }
    return { bytes, ext: out.ext, meta: plan.meta, thumbnail, content: contentRecord(plan, outcome) };
  } finally {
    client.dispose();
  }
}
