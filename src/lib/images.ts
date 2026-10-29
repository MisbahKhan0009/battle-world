import { del, get, set } from 'idb-keyval';
import { uid } from './utils';

/** Uploaded images live in IndexedDB; fighters/settings keep an `idb:<key>` reference. */
export async function saveBlob(prefix: 'img', blob: Blob): Promise<string> {
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
