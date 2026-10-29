/**
 * Spoiler-free YouTube thumbnails for every game: a frame from early in the video (everyone
 * still in play) with a bold question on top. It never shows the winner, unlike the frame
 * YouTube would pick automatically, which is often the big winner card at the end.
 */
import type { ContentFormat } from '../autopilot/types';
import type { Look } from '../engine/types';
import { createCanvas, context2d, FONT_DISPLAY, type Ctx2D } from '../render/canvas';
import { THEMES } from '../render/themes';

/** YouTube's recommended sizes (and under the 2 MB thumbnail limit as JPEG). */
const SIZE: Record<ContentFormat, { W: number; H: number }> = {
  short: { W: 1080, H: 1920 },
  video: { W: 1280, H: 720 },
};

function fitLines(
  ctx: Ctx2D,
  text: string,
  maxW: number,
  size: number,
  minSize: number,
): { lines: string[]; size: number } {
  for (let s = size; s >= minSize; s -= 4) {
    ctx.font = `${s}px ${FONT_DISPLAY}`;
    if (ctx.measureText(text).width <= maxW) return { lines: [text], size: s };
  }
  // Two lines, split near the middle word boundary.
  const words = text.split(' ');
  let best = { lines: [text], width: Infinity };
  ctx.font = `${size}px ${FONT_DISPLAY}`;
  for (let i = 1; i < words.length; i++) {
    const lines = [words.slice(0, i).join(' '), words.slice(i).join(' ')];
    const width = Math.max(...lines.map((l) => ctx.measureText(l).width));
    if (width < best.width) best = { lines, width };
  }
  const s = Math.max(minSize, Math.min(size, Math.floor((size * maxW) / best.width)));
  return { lines: best.lines, size: s };
}

function shout(
  ctx: Ctx2D,
  text: string,
  x: number,
  y: number,
  size: number,
  fill: string,
  glow: string,
): void {
  ctx.font = `${size}px ${FONT_DISPLAY}`;
  ctx.lineJoin = 'round';
  ctx.shadowColor = glow;
  ctx.shadowBlur = size * 0.35;
  ctx.lineWidth = size * 0.16;
  ctx.strokeStyle = 'rgba(0,0,0,0.92)';
  ctx.strokeText(text, x, y);
  ctx.shadowBlur = 0;
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

/** A round "?" badge. */
function badge(ctx: Ctx2D, x: number, y: number, r: number, accent: string): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = accent;
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = r * 0.5;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = r * 0.1;
  ctx.strokeStyle = '#000';
  ctx.stroke();
  ctx.font = `${Math.round(r * 1.5)}px ${FONT_DISPLAY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#0B0D13';
  ctx.fillText('?', x, y + r * 0.08);
}

/** Draws `draw`'s frame at the thumbnail size, adds the question and badge, and encodes a JPEG. */
export async function composeThumbnail(args: {
  format: ContentFormat;
  theme: Look['theme'];
  hook: string;
  sub: string;
  draw: (ctx: Ctx2D, W: number, H: number) => void;
}): Promise<Uint8Array> {
  const { format, hook, sub } = args;
  const { W, H } = SIZE[format];
  await document.fonts.load(`120px ${FONT_DISPLAY}`).catch(() => undefined);
  const canvas = createCanvas(W, H);
  const ctx = context2d(canvas, { alpha: false });
  args.draw(ctx, W, H);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const accent = THEMES[args.theme].accent;
  const short = format === 'short';

  if (short) {
    // Text across the top (the arena fills the middle of a vertical frame).
    const band = H * 0.36;
    const g = ctx.createLinearGradient(0, 0, 0, band);
    g.addColorStop(0, 'rgba(0,0,0,0.82)');
    g.addColorStop(0.65, 'rgba(0,0,0,0.45)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, band);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const head = fitLines(ctx, hook, W * 0.9, 190, 110);
    let y = H * 0.1;
    for (const line of head.lines) {
      shout(ctx, line, W / 2, y, head.size, '#FFFFFF', accent);
      y += head.size * 0.95;
    }
    const subFit = fitLines(ctx, sub, W * 0.76, 96, 48);
    shout(ctx, subFit.lines.join(' '), W / 2, y + subFit.size * 0.1, subFit.size, accent, 'rgba(0,0,0,0.6)');
    badge(ctx, W - 150, H - 350, 110, accent);
  } else {
    // 16:9 puts the arena on the right; the text takes the left column.
    const g = ctx.createLinearGradient(0, 0, W * 0.55, 0);
    g.addColorStop(0, 'rgba(0,0,0,0.85)');
    g.addColorStop(0.7, 'rgba(0,0,0,0.55)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W * 0.55, H);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const x = W * 0.05;
    const colW = W * 0.4;
    const words = hook.split(' ');
    // Two short lines read best at thumbnail size.
    const lines = words.length <= 2 ? [hook] : [words.slice(0, 2).join(' '), words.slice(2).join(' ')];
    let size = 150;
    ctx.font = `${size}px ${FONT_DISPLAY}`;
    const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
    if (widest > colW) size = Math.max(70, Math.floor((size * colW) / widest));
    const lh = size * 0.92;
    const subSize = 54;
    let y = (H - (lines.length * lh + subSize * 1.4)) / 2 - H * 0.06 + lh / 2;
    for (const line of lines) {
      shout(ctx, line, x, y, size, '#FFFFFF', accent);
      y += lh;
    }
    const subFit = fitLines(ctx, sub, colW, subSize, 34);
    shout(ctx, subFit.lines.join(' '), x, y + subFit.size * 0.2, subFit.size, accent, 'rgba(0,0,0,0.6)');
    badge(ctx, x + 64, H - 110, 62, accent);
  }

  const blob =
    'convertToBlob' in canvas
      ? await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 })
      : await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(
            (b) => (b ? resolve(b) : reject(new Error('Thumbnail encoding failed'))),
            'image/jpeg',
            0.9,
          ),
        );
  return new Uint8Array(await blob.arrayBuffer());
}
