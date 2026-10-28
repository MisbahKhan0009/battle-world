import type { Fighter, Preset } from '../engine/types';
import { blobToDataUrl, dataUrlToBlob, getBlob, saveBlob } from './images';
import { uid } from './utils';

type PresetFile = { app: 'flag-clash'; version: 1; preset: Preset };

/** Serializes a preset with uploaded images embedded as data URLs. */
export async function exportPresetFile(p: Preset): Promise<Blob> {
  const fighters: Fighter[] = await Promise.all(
    p.fighters.map(async (f) => {
      if (!f.imageSrc.startsWith('idb:')) return f;
      const blob = await getBlob(f.imageSrc.slice(4));
      return { ...f, imageSrc: blob ? await blobToDataUrl(blob) : f.imageSrc };
    }),
  );
  const file: PresetFile = { app: 'flag-clash', version: 1, preset: { ...p, fighters } };
  return new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
}

/** Parses a preset file and moves embedded images into IndexedDB. */
export async function importPresetFile(file: File): Promise<Preset> {
  let parsed: PresetFile;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  if (parsed?.app !== 'flag-clash' || !parsed.preset || !Array.isArray(parsed.preset.fighters)) {
    throw new Error('That file is not a Flag Clash preset.');
  }
  const p = parsed.preset;
  const fighters: Fighter[] = await Promise.all(
    p.fighters.slice(0, 64).map(async (f) => {
      let imageSrc = String(f.imageSrc ?? '');
      if (imageSrc.startsWith('data:'))
        imageSrc = `idb:${await saveBlob('img', await dataUrlToBlob(imageSrc))}`;
      return {
        id: uid(),
        kind: f.kind === 'custom' ? 'custom' : 'country',
        iso2: f.iso2,
        name: String(f.name ?? 'Fighter').slice(0, 40),
        imageSrc,
        accent: typeof f.accent === 'string' ? f.accent : '',
        hp: Number(f.hp) || 100,
        size: Number(f.size) || 1,
        speed: Number(f.speed) || 1,
        attack: Number(f.attack) || 1,
      } satisfies Fighter;
    }),
  );
  return { ...p, id: uid(), name: String(p.name ?? 'Imported preset'), fighters, updatedAt: Date.now() };
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
