/**
 * Territory Wars renderer. The whole map stays in view: flag-textured territories (the pixel layer
 * in mapLayer.ts), dotted sea crossings, and a countryball on every territory that grows with it,
 * eyes on its nearest rival. The leader wears a crown, a rallying country pulses, a fallen one
 * leaves crossed-out eyes behind. Titles, banners, the intro, winner card and outro come from the
 * shared show frame.
 */
import { FONT_DISPLAY, type Ctx2D } from '../canvas';
import { blinking, drawCountryball, type Expression } from '../countryball';
import { easeOut } from '../effects';
import { ShowRenderer, type BoardRow } from '../show';
import { MapLayer } from './mapLayer';
import { landAt, leaderAt, spotAt, tickAt, type TerritoryScene } from './scene';

const TAU = Math.PI * 2;
/** A rally shows (pulse, determined eyes) this long after it starts. */
const RALLY = 2;
/** A fallen country's ball lingers this long. */
const FALL = 0.9;

const pct = (share: number) => `${share >= 0.995 ? 100 : (share * 100).toFixed(1)}%`;

export class TerritoryRenderer extends ShowRenderer<TerritoryScene> {
  protected readonly countryballs = true;
  private layer: MapLayer | null = null;

  /** Map placement in design pixels: top left corner and cell size. */
  private frame() {
    const { cols, rows } = this.scene.map;
    const side = this.L.P * 2 * 0.97;
    const s = Math.min(side / cols, side / rows);
    return { s, x0: this.L.cx - (cols * s) / 2, y0: this.L.cy - (rows * s) / 2, w: cols * s, h: rows * s };
  }

  protected drawArena(ctx: Ctx2D, t: number, opts: { thumbnail?: boolean }): void {
    const { scene, theme: th } = this;
    const { round, map } = scene;
    const { s, x0, y0, w, h } = this.frame();
    this.layer ??= new MapLayer(scene, th);
    this.layer.update(tickAt(scene, t));

    // The map on a sea-colored card with a soft frame.
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 30;
    ctx.fillStyle = th.floorOuter;
    ctx.beginPath();
    ctx.roundRect(x0 - 10, y0 - 10, w + 20, h + 20, 18);
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x0 - 10, y0 - 10, w + 20, h + 20, 18);
    ctx.clip();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.layer.canvas, x0, y0, w, h);
    ctx.restore();
    ctx.strokeStyle = th.border;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(x0 - 10, y0 - 10, w + 20, h + 20, 18);
    ctx.stroke();

    // Sea crossings.
    const at = (q: number): [number, number] => [
      x0 + ((q % map.cols) + 0.5) * s,
      y0 + (Math.floor(q / map.cols) + 0.5) * s,
    ];
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = th.text;
    ctx.lineWidth = Math.max(1.5, s * 0.22);
    ctx.setLineDash([s * 0.5, s * 0.6]);
    ctx.beginPath();
    for (const [a, b] of map.bridges) {
      const [ax, ay] = at(a);
      const [bx, by] = at(b);
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    // Countryballs, smallest on top.
    const done = t >= round.winnerT;
    const land = landAt(scene, t);
    const leader = done ? round.winnerIndex : leaderAt(scene, t);
    const home = map.homes[0].length;
    const balls = land
      .map((c, i) => ({ i, c, p: spotAt(scene, i, t) }))
      .filter((b) => b.c > 0 && b.p[0] >= 0)
      .sort((a, b) => b.c - a.c || a.i - b.i);
    const rally = this.rallies(t);
    for (const { i, c, p } of balls) {
      const x = x0 + p[0] * s;
      const y = y0 + p[1] * s;
      const r = Math.max(13, Math.min(56, Math.sqrt(c) * s * 0.42));
      const look = this.lookAt(i, p, balls);
      const rallying = rally.has(i) && !done;
      const expression: Expression =
        done && i === round.winnerIndex
          ? 'happy'
          : rallying || (i === leader && !opts.thumbnail)
            ? 'determined'
            : c < home * 0.5
              ? 'scared'
              : blinking(scene.seed, i, t)
                ? 'blink'
                : 'open';
      if (rallying) {
        const u = ((t - rally.get(i)!) % 0.7) / 0.7;
        ctx.strokeStyle = scene.colors[i];
        ctx.globalAlpha = 0.85 * (1 - u);
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(x, y, r + 4 + 22 * easeOut(u), 0, TAU);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      drawCountryball(ctx, this.tokens.get(i, 2 * r * this.px), x, y, r, { expression, look });
      // No crown on the thumbnail: it would hint at the winner.
      if (i === leader && balls.length > 1 && !opts.thumbnail)
        this.crown(ctx, x, y - r - 6, Math.max(24, r * 0.5));
    }

    // Fallen countries: crossed-out eyes that shrink away where they made their last stand.
    scene.outT.forEach((ot, i) => {
      const u = (t - ot) / FALL;
      if (u < 0 || u >= 1) return;
      const p = spotAt(scene, i, ot - 1 / round.config.rate);
      if (p[0] < 0) return;
      const r = 16 * (1 - easeOut(u)) + 4;
      ctx.globalAlpha = 1 - u;
      drawCountryball(ctx, this.tokens.get(i, 2 * r * this.px), x0 + p[0] * s, y0 + p[1] * s - 20 * u, r, {
        expression: 'dead',
      });
      ctx.globalAlpha = 1;
    });
  }

  /** Countries rallying at sim time t, with when their rally started. */
  private rallies(t: number): Map<number, number> {
    const out = new Map<number, number>();
    for (const e of this.scene.round.events) {
      if (e.t > t) break;
      if (e.type === 'surge' && t - e.t < RALLY) out.set(e.i, e.t);
    }
    return out;
  }

  /** Eyes on the nearest rival. */
  private lookAt(
    i: number,
    p: [number, number],
    balls: { i: number; p: [number, number] }[],
  ): [number, number] {
    let best: [number, number] = [0, 0];
    let bestD = Infinity;
    for (const b of balls) {
      if (b.i === i) continue;
      const dx = b.p[0] - p[0];
      const dy = b.p[1] - p[1];
      const d = dx * dx + dy * dy;
      if (d < bestD && d > 0) {
        bestD = d;
        best = [dx / Math.sqrt(d), dy / Math.sqrt(d)];
      }
    }
    return [best[0] * 0.8, best[1] * 0.8];
  }

  protected drawCounter(ctx: Ctx2D, t: number): void {
    const { scene, theme: th } = this;
    const { round } = scene;
    const land = landAt(scene, t);
    const done = t >= round.winnerT;
    const lead = done ? round.winnerIndex : leaderAt(scene, t);
    const left = land.filter((c) => c > 0).length;
    const name = scene.fighters[lead].name.toUpperCase();
    const text = done
      ? round.conquered
        ? `${name} RULES THE MAP!`
        : `${name} WINS!`
      : `${left} COUNTRIES LEFT · ${name} LEADS`;
    const A = this.L.counter;
    ctx.textAlign = A.align;
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    this.fit(ctx, text, FONT_DISPLAY, '400', A.size, A.maxW);
    this.text(ctx, text, A.x, A.y, done ? th.accent : th.text);
    // How much of the map the leader holds.
    const w = Math.min(A.maxW, 620);
    const x0 = A.align === 'center' ? A.x - w / 2 : A.x;
    const y = A.y + A.size * 0.75;
    const p = land[lead] / round.total;
    ctx.fillStyle = th.hudBg;
    ctx.beginPath();
    ctx.roundRect(x0, y, w, 14, 7);
    ctx.fill();
    ctx.fillStyle = scene.colors[lead];
    ctx.beginPath();
    ctx.roundRect(x0, y, Math.max(14, w * p), 14, 7);
    ctx.fill();
  }

  protected boardRows(t: number): BoardRow[] {
    const { scene } = this;
    const land = landAt(scene, t);
    const done = t >= scene.round.winnerT;
    const lead = done ? scene.round.winnerIndex : leaderAt(scene, t);
    return land
      .map((_, i) => i)
      .sort(
        (a, b) =>
          Number(b === lead) - Number(a === lead) ||
          land[b] - land[a] ||
          scene.outT[b] - scene.outT[a] ||
          a - b,
      )
      .map((i) => ({
        fighter: i,
        tail: land[i] > 0 ? pct(land[i] / scene.round.total) : 'OUT',
        hot: i === lead,
        dim: land[i] === 0,
      }));
  }

  protected roundWinner(): number {
    return this.scene.round.winnerIndex;
  }

  protected drawGameBanners(ctx: Ctx2D, v: number, _t: number, y: number): void {
    const { scene } = this;
    for (const m of scene.moments) {
      const name = scene.fighters[m.i].name.toUpperCase();
      const text =
        m.kind === 'out'
          ? `${name} FALLS`
          : m.kind === 'lead'
            ? `${name} TAKES THE LEAD`
            : `${name} STRIKES BACK!`;
      this.banner(ctx, text, v - scene.timeline.videoAt(m.t), m.life, y);
    }
  }

  protected introText(): { head: string; sub: string } {
    const { fighters } = this.scene;
    const noun = fighters.every((f) => f.isCountry) ? 'COUNTRIES' : 'FLAGS';
    return { head: `${fighters.length} ${noun}`, sub: 'WHO TAKES OVER THE MAP?' };
  }

  protected winnerText(): { verb: string; line: string; outro: string } {
    const { round } = this.scene;
    const n = round.config.ids.length;
    return round.conquered
      ? { verb: 'CONQUERS THE MAP', line: `Took the land of all ${n - 1} rivals`, outro: 'WINS' }
      : {
          verb: 'HOLDS THE MOST LAND',
          line: `${pct(round.land[round.winnerIndex] / round.total)} of the map when the war ended`,
          outro: 'WINS',
        };
  }

  /** Pixel squares that spread out like conquered land. */
  protected drawWinnerHalo(ctx: Ctx2D, R: number, u: number): void {
    const w = this.scene.fighters[this.scene.result.winnerIndex];
    for (let j = 0; j < 3; j++) {
      const q = (u * 0.6 + j / 3) % 1;
      const half = R + 18 + q * 90;
      ctx.strokeStyle = w.accent;
      ctx.globalAlpha = 0.6 * (1 - q);
      ctx.lineWidth = 10;
      ctx.strokeRect(-half, -half, half * 2, half * 2);
    }
  }
}
