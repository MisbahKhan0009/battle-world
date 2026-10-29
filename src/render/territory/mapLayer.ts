/**
 * The pixel map for Territory Wars, painted straight into an ImageData buffer: sea, empty land,
 * and every country's land textured with its own flag (stretched to cover the territory, so a
 * country that takes over the world flies one giant flag). Each map cell is TEX x TEX pixels with
 * a faint grid line, borders in the country's color, and a white flash on freshly taken cells.
 *
 * The owner grid is replayed from the recorded changes and only repainted when the tick changes,
 * so scrubbing forward is incremental and scrubbing back replays from the start.
 */
import { context2d, createCanvas, type AnyCanvas } from '../canvas';
import type { Theme } from '../themes';
import type { TerritoryScene } from './scene';

/** Pixels per map cell in the painted layer. */
export const TEX = 4;
/** Flags are sampled at this resolution. */
const FLAG = 48;
/** A freshly taken cell flashes for this long (sim seconds). */
const FLASH = 0.3;

type RGB = [number, number, number];

function rgb(hex: string): RGB {
  const m = /^#?([0-9a-f]{6})/i.exec(hex);
  const v = m ? parseInt(m[1], 16) : 0x888888;
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** Packs a color for a little-endian Uint32 view of RGBA pixels. */
const pack = (r: number, g: number, b: number) => ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
const shade = (c: RGB, k: number) => pack(c[0] * k, c[1] * k, c[2] * k);

export class MapLayer {
  readonly canvas: AnyCanvas;
  private readonly ctx;
  private readonly image: ImageData;
  private readonly px: Uint32Array;
  private readonly owner: Int16Array;
  private readonly takenAt: Int32Array;
  private readonly flags: Uint32Array[];
  private readonly sea: RGB;
  private readonly land: RGB;
  private readonly edges: number[];
  private tick = -1;

  constructor(
    private readonly scene: TerritoryScene,
    theme: Theme,
  ) {
    const { cols, rows } = scene.map;
    this.canvas = createCanvas(cols * TEX, rows * TEX);
    this.ctx = context2d(this.canvas);
    this.image = this.ctx.createImageData(cols * TEX, rows * TEX);
    this.px = new Uint32Array(this.image.data.buffer);
    this.owner = new Int16Array(cols * rows).fill(-1);
    this.takenAt = new Int32Array(cols * rows).fill(-1_000_000);
    this.sea = rgb(theme.floorOuter);
    this.land = rgb(theme.floorInner);
    this.edges = scene.colors.map((c) => shade(rgb(c), 0.62));
    this.flags = scene.result.show.entrants[0].map((f) => this.sampleFlag(f));
  }

  /** The flag as FLAG x FLAG packed pixels (its solid color when it has no image). */
  private sampleFlag(f: number): Uint32Array {
    const out = new Uint32Array(FLAG * FLAG);
    const img = this.scene.fighters[f].image;
    const solid = rgb(this.scene.colors[f]);
    if (!img) return out.fill(pack(...solid));
    const c = createCanvas(FLAG, FLAG);
    const x = context2d(c);
    x.fillStyle = this.scene.colors[f];
    x.fillRect(0, 0, FLAG, FLAG);
    x.drawImage(img, 0, 0, FLAG, FLAG);
    const d = x.getImageData(0, 0, FLAG, FLAG).data;
    for (let k = 0; k < out.length; k++) out[k] = pack(d[k * 4], d[k * 4 + 1], d[k * 4 + 2]);
    return out;
  }

  /** Brings the layer to recorded tick `tick` and repaints it if anything changed. */
  update(tick: number): void {
    if (tick === this.tick) return;
    const rec = this.scene.round.rec!;
    if (tick < this.tick) {
      this.owner.fill(-1);
      this.takenAt.fill(-1_000_000);
      this.tick = -1;
    }
    for (let g = this.tick + 1; g <= tick; g++) {
      for (let k = rec.changeStart[g]; k < rec.changeStart[g + 1]; k++) {
        this.owner[rec.cells[k]] = rec.owners[k] - 1;
        if (g > 0) this.takenAt[rec.cells[k]] = g;
      }
    }
    this.tick = tick;
    this.paint();
  }

  private paint(): void {
    const { cols, rows, land } = this.scene.map;
    const { owner, px, takenAt } = this;
    const W = cols * TEX;
    const n = this.flags.length;
    // Each territory's bounding box, for stretching its flag over it.
    const x0 = new Int32Array(n).fill(cols);
    const x1 = new Int32Array(n).fill(-1);
    const y0 = new Int32Array(n).fill(rows);
    const y1 = new Int32Array(n).fill(-1);
    for (let q = 0; q < owner.length; q++) {
      const o = owner[q];
      if (o < 0) continue;
      const c = q % cols;
      const r = (q - c) / cols;
      if (c < x0[o]) x0[o] = c;
      if (c > x1[o]) x1[o] = c;
      if (r < y0[o]) y0[o] = r;
      if (r > y1[o]) y1[o] = r;
    }
    const sea = pack(...this.sea);
    const flat = pack(...this.land);
    const flatGrid = shade(this.land, 0.93);
    const coast = shade(this.land, 0.78);
    const rate = this.scene.round.config.rate;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const q = r * cols + c;
        const base = r * TEX * W + c * TEX;
        if (!land[q]) {
          for (let y = 0; y < TEX; y++) px.fill(sea, base + y * W, base + y * W + TEX);
          continue;
        }
        const o = owner[q];
        // Which sides border something else (a rival, empty land or the sea)?
        const up = r > 0 ? owner[q - cols] !== o || !land[q - cols] : true;
        const dn = r < rows - 1 ? owner[q + cols] !== o || !land[q + cols] : true;
        const lf = c > 0 ? owner[q - 1] !== o || !land[q - 1] : true;
        const rt = c < cols - 1 ? owner[q + 1] !== o || !land[q + 1] : true;
        if (o < 0) {
          for (let y = 0; y < TEX; y++)
            for (let x = 0; x < TEX; x++) {
              const edge =
                (y === 0 && up) || (y === TEX - 1 && dn) || (x === 0 && lf) || (x === TEX - 1 && rt);
              px[base + y * W + x] = edge ? coast : x === TEX - 1 || y === TEX - 1 ? flatGrid : flat;
            }
          continue;
        }
        const flag = this.flags[o];
        const side = Math.max(x1[o] - x0[o] + 1, y1[o] - y0[o] + 1) * TEX;
        const fx = ((x0[o] + x1[o] + 1) * TEX) / 2 - side / 2;
        const fy = ((y0[o] + y1[o] + 1) * TEX) / 2 - side / 2;
        const age = (this.tick - takenAt[q]) / rate;
        const flash = age < FLASH ? 0.75 * (1 - age / FLASH) : 0;
        const edgeCol = this.edges[o];
        for (let y = 0; y < TEX; y++) {
          const Y = r * TEX + y;
          const v = Math.min(FLAG - 1, Math.floor(((Y - fy) / side) * FLAG));
          for (let x = 0; x < TEX; x++) {
            const X = c * TEX + x;
            const edge = (y === 0 && up) || (y === TEX - 1 && dn) || (x === 0 && lf) || (x === TEX - 1 && rt);
            let col = edge
              ? edgeCol
              : flag[v * FLAG + Math.min(FLAG - 1, Math.floor(((X - fx) / side) * FLAG))];
            if (!edge && (x === TEX - 1 || y === TEX - 1)) col = dim(col, 0.9);
            if (flash) col = toward(col, flash);
            px[Y * W + X] = col;
          }
        }
      }
    }
    this.ctx.putImageData(this.image, 0, 0);
  }
}

function dim(c: number, k: number): number {
  return pack((c & 255) * k, ((c >> 8) & 255) * k, ((c >> 16) & 255) * k);
}

/** Blends a packed color toward white by `k`. */
function toward(c: number, k: number): number {
  const f = (v: number) => v + (255 - v) * k;
  return pack(f(c & 255), f((c >> 8) & 255), f((c >> 16) & 255));
}
