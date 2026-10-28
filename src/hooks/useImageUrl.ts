import { useEffect, useState } from 'react';
import { getBlob } from '../lib/images';

const urls = new Map<string, Promise<string>>();

/** Resolves `idb:` image references to object URLs (cached for the session). */
export function resolveImageUrl(src: string): Promise<string> {
  if (!src.startsWith('idb:')) return Promise.resolve(src);
  let p = urls.get(src);
  if (!p) {
    p = getBlob(src.slice(4)).then((b) => (b ? URL.createObjectURL(b) : ''));
    urls.set(src, p);
  }
  return p;
}

export function useImageUrl(src: string): string {
  const [url, setUrl] = useState(() => (src.startsWith('idb:') ? '' : src));
  useEffect(() => {
    let live = true;
    resolveImageUrl(src).then((u) => live && setUrl(u));
    return () => {
      live = false;
    };
  }, [src]);
  return src.startsWith('idb:') ? url : src;
}
