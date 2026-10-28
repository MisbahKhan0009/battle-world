export type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;
export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export type ImageSource = ImageBitmap | AnyCanvas;

/** Creates an offscreen canvas when available (workers, modern browsers), else a DOM canvas. */
export function createCanvas(width: number, height: number): AnyCanvas {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export function context2d(canvas: AnyCanvas, opts?: CanvasRenderingContext2DSettings): Ctx2D {
  const ctx = canvas.getContext('2d', opts) as Ctx2D | null;
  if (!ctx) throw new Error('Canvas 2D is not available');
  return ctx;
}

export const FONT_DISPLAY = '"Bebas Neue", "Arial Narrow", Impact, sans-serif';
export const FONT_SANS = '"Geist Variable", Geist, system-ui, -apple-system, "Segoe UI", sans-serif';
