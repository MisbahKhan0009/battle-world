import type { Look } from '../engine/types';
import type { ExportContent } from './production';

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
  content: ExportContent;
  look: Look;
  fighters: ExportFighter[];
  winnerImage: ImageBitmap | null;
  fps: 30 | 60;
  bitrate: number;
  /** Sound effects only (no background music). */
  audio: { enabled: boolean; sfxVolume: number };
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
