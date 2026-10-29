/** Voices that live outside synth.ts (one file per game), registered there in one go. */
import { gulp, whomp } from './holeVoices';
import { horn, wardrum } from './territoryVoices';

export const GAME_VOICES: Record<string, () => Float32Array> = { wardrum, horn, gulp, whomp };
