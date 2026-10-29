/**
 * Black Hole renderer. The city seen from above in a rounded frame: every hole is a dark disc in
 * a rim of its flag with a countryball face, things fall in with a short tip, spin and shrink, and
 * a swallowed hole slides into the bigger one. Long videos show the whole city; Shorts follow the
 * leader with a gentle camera (a moving average of where it is, so it never jumps). Titles,
 * banners, the intro, winner card and outro come from the shared show frame.
 */
import { EAT_MARGIN } from '../../engine/black/sim';
import type { BlackResult } from '../../engine/black/types';
import { FONT_DISPLAY, type AnyCanvas, type Ctx2D } from '../canvas';
import { blinking, paintEyes, type Expression } from '../countryball';
import { easeOut } from '../effects';
import { ShowRenderer, type BoardRow } from '../show';
import { TOKEN_SCALE } from '../tokens';
import { bakeGround, cityPalette, drawObject, drawShadow, type CityPalette } from './city';
import { holeAt, leaderAt, roundOf, type BlackScene } from './scene';

const TAU = Math.PI * 2;
/** Seconds an object takes to fall in, and a swallowed hole to slide into the bigger one. */
const FALL = 0.5;
const GULP = 0.7;
/** The flag rim around a hole, as a share of its radius (wide enough to tell the flags apart). */
const RIM = 0.3;

const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
const smooth = (u: number) => {
  const c = Math.max(0, Math.min(1, u));
  return c * c * (3 - 2 * c);
};

type Camera = { x: number; y: number; half: number };

export class BlackRenderer extends ShowRenderer<BlackScene> {
  protected readonly countryballs = true;
  private readonly palette: CityPalette;
  private readonly grounds: (AnyCanvas | null)[];

  constructor(scene: BlackScene, width: number, height: number) {
    super(scene, width, height);
    this.palette = cityPalette(this.theme.dark);
    this.grounds = scene.result.rounds.map(() => null);
  }

  private ground(k: number): AnyCanvas {
    let g = this.grounds[k];
    if (!g) {
      const city = this.scene.result.rounds[k].city;
      g = bakeGround(city, this.palette, Math.min(1.6 * this.px + 0.2, 3000 / city.size));
      this.grounds[k] = g;
    }
    return g;
  }

  /** The whole city for long videos and thumbnails; Shorts ease in onto the leader. */
  private camera(k: number, local: number, round: BlackResult, wide: boolean): Camera {
    const S = round.city.size;
    const full = { x: S / 2, y: S / 2, half: S / 2 };
    if (wide) return full;
    let sx = 0;
    let sy = 0;
    let sr = 0;
    const N = 9;
    for (let q = 0; q < N; q++) {
      const tq = Math.max(0, Math.min(round.endT, local - 1.6 + (q * 3.2) / (N - 1)));
      const lead = tq >= round.winnerT ? round.winnerIndex : Math.max(0, leaderAt(this.scene, k, tq));
      const [x, y, r] = holeAt(round, lead, tq);
      sx += x;
      sy += y;
      sr += r;
    }
    const w = smooth((local - 0.4) / 2.2);
    const half = full.half + (Math.min(full.half, Math.max(S * 0.34, (sr / N) * 3.4 + 140)) - full.half) * w;
    const cx = full.x + (sx / N - full.x) * w;
    const cy = full.y + (sy / N - full.y) * w;
    return {
      x: Math.max(half, Math.min(S - half, cx)),
      y: Math.max(half, Math.min(S - half, cy)),
      half,
    };
  }

  /** A hole: its flag as a rim, the dark hole inside. */
  private drawHole(ctx: Ctx2D, f: number, x: number, y: number, r: number, s: number): void {
    const R = r * (1 + RIM);
    const tok = this.tokens.get(f, 2 * R * s * this.px);
    const size = 2 * R * TOKEN_SCALE;
    ctx.drawImage(tok, x - size / 2, y - size / 2, size, size);
    const g = ctx.createRadialGradient(x, y - r * 0.15, 0, x, y, r);
    g.addColorStop(0, '#000000');
    g.addColorStop(0.7, '#07040E');
    g.addColorStop(1, '#2A1745');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  }

  protected drawArena(ctx: Ctx2D, t: number, opts: { thumbnail?: boolean }): void {
    const { scene, L, theme: th, palette: P } = this;
    const { k, local, round } = roundOf(scene, t);
    const ids = scene.result.show.entrants[k];
    const objs = round.city.objects;
    const S = round.city.size;
    const cam = this.camera(k, local, round, this.scene.look.aspect === '16:9' || !!opts.thumbnail);
    const s = L.P / cam.half;
    const px = this.px;

    // The frame, then the city clipped inside it.
    ctx.fillStyle = th.floorOuter;
    ctx.beginPath();
    ctx.roundRect(L.cx - L.P - 10, L.cy - L.P - 10, 2 * L.P + 20, 2 * L.P + 20, 44);
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(L.cx - L.P, L.cy - L.P, 2 * L.P, 2 * L.P, 36);
    ctx.clip();
    ctx.setTransform(px * s, 0, 0, px * s, px * (L.cx - cam.x * s), px * (L.cy - cam.y * s));
    ctx.drawImage(this.ground(k), 0, 0, S, S);
    const x0 = cam.x - cam.half - 80;
    const x1 = cam.x + cam.half + 80;
    const y0 = cam.y - cam.half - 80;
    const y1 = cam.y + cam.half + 80;

    // Holes.
    const holes = ids.map((_, i) => holeAt(round, i, local));
    holes.forEach(([x, y, r], i) => r > 0 && this.drawHole(ctx, ids[i], x, y, r, s));

    // Things falling in: tip toward the middle, spin, shrink and darken, clipped to the hole.
    const eatT = scene.eatT[k];
    const order = scene.eatOrder[k];
    let lo = 0;
    let hi = order.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (eatT[order[mid]] < local - FALL) lo = mid + 1;
      else hi = mid;
    }
    for (let q = lo; q < order.length && eatT[order[q]] <= local; q++) {
      const o = objs[order[q]];
      const [hx, hy, hr] = holes[scene.eatBy[k][order[q]]];
      if (hr <= 0) continue;
      const u = (local - eatT[order[q]]) / FALL;
      const pull = easeOut(u) * 0.7;
      ctx.save();
      ctx.beginPath();
      ctx.arc(hx, hy, hr, 0, TAU);
      ctx.clip();
      ctx.translate(o.x + (hx - o.x) * pull, o.y + (hy - o.y) * pull);
      ctx.rotate(u * (o.v - 0.5) * 4);
      const sc = 1 - 0.85 * u * u;
      ctx.scale(sc, sc);
      ctx.globalAlpha = 1 - u * 0.5;
      drawObject(ctx, o, P, 0, 0);
      ctx.globalAlpha = u * 0.7;
      ctx.fillStyle = '#000000';
      ctx.beginPath();
      ctx.arc(0, 0, o.s, 0, TAU);
      ctx.fill();
      ctx.restore();
    }

    // Swallowed holes slide into the bigger one, spinning, eyes crossed.
    for (const sw of scene.swallows[k]) {
      const u = (local - sw.t) / GULP;
      if (u < 0 || u >= 1) continue;
      const [bx, by] = holes[sw.i];
      const r0 = holeAt(round, sw.j, sw.t - 0.05)[2];
      const e = easeOut(u);
      const x = sw.x + (bx - sw.x) * e;
      const y = sw.y + (by - sw.y) * e;
      const r = r0 * (1 - e);
      if (r < 0.5) continue;
      const tok = this.tokens.get(ids[sw.j], 2 * r * s * px);
      const size = 2 * r * TOKEN_SCALE;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(u * 7);
      ctx.drawImage(tok, -size / 2, -size / 2, size, size);
      paintEyes(ctx, 0, -r * 0.08, r * 1.24, 'dead');
      ctx.restore();
    }

    // Everything still standing: shadows first, then the objects.
    const standing: number[] = [];
    for (let q = 0; q < objs.length; q++) {
      const o = objs[q];
      if (eatT[q] <= local || o.x < x0 || o.x > x1 || o.y < y0 || o.y > y1) continue;
      standing.push(q);
    }
    for (const q of standing) drawShadow(ctx, objs[q], P);
    for (const q of standing) drawObject(ctx, objs[q], P);

    // Faces on top, so a hole under a tower still shows who it is.
    const done = local >= round.winnerT;
    const lead = done ? round.winnerIndex : leaderAt(scene, k, local);
    holes.forEach(([x, y, r], i) => {
      if (r <= 0) return;
      const [px0, py0] = holeAt(round, i, Math.max(0, local - 1 / 15));
      const sp = Math.hypot(x - px0, y - py0) || 1;
      const lean = Math.min(1, sp / 6);
      const threat = holes.some(
        ([qx, qy, qr], j) => j !== i && qr >= EAT_MARGIN * r && Math.hypot(qx - x, qy - y) < qr + r + 70,
      );
      const swallowed = scene.swallows[k].some((sw) => sw.i === i && local >= sw.t && local - sw.t < 1);
      const expression: Expression =
        (done && i === round.winnerIndex) || swallowed
          ? 'happy'
          : threat && !done
            ? 'scared'
            : i === lead && !opts.thumbnail
              ? 'determined'
              : blinking(scene.seed, ids[i], local)
                ? 'blink'
                : 'open';
      const look: [number, number] = [((x - px0) / sp) * lean, ((y - py0) / sp) * lean];
      paintEyes(
        ctx,
        x + look[0] * r * 0.2,
        y - r * 0.12 + look[1] * r * 0.14,
        r * 1.05,
        expression,
        look,
        '#FFFFFF',
      );
      if (i === lead && ids.length > 1 && !opts.thumbnail) {
        const w = Math.max(30 / s, r * 0.55);
        this.crown(ctx, x, y - r * (1 + RIM) - w * 0.15, w);
      }
    });
    ctx.restore();
    ctx.setTransform(px, 0, 0, px, 0, 0);
    ctx.strokeStyle = th.border;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.roundRect(L.cx - L.P, L.cy - L.P, 2 * L.P, 2 * L.P, 36);
    ctx.stroke();
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
    const r = ids.map((_, i) => holeAt(round, i, local)[2]);
    const lead = local >= round.winnerT ? round.winnerIndex : leaderAt(this.scene, k, local);
    return ids
      .map((_, i) => i)
      .sort(
        (a, b) =>
          Number(r[a] === 0) - Number(r[b] === 0) ||
          Number(b === lead) - Number(a === lead) ||
          r[b] - r[a] ||
          a - b,
      )
      .map((i) => ({
        fighter: ids[i],
        // Holes are measured in meters across (10 city units to the meter).
        tail: r[i] === 0 ? 'EATEN' : `${((r[i] * 2) / 10).toFixed(1)} m`,
        hot: i === lead,
        dim: r[i] === 0,
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
    for (const sw of scene.swallows[k])
      this.banner(ctx, `${name(sw.i)} SWALLOWS ${name(sw.j)}`, v - timeline.videoAt(off + sw.t), 1.6, y);
    // New leaders after the opening seconds, at most one every 3 seconds.
    let shown = -Infinity;
    const leads = scene.leads[k];
    for (let q = 0; q < leads.length; q++) {
      const lead = leads[q];
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
        : 'WHICH HOLE GROWS BIGGEST?',
    };
  }

  protected winnerText(): { verb: string; line: string; outro: string } {
    const { result } = this.scene;
    const last = result.rounds.length - 1;
    const fin = result.rounds[last];
    const ate = fin.events.filter(
      (e) => e.type === 'eat' && e.i === fin.winnerIndex && e.t <= fin.winnerT,
    ).length;
    const holes = this.scene.swallows[last].filter((sw) => sw.i === fin.winnerIndex).length;
    const what = `${ate} things${holes ? ` and ${holes} hole${holes > 1 ? 's' : ''}` : ''}`;
    return {
      verb: fin.lastStanding ? 'IS THE LAST HOLE LEFT' : 'IS THE BIGGEST HOLE',
      line: this.tournament
        ? `Won the final against ${result.show.entrants[last].length - 1} heat winners`
        : `Swallowed ${what}`,
      outro: 'WINS',
    };
  }

  /** Rings pulled in toward the winner, like everything else was. */
  protected drawWinnerHalo(ctx: Ctx2D, R: number, u: number): void {
    const w = this.scene.fighters[this.scene.result.winnerIndex];
    for (let j = 0; j < 3; j++) {
      const q = 1 - ((u * 0.6 + j / 3) % 1);
      ctx.strokeStyle = w.accent;
      ctx.globalAlpha = 0.6 * (1 - q);
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.arc(0, 0, R + 18 + q * 90, 0, TAU);
      ctx.stroke();
    }
  }
}
