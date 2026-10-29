/**
 * Growing Ball renderer. A fixed camera on the round arena: flags swell on every firm wall
 * bounce (with a glow where they hit and a pulse around the ball) and the biggest wears a crown.
 * Titles, banners, the intro, winner card and outro come from the shared show frame.
 */
import { ARENA, END_FILL } from '../../engine/grow/sim';
import { FONT_DISPLAY, type Ctx2D } from '../canvas';
import { easeOut } from '../effects';
import { ShowRenderer, type BoardRow } from '../show';
import { TOKEN_SCALE } from '../tokens';
import { ballAt, lastBefore, leaderAt, roundOf, sharesAt, type GrowScene } from './scene';

const TAU = Math.PI * 2;
const WALL_GLOW = 0.35;
const PULSE = 0.3;

const pct = (share: number) => `${Math.round(share * 100)}%`;

export class GrowRenderer extends ShowRenderer<GrowScene> {
  protected drawArena(ctx: Ctx2D, t: number, opts: { thumbnail?: boolean }): void {
    const { scene, L, theme: th } = this;
    const { k, local, round } = roundOf(scene, t);
    const s = L.P / ARENA;
    ctx.setTransform(this.px * s, 0, 0, this.px * s, this.px * L.cx, this.px * L.cy);

    // Floor and wall.
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, ARENA);
    g.addColorStop(0, th.floorInner);
    g.addColorStop(1, th.floorOuter);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, ARENA, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = th.border;
    for (const pass of [0, 1]) {
      ctx.globalAlpha = pass === 0 ? 0.22 : 1;
      ctx.lineWidth = 12 + (pass === 0 ? 18 : 0);
      ctx.beginPath();
      ctx.arc(0, 0, ARENA + 6, 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Glow on the wall where balls just grew.
    const walls = scene.walls[k];
    ctx.lineCap = 'round';
    for (let w = lastBefore(walls, local); w >= 0 && local - walls[w].t < WALL_GLOW; w--) {
      const hit = walls[w];
      const u = (local - hit.t) / WALL_GLOW;
      const a = Math.atan2(hit.y, hit.x);
      ctx.strokeStyle = scene.fighters[scene.result.show.entrants[k][hit.i]].accent;
      ctx.globalAlpha = 0.9 * (1 - u);
      ctx.lineWidth = 16;
      ctx.beginPath();
      ctx.arc(0, 0, ARENA + 6, a - 0.22 - 0.1 * u, a + 0.22 + 0.1 * u);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Balls, biggest first so small ones stay visible on top.
    const ids = scene.result.show.entrants[k];
    const balls = ids.map((_, i) => ({ i, p: ballAt(round, i, local) }));
    balls.sort((a, b) => b.p[2] - a.p[2] || a.i - b.i);
    const leader = local >= round.winnerT ? round.winnerIndex : leaderAt(scene, k, local);
    for (const { i, p } of balls) {
      const [x, y, r] = p;
      const tok = this.tokens.get(ids[i], 2 * r * s * this.px);
      const size = 2 * r * TOKEN_SCALE;
      ctx.drawImage(tok, x - size / 2, y - size / 2, size, size);
      // Pulse when it grew.
      let last = -1;
      for (let w = lastBefore(walls, local); w >= 0 && local - walls[w].t < PULSE; w--)
        if (walls[w].i === i) {
          last = w;
          break;
        }
      if (last >= 0) {
        const u = (local - walls[last].t) / PULSE;
        ctx.strokeStyle = '#FFFFFF';
        ctx.globalAlpha = 0.7 * (1 - u);
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.arc(x, y, r + 6 + 26 * easeOut(u), 0, TAU);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      // No crown on the thumbnail: it would hint at the winner.
      if (i === leader && balls.length > 1 && !opts.thumbnail) {
        ctx.strokeStyle = th.accent;
        ctx.lineWidth = 7;
        ctx.beginPath();
        ctx.arc(x, y, r + 5, 0, TAU);
        ctx.stroke();
        this.crown(ctx, x, y - r - 8, Math.max(26, r * 0.42));
      }
    }
  }

  private crown(ctx: Ctx2D, x: number, y: number, w: number): void {
    const h = w * 0.62;
    ctx.fillStyle = this.theme.accent;
    ctx.strokeStyle = 'rgba(4,6,10,0.85)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x - w / 2, y);
    ctx.lineTo(x - w / 2, y - h * 0.55);
    ctx.lineTo(x - w / 4, y - h * 0.25);
    ctx.lineTo(x, y - h);
    ctx.lineTo(x + w / 4, y - h * 0.25);
    ctx.lineTo(x + w / 2, y - h * 0.55);
    ctx.lineTo(x + w / 2, y);
    ctx.closePath();
    ctx.stroke();
    ctx.fill();
  }

  protected drawCounter(ctx: Ctx2D, t: number): void {
    const { scene, theme: th } = this;
    const { k, local, round } = roundOf(scene, t);
    const ids = scene.result.show.entrants[k];
    const fill = Math.min(
      END_FILL,
      sharesAt(round, local).reduce((a, b) => a + b, 0),
    );
    const A = this.L.counter;
    const done = local >= round.winnerT;
    const lead = done ? round.winnerIndex : leaderAt(scene, k, local);
    const text =
      (this.tournament ? `${this.roundName(k)} · ` : '') +
      (done
        ? `${scene.fighters[ids[lead]].name.toUpperCase()} WINS!`
        : `ARENA ${pct(fill / END_FILL)} FULL` +
          (lead >= 0 ? ` · ${scene.fighters[ids[lead]].name.toUpperCase()} LEADS` : ''));
    ctx.textAlign = A.align;
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    this.fit(ctx, text, FONT_DISPLAY, '400', A.size, A.maxW);
    this.outlined(ctx, text, A.x, A.y, done ? th.accent : th.text, 8);
    // How full the arena is: the game ends when the bar does.
    const w = Math.min(A.maxW, 620);
    const x0 = A.align === 'center' ? A.x - w / 2 : A.x;
    const y = A.y + A.size * 0.75;
    const p = done ? 1 : fill / END_FILL;
    ctx.fillStyle = th.hudBg;
    ctx.beginPath();
    ctx.roundRect(x0, y, w, 14, 7);
    ctx.fill();
    ctx.fillStyle = p > 0.85 ? th.danger : th.accent;
    ctx.beginPath();
    ctx.roundRect(x0, y, Math.max(14, w * p), 14, 7);
    ctx.fill();
  }

  protected boardRows(t: number): BoardRow[] {
    const { k, local, round } = roundOf(this.scene, t);
    const ids = this.scene.result.show.entrants[k];
    const shares = sharesAt(round, local);
    // The leader (clearly ahead, as the crown shows) first, then everyone by size.
    const lead = local >= round.winnerT ? round.winnerIndex : leaderAt(this.scene, k, local);
    return ids
      .map((_, i) => i)
      .sort((a, b) => Number(b === lead) - Number(a === lead) || shares[b] - shares[a] || a - b)
      .map((i) => ({ fighter: ids[i], tail: `${(shares[i] * 100).toFixed(1)}%`, hot: i === lead }));
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
    // New leaders (after the opening seconds), and the moment the arena is almost full.
    for (const lead of scene.leads[k]) {
      if (lead.t < 3) continue;
      const name = scene.fighters[ids[lead.i]].name.toUpperCase();
      this.banner(ctx, `${name} TAKES THE LEAD`, v - timeline.videoAt(off + lead.t), 1.4, y);
    }
    const almost = scene.almostT[k];
    if (almost !== null) this.banner(ctx, 'ALMOST FULL!', v - timeline.videoAt(off + almost), 1.3, y + 150);
  }

  protected introText(): { head: string; sub: string } {
    const { fighters, result } = this.scene;
    const noun = fighters.every((f) => f.isCountry) ? 'COUNTRIES' : 'FLAGS';
    return {
      head: `${fighters.length} ${noun}`,
      sub: this.tournament ? `${result.rounds.length - 1} HEATS, THEN THE FINAL` : 'WHO GROWS BIGGEST?',
    };
  }

  protected winnerText(): { title: string; line: string; outro: string } {
    const { result } = this.scene;
    const last = result.rounds.length - 1;
    const fin = result.rounds[last];
    const shares = sharesAt(fin, fin.winnerT + 0.05);
    return {
      title: 'BIGGEST!',
      line: this.tournament
        ? `Won the final against ${result.show.entrants[last].length - 1} heat winners`
        : `Biggest when the arena filled up (${(shares[fin.winnerIndex] * 100).toFixed(1)}% of it)`,
      outro: 'WINS',
    };
  }

  /** A soft glow that swells, like the ball did. */
  protected drawWinnerHalo(ctx: Ctx2D, R: number, u: number): void {
    const w = this.scene.fighters[this.scene.result.winnerIndex];
    for (let j = 0; j < 3; j++) {
      const q = (u * 0.6 + j / 3) % 1;
      ctx.strokeStyle = w.accent;
      ctx.globalAlpha = 0.6 * (1 - q);
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.arc(0, 0, R + 18 + q * 90, 0, TAU);
      ctx.stroke();
    }
  }
}
