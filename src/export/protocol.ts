import type { MusicId, Stereo } from '../audio/synth';
import type { Look, SimConfig } from '../engine/types';

export type ExportFighter = {
  id: string;
  name: string;
  isCountry: boolean;
  accent: string;
  palette: string[];
  image: ImageBitmap | null;
};

export type ExportRequest = {
  type: 'start';
  config: SimConfig;
  look: Look;
  fighters: ExportFighter[];
  winnerImage: ImageBitmap | null;
  fps: 30 | 60;
  bitrate: number;
  audio: {
    enabled: boolean;
    sfxVolume: number;
    musicVolume: number;
    musicId: MusicId | null;
    custom: Stereo | null;
  };
  fonts: { family: string; url: string; descriptors: FontFaceDescriptors }[];
};

export type ExportMessage =
  | { type: 'progress'; frame: number; total: number; stage: 'audio' | 'video' | 'finalizing' }
  | { type: 'thumb'; bitmap: ImageBitmap }
  | {
      type: 'done';
      buffer: ArrayBuffer;
      mime: string;
      ext: string;
      videoCodec: string;
      audioCodec: string | null;
    }
  | { type: 'unsupported'; reason: string }
  | { type: 'error'; message: string }
  | { type: 'cancelled' };
