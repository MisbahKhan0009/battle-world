/**
 * Paper Land renderer. A square board seen from above: each flag's land is tiled with its flag
 * and stands a little off the paper, trails are drawn in the flag's color, and the head is the
 * flag's disc. Claims flash, wiped-out land fades, knock-outs burst into paper scraps, and the
 * flag with the most land wears a crown. Titles, banners, the intro, winner card and outro come
 * from the shared show frame.
 */
import { hashFloat } from '../../engine/rng';
import { context2d, createCanvas, FONT_DISPLAY, type AnyCanvas, type Ctx2D } from '../canvas';
import { easeOut } from '../effects';
import { ShowRenderer, type BoardRow } from '../show';
import { TOKEN_SCALE } from '../tokens';
import {
  boardAt,
  headAt,
  lastBefore,
  leaderAt,
  roundOf,
  sharesAt,
  stateAt,
  tickAt,
  trailAt,
  type PaperScene,
} from './scene';

const TAU = Math.PI * 2;
/** Seconds a fresh claim flashes, wiped land fades, and a knock-out bursts. */
const FLASH = 0.45;
const WIPE = 0.6;
const BURST = 0.8;

/** A #rrggbb color scaled toward black (f < 1). */
function shade(hex: string, f: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const v = parseInt(m[1], 16);
  const c = (s: number) => Math.round(((v >> s) & 255) * f);
  return `rgb(${c(16)},${c(8)},${c(0)})`;
}

const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

type Diff = { k: number; s: number; gain: Path2D; wipes: { i: number; path: Path2D }[] };

export class PaperRenderer extends ShowRenderer<PaperScene> {
  private layer: { canvas: AnyCanvas; ctx: Ctx2D; key: string } | null = null;
  private patterns = new Map<string, CanvasPattern | null>();
  private diffs: Diff[] = [];
  private grid = new Map<number, Path2D>();

  /** Board geometry for a round: side in cells, cell size and top-left corner (design px). */
  private geo(size: number) {
    const side = 2 * this.L.P;
    return { side, cs: side / size, x0: this.L.cx - this.L.P, y0: this.L.cy - this.L.P };
  }

  /** The flag tiled in a brick pattern for fighter f (null without a flag image). */
  private pattern(ctx: Ctx2D, f: number, cs: number): CanvasPattern | null {
    const key = `${f}:${cs.toFixed(2)}`;
    if (this.patterns.has(key)) return this.patterns.get(key)!;
    const fighter = this.scene.fighters[f];
    let pat: CanvasPattern | null = null;
    if (fighter.image) {
      const t = Math.max(40, cs * 2.6) * this.px;
      const g = t * 0.16;
      const step = t + g;
      const c = createCanvas(Math.round(2 * step), Math.round(2 * step));
      const tc = context2d(c);
      // Dark grout between the tiles keeps each flag readable.
      tc.fillStyle = shade(fighter.accent, 0.35);
      tc.fillRect(0, 0, 2 * step, 2 * step);
      tc.imageSmoothingQuality = 'high';
      const flag = (x: number, y: number) => {
        tc.save();
        tc.beginPath();
        tc.roundRect(x, y, t, t, t * 0.12);
        tc.clip();
        tc.drawImage(fighter.image!, x, y, t, t);
        tc.restore();
      };
      for (let j = 0; j < 2; j++) flag(g / 2 + j * step, g / 2);
      for (let j = -1; j < 2; j++) flag(g / 2 + step / 2 + j * step, step + g / 2);
      pat = ctx.createPattern(c, 'repeat');
      pat?.setTransform(new DOMMatrix().scale(1 / this.px));
    }
    this.patterns.set(key, pat);
    return pat;
  }

  /** Every flag's land on board s of round k, drawn once into an offscreen layer. */
  private landLayer(k: number, s: number): AnyCanvas {
    const round = this.scene.result.rounds[k];
    const { grids, size } = round.rec!;
    const { side, cs } = this.geo(size);
    const key = `${k}:${s}`;
    const dim = Math.round(side * this.px);
    if (!this.layer) {
      // A little taller than the board, for the lip under the bottom row.
      const canvas = createCanvas(dim, Math.round(side * 1.03 * this.px));
      this.layer = { canvas, ctx: context2d(canvas), key: '' };
    }
    if (this.layer.key === key) return this.layer.canvas;
    const { ctx: c, canvas } = this.layer;
    this.layer.key = key;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, canvas.width, canvas.height);
    c.setTransform(this.px, 0, 0, this.px, 0, 0);
    const N = size * size;
    const off = s * N;
    const ids = this.scene.result.show.entrants[k];
    const paths = ids.map(() => new Path2D());
    const edges = ids.map(() => new Path2D());
    const own = (x: number, y: number) =>
      x < 0 || y < 0 || x >= size || y >= size ? 0 : grids[off + y * size + x];
    for (let y = 0; y < size; y++) {
      let x = 0;
      while (x < size) {
        const o = grids[off + y * size + x];
        let e = x + 1;
        while (e < size && grids[off + y * size + e] === o) e++;
        if (o) paths[o - 1].rect(x * cs, y * cs, (e - x) * cs, cs);
        x = e;
      }
      for (let x2 = 0; x2 < size; x2++) {
        const o = grids[off + y * size + x2];
        if (!o) continue;
        const p = edges[o - 1];
        const X = x2 * cs;
        const Y = y * cs;
        if (own(x2, y - 1) !== o) {
          p.moveTo(X, Y);
          p.lineTo(X + cs, Y);
        }
        if (own(x2, y + 1) !== o) {
          p.moveTo(X, Y + cs);
          p.lineTo(X + cs, Y + cs);
        }
        if (own(x2 - 1, y) !== o) {
          p.moveTo(X, Y);
          p.lineTo(X, Y + cs);
        }
        if (own(x2 + 1, y) !== o) {
          p.moveTo(X + cs, Y);
          p.lineTo(X + cs, Y + cs);
        }
      }
    }
    const counts = this.scene.counts[k][s];
    // The land stands off the paper: a darker lip under every piece first, then the tops.
    const lip = cs * 0.34;
    ids.forEach((f, i) => {
      if (!counts[i]) return;
      c.save();
      c.translate(0, lip);
      c.fillStyle = shade(this.scene.fighters[f].accent, 0.5);
      c.fill(paths[i]);
      c.restore();
    });
    ids.forEach((f, i) => {
      if (!counts[i]) return;
      const accent = this.scene.fighters[f].accent;
      c.fillStyle = this.pattern(c, f, cs) ?? accent;
      c.fill(paths[i]);
      c.strokeStyle = accent;
      c.lineWidth = Math.max(2, cs * 0.2);
      c.lineCap = 'round';
      c.stroke(edges[i]);
    });
    return canvas;
  }

  /** Cells that changed hands on board s (claims flash) and land wiped out with a flag. */
  private diff(k: number, s: number): Diff {
    let d = this.diffs.find((x) => x.k === k && x.s === s);
    if (d) return d;
    const { grids, size } = this.scene.result.rounds[k].rec!;
    const { cs } = this.geo(size);
    const N = size * size;
    const gain = new Path2D();
    const wipes = new Map<number, Path2D>();
    for (let c = 0; c < N; c++) {
      const a = grids[(s - 1) * N + c];
      const b = grids[s * N + c];
      if (a === b) continue;
      const x = (c % size) * cs;
      const y = Math.floor(c / size) * cs;
      if (b) gain.rect(x, y, cs, cs);
      else {
        if (!wipes.has(a - 1)) wipes.set(a - 1, new Path2D());
        wipes.get(a - 1)!.rect(x, y, cs, cs);
      }
    }
    d = { k, s, gain, wipes: [...wipes].map(([i, path]) => ({ i, path })) };
    this.diffs.push(d);
    if (this.diffs.length > 8) this.diffs.shift();
    return d;
  }

  protected drawArena(ctx: Ctx2D, t: number, opts: { thumbnail?: boolean }): void {
    const { scene, theme: th } = this;
    const { k, local, round } = roundOf(scene, t);
    const rec = round.rec!;
    const { side, cs, x0, y0 } = this.geo(rec.size);
    const ids = scene.result.show.entrants[k];

    // The sheet: a soft shadow, the paper and a faint cell grid.
    ctx.fillStyle = th.dark ? 'rgba(0,0,0,0.45)' : 'rgba(70,45,20,0.16)';
    ctx.beginPath();
    ctx.roundRect(x0 - 4, y0 + 10, side + 8, side + 8, 18);
    ctx.fill();
    ctx.fillStyle = th.floorInner;
    ctx.beginPath();
    ctx.roundRect(x0 - 10, y0 - 10, side + 20, side + 20, 16);
    ctx.fill();
    let grid = this.grid.get(rec.size);
    if (!grid) {
      grid = new Path2D();
      for (let q = 1; q < rec.size; q++) {
        grid.moveTo(q * cs, 0);
        grid.lineTo(q * cs, side);
        grid.moveTo(0, q * cs);
        grid.lineTo(side, q * cs);
      }
      this.grid.set(rec.size, grid);
    }
    ctx.save();
    ctx.translate(x0, y0);
    ctx.strokeStyle = th.grid;
    ctx.lineWidth = 1.5;
    ctx.stroke(grid);
    ctx.restore();

    // Land.
    const ft = tickAt(round, local);
    const tick = Math.floor(ft);
    const s = boardAt(round, tick);
    const layer = this.landLayer(k, s);
    ctx.drawImage(layer, x0, y0, layer.width / this.px, layer.height / this.px);
    ctx.save();
    ctx.translate(x0, y0);
    for (let q = s; q > 0; q--) {
      const u = local - rec.gridTicks[q] / rec.hz;
      if (u > WIPE) break;
      const d = this.diff(k, q);
      for (const w of d.wipes) {
        ctx.globalAlpha = 1 - u / WIPE;
        ctx.fillStyle = scene.fighters[ids[w.i]].accent;
        ctx.fill(w.path);
      }
      if (u < FLASH) {
        ctx.globalAlpha = 0.6 * (1 - u / FLASH);
        ctx.fillStyle = '#FFFFFF';
        ctx.fill(d.gain);
      }
    }
    ctx.globalAlpha = 1;

    // Trails.
    const cell = (x: number, y: number): [number, number] => [(x + 0.5) * cs, (y + 0.5) * cs];
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ids.forEach((f, i) => {
      const pts = trailAt(round, i, tick);
      if (!pts.length) return;
      ctx.beginPath();
      pts.forEach(([x, y], j) => (j ? ctx.lineTo(...cell(x, y)) : ctx.moveTo(...cell(x, y))));
      ctx.lineTo(...cell(...headAt(round, i, ft)));
      ctx.strokeStyle = scene.fighters[f].accent;
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = cs * 0.72;
      ctx.stroke();
      ctx.strokeStyle = '#FFFFFF';
      ctx.globalAlpha = 0.4;
      ctx.lineWidth = cs * 0.16;
      ctx.stroke();
      ctx.globalAlpha = 1;
    });

    // Knock-outs: a ring and paper scraps in the flag's colors.
    const cuts = scene.cuts[k];
    for (let q = lastBefore(cuts, local); q >= 0 && local - cuts[q].t < BURST; q--) {
      const c = cuts[q];
      const u = (local - c.t) / BURST;
      const [cx, cy] = cell(c.x, c.y);
      const f = scene.fighters[ids[c.i]];
      ctx.strokeStyle = f.accent;
      ctx.globalAlpha = 0.9 * (1 - u);
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(cx, cy, cs * (1.2 + 5 * easeOut(u)), 0, TAU);
      ctx.stroke();
      const colors = f.palette.length ? f.palette : [f.accent];
      for (let j = 0; j < 14; j++) {
        const a = hashFloat(scene.seed, q * 31 + j, 71) * TAU;
        const sp = cs * (3 + 5 * hashFloat(scene.seed, q * 31 + j, 72));
        const r = sp * easeOut(u);
        const w = cs * (0.5 + 0.5 * hashFloat(scene.seed, q * 31 + j, 73));
        ctx.save();
        ctx.translate(cx + Math.cos(a) * r, cy + Math.sin(a) * r + cs * 2 * u * u);
        ctx.rotate(a + u * 6);
        ctx.fillStyle = colors[j % colors.length];
        ctx.globalAlpha = 1 - u;
        ctx.fillRect(-w / 2, -w * 0.35, w, w * 0.7);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }

    // Heads, with a crown on the flag holding the most land (none on the thumbnail).
    const lead = local >= round.winnerT ? round.winnerIndex : leaderAt(scene, k, local);
    const d = Math.max(cs * 2.2, 50);
    ids.forEach((f, i) => {
      let scale = 1;
      if (stateAt(round, i, tick) === 0) {
        const c = cuts.find((x) => x.i === i);
        const u = c ? (local - c.t) / 0.3 : 1;
        if (u >= 1) return;
        scale = 1 - easeOut(u);
      }
      const [x, y] = cell(...headAt(round, i, ft));
      const dd = d * scale;
      const tok = this.tokens.get(f, dd * this.px);
      const size = dd * TOKEN_SCALE;
      ctx.drawImage(tok, x - size / 2, y - size / 2, size, size);
      if (i === lead && ids.length > 1 && scale === 1 && !opts.thumbnail)
        this.crown(ctx, x, y - dd / 2 - 6, Math.max(26, dd * 0.55));
    });
    ctx.restore();
  }

  protected drawCounter(ctx: Ctx2D, t: number): void {
    const { scene, theme: th } = this;
    const { k, local, round } = roundOf(scene, t);
    const ids = scene.result.show.entrants[k];
    const limit = round.config.limit;
    const done = local >= round.winnerT;
    const left = Math.max(0, Math.ceil(limit - local));
    const lead = done ? round.winnerIndex : leaderAt(scene, k, local);
    const text =
      (this.tournament ? `${this.roundName(k)} · ` : '') +
      (done
        ? `${scene.fighters[ids[lead]].name.toUpperCase()} WINS!`
        : `${clock(left)} LEFT` +
          (lead >= 0 ? ` · ${scene.fighters[ids[lead]].name.toUpperCase()} LEADS` : ''));
    const A = this.L.counter;
    ctx.textAlign = A.align;
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    this.fit(ctx, text, FONT_DISPLAY, '400', A.size, A.maxW);
    this.text(ctx, text, A.x, A.y, done ? th.accent : th.text);
    // The clock as a bar that runs down.
    const w = Math.min(A.maxW, 620);
    const x0 = A.align === 'center' ? A.x - w / 2 : A.x;
    const y = A.y + A.size * 0.75;
    const p = done ? 0 : Math.max(0, 1 - local / limit);
    ctx.fillStyle = th.hudBg;
    ctx.beginPath();
    ctx.roundRect(x0, y, w, 14, 7);
    ctx.fill();
    if (p > 0) {
      ctx.fillStyle = left <= 10 ? th.danger : th.accent;
      ctx.beginPath();
      ctx.roundRect(x0, y, Math.max(14, w * p), 14, 7);
      ctx.fill();
    }
  }

  protected boardRows(t: number): BoardRow[] {
    const { k, local, round } = roundOf(this.scene, t);
    const ids = this.scene.result.show.entrants[k];
    const shares = sharesAt(this.scene, k, local);
    const tick = Math.floor(tickAt(round, local));
    const out = ids.map((_, i) => stateAt(round, i, tick) === 0);
    const lead = local >= round.winnerT ? round.winnerIndex : leaderAt(this.scene, k, local);
    return ids
      .map((_, i) => i)
      .sort(
        (a, b) =>
          Number(out[a]) - Number(out[b]) ||
          Number(b === lead) - Number(a === lead) ||
          shares[b] - shares[a] ||
          a - b,
      )
      .map((i) => ({
        fighter: ids[i],
        tail: out[i] ? 'OUT' : `${(shares[i] * 100).toFixed(1)}%`,
        hot: i === lead,
        dim: out[i],
      }));
  }

  protected roundWinner(k: number): number {
    return this.scene.result.rounds[k].winnerIndex;
  }

  protected drawGameBanners(ctx: Ctx2D, v: number, t: number, y: number): void {
    const { scene } = this;
    const { timeline, result } = scene;
    const { k } = roundOf(scene, t);
    const off = result.offsets[k];
    const ids = result.show.entrants[k];
    const name = (i: number) => scene.fighters[ids[i]].name.toUpperCase();
    for (const c of scene.cuts[k]) {
      const text =
        c.by < 0
          ? `${name(c.i)} IS OUT`
          : c.cause === 'land'
            ? `${name(c.by)} TAKES ALL OF ${name(c.i)}`
            : c.cause === 'head'
              ? `${name(c.i)} CRASHES INTO ${name(c.by)}`
              : `${name(c.by)} CUTS ${name(c.i)}`;
      this.banner(ctx, text, v - timeline.videoAt(off + c.t), 1.6, y);
    }
    // New leaders after the opening seconds, at most one every 3 seconds.
    let shown = -Infinity;
    for (const lead of scene.leads[k]) {
      if (lead.t < 4 || lead.t - shown < 3) continue;
      shown = lead.t;
      this.banner(ctx, `${name(lead.i)} TAKES THE LEAD`, v - timeline.videoAt(off + lead.t), 1.3, y + 150);
    }
    const ten = scene.tenT[k];
    if (ten !== null) this.banner(ctx, '10 SECONDS LEFT', v - timeline.videoAt(off + ten), 1.3, y - 150);
  }

  protected introText(): { head: string; sub: string } {
    const { fighters, result } = this.scene;
    const noun = fighters.every((f) => f.isCountry) ? 'COUNTRIES' : 'FLAGS';
    return {
      head: `${fighters.length} ${noun}`,
      sub: this.tournament
        ? `${result.rounds.length - 1} HEATS, THEN THE FINAL`
        : 'WHO CLAIMS THE MOST LAND?',
    };
  }

  protected winnerText(): { verb: string; line: string; outro: string } {
    const { result } = this.scene;
    const last = result.rounds.length - 1;
    const fin = result.rounds[last];
    const N = fin.config.size * fin.config.size;
    const share = ((fin.land[fin.winnerIndex] / N) * 100).toFixed(1);
    return {
      verb: fin.lastStanding ? 'IS THE LAST FLAG LEFT' : 'CLAIMS THE MOST LAND',
      line: this.tournament
        ? `Won the final against ${result.show.entrants[last].length - 1} heat winners`
        : fin.lastStanding
          ? `Outlasted every rival with ${share}% of the board`
          : `Held ${share}% of the board when time ran out`,
      outro: 'WINS',
    };
  }

  /** Squares of land spreading out from the winner. */
  protected drawWinnerHalo(ctx: Ctx2D, R: number, u: number): void {
    const w = this.scene.fighters[this.scene.result.winnerIndex];
    for (let j = 0; j < 3; j++) {
      const q = (u * 0.6 + j / 3) % 1;
      const h = R + 18 + q * 90;
      ctx.strokeStyle = w.accent;
      ctx.globalAlpha = 0.6 * (1 - q);
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.roundRect(-h, -h, 2 * h, 2 * h, h * 0.18);
      ctx.stroke();
    }
  }
}
