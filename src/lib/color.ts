import { context2d, createCanvas, type ImageSource } from '../render/canvas';

export type FlagColors = { accent: string; palette: string[] };

const hex = (r: number, g: number, b: number) =>
  '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

function saturation(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

/**
 * Extracts a small palette from a flag by bucketing a 32x32 downsample.
 * The accent is the most prominent saturated color (falls back to the dominant one).
 */
export function extractColors(img: ImageSource): FlagColors {
  const size = 32;
  const c = createCanvas(size, size);
  const ctx = context2d(c, { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, size, size);
  const { data } = ctx.getImageData(0, 0, size, size);
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const key = ((data[i] >> 5) << 6) | ((data[i + 1] >> 5) << 3) | (data[i + 2] >> 5);
    const e = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    e.n++;
    e.r += data[i];
    e.g += data[i + 1];
    e.b += data[i + 2];
    buckets.set(key, e);
  }
  const total = [...buckets.values()].reduce((s, e) => s + e.n, 0) || 1;
  const colors = [...buckets.values()]
    .map((e) => ({ r: e.r / e.n, g: e.g / e.n, b: e.b / e.n, w: e.n / total }))
    .sort((a, b) => b.w - a.w);

  const picked: typeof colors = [];
  for (const col of colors) {
    if (col.w < 0.03) break;
    if (picked.some((p) => Math.hypot(p.r - col.r, p.g - col.g, p.b - col.b) < 70)) continue;
    picked.push(col);
    if (picked.length === 4) break;
  }
  if (!picked.length) return { accent: '#C6FF3D', palette: ['#FFFFFF', '#C6FF3D'] };

  const vivid = picked
    .filter((c) => c.w >= 0.08 && saturation(c.r, c.g, c.b) > 0.35 && Math.max(c.r, c.g, c.b) > 70)
    .sort((a, b) => b.w * (0.5 + saturation(b.r, b.g, b.b)) - a.w * (0.5 + saturation(a.r, a.g, a.b)));
  const accent =
    vivid[0] ??
    picked.find((c) => Math.max(c.r, c.g, c.b) > 60 && Math.min(c.r, c.g, c.b) < 220) ??
    picked[0];
  return { accent: hex(accent.r, accent.g, accent.b), palette: picked.map((c) => hex(c.r, c.g, c.b)) };
}

export function hexToRgb(h: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(h.trim());
  if (!m) return [198, 255, 61];
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export function withAlpha(h: string, a: number): string {
  const [r, g, b] = hexToRgb(h);
  return `rgba(${r},${g},${b},${a})`;
}
