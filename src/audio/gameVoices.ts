/** Voices that live outside synth.ts (one file per game), registered there in one go. */
import { gulp, whomp } from './holeVoices';

export const GAME_VOICES: Record<string, () => Float32Array> = { gulp, whomp };
