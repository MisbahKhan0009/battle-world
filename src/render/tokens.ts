import { context2d, createCanvas, type AnyCanvas, type ImageSource } from './canvas';

/** Padding around the disc (fraction of diameter) that holds the baked drop shadow. */
export const TOKEN_PAD = 0.2;
export const TOKEN_SCALE = 1 + 2 * TOKEN_PAD;

/**
 * Bakes a flag into a disc token: circular clip, white rim, soft drop shadow and a gloss
 * highlight. Baking once per size keeps shadowBlur and clipping out of the per-frame path.
 */
export function bakeToken(image: ImageSource | null, diameterPx: number, fallback: string): AnyCanvas {
  const D = Math.max(8, Math.round(diameterPx));
  const S = Math.ceil(D * TOKEN_SCALE);
  const c = createCanvas(S, S);
  const ctx = context2d(c);
  const cx = S / 2;
  const R = D / 2;
  const rim = Math.max(2, D * 0.05);

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = D * 0.14;
  ctx.shadowOffsetY = D * 0.06;
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.arc(cx, cx, R, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cx, R - rim, 0, Math.PI * 2);
  ctx.clip();
  if (image) {
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, cx - R, cx - R, D, D);
  } else {
    ctx.fillStyle = fallback;
    ctx.fillRect(cx - R, cx - R, D, D);
  }
  // Gloss highlight and soft inner edge for depth.
  const g = ctx.createRadialGradient(cx - R * 0.35, cx - R * 0.45, R * 0.1, cx, cx, R);
  g.addColorStop(0, 'rgba(255,255,255,0.28)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.04)');
  g.addColorStop(1, 'rgba(0,0,0,0.22)');
  ctx.fillStyle = g;
  ctx.fillRect(cx - R, cx - R, D, D);
  ctx.restore();
  return c;
}

/** Per-fighter token cache keyed by pixel size bucket. */
export class TokenCache {
  private cache = new Map<string, AnyCanvas>();

  constructor(
    private readonly images: (ImageSource | null)[],
    private readonly fallbacks: string[],
  ) {}

  get(i: number, diameterPx: number): AnyCanvas {
    // Bucket sizes (8% steps) so zooming does not rebake every frame.
    const bucket = Math.max(8, Math.round(Math.pow(1.08, Math.ceil(Math.log(diameterPx) / Math.log(1.08)))));
    const key = `${i}:${bucket}`;
    let c = this.cache.get(key);
    if (!c) {
      c = bakeToken(this.images[i], bucket, this.fallbacks[i]);
      this.cache.set(key, c);
    }
    return c;
  }

  clear(): void {
    this.cache.clear();
  }
}
