import type { Fighter } from '../engine/types';
import type { SceneFighter } from '../render/scene';
import { loadFlagSafe } from './flags';

/** Loads (cached) flag rasters and resolves accents for a roster. */
export async function loadSceneFighters(fighters: Fighter[]): Promise<SceneFighter[]> {
  const assets = await Promise.all(fighters.map((f) => loadFlagSafe(f.imageSrc)));
  return fighters.map((f, i) => ({
    id: f.id,
    name: f.name,
    isCountry: f.kind === 'country',
    accent: f.accent || assets[i].colors.accent,
    palette: assets[i].colors.palette,
    image: assets[i].bitmap,
  }));
}

export function buildFilename(
  template: string,
  vars: { count: number; winner: string; seed: number },
): string {
  const name = template
    .replace(/\{count\}/g, String(vars.count))
    .replace(/\{winner\}/g, vars.winner)
    .replace(/\{seed\}/g, String(vars.seed))
    .replace(/[\\/:*?"<>|]+/g, '-')
    .trim();
  return name.replace(/\.(mp4|webm)$/i, '') || 'flag-clash';
}

export function hashtagsFor(
  winner: string,
  count: number,
  mode: 'escape' | 'royale' = 'escape',
): { title: string; tags: string } {
  const clean = winner.replace(/[^\p{L}\p{N}]+/gu, '');
  return {
    title:
      mode === 'escape'
        ? `${count} countries, one rotating exit. Who stays inside the longest? ${winner} does!`
        : `${count} countries battle it out. Can you guess the winner? ${winner} takes it!`,
    tags: `#shorts #flags #countryballs #flagbattle #countries #${clean.toLowerCase()} #geography #marblerace`,
  };
}
