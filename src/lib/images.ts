import { del, get, set } from 'idb-keyval';
import type { Stereo } from '../audio/synth';
import { uid } from './utils';

/** Uploaded images and music live in IndexedDB; fighters/settings keep an `idb:<key>` reference. */
export async function saveBlob(prefix: 'img' | 'music', blob: Blob): Promise<string> {
  const key = `${prefix}:${uid()}`;
  await set(key, blob);
  return key;
}

export async function getBlob(key: string): Promise<Blob | undefined> {
  return get<Blob>(key);
}

export async function deleteBlob(key: string): Promise<void> {
  await del(key);
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export async function dataUrlToBlob(url: string): Promise<Blob> {
  return (await fetch(url)).blob();
}

const musicCache = new Map<string, Promise<Stereo>>();

/** Decodes uploaded music to 48 kHz stereo (resampled by an OfflineAudioContext). */
export function decodeMusic(key: string): Promise<Stereo> {
  let p = musicCache.get(key);
  if (!p) {
    p = (async () => {
      const blob = await getBlob(key);
      if (!blob) throw new Error('The uploaded music file is missing. Upload it again.');
      const ctx = new OfflineAudioContext(2, 1, 48000);
      const audio = await ctx.decodeAudioData(await blob.arrayBuffer());
      const L = audio.getChannelData(0).slice();
      const R = audio.numberOfChannels > 1 ? audio.getChannelData(1).slice() : L.slice();
      return { L, R };
    })();
    musicCache.set(key, p);
    p.catch(() => musicCache.delete(key));
  }
  return p;
}
