import { extractColors, type FlagColors } from './color';
import { getBlob } from './images';

export type FlagAsset = { bitmap: ImageBitmap; colors: FlagColors };

/** Raster size used for discs. Large enough for every in-battle size on a 1080p canvas. */
export const FLAG_RASTER = 256;
export const WINNER_RASTER = 768;

const cache = new Map<string, Promise<FlagAsset>>();

async function loadImageElement(src: string): Promise<{ img: HTMLImageElement; revoke?: () => void }> {
  let url = src;
  let revoke: (() => void) | undefined;
  if (src.startsWith('idb:')) {
    const blob = await getBlob(src.slice(4));
    if (!blob) throw new Error('Image missing from storage');
    url = URL.createObjectURL(blob);
    revoke = () => URL.revokeObjectURL(url);
  }
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  await img.decode();
  return { img, revoke };
}

/**
 * Pre-rasterizes a flag (SVG, PNG, JPG, data URL or IndexedDB image) to a square ImageBitmap
 * once, center-cropped, so frames never touch SVG decoding.
 */
export function loadFlag(src: string, size = FLAG_RASTER): Promise<FlagAsset> {
  const key = `${size}|${src}`;
  let p = cache.get(key);
  if (!p) {
    p = (async () => {
      const { img, revoke } = await loadImageElement(src);
      try {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext('2d')!;
        const w = img.naturalWidth || size;
        const h = img.naturalHeight || size;
        const s = Math.max(size / w, size / h);
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, (size - w * s) / 2, (size - h * s) / 2, w * s, h * s);
        const bitmap = await createImageBitmap(canvas);
        return { bitmap, colors: extractColors(bitmap) };
      } finally {
        revoke?.();
      }
    })();
    cache.set(key, p);
    p.catch(() => cache.delete(key));
  }
  return p;
}

/** Fallback asset (solid disc) for images that fail to load. */
export async function placeholderFlag(color = '#2A2F3B'): Promise<FlagAsset> {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 64, 64);
  return { bitmap: await createImageBitmap(c), colors: { accent: '#8A93A6', palette: ['#8A93A6'] } };
}

export async function loadFlagSafe(src: string, size = FLAG_RASTER): Promise<FlagAsset> {
  try {
    return await loadFlag(src, size);
  } catch {
    return placeholderFlag();
  }
}
