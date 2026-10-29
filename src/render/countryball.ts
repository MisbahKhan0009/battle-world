/**
 * Countryballs in 2D: a flag disc with cartoon eyes (Polandball style). The eyes look where the
 * ball is going and change with what is happening (blink, squint on a hit, scared near danger,
 * determined when it matters, happy when it wins, crosses when it is out), and the disc squashes
 * on impact. Every game draws its flags this way.
 */
import { hashFloat } from '../engine/rng';
import type { AnyCanvas, Ctx2D } from './canvas';
import { TOKEN_SCALE } from './tokens';

export type Expression = 'open' | 'blink' | 'squint' | 'scared' | 'happy' | 'dead' | 'determined';

const INK = '#111318';

/**
 * Paints a pair of eyes centered at (cx, cy); `w` is the width of the pair. `look` nudges the
 * pupils of the expressions that have them (-1..1 on each axis).
 */
export function paintEyes(
  ctx: Ctx2D,
  cx: number,
  cy: number,
  w: number,
  e: Expression,
  look: [number, number] = [0, 0],
): void {
  const rx = w * 0.17;
  const ry = w * 0.21;
  const lw = w * 0.04;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = INK;
  ctx.fillStyle = '#FFFFFF';
  ctx.lineWidth = lw;
  for (const side of [-1, 1]) {
    const x = cx + side * w * 0.24;
    const y = cy;
    ctx.beginPath();
    if (e === 'open' || e === 'determined' || e === 'scared') {
      const k = e === 'scared' ? 1.12 : 1;
      ctx.ellipse(x, y, rx * k, ry * k, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (e === 'scared') {
        ctx.fillStyle = INK;
        ctx.beginPath();
        ctx.arc(x + look[0] * rx * 0.45, y + look[1] * ry * 0.45, rx * 0.26, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#FFFFFF';
      }
      if (e === 'determined') {
        // A brow slanting down toward the middle.
        ctx.lineWidth = lw * 1.6;
        ctx.beginPath();
        ctx.moveTo(x + side * rx * 1.15, y - ry * 1.25);
        ctx.lineTo(x - side * rx * 0.95, y - ry * 0.55);
        ctx.stroke();
        ctx.lineWidth = lw;
      }
    } else if (e === 'blink') {
      ctx.moveTo(x - rx, y + ry * 0.1);
      ctx.quadraticCurveTo(x, y + ry * 0.45, x + rx, y + ry * 0.1);
      ctx.stroke();
    } else if (e === 'squint') {
      // ">" on the left eye, "<" on the right.
      ctx.moveTo(x - side * rx, y - ry * 0.7);
      ctx.lineTo(x + side * rx * 0.8, y);
      ctx.lineTo(x - side * rx, y + ry * 0.7);
      ctx.stroke();
    } else if (e === 'happy') {
      ctx.moveTo(x - rx, y + ry * 0.35);
      ctx.quadraticCurveTo(x, y - ry * 1.1, x + rx, y + ry * 0.35);
      ctx.stroke();
    } else if (e === 'dead') {
      ctx.moveTo(x - rx * 0.8, y - ry * 0.7);
      ctx.lineTo(x + rx * 0.8, y + ry * 0.7);
      ctx.moveTo(x + rx * 0.8, y - ry * 0.7);
      ctx.lineTo(x - rx * 0.8, y + ry * 0.7);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** Blinks every few seconds, at its own rhythm. */
export function blinking(seed: number, i: number, t: number): boolean {
  const period = 2.6 + 2.2 * hashFloat(seed, i, 0xb11);
  const phase = (t + period * hashFloat(seed, i, 0xb12)) % period;
  return phase < 0.12;
}

/**
 * Draws a countryball centered at (x, y) with radius r: the baked flag disc, then its eyes. `look`
 * shifts the eyes toward where it is heading (-1..1 each way); `squash` flattens it along `angle`
 * (radians) for a bounce, and `spin` rolls the flag (the eyes stay upright).
 */
export function drawCountryball(
  ctx: Ctx2D,
  token: AnyCanvas,
  x: number,
  y: number,
  r: number,
  opts: { expression: Expression; look?: [number, number]; squash?: number; angle?: number; spin?: number },
): void {
  const size = 2 * r * TOKEN_SCALE;
  const [lx, ly] = opts.look ?? [0, 0];
  const q = opts.squash ?? 0;
  const a = opts.angle ?? 0;
  ctx.save();
  ctx.translate(x, y);
  if (q) {
    ctx.rotate(a);
    ctx.scale(1 - q, 1 + q * 0.7);
    ctx.rotate(-a);
  }
  if (opts.spin) {
    ctx.save();
    ctx.rotate(opts.spin);
    ctx.drawImage(token, -size / 2, -size / 2, size, size);
    ctx.restore();
  } else ctx.drawImage(token, -size / 2, -size / 2, size, size);
  paintEyes(ctx, lx * r * 0.22, -r * 0.08 + ly * r * 0.16, r * 1.24, opts.expression, [lx, ly]);
  ctx.restore();
}
