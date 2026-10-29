/**
 * Fallback export for browsers without WebCodecs: renders in real time to a canvas and records
 * it with MediaRecorder (WebM). Audio is mixed with the same Mixer and played into the stream.
 */
import { Mixer } from '../audio/mix';
import { SAMPLE_RATE } from '../audio/synth';
import { simulate } from '../engine/sim';
import { WINNER_HOLD_SEC } from '../engine/timeline';
import { DESIGN_SIZE } from '../render/layout';
import { BattleRenderer } from '../render/renderer';
import { buildScene } from '../render/scene';
import { BITRATES, type ExportInput, type ExportOutcome } from './exporter';

function pickMime(): string {
  const options = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  return options.find((m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) ?? '';
}

export async function runFallback(input: ExportInput): Promise<ExportOutcome> {
  if (typeof MediaRecorder === 'undefined')
    throw new Error('This browser cannot record video. Use the latest Chrome or Edge.');
  const { W, H } = DESIGN_SIZE[input.look.aspect];
  const result = simulate(input.config, { record: true, holdSec: WINNER_HOLD_SEC + 1 });
  const scene = buildScene({
    result,
    look: input.look,
    fighters: input.fighters,
    winnerImage: input.winnerImage,
  });
  const renderer = new BattleRenderer(scene, W, H);
  const total = scene.timeline.total;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { alpha: false })!;
  renderer.render(ctx, 0);
  const stream = canvas.captureStream(input.fps);

  let audioCtx: AudioContext | null = null;
  let source: AudioBufferSourceNode | null = null;
  if (input.audio.enabled) {
    audioCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
    const mixer = new Mixer(scene, { sfxVolume: input.audio.sfxVolume });
    const frames = Math.ceil(total * SAMPLE_RATE);
    const { L, R } = mixer.render(0, frames);
    const buffer = audioCtx.createBuffer(2, frames, SAMPLE_RATE);
    buffer.copyToChannel(L, 0);
    buffer.copyToChannel(R, 1);
    const dest = audioCtx.createMediaStreamDestination();
    source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(dest);
    dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
  }

  const mime = pickMime();
  const recorder = new MediaRecorder(stream, {
    mimeType: mime || undefined,
    videoBitsPerSecond: BITRATES[input.quality],
  });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);

  return new Promise<ExportOutcome>((resolve, reject) => {
    // Timer-driven (not requestAnimationFrame) so it keeps going while the window is hidden.
    let raf: ReturnType<typeof setTimeout> | undefined;
    let start = 0;
    let lastThumb = -10;
    const stop = (err?: Error) => {
      clearTimeout(raf);
      input.signal.removeEventListener('abort', onAbort);
      source?.stop();
      if (recorder.state !== 'inactive') recorder.stop();
      if (err) {
        void audioCtx?.close();
        reject(err);
      }
    };
    const onAbort = () => stop(new DOMException('Export cancelled', 'AbortError'));
    input.signal.addEventListener('abort', onAbort);
    recorder.onstop = () => {
      void audioCtx?.close();
      if (input.signal.aborted) return;
      resolve({
        blob: new Blob(chunks, { type: 'video/webm' }),
        ext: 'webm',
        videoCodec: mime || 'WebM',
        audioCodec: input.audio.enabled ? 'Opus' : null,
        fallback: true,
      });
    };
    const tick = () => {
      const now = performance.now();
      const v = (now - start) / 1000;
      renderer.render(ctx, Math.min(v, total));
      input.onProgress({
        stage: 'recording',
        percent: Math.min(99, (v / total) * 100),
        etaSec: Math.max(0, total - v),
      });
      if (v - lastThumb > 2) {
        lastThumb = v;
        void createImageBitmap(canvas, { resizeHeight: 240, resizeWidth: Math.round((W / H) * 240) }).then(
          input.onThumb,
        );
      }
      if (v >= total) return stop();
      raf = setTimeout(tick, 1000 / input.fps);
    };
    recorder.start(1000);
    source?.start();
    start = performance.now();
    raf = setTimeout(tick, 0);
  });
}
