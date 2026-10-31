/**
 * Shared frame for the arena games that run as a show of rounds (Ring Escape, Growing Ball):
 * layout, title, banners, the intro countdown, the winner card and the outro. A game renderer
 * extends it and draws its own arena, counter and board. Everything is a pure function of
 * (scene, video time), so preview and export match frame for frame.
 */
import { bandBanner, legibleText, winnerLockup } from './overlay';
import { paintEyes } from './countryball';
import type { Timeline } from '../engine/timeline';
import type { Look } from '../engine/types';
import {
  context2d,
  createCanvas,
  FONT_DISPLAY,
  FONT_SANS,
  type AnyCanvas,
  type Ctx2D,
  type ImageSource,
} from './canvas';
import { drawConfetti, easeBack, easeOut } from './effects';
import { DESIGN_SIZE } from './layout';
import type { SceneFighter } from './scene';
import { THEMES, type Theme } from './themes';
import { TOKEN_SCALE, TokenCache, bakeToken } from './tokens';

type Anchor = { x: number; y: number; align: CanvasTextAlign; maxW: number; size: number };

export type ShowLayout = {
  W: number;
  H: number;
  /** Arena center and its radius in design pixels. */
  cx: number;
  cy: number;
  P: number;
  title: Anchor;
  subtitle: Anchor;
  counter: Anchor;
  board: { x: number; y: number; w: number; rowH: number; rows: number; size: number } | null;
  safe: { top: number; bottom: number } | null;
};

function layoutFor(aspect: Look['aspect']): ShowLayout {
  const { W, H } = DESIGN_SIZE[aspect];
  if (aspect === '16:9') {
    return {
      W,
      H,
      cx: W - 560,
      cy: H * 0.52,
      P: 470,
      title: { x: 96, y: 130, align: 'left', maxW: 680, size: 92 },
      subtitle: { x: 96, y: 206, align: 'left', maxW: 680, size: 36 },
      counter: { x: 96, y: 300, align: 'left', maxW: 640, size: 46 },
      board: { x: 96, y: 390, w: 600, rowH: 58, rows: 9, size: 28 },
      safe: null,
    };
  }
  const safeTop = Math.round(H * 0.12);
  return {
    W,
    H,
    cx: W / 2,
    cy: H * 0.5,
    P: 500,
    title: { x: W / 2, y: safeTop + 70, align: 'center', maxW: W - 110, size: 88 },
    subtitle: { x: W / 2, y: safeTop + 146, align: 'center', maxW: W - 160, size: 38 },
    counter: { x: W / 2, y: H * 0.5 + 560, align: 'center', maxW: W - 120, size: 52 },
    board: null,
    safe: { top: safeTop, bottom: Math.round(H * 0.8) },
  };
}

/** What every show scene has: rounds on one sim clock, entrants per round, one winner. */
export type ShowScene = {
  timeline: Timeline;
  look: Look;
  fighters: SceneFighter[];
  winnerImage: ImageSource | null;
  seed: number;
  result: {
    winnerIndex: number;
    offsets: number[];
    rounds: { winnerT: number }[];
    show: { entrants: number[][] };
  };
};

/** Round on screen at video-wide sim time t, and the time inside it. */
export function roundIndexAt(offsets: number[], t: number): { k: number; local: number } {
  let k = 0;
  while (k + 1 < offsets.length && t >= offsets[k + 1]) k++;
  return { k, local: t - offsets[k] };
}

export type BoardRow = { fighter: number; tail: string; hot: boolean; dim?: boolean };

export abstract class ShowRenderer<S extends ShowScene, O = object> {
  readonly L: ShowLayout;
  readonly theme: Theme;
  readonly px: number;
  protected readonly tokens: TokenCache;
  private bg: AnyCanvas | null = null;
  private winnerToken: { canvas: AnyCanvas; size: number } | null = null;
  /** The flags are countryballs: give the intro and winner discs their eyes. */
  protected readonly countryballs: boolean = false;

  constructor(
    readonly scene: S,
    readonly width: number,
    readonly height: number,
  ) {
    this.L = layoutFor(scene.look.aspect);
    this.theme = THEMES[scene.look.theme];
    this.px = width / this.L.W;
    this.tokens = new TokenCache(
      scene.fighters.map((f) => f.image),
      scene.fighters.map((f) => f.accent),
    );
  }

  get duration(): number {
    return this.scene.timeline.total;
  }

  protected get tournament(): boolean {
    return this.scene.result.rounds.length > 1;
  }

  protected roundName(k: number): string {
    const n = this.scene.result.rounds.length;
    return k === n - 1 ? 'FINAL' : `HEAT ${k + 1} OF ${n - 1}`;
  }

  // ------------------------------------------------------------------ per game

  /** The arena at sim time t (world transform is the game's own). */
  protected abstract drawArena(ctx: Ctx2D, t: number, opts: O): void;
  /** The live counter (rings left, size to beat…). */
  protected abstract drawCounter(ctx: Ctx2D, t: number): void;
  /** Board rows for the round on screen, best first (16:9 only). */
  protected abstract boardRows(t: number): BoardRow[];
  /** Extra banners on top of the round names and heat winners. */
  protected abstract drawGameBanners(ctx: Ctx2D, v: number, t: number, y: number): void;
  /** Intro headline and sub line. */
  protected abstract introText(): { head: string; sub: string };
  /** Winner card: the verb under the name ("ESCAPES FIRST"), one line of what happened, the outro word. */
  protected abstract winnerText(): { verb: string; line: string; outro: string };
  protected drawWinnerHalo(ctx: Ctx2D, R: number, u: number): void {
    void ctx;
    void R;
    void u;
  }

  // ------------------------------------------------------------------ text helpers

  /** Overlay text with the shared soft shadow (overlay.ts), readable over any arena. */
  protected text(ctx: Ctx2D, text: string, x: number, y: number, fill: string): void {
    legibleText(ctx, this.theme, text, x, y, fill);
  }

  protected fit(ctx: Ctx2D, text: string, family: string, weight: string, size: number, maxW: number): void {
    let s = size;
    ctx.font = `${weight} ${s}px ${family}`;
    while (s > 12 && ctx.measureText(text).width > maxW) {
      s -= 2;
      ctx.font = `${weight} ${s}px ${family}`;
    }
  }

  protected ellipsize(ctx: Ctx2D, text: string, maxW: number): string {
    if (ctx.measureText(text).width <= maxW) return text;
    let s = text;
    while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
    return s.trimEnd() + '…';
  }

  /** A crown over the leader. */
  protected crown(ctx: Ctx2D, x: number, y: number, w: number): void {
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

  // ------------------------------------------------------------------ background, title, board

  protected background(ctx: Ctx2D): void {
    const { W, H } = this.L;
    if (!this.bg) {
      this.bg = createCanvas(Math.round(W * this.px), Math.round(H * this.px));
      const c = context2d(this.bg);
      c.scale(this.px, this.px);
      const g = c.createRadialGradient(this.L.cx, this.L.cy, 0, this.L.cx, this.L.cy, Math.max(W, H) * 0.8);
      g.addColorStop(0, this.theme.bgInner);
      g.addColorStop(1, this.theme.bgOuter);
      c.fillStyle = g;
      c.fillRect(0, 0, W, H);
      if (this.theme.stars) {
        for (let i = 0; i < 160; i++) {
          const x = (Math.sin(i * 91.7) * 0.5 + 0.5) * W;
          const y = (Math.sin(i * 47.3 + 1) * 0.5 + 0.5) * H;
          c.globalAlpha = 0.2 + 0.5 * (Math.sin(i * 13.1) * 0.5 + 0.5);
          c.fillStyle = '#fff';
          c.fillRect(x, y, 2, 2);
        }
        c.globalAlpha = 1;
      }
    }
    ctx.drawImage(this.bg, 0, 0, W, H);
  }

  private drawTitle(ctx: Ctx2D): void {
    const { look } = this.scene;
    const L = this.L;
    if (L.safe && (look.title.trim() || look.subtitle.trim())) {
      const yEnd = L.subtitle.y + 70;
      const g = ctx.createLinearGradient(0, 0, 0, yEnd);
      g.addColorStop(0, 'rgba(0,0,0,0.75)');
      g.addColorStop(0.75, 'rgba(0,0,0,0.45)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, L.W, yEnd);
    }
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    if (look.title.trim()) {
      ctx.textAlign = L.title.align;
      const display = look.titleFont === 'display';
      this.fit(
        ctx,
        look.title,
        display ? FONT_DISPLAY : FONT_SANS,
        display ? '400' : '800',
        L.title.size,
        L.title.maxW,
      );
      this.text(ctx, look.title, L.title.x, L.title.y, this.theme.text);
    }
    if (look.subtitle.trim()) {
      ctx.textAlign = L.subtitle.align;
      this.fit(ctx, look.subtitle, FONT_SANS, '500', L.subtitle.size, L.subtitle.maxW);
      this.text(ctx, look.subtitle, L.subtitle.x, L.subtitle.y, this.theme.subtext);
    }
  }

  private drawBoard(ctx: Ctx2D, t: number): void {
    const B = this.L.board;
    if (!B) return;
    const { scene, theme: th } = this;
    const all = this.boardRows(t);
    const rows = Math.min(B.rows, all.length);
    ctx.textBaseline = 'middle';
    for (let q = 0; q < rows; q++) {
      const row = all[q];
      const y = B.y + q * B.rowH;
      const h = B.rowH - 10;
      ctx.globalAlpha = row.dim ? 0.45 : 0.85;
      ctx.fillStyle = th.hudBg;
      ctx.beginPath();
      ctx.roundRect(B.x, y - h / 2, B.w, h, h / 2);
      ctx.fill();
      ctx.globalAlpha = row.dim ? 0.5 : 1;
      let x = B.x + 12;
      const disc = h * 0.78;
      const tok = this.tokens.get(row.fighter, disc * this.px);
      const size = disc * TOKEN_SCALE;
      ctx.drawImage(tok, x + disc / 2 - size / 2, y - size / 2, size, size);
      x += disc + 12;
      ctx.font = `600 ${B.size}px ${FONT_SANS}`;
      ctx.textAlign = 'left';
      const tailW = ctx.measureText(row.tail).width + 18;
      ctx.fillStyle = th.text;
      ctx.fillText(this.ellipsize(ctx, scene.fighters[row.fighter].name, B.x + B.w - x - tailW - 10), x, y);
      ctx.textAlign = 'right';
      ctx.fillStyle = row.hot ? th.accent : th.subtext;
      ctx.fillText(row.tail, B.x + B.w - 18, y);
      ctx.globalAlpha = 1;
    }
    if (all.length > rows) {
      ctx.textAlign = 'left';
      ctx.font = `500 ${B.size * 0.8}px ${FONT_SANS}`;
      ctx.fillStyle = th.subtext;
      ctx.fillText(`+${all.length - rows} more`, B.x + 14, B.y + rows * B.rowH - 6);
    }
  }

  /** An announcement band over the arena (see overlay.ts). */
  protected banner(ctx: Ctx2D, text: string, u: number, life: number, y: number): void {
    const { L } = this;
    bandBanner(ctx, this.theme, {
      text,
      u,
      life,
      cx: L.cx,
      y,
      maxW: L.P * 2 * 0.96,
      size: Math.min(L.W, L.H) * 0.085,
    });
  }

  private drawBanners(ctx: Ctx2D, v: number, t: number): void {
    const { scene, L } = this;
    const { timeline, result } = scene;
    const { k } = roundIndexAt(result.offsets, t);
    const off = result.offsets[k];
    const y = L.cy - L.P * 0.35;
    if (this.tournament) this.banner(ctx, this.roundName(k), v - timeline.videoAt(off), 1.5, y);
    if (k < result.rounds.length - 1) {
      const w = scene.fighters[result.show.entrants[k][this.roundWinner(k)]];
      const at = off + result.rounds[k].winnerT;
      this.banner(ctx, `${w.name.toUpperCase()} ADVANCES`, v - timeline.videoAt(at), 2.4, y);
    }
    this.drawGameBanners(ctx, v, t, y);
    // Ask viewers to pick a flag in the comments, just after the start.
    if (scene.look.prompt)
      this.banner(ctx, scene.look.prompt, v - (timeline.intro + 1.2), 2.4, L.cy + L.P * 0.5);
  }

  /** Index (within the round) of a round's winning ball. */
  protected abstract roundWinner(k: number): number;

  // ------------------------------------------------------------------ intro, winner, outro

  private drawIntro(ctx: Ctx2D, v: number): void {
    const { timeline, fighters } = this.scene;
    if (v >= timeline.intro) return;
    const { W, H } = this.L;
    const th = this.theme;
    const end = timeline.intro;
    const fade = v > end - 0.3 ? (end - v) / 0.3 : 1;
    ctx.save();
    ctx.globalAlpha = 0.88 * fade;
    ctx.fillStyle = th.bgOuter;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = fade;
    const n = fighters.length;
    const areaW = W - 140;
    const areaH = Math.min(H * 0.42, 820);
    const cols = Math.max(1, Math.ceil(Math.sqrt((n * areaW) / areaH)));
    const rows = Math.ceil(n / cols);
    const cell = Math.min(areaW / cols, areaH / rows, 170);
    const gx = W / 2 - (cols * cell) / 2;
    const gy = H * 0.5 - (rows * cell) / 2;
    for (let i = 0; i < n; i++) {
      const appear = -0.25 + (0.9 * i) / Math.max(1, n);
      const sc = easeBack((v - appear) / 0.25);
      if (sc <= 0) continue;
      const d = cell * 0.8 * sc;
      const tok = this.tokens.get(i, d * this.px);
      const size = d * TOKEN_SCALE;
      const cx = gx + (i % cols) * cell + cell / 2;
      const cy = gy + Math.floor(i / cols) * cell + cell / 2;
      ctx.drawImage(tok, cx - size / 2, cy - size / 2, size, size);
      if (this.countryballs) paintEyes(ctx, cx, cy - d * 0.04, d * 0.62, 'open');
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    const { head, sub } = this.introText();
    const m = Math.min(W, H);
    this.fit(ctx, head, FONT_DISPLAY, '400', m * 0.1, W - 120);
    this.text(ctx, head, W / 2, gy - m * 0.15, th.text);
    this.fit(ctx, sub, FONT_DISPLAY, '400', m * 0.07, W - 160);
    this.text(ctx, sub, W / 2, gy - m * 0.065, th.accent);
    const marks: [number, string][] = [
      [0.2, '3'],
      [0.7, '2'],
      [1.2, '1'],
      [1.7, 'GO!'],
    ];
    for (let q = marks.length - 1; q >= 0; q--) {
      const [at, label] = marks[q];
      if (v < at) continue;
      const p = easeBack((v - at) / 0.22);
      ctx.save();
      ctx.translate(W / 2, gy + rows * cell + m * 0.16);
      ctx.scale(p, p);
      ctx.font = `${m * 0.15}px ${FONT_DISPLAY}`;
      this.text(ctx, label, 0, 0, label === 'GO!' ? th.accent : th.text);
      ctx.restore();
      break;
    }
    ctx.restore();
  }

  private getWinnerToken(sizePx: number): AnyCanvas {
    const want = Math.round(sizePx);
    if (!this.winnerToken || this.winnerToken.size < want * 0.95) {
      const w = this.scene.fighters[this.scene.result.winnerIndex];
      this.winnerToken = { canvas: bakeToken(this.scene.winnerImage ?? w.image, want, w.accent), size: want };
    }
    return this.winnerToken.canvas;
  }

  private drawWinner(ctx: Ctx2D, v: number): void {
    const { timeline, result, fighters, look } = this.scene;
    const u = v - timeline.vWinner;
    if (u < 0) return;
    const { W, H } = this.L;
    const th = this.theme;
    const m = Math.min(W, H);
    const w = fighters[result.winnerIndex];
    if (u < 0.35) {
      ctx.globalAlpha = 0.5 * (1 - u / 0.35);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, W, H);
    }
    ctx.globalAlpha = 0.8 * easeOut((u - 0.4) / 0.6);
    ctx.fillStyle = th.bgOuter;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
    const cy = look.aspect === '16:9' ? H * 0.4 : H * 0.42;
    const R = m * (look.aspect === '16:9' ? 0.19 : 0.21);
    const sc = easeBack((u - 0.55) / 0.5);
    if (sc > 0) {
      ctx.save();
      ctx.translate(W / 2, cy);
      ctx.scale(sc, sc);
      this.drawWinnerHalo(ctx, R, u);
      ctx.globalAlpha = 1;
      const tok = this.getWinnerToken(2 * R * this.px);
      const size = 2 * R * TOKEN_SCALE;
      ctx.drawImage(tok, -size / 2, -size / 2, size, size);
      if (this.countryballs) paintEyes(ctx, 0, -R * 0.08, R * 1.24, 'happy');
      ctx.restore();
    }
    const tp = easeOut((u - 0.8) / 0.45);
    if (tp > 0) {
      const text = this.winnerText();
      winnerLockup(ctx, th, {
        name: w.name.toUpperCase(),
        verb: text.verb,
        line: text.line,
        x: W / 2,
        y: cy + R + m * 0.07,
        maxW: W - 120,
        m,
        t: tp,
      });
    }
    if (look.particles) drawConfetti(ctx, u - 0.5, W, H, w.palette, this.scene.seed);
  }

  private drawOutro(ctx: Ctx2D, v: number): void {
    const { timeline, result, fighters, look } = this.scene;
    const u = v - timeline.vOutro;
    if (u < 0 || timeline.outro <= 0) return;
    const { W, H, safe } = this.L;
    const th = this.theme;
    const a = easeOut(u / 0.45);
    ctx.globalAlpha = a;
    this.background(ctx);
    const top = safe ? safe.top : 0;
    const bottom = safe ? safe.bottom : H;
    const m = Math.min(W, H);
    const discY = (top + bottom) / 2 - m * 0.3;
    const R = m * 0.15;
    const w = fighters[result.winnerIndex];
    const tok = this.getWinnerToken(2 * R * this.px);
    const size = 2 * R * TOKEN_SCALE * (0.9 + 0.1 * easeOut(u / 0.6));
    ctx.drawImage(tok, W / 2 - size / 2, discY - size / 2, size, size);
    if (this.countryballs) paintEyes(ctx, W / 2, discY - R * 0.08, R * 1.24, 'happy');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    const name = `${w.name.toUpperCase()} ${this.winnerText().outro}`;
    this.fit(ctx, name, FONT_DISPLAY, '400', m * 0.12, W - 120);
    this.text(ctx, name, W / 2, discY + R + m * 0.1, th.text);
    const cta = look.outroCta.trim();
    if (cta) {
      ctx.font = `600 ${m * 0.05}px ${FONT_SANS}`;
      const words = cta.split(/\s+/);
      const lines: string[] = [];
      let line = '';
      for (const word of words) {
        const next = line ? `${line} ${word}` : word;
        if (ctx.measureText(next).width > W - 160 && line) {
          lines.push(line);
          line = word;
        } else line = next;
      }
      if (line) lines.push(line);
      const cp = easeOut((u - 0.25) / 0.4);
      ctx.globalAlpha = a * cp;
      lines
        .slice(0, 3)
        .forEach((l, i) => this.text(ctx, l, W / 2, discY + R + m * 0.24 + i * m * 0.066, th.accent));
    }
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------------ frame

  /** `opts` go to the game's arena (the thumbnail frames it differently, without banners). */
  render(ctx: Ctx2D, v: number, opts: O & { thumbnail?: boolean } = {} as O & { thumbnail?: boolean }): void {
    const { scene } = this;
    const { timeline, look } = scene;
    v = Math.max(0, Math.min(v, timeline.total));
    const phase = timeline.phaseAt(v);
    const t = timeline.simAt(v);
    ctx.setTransform(this.px, 0, 0, this.px, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.imageSmoothingEnabled = true;
    this.background(ctx);
    const covered = phase === 'outro' && v - timeline.vOutro > 0.45;
    if (!covered) {
      ctx.save();
      this.drawArena(ctx, t, opts);
      ctx.restore();
      ctx.setTransform(this.px, 0, 0, this.px, 0, 0);
      if (phase === 'battle' || phase === 'intro') {
        this.drawTitle(ctx);
        if (look.showCounter) this.drawCounter(ctx, t);
        if (look.showKillFeed) this.drawBoard(ctx, t);
        if (!opts.thumbnail) this.drawBanners(ctx, v, t);
      }
      if (phase === 'intro') this.drawIntro(ctx, v);
      if (phase === 'winner' || phase === 'outro') this.drawWinner(ctx, v);
    }
    if (phase === 'outro') this.drawOutro(ctx, v);
  }
}
