/**
 * Shared overlay type for every game's video: readable text over any arena, the accent band that
 * carries announcements, and the winner's name lockup. One treatment everywhere, colored by each
 * game's own theme.
 */
import { FONT_DISPLAY, FONT_SANS, type Ctx2D } from './canvas';
import { easeOut } from './effects';
import type { Theme } from './themes';

/** Font size in design pixels from the context's current font. */
function fontPx(ctx: Ctx2D): number {
  const m = /(\d+(?:\.\d+)?)px/.exec(ctx.font);
  return m ? Number(m[1]) : 32;
}

/**
 * Text that reads over a busy arena: a soft drop shadow under the glyphs instead of a heavy
 * outline. Shadows ignore the canvas transform, so they are scaled by it here.
 */
export function legibleText(
  ctx: Ctx2D,
  theme: Theme,
  text: string,
  x: number,
  y: number,
  fill: string,
): void {
  const size = fontPx(ctx);
  const scale = ctx.getTransform().a;
  ctx.save();
  ctx.shadowColor = theme.dark ? 'rgba(0,0,0,0.62)' : 'rgba(60,40,30,0.2)';
  ctx.shadowBlur = size * (theme.dark ? 0.24 : 0.14) * scale;
  ctx.shadowOffsetY = size * 0.07 * scale;
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
  ctx.restore();
}

/** Ink or white, whichever reads better on a solid color. */
export function inkOn(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return '#0B0D12';
  const v = parseInt(m[1], 16);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const L = 0.2126 * lin((v >> 16) & 255) + 0.7152 * lin((v >> 8) & 255) + 0.0722 * lin(v & 255);
  // Contrast against near-black (L 0.006) versus white (L 1).
  return (L + 0.05) / 0.056 >= 1.05 / (L + 0.05) ? '#0B0D12' : '#FFFFFF';
}

/**
 * An announcement ("FINAL STRETCH", "MEXICO TAKES THE LEAD"): a solid band in the game's accent
 * that wipes in from the left, holds, and wipes out to the right. `u` is seconds since it started.
 */
export function bandBanner(
  ctx: Ctx2D,
  theme: Theme,
  args: { text: string; u: number; life: number; cx: number; y: number; maxW: number; size: number },
): void {
  const { text, u, life, cx, y, maxW } = args;
  if (u < 0 || u > life) return;
  let size = args.size;
  ctx.font = `${size}px ${FONT_DISPLAY}`;
  const pad = size * 0.42;
  let tw = ctx.measureText(text).width;
  if (tw + 2 * pad > maxW) {
    size *= (maxW - 2 * pad) / tw;
    ctx.font = `${size}px ${FONT_DISPLAY}`;
    tw = ctx.measureText(text).width;
  }
  const w = tw + 2 * size * 0.42;
  const h = size * 1.08;
  const x0 = cx - w / 2;
  const inP = easeOut(u / 0.26);
  const outP = u > life - 0.24 ? easeOut((u - (life - 0.24)) / 0.24) : 0;
  const left = x0 + w * outP;
  const right = x0 + w * inP;
  if (right <= left) return;
  const scale = ctx.getTransform().a;
  ctx.save();
  // Band with a soft, offset shadow so it sits above the arena.
  ctx.shadowColor = theme.dark ? 'rgba(0,0,0,0.5)' : 'rgba(60,40,30,0.18)';
  ctx.shadowBlur = h * 0.35 * scale;
  ctx.shadowOffsetY = h * 0.1 * scale;
  ctx.fillStyle = theme.accent;
  ctx.fillRect(left, y - h / 2, right - left, h);
  ctx.restore();
  ctx.save();
  ctx.beginPath();
  ctx.rect(left, y - h / 2, right - left, h);
  ctx.clip();
  ctx.fillStyle = inkOn(theme.accent);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // The words trail the wipe slightly, so they settle into place.
  ctx.fillText(text, cx - size * 0.3 * (1 - inP), y + size * 0.04);
  ctx.restore();
}

/**
 * The winner's lockup under the flag: the name, the game's verb in the accent ("WINS",
 * "ESCAPES FIRST"), then one plain line of what happened.
 */
export function winnerLockup(
  ctx: Ctx2D,
  theme: Theme,
  args: {
    name: string;
    verb: string;
    line: string;
    x: number;
    y: number;
    maxW: number;
    m: number;
    t: number;
  },
): void {
  const { name, verb, line, x, maxW, m, t } = args;
  const rise = (1 - t) * 18;
  ctx.save();
  ctx.globalAlpha *= t;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  let size = m * 0.15;
  ctx.font = `${size}px ${FONT_DISPLAY}`;
  const nw = ctx.measureText(name).width;
  if (nw > maxW) {
    size *= maxW / nw;
    ctx.font = `${size}px ${FONT_DISPLAY}`;
  }
  const nameY = args.y + size * 0.8 + rise;
  legibleText(ctx, theme, name, x, nameY, theme.text);
  const vs = m * 0.072;
  ctx.font = `${vs}px ${FONT_DISPLAY}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${Math.round(vs * 0.06)}px`;
  const verbY = nameY + vs * 1.05;
  legibleText(ctx, theme, verb, x, verbY, theme.accent);
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  ctx.font = `500 ${m * 0.032}px ${FONT_SANS}`;
  legibleText(ctx, theme, line, x, verbY + m * 0.07, theme.subtext);
  ctx.restore();
}
