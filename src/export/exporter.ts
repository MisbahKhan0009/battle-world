/**
 * Main-thread export controller. Runs the WebCodecs worker when available and falls back to
 * real-time MediaRecorder (WebM) otherwise.
 */
import type { Look, SimConfig } from '../engine/types';
import type { SceneFighter } from '../render/scene';
import type { AudioSettings } from '../store/app';
import { exportFonts } from './fonts';
import type { ExportFighter, ExportMessage, ExportRequest } from './protocol';

export type ExportProgress = {
  stage: 'preparing' | 'audio' | 'video' | 'finalizing' | 'recording';
  percent: number;
  etaSec: number | null;
};

export type ExportOutcome = {
  blob: Blob;
  ext: 'mp4' | 'webm';
  videoCodec: string;
  audioCodec: string | null;
  fallback: boolean;
};

export type ExportInput = {
  config: SimConfig;
  look: Look;
  fighters: SceneFighter[];
  winnerImage: ImageBitmap | null;
  fps: 30 | 60;
  quality: 'standard' | 'high';
  audio: AudioSettings;
  onProgress: (p: ExportProgress) => void;
  onThumb: (b: ImageBitmap) => void;
  signal: AbortSignal;
};

export const BITRATES = { standard: 8_000_000, high: 16_000_000 } as const;

export function webCodecsAvailable(): boolean {
  return typeof window !== 'undefined' && 'VideoEncoder' in window && 'OffscreenCanvas' in window;
}

async function cloneBitmap(b: ImageBitmap | null | undefined): Promise<ImageBitmap | null> {
  if (!b) return null;
  return createImageBitmap(b as ImageBitmap);
}

export async function runExport(input: ExportInput): Promise<ExportOutcome> {
  input.onProgress({ stage: 'preparing', percent: 0, etaSec: null });
  if (webCodecsAvailable()) {
    const res = await runWorker(input);
    if (res !== 'unsupported') return res;
  }
  const { runFallback } = await import('./fallback');
  return runFallback(input);
}

async function runWorker(input: ExportInput): Promise<ExportOutcome | 'unsupported'> {
  const fighters: ExportFighter[] = await Promise.all(
    input.fighters.map(async (f) => ({
      id: f.id,
      name: f.name,
      isCountry: f.isCountry,
      accent: f.accent,
      palette: f.palette,
      image: await cloneBitmap(f.image as ImageBitmap | null),
    })),
  );
  const winnerImage = await cloneBitmap(input.winnerImage);
  const req: ExportRequest = {
    type: 'start',
    config: input.config,
    look: input.look,
    fighters,
    winnerImage,
    fps: input.fps,
    bitrate: BITRATES[input.quality],
    audio: { enabled: input.audio.enabled, sfxVolume: input.audio.sfxVolume },
    fonts: exportFonts(),
  };
  const transfer: Transferable[] = [
    ...fighters.map((f) => f.image).filter((b): b is ImageBitmap => !!b),
    ...(winnerImage ? [winnerImage] : []),
  ];

  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  const started = performance.now();
  let videoStart = 0;

  return new Promise<ExportOutcome | 'unsupported'>((resolve, reject) => {
    const cleanup = () => {
      input.signal.removeEventListener('abort', onAbort);
      worker.terminate();
    };
    const onAbort = () => {
      worker.postMessage({ type: 'cancel' });
      // Hard stop if the worker does not acknowledge quickly.
      setTimeout(() => {
        cleanup();
        reject(new DOMException('Export cancelled', 'AbortError'));
      }, 1500);
    };
    input.signal.addEventListener('abort', onAbort);

    worker.onerror = (e) => {
      cleanup();
      reject(new Error(e.message || 'The export worker crashed.'));
    };
    worker.onmessage = (e: MessageEvent<ExportMessage>) => {
      const m = e.data;
      switch (m.type) {
        case 'progress': {
          if (m.stage === 'audio') {
            input.onProgress({ stage: 'audio', percent: 1, etaSec: null });
            break;
          }
          if (m.stage === 'finalizing') {
            input.onProgress({ stage: 'finalizing', percent: 99, etaSec: 1 });
            break;
          }
          if (!videoStart) videoStart = performance.now();
          const done = m.frame / m.total;
          const elapsed = (performance.now() - videoStart) / 1000;
          const eta = done > 0.02 ? (elapsed / done) * (1 - done) : null;
          input.onProgress({ stage: 'video', percent: 2 + done * 96, etaSec: eta });
          break;
        }
        case 'thumb':
          input.onThumb(m.bitmap);
          break;
        case 'done':
          cleanup();
          console.info(
            `[export] ${m.videoCodec} / ${m.audioCodec ?? 'no audio'} in ${((performance.now() - started) / 1000).toFixed(1)}s`,
          );
          resolve({
            blob: new Blob([m.buffer], { type: m.mime }),
            ext: 'mp4',
            videoCodec: m.videoCodec,
            audioCodec: m.audioCodec,
            fallback: false,
          });
          break;
        case 'unsupported':
          cleanup();
          resolve('unsupported');
          break;
        case 'cancelled':
          cleanup();
          reject(new DOMException('Export cancelled', 'AbortError'));
          break;
        case 'error':
          cleanup();
          reject(new Error(m.message));
          break;
      }
    };
    worker.postMessage(req, transfer);
  });
}
