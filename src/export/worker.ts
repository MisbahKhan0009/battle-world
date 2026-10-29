/**
 * Offline, frame-by-frame MP4 export inside a worker. For each output frame i the battle is
 * rendered at video time i / fps on an OffscreenCanvas, wrapped in a VideoFrame and encoded.
 * Audio is mixed in one-second chunks and encoded alongside. Output is muxed by mp4-muxer with
 * fastStart so the moov atom sits at the front (YouTube-friendly).
 */
import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import { SAMPLE_RATE } from '../audio/synth';
import { DESIGN_SIZE } from '../render/layout';
import { buildProduction } from './production';
import { pickAudioConfig, pickVideoConfig } from './codecs';
import type { ExportMessage, ExportRequest } from './protocol';

type WorkerScope = {
  postMessage(message: unknown, transfer: Transferable[]): void;
  onmessage: ((e: MessageEvent) => void) | null;
  fonts: FontFaceSet;
};
const scope = self as unknown as WorkerScope;

let cancelled = false;

const post = (msg: ExportMessage, transfer: Transferable[] = []) => scope.postMessage(msg, transfer);

scope.onmessage = (e: MessageEvent<ExportRequest | { type: 'cancel' }>) => {
  if (e.data.type === 'cancel') {
    cancelled = true;
    return;
  }
  run(e.data).catch((err: unknown) => {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  });
};

async function waitFor(cond: () => boolean): Promise<void> {
  while (!cond()) await new Promise((r) => setTimeout(r, 2));
}

async function run(req: ExportRequest): Promise<void> {
  if (typeof VideoEncoder === 'undefined' || typeof OffscreenCanvas === 'undefined') {
    post({ type: 'unsupported', reason: 'WebCodecs is not available in this browser.' });
    return;
  }

  // Fonts for canvas text inside the worker.
  await Promise.all(
    req.fonts.map(async (f) => {
      const face = new FontFace(f.family, `url(${f.url})`, f.descriptors);
      await face.load();
      scope.fonts.add(face);
    }),
  );

  const { W, H } = DESIGN_SIZE[req.look.aspect];
  const video = await pickVideoConfig(W, H, req.fps, req.bitrate);
  if (!video) {
    post({ type: 'unsupported', reason: 'No supported video encoder (H.264, VP9 or AV1) was found.' });
    return;
  }
  const audio = req.audio.enabled ? await pickAudioConfig() : null;

  const production = buildProduction({
    content: req.content,
    look: req.look,
    fighters: req.fighters,
    winnerImage: req.winnerImage,
    W,
    H,
  });
  const total = production.total;
  const frames = Math.ceil(total * req.fps);

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: video.muxCodec, width: W, height: H, frameRate: req.fps },
    audio: audio ? { codec: audio.muxCodec, numberOfChannels: 2, sampleRate: SAMPLE_RATE } : undefined,
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  });

  let encodeError: Error | null = null;

  // ---- audio
  if (audio) {
    post({ type: 'progress', frame: 0, total: frames, stage: 'audio' });
    // Some encoders (WebKitGTK) stamp every packet of an input batch with the batch start time.
    // Re-time packets so timestamps always increase by each packet's duration.
    const packetUs = audio.muxCodec === 'opus' ? 20_000 : (1024 / SAMPLE_RATE) * 1e6;
    let nextTs = 0;
    const encoder = new AudioEncoder({
      output: (chunk, meta) => {
        // Trust the reported duration only when it is a plausible packet length (Opus max 120 ms).
        const duration = chunk.duration && chunk.duration <= 120_000 ? chunk.duration : packetUs;
        const ts = Math.max(chunk.timestamp, nextTs);
        nextTs = ts + duration;
        if (ts === chunk.timestamp) return muxer.addAudioChunk(chunk, meta);
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        muxer.addAudioChunk(new EncodedAudioChunk({ type: chunk.type, timestamp: ts, duration, data }), meta);
      },
      error: (err) => (encodeError = err),
    });
    encoder.configure(audio.config);
    const mixer = production.mixer({ sfxVolume: req.audio.sfxVolume });
    const totalSamples = Math.ceil(total * SAMPLE_RATE);
    const chunk = SAMPLE_RATE;
    for (let s = 0; s < totalSamples; s += chunk) {
      if (cancelled) return finishCancelled([encoder]);
      const n = Math.min(chunk, totalSamples - s);
      const { L, R } = mixer.render(s, n);
      const planar = new Float32Array(n * 2);
      planar.set(L, 0);
      planar.set(R, n);
      const data = new AudioData({
        format: 'f32-planar',
        sampleRate: SAMPLE_RATE,
        numberOfFrames: n,
        numberOfChannels: 2,
        timestamp: Math.round((s / SAMPLE_RATE) * 1e6),
        data: planar,
      });
      encoder.encode(data);
      data.close();
      await waitFor(() => encoder.encodeQueueSize < 8);
    }
    await encoder.flush();
    encoder.close();
    if (encodeError) throw encodeError;
  }

  // ---- video
  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Could not create a 2D canvas in the export worker.');
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (err) => (encodeError = err),
  });
  encoder.configure(video.config);

  const frameDur = 1e6 / req.fps;
  const keyEvery = req.fps * 2;
  const thumbEvery = req.fps * 2;
  for (let i = 0; i < frames; i++) {
    if (cancelled) return finishCancelled([encoder]);
    if (encodeError) throw encodeError;
    production.render(ctx, i / req.fps);
    const frame = new VideoFrame(canvas, {
      timestamp: Math.round(i * frameDur),
      duration: Math.round(frameDur),
      alpha: 'discard',
    });
    encoder.encode(frame, { keyFrame: i % keyEvery === 0 });
    frame.close();
    if (encoder.encodeQueueSize > 10) await waitFor(() => encoder.encodeQueueSize <= 10);
    else if (i % 30 === 0) await new Promise((r) => setTimeout(r, 0)); // let cancel messages in
    if (i % 6 === 0 || i === frames - 1)
      post({ type: 'progress', frame: i + 1, total: frames, stage: 'video' });
    if (i % thumbEvery === 0) {
      const bitmap = await createImageBitmap(canvas, {
        resizeWidth: Math.round((W / H) * 240),
        resizeHeight: 240,
        resizeQuality: 'medium',
      });
      post({ type: 'thumb', bitmap }, [bitmap]);
    }
  }
  post({ type: 'progress', frame: frames, total: frames, stage: 'finalizing' });
  await encoder.flush();
  encoder.close();
  if (encodeError) throw encodeError;
  muxer.finalize();

  const buffer = target.buffer;
  post(
    {
      type: 'done',
      buffer,
      mime: 'video/mp4',
      ext: 'mp4',
      videoCodec: video.label,
      audioCodec: audio?.label ?? null,
    },
    [buffer],
  );
}

function finishCancelled(encoders: (VideoEncoder | AudioEncoder)[]): void {
  for (const e of encoders) {
    try {
      e.close();
    } catch {
      /* already closed */
    }
  }
  post({ type: 'cancelled' });
}
