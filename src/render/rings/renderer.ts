/**
 * Ring Escape renderer. Draws a frame as a pure function of (scene, video time), so preview and
 * export match frame for frame. The camera follows the balls and widens as rings break; rings
 * glow in rainbow colors and burst into shards when someone gets through.
 */
import { hashFloat } from '../../engine/rng';
import { context2d, createCanvas, FONT_DISPLAY, FONT_SANS, type AnyCanvas, type Ctx2D } from '../canvas';
import { drawConfetti, easeBack, easeOut } from '../effects';
import { DESIGN_SIZE } from '../layout';
import { THEMES, type Theme } from '../themes';
import { TOKEN_SCALE, TokenCache, bakeToken } from '../tokens';
import { ballAt, breaksAt, brokenAt, camAt, gapAngle, roundOf, type RingsScene } from './scene';

type Anchor = { x: number; y: number; align: CanvasTextAlign; maxW: number; size: number };

type RingsLayout = {
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

function layoutFor(aspect: RingsScene['look']['aspect']): RingsLayout {
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

const TAU = Math.PI * 2;
/** How long shards fly after a ring breaks (sim seconds). */
const SHARD_LIFE = 1.3;
const SHARDS = 22;

const ringColor = (hue: number, l = 62) => `hsl(${((hue % 360) + 360) % 360} 95% ${l}%)`;

export class RingsRenderer {
  readonly L: RingsLayout;
  readonly theme: Theme;
  readonly px: number;
  private readonly tokens: TokenCache;
  private bg: AnyCanvas | null = null;
  private winnerToken: { canvas: AnyCanvas; size: number } | null = null;

  constructor(
    readonly scene: RingsScene,
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

  private get tournament(): boolean {
    return this.scene.result.rounds.length > 1;
  }

  // ------------------------------------------------------------------ text helpers

  private outlined(ctx: Ctx2D, text: string, x: number, y: number, fill: string, stroke: number): void {
    ctx.lineWidth = stroke;
    ctx.strokeStyle = this.theme.dark ? 'rgba(4,6,10,0.88)' : 'rgba(255,255,255,0.92)';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = fill;
    ctx.fillText(text, x, y);
  }

  private fit(ctx: Ctx2D, text: string, family: string, weight: string, size: number, maxW: number): void {
    let s = size;
    ctx.font = `${weight} ${s}px ${family}`;
    while (s > 12 && ctx.measureText(text).width > maxW) {
      s -= 2;
      ctx.font = `${weight} ${s}px ${family}`;
    }
  }

  private ellipsize(ctx: Ctx2D, text: string, maxW: number): string {
    if (ctx.measureText(text).width <= maxW) return text;
    let s = text;
    while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
    return s.trimEnd() + '…';
  }

  private roundName(k: number): string {
    const n = this.scene.result.rounds.length;
    return k === n - 1 ? 'FINAL' : `HEAT ${k + 1} OF ${n - 1}`;
  }

  // ------------------------------------------------------------------ background and arena

  private background(ctx: Ctx2D): void {
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

  private drawArena(ctx: Ctx2D, t: number, full: boolean): void {
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
    ctx.restore();
  }

  // ------------------------------------------------------------------ HUD

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
      this.outlined(ctx, look.title, L.title.x, L.title.y, this.theme.text, 10);
    }
    if (look.subtitle.trim()) {
      ctx.textAlign = L.subtitle.align;
      this.fit(ctx, look.subtitle, FONT_SANS, '500', L.subtitle.size, L.subtitle.maxW);
      this.outlined(ctx, look.subtitle, L.subtitle.x, L.subtitle.y, this.theme.subtext, 7);
    }
  }

  private drawCounter(ctx: Ctx2D, t: number): void {
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

  private drawBoard(ctx: Ctx2D, t: number): void {
    const B = this.L.board;
    if (!B) return;
    const { scene, theme: th } = this;
    const { k, local, round } = roundOf(scene, t);
    const ids = scene.result.show.entrants[k];
    const breaks = breaksAt(round, local);
    // Most rings broken first; ties keep the start order.
    const order = ids.map((_, i) => i).sort((a, b) => breaks[b] - breaks[a] || a - b);
    const rows = Math.min(B.rows, order.length);
    ctx.textBaseline = 'middle';
    for (let q = 0; q < rows; q++) {
      const i = order[q];
      const y = B.y + q * B.rowH;
      const h = B.rowH - 10;
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = th.hudBg;
      ctx.beginPath();
      ctx.roundRect(B.x, y - h / 2, B.w, h, h / 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      let x = B.x + 12;
      const disc = h * 0.78;
      const tok = this.tokens.get(ids[i], disc * this.px);
      const size = disc * TOKEN_SCALE;
      ctx.drawImage(tok, x + disc / 2 - size / 2, y - size / 2, size, size);
      x += disc + 12;
      ctx.font = `600 ${B.size}px ${FONT_SANS}`;
      ctx.textAlign = 'left';
      const tail = `${breaks[i]} ${breaks[i] === 1 ? 'ring' : 'rings'}`;
      const tailW = ctx.measureText(tail).width + 18;
      ctx.fillStyle = th.text;
      ctx.fillText(this.ellipsize(ctx, scene.fighters[ids[i]].name, B.x + B.w - x - tailW - 10), x, y);
      ctx.textAlign = 'right';
      ctx.fillStyle = breaks[i] ? th.accent : th.subtext;
      ctx.fillText(tail, B.x + B.w - 18, y);
    }
    if (order.length > rows) {
      ctx.textAlign = 'left';
      ctx.font = `500 ${B.size * 0.8}px ${FONT_SANS}`;
      ctx.fillStyle = th.subtext;
      ctx.fillText(`+${order.length - rows} more`, B.x + 14, B.y + rows * B.rowH - 6);
    }
  }

  private banner(ctx: Ctx2D, text: string, u: number, life: number, y: number): void {
    if (u < 0 || u > life) return;
    const { L } = this;
    const fade = u > life - 0.35 ? (life - u) / 0.35 : 1;
    const pop = easeBack(u / 0.35);
    ctx.save();
    ctx.globalAlpha = Math.max(0, fade);
    ctx.translate(L.cx, y);
    ctx.scale(pop, pop);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    this.fit(ctx, text, FONT_DISPLAY, '400', Math.min(L.W, L.H) * 0.13, L.P * 2 * 0.95);
    ctx.lineWidth = 16;
    ctx.strokeStyle = 'rgba(4,6,10,0.9)';
    ctx.strokeText(text, 0, 0);
    ctx.fillStyle = this.theme.accent;
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }

  private drawBanners(ctx: Ctx2D, v: number, t: number): void {
    const { scene, L } = this;
    const { timeline, result } = scene;
    const { k, round } = roundOf(scene, t);
    const off = result.offsets[k];
    const last = k === result.rounds.length - 1;
    const N = round.rings.length;
    const y = L.cy - L.P * 0.35;
    if (this.tournament) this.banner(ctx, this.roundName(k), v - timeline.videoAt(off), 1.5, y);
    if (!last) {
      const w = scene.fighters[result.show.entrants[k][round.winnerIndex]];
      this.banner(ctx, `${w.name.toUpperCase()} ADVANCES`, v - timeline.videoAt(off + round.winnerT), 2.4, y);
    } else if (N > 2) {
      this.banner(ctx, 'LAST RING', v - timeline.videoAt(off + round.shatterT[N - 2]), 1.4, y);
    }
  }

  // ------------------------------------------------------------------ intro, winner, outro

  private drawIntro(ctx: Ctx2D, v: number): void {
    const { timeline, fighters, result } = this.scene;
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
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    const noun = fighters.every((f) => f.isCountry) ? 'COUNTRIES' : 'FLAGS';
    const head = this.tournament ? `${n} ${noun}` : `${n} ${noun}, ${result.rounds[0].rings.length} RINGS`;
    const sub = this.tournament ? `${result.rounds.length - 1} HEATS, THEN THE FINAL` : 'WHO ESCAPES FIRST?';
    const m = Math.min(W, H);
    this.fit(ctx, head, FONT_DISPLAY, '400', m * 0.1, W - 120);
    this.outlined(ctx, head, W / 2, gy - m * 0.15, th.text, 10);
    this.fit(ctx, sub, FONT_DISPLAY, '400', m * 0.07, W - 160);
    this.outlined(ctx, sub, W / 2, gy - m * 0.065, th.accent, 8);
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
      ctx.font = `${m * 0.2}px ${FONT_DISPLAY}`;
      ctx.lineWidth = 16;
      ctx.strokeStyle = 'rgba(4,6,10,0.9)';
      ctx.strokeText(label, 0, 0);
      ctx.fillStyle = label === 'GO!' ? th.accent : th.text;
      ctx.fillText(label, 0, 0);
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
      // The rings it broke, as a rainbow halo.
      const fin = result.rounds[result.rounds.length - 1];
      fin.rings.slice(0, 5).forEach((ring, j) => {
        ctx.strokeStyle = ringColor(ring.hue);
        ctx.globalAlpha = 0.85 - j * 0.12;
        ctx.lineWidth = 7;
        ctx.beginPath();
        const a = u * (j % 2 ? -0.7 : 0.7) + j;
        ctx.arc(0, 0, R + 24 + j * 13, a + 0.35, a - 0.35 + TAU);
        ctx.stroke();
      });
      ctx.globalAlpha = 1;
      const tok = this.getWinnerToken(2 * R * this.px);
      const size = 2 * R * TOKEN_SCALE;
      ctx.drawImage(tok, -size / 2, -size / 2, size, size);
      ctx.restore();
    }
    const tp = easeOut((u - 0.8) / 0.45);
    if (tp > 0) {
      ctx.globalAlpha = tp;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.font = `${m * 0.085}px ${FONT_DISPLAY}`;
      this.outlined(ctx, 'ESCAPED!', W / 2, cy - R - 120 - (1 - tp) * 20, th.accent, 10);
      this.fit(ctx, w.name.toUpperCase(), FONT_DISPLAY, '400', m * 0.15, W - 120);
      const nameY = cy + R + 140 + (1 - tp) * 20;
      this.outlined(ctx, w.name.toUpperCase(), W / 2, nameY, th.text, 12);
      ctx.font = `500 ${m * 0.034}px ${FONT_SANS}`;
      const rings = result.rounds[result.rounds.length - 1].rings.length;
      this.outlined(
        ctx,
        this.tournament
          ? `Won the final against ${result.show.entrants[result.rounds.length - 1].length - 1} heat winners`
          : `First of ${fighters.length} to break all ${rings} rings`,
        W / 2,
        nameY + m * 0.1,
        th.subtext,
        6,
      );
      ctx.globalAlpha = 1;
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
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    const name = `${w.name.toUpperCase()} ESCAPED`;
    this.fit(ctx, name, FONT_DISPLAY, '400', m * 0.12, W - 120);
    this.outlined(ctx, name, W / 2, discY + R + m * 0.1, th.text, 10);
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
        .forEach((l, i) => this.outlined(ctx, l, W / 2, discY + R + m * 0.24 + i * m * 0.066, th.accent, 7));
    }
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------------ frame

  /** `full` frames the inner rings around the center (used for the thumbnail). */
  render(ctx: Ctx2D, v: number, opts: { full?: boolean } = {}): void {
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
      this.drawArena(ctx, t, !!opts.full);
      ctx.setTransform(this.px, 0, 0, this.px, 0, 0);
      if (phase === 'battle' || phase === 'intro') {
        this.drawTitle(ctx);
        if (look.showCounter) this.drawCounter(ctx, t);
        if (look.showKillFeed) this.drawBoard(ctx, t);
        if (!opts.full) this.drawBanners(ctx, v, t);
      }
      if (phase === 'intro') this.drawIntro(ctx, v);
      if (phase === 'winner' || phase === 'outro') this.drawWinner(ctx, v);
    }
    if (phase === 'outro') this.drawOutro(ctx, v);
  }
}
