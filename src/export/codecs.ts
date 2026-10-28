export type VideoChoice = { muxCodec: 'avc' | 'vp9' | 'av1'; config: VideoEncoderConfig; label: string };
export type AudioChoice = { muxCodec: 'aac' | 'opus'; config: AudioEncoderConfig; label: string };

/** H.264 level for the given frame size and rate (macroblocks per second). */
function avcLevel(width: number, height: number, fps: number): string {
  const mbs = Math.ceil(width / 16) * Math.ceil(height / 16) * fps;
  if (mbs <= 245760) return '28'; // 4.0
  if (mbs <= 522240) return '2A'; // 4.2
  if (mbs <= 589824) return '32'; // 5.0
  return '33'; // 5.1
}

/** Picks the best supported video config: H.264 High, then Main, Baseline, VP9, AV1. */
export async function pickVideoConfig(
  width: number,
  height: number,
  fps: number,
  bitrate: number,
): Promise<VideoChoice | null> {
  const level = avcLevel(width, height, fps);
  const base = {
    width,
    height,
    bitrate,
    framerate: fps,
    latencyMode: 'quality' as const,
  };
  const candidates: VideoChoice[] = [
    {
      muxCodec: 'avc',
      label: 'H.264 High',
      config: { ...base, codec: `avc1.6400${level}`, avc: { format: 'avc' } },
    },
    {
      muxCodec: 'avc',
      label: 'H.264 Main',
      config: { ...base, codec: `avc1.4D40${level}`, avc: { format: 'avc' } },
    },
    {
      muxCodec: 'avc',
      label: 'H.264 Baseline',
      config: { ...base, codec: `avc1.42E0${level}`, avc: { format: 'avc' } },
    },
    { muxCodec: 'vp9', label: 'VP9', config: { ...base, codec: 'vp09.00.41.08' } },
    { muxCodec: 'av1', label: 'AV1', config: { ...base, codec: 'av01.0.09M.08' } },
  ];
  for (const accel of ['prefer-hardware', 'no-preference'] as const) {
    for (const c of candidates) {
      const config = { ...c.config, hardwareAcceleration: accel };
      try {
        const res = await VideoEncoder.isConfigSupported(config);
        if (res.supported) return { ...c, config };
      } catch {
        /* try next */
      }
    }
  }
  return null;
}

export async function pickAudioConfig(): Promise<AudioChoice | null> {
  if (typeof AudioEncoder === 'undefined') return null;
  const candidates: AudioChoice[] = [
    {
      muxCodec: 'aac',
      label: 'AAC',
      config: { codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2, bitrate: 160_000 },
    },
    {
      muxCodec: 'opus',
      label: 'Opus',
      config: { codec: 'opus', sampleRate: 48000, numberOfChannels: 2, bitrate: 160_000 },
    },
  ];
  for (const c of candidates) {
    try {
      const res = await AudioEncoder.isConfigSupported(c.config);
      if (res.supported) return c;
    } catch {
      /* try next */
    }
  }
  return null;
}
