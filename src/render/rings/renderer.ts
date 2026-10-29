/**
 * Ring Escape renderer. The camera follows the balls and widens as rings break; rings glow in
 * rainbow colors and burst into shards when someone gets through. Titles, banners, the intro,
 * winner card and outro come from the shared show frame.
 */
import { hashFloat } from '../../engine/rng';
import { FONT_DISPLAY, type Ctx2D } from '../canvas';
import { easeOut } from '../effects';
import { ShowRenderer, type BoardRow } from '../show';
import { TOKEN_SCALE } from '../tokens';
import { ballAt, breaksAt, brokenAt, camAt, gapAngle, roundOf, type RingsScene } from './scene';

const TAU = Math.PI * 2;
/** How long shards fly after a ring breaks (sim seconds). */
const SHARD_LIFE = 1.3;
const SHARDS = 22;

const ringColor = (hue: number, l = 62) => `hsl(${((hue % 360) + 360) % 360} 95% ${l}%)`;

export class RingsRenderer extends ShowRenderer<RingsScene, { full?: boolean }> {
  /** World units on screen (view radius) and the camera center for a round at its local time. */
  private camera(k: number, local: number, full: boolean): { V: number; x: number; y: number } {
    const round = this.scene.result.rounds[k];
    const { rings } = round;
    const r = round.config.radius;
    const N = rings.length;
    if (full) {
      // The first few rings fill the frame: enough to read as "rings" with the flags big.
      const outer = rings[Math.min(N - 1, 3)];
      return { V: outer.R + outer.w + r * 1.5, x: 0, y: 0 };
    }
    const c = brokenAt(round, local);
    const cur = rings[Math.min(c, N - 1)].R;
    const prev = c > 0 ? rings[c - 1].R : cur;
    const e = c > 0 ? easeOut((local - round.shatterT[c - 1]) / 0.8) : 1;
    const ringView = prev + (cur - prev) * e + r * 1.6;
    // Never further out than needed: when the ring is big the camera follows the balls, wide
    // enough to keep all of them in the picture.
    const [cx, cy, spread] = camAt(this.scene, k, local);
    const V = Math.min(ringView, Math.max(r * 11, spread));
    let x = cx;
    let y = cy;
    const room = Math.max(0, ringView - V);
    const d = Math.hypot(x, y);
    if (d > room) {
      x *= room / d;
      y *= room / d;
    }
    return { V, x, y };
  }

  protected drawArena(ctx: Ctx2D, t: number, opts: { full?: boolean }): void {
    const full = !!opts.full;
    const { scene, L, theme: th } = this;
    const { k, local, round } = roundOf(scene, t);
    const { rings } = round;
    const N = rings.length;
    const r = round.config.radius;
    const cam = this.camera(k, local, full);
    const s = L.P / cam.V;
    const c = brokenAt(round, local);

    ctx.save();
    ctx.setTransform(
      this.px * s,
      0,
      0,
      this.px * s,
      this.px * (L.cx - cam.x * s),
      this.px * (L.cy - cam.y * s),
    );
    const reach = Math.hypot(L.W, L.H) / s + Math.hypot(cam.x, cam.y);

    // Rings, outermost first so the current one sits on top.
    ctx.lineCap = 'round';
    for (let j = N - 1; j >= c; j--) {
      const ring = rings[j];
      if (ring.R - ring.w > reach) continue;
      const th0 = gapAngle(ring, local);
      const depth = j - c;
      const alpha = depth === 0 ? 1 : Math.max(0.28, 0.75 - depth * 0.12);
      const lw = Math.max(ring.w * 2, 4 / s);
      if (depth === 0) {
        ctx.strokeStyle = ringColor(ring.hue);
        ctx.globalAlpha = 0.25;
        ctx.lineWidth = lw + 18 / s;
        ctx.beginPath();
        ctx.arc(0, 0, ring.R, th0 + ring.gap, th0 - ring.gap + TAU);
        ctx.stroke();
      }
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = ringColor(ring.hue, depth === 0 ? 64 : 55);
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.arc(0, 0, ring.R, th0 + ring.gap, th0 - ring.gap + TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Shards of the rings that just broke.
    for (let j = Math.max(0, c - 3); j < c; j++) {
      const u = local - round.shatterT[j];
      if (u < 0 || u > SHARD_LIFE) continue;
      const ring = rings[j];
      const th0 = gapAngle(ring, round.shatterT[j]);
      const span = (TAU - 2 * ring.gap) / SHARDS;
      const fade = 1 - u / SHARD_LIFE;
      ctx.strokeStyle = ringColor(ring.hue);
      ctx.lineWidth = Math.max(ring.w * 2, 4 / s);
      for (let m = 0; m < SHARDS; m++) {
        const h1 = hashFloat(scene.seed, j * 97 + m, 0x51);
        const h2 = hashFloat(scene.seed, j * 97 + m, 0x52);
        const mid = th0 + ring.gap + span * (m + 0.5);
        const cx = Math.cos(mid);
        const cy = Math.sin(mid);
        const v = 260 + 520 * h1;
        const px = ring.R * cx + cx * v * u;
        const py = ring.R * cy + cy * v * u + 0.5 * 900 * u * u;
        const rot = mid + Math.PI / 2 + (h2 - 0.5) * 9 * u;
        const half = (ring.R * span * 0.42) / (1 + u * 0.6);
        ctx.globalAlpha = fade;
        ctx.beginPath();
        ctx.moveTo(px - Math.cos(rot) * half, py - Math.sin(rot) * half);
        ctx.lineTo(px + Math.cos(rot) * half, py + Math.sin(rot) * half);
        ctx.stroke();
      }
      // Flash where it broke.
      const sh = round.events.find((e) => e.type === 'shatter' && e.ring === j);
      if (sh && sh.type === 'shatter' && u < 0.35) {
        ctx.globalAlpha = 0.7 * (1 - u / 0.35);
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.arc(sh.x, sh.y, r * (1.4 + 3 * u), 0, TAU);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

    // Balls. The latest breaker glows; badges count rings broken.
    const ids = scene.result.show.entrants[k];
    const breaks = breaksAt(round, local);
    const lastBreak = c > 0 ? round.shatterBy[c - 1] : -1;
    const glowU = c > 0 ? local - round.shatterT[c - 1] : Infinity;
    const tokenPx = 2 * r * s * this.px;
    for (let i = 0; i < ids.length; i++) {
      const [x, y] = ballAt(round, i, local);
      if (Math.abs(x - cam.x) > reach || Math.abs(y - cam.y) > reach) continue;
      if (i === lastBreak && glowU < 1.2) {
        ctx.strokeStyle = th.accent;
        ctx.globalAlpha = 0.9 * (1 - glowU / 1.2);
        ctx.lineWidth = 8 / s;
        ctx.beginPath();
        ctx.arc(x, y, r + 8 / s, 0, TAU);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      const tok = this.tokens.get(ids[i], tokenPx);
      const size = 2 * r * TOKEN_SCALE;
      ctx.drawImage(tok, x - size / 2, y - size / 2, size, size);
    }
    for (let i = 0; i < ids.length; i++) {
      if (!breaks[i] || local >= round.winnerT) continue;
      const [x, y] = ballAt(round, i, local);
      const br = Math.max(r * 0.42, 13 / s);
      const bx = x + r * 0.78;
      const by = y - r * 0.78;
      ctx.fillStyle = th.accent;
      ctx.beginPath();
      ctx.arc(bx, by, br, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#0B0D13';
      ctx.font = `${br * 1.35}px ${FONT_DISPLAY}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(breaks[i]), bx, by + br * 0.06);
    }
  }

  protected drawCounter(ctx: Ctx2D, t: number): void {
    const { k, local, round } = roundOf(this.scene, t);
    const N = round.rings.length;
    const c = Math.min(brokenAt(round, local), N);
    const A = this.L.counter;
    const left = N - c;
    const text =
      (this.tournament ? `${this.roundName(k)} · ` : '') +
      (left === 0 ? 'ESCAPED!' : left === 1 ? 'LAST RING!' : `${left} RINGS LEFT`);
    ctx.textAlign = A.align;
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    this.fit(ctx, text, FONT_DISPLAY, '400', A.size, A.maxW);
    this.outlined(ctx, text, A.x, A.y, left <= 1 ? this.theme.accent : this.theme.text, 8);
    // Progress pips, one per ring, in the ring's color.
    const pip = Math.min(26, (A.maxW * 0.9) / Math.max(1, N) - 8);
    const total = N * (pip + 8) - 8;
    const x0 = A.align === 'center' ? A.x - total / 2 : A.x;
    const y = A.y + A.size * 0.75;
    for (let j = 0; j < N; j++) {
      ctx.globalAlpha = j < c ? 0.25 : 1;
      ctx.fillStyle = ringColor(round.rings[j].hue);
      ctx.beginPath();
      ctx.roundRect(x0 + j * (pip + 8), y, pip, 10, 5);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  protected boardRows(t: number): BoardRow[] {
    const { k, local, round } = roundOf(this.scene, t);
    const ids = this.scene.result.show.entrants[k];
    const breaks = breaksAt(round, local);
    // Most rings broken first; ties keep the start order.
    return ids
      .map((_, i) => i)
      .sort((a, b) => breaks[b] - breaks[a] || a - b)
      .map((i) => ({
        fighter: ids[i],
        tail: `${breaks[i]} ${breaks[i] === 1 ? 'ring' : 'rings'}`,
        hot: breaks[i] > 0,
      }));
  }

  protected roundWinner(k: number): number {
    return this.scene.result.rounds[k].winnerIndex;
  }

  protected drawGameBanners(ctx: Ctx2D, v: number, t: number, y: number): void {
    const { timeline, result } = this.scene;
    const { k, round } = roundOf(this.scene, t);
    const N = round.rings.length;
    if (k === result.rounds.length - 1 && N > 2)
      this.banner(ctx, 'LAST RING', v - timeline.videoAt(result.offsets[k] + round.shatterT[N - 2]), 1.4, y);
  }

  protected introText(): { head: string; sub: string } {
    const { fighters, result } = this.scene;
    const n = fighters.length;
    const noun = fighters.every((f) => f.isCountry) ? 'COUNTRIES' : 'FLAGS';
    return this.tournament
      ? { head: `${n} ${noun}`, sub: `${result.rounds.length - 1} HEATS, THEN THE FINAL` }
      : { head: `${n} ${noun}, ${result.rounds[0].rings.length} RINGS`, sub: 'WHO ESCAPES FIRST?' };
  }

  protected winnerText(): { title: string; line: string; outro: string } {
    const { fighters, result } = this.scene;
    const rings = result.rounds[result.rounds.length - 1].rings.length;
    return {
      title: 'ESCAPED!',
      line: this.tournament
        ? `Won the final against ${result.show.entrants[result.rounds.length - 1].length - 1} heat winners`
        : `First of ${fighters.length} to break all ${rings} rings`,
      outro: 'ESCAPED',
    };
  }

  /** The rings it broke, as a rainbow halo. */
  protected drawWinnerHalo(ctx: Ctx2D, R: number, u: number): void {
    const fin = this.scene.result.rounds[this.scene.result.rounds.length - 1];
    fin.rings.slice(0, 5).forEach((ring, j) => {
      ctx.strokeStyle = ringColor(ring.hue);
      ctx.globalAlpha = 0.85 - j * 0.12;
      ctx.lineWidth = 7;
      ctx.beginPath();
      const a = u * (j % 2 ? -0.7 : 0.7) + j;
      ctx.arc(0, 0, R + 24 + j * 13, a + 0.35, a - 0.35 + TAU);
      ctx.stroke();
    });
  }
}
