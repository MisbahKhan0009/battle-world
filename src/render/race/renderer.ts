/**
 * Marble Race renderer. Draws a frame as a pure function of (scene, video time), like the battle
 * renderer, so preview and export match frame for frame. The camera follows the front of the
 * race down the track; flags spin with the marbles' real rotation.
 */
import { blinking, drawCountryball, paintEyes, type Expression } from '../countryball';
import { bandBanner, legibleText, winnerLockup } from '../overlay';
import { SLOWMO_SEC } from '../../engine/timeline';
import { context2d, createCanvas, FONT_DISPLAY, FONT_SANS, type AnyCanvas, type Ctx2D } from '../canvas';
import { drawConfetti, easeBack, easeOut } from '../effects';
import { DESIGN_SIZE } from '../layout';
import { THEMES, type Theme } from '../themes';
import { TOKEN_SCALE, TokenCache, bakeToken } from '../tokens';
import { cameraAt, marbleAt, standingsAt, type RaceScene } from './scene';

type Anchor = { x: number; y: number; align: CanvasTextAlign; maxW: number; size: number };

type RaceLayout = {
  W: number;
  H: number;
  /** Design pixels per world unit. */
  s: number;
  /** Screen x of the track's left edge. */
  trackX: number;
  /** Screen y the camera focus maps to. */
  focusY: number;
  title: Anchor;
  subtitle: Anchor;
  board: { x: number; y: number; w: number; rowH: number; rows: number; size: number };
  progress: { x: number; y: number; w: number };
  safe: { top: number; bottom: number } | null;
};

function layoutFor(aspect: RaceScene['look']['aspect']): RaceLayout {
  const { W, H } = DESIGN_SIZE[aspect];
  if (aspect === '16:9') {
    const s = 0.8;
    return {
      W,
      H,
      s,
      trackX: W - 110 - 1000 * s,
      focusY: H * 0.56,
      title: { x: 96, y: 130, align: 'left', maxW: 700, size: 92 },
      subtitle: { x: 96, y: 206, align: 'left', maxW: 700, size: 36 },
      board: { x: 96, y: 300, w: 620, rowH: 56, rows: 10, size: 28 },
      progress: { x: 96, y: 900, w: 620 },
      safe: null,
    };
  }
  // 9:16 (and 1:1 falls back to the same column layout).
  const s = 0.76;
  const safeTop = Math.round(H * 0.12);
  return {
    W,
    H,
    s,
    trackX: 24,
    focusY: H * 0.56,
    title: { x: W / 2, y: safeTop + 70, align: 'center', maxW: W - 110, size: 88 },
    subtitle: { x: W / 2, y: safeTop + 146, align: 'center', maxW: W - 160, size: 38 },
    board: {
      x: 24 + 1000 * s + 14,
      y: safeTop + 230,
      w: W - (24 + 1000 * s + 14) - 18,
      rowH: 64,
      rows: 8,
      size: 26,
    },
    progress: { x: 24 + 1000 * s + 14, y: safeTop + 230 + 8 * 64 + 40, w: W - (24 + 1000 * s + 14) - 18 },
    safe: { top: safeTop, bottom: Math.round(H * 0.8) },
  };
}

export class RaceRenderer {
  readonly L: RaceLayout;
  readonly theme: Theme;
  readonly px: number;
  private readonly tokens: TokenCache;
  private bg: AnyCanvas | null = null;
  private winnerToken: { canvas: AnyCanvas; size: number } | null = null;

  constructor(
    readonly scene: RaceScene,
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

  // ------------------------------------------------------------------ text helpers

  /** Overlay text with the shared soft shadow (overlay.ts), readable over any arena. */
  private text(ctx: Ctx2D, text: string, x: number, y: number, fill: string): void {
    legibleText(ctx, this.theme, text, x, y, fill);
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

  // ------------------------------------------------------------------ background and track

  private background(ctx: Ctx2D): void {
    const { W, H } = this.L;
    if (!this.bg) {
      this.bg = createCanvas(Math.round(W * this.px), Math.round(H * this.px));
      const c = context2d(this.bg);
      c.scale(this.px, this.px);
      const g = c.createRadialGradient(W / 2, H * 0.45, 0, W / 2, H * 0.45, Math.max(W, H) * 0.75);
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

  private drawTrack(ctx: Ctx2D, t: number, cam: number): void {
    const { scene, L, theme: th } = this;
    const { track, winnerIndex } = scene.result;
    const s = L.s;
    const top = cam - L.focusY / s;
    const bottom = cam + (L.H - L.focusY) / s;
    const W = track.width;

    ctx.save();
    ctx.setTransform(this.px * s, 0, 0, this.px * s, this.px * L.trackX, this.px * (L.focusY - cam * s));
    // Floor panel and a slow grid that scrolls with the track.
    ctx.fillStyle = th.floorOuter;
    ctx.globalAlpha = 0.55;
    ctx.fillRect(0, top, W, bottom - top);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = th.grid;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let y = Math.floor(top / 160) * 160; y < bottom; y += 160) {
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
    }
    for (let x = 125; x < W; x += 250) {
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
    }
    ctx.stroke();

    // Finish line (checkered band).
    if (Number.isFinite(track.finishY) && track.finishY > top - 40 && track.finishY < bottom + 40) {
      const sq = 25;
      for (let x = 0, k = 0; x < W; x += sq, k++) {
        for (let row = 0; row < 2; row++) {
          ctx.fillStyle = (k + row) % 2 ? '#0B0D13' : '#FFFFFF';
          ctx.fillRect(x, track.finishY - sq + row * sq, sq, sq);
        }
      }
      ctx.font = `${70}px ${FONT_DISPLAY}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.lineJoin = 'round';
      this.text(ctx, 'FINISH', W / 2, track.finishY - sq - 14, th.accent);
    }

    // Walls and ramps: soft glow under a solid core.
    const visible = track.segs.filter(
      (g) => Math.max(g.ay, g.by) + 40 > top && Math.min(g.ay, g.by) - 40 < bottom,
    );
    ctx.lineCap = 'round';
    ctx.strokeStyle = th.border;
    for (const pass of [0, 1]) {
      ctx.globalAlpha = pass === 0 ? 0.22 : 1;
      for (const g of visible) {
        ctx.lineWidth = g.r * 2 + (pass === 0 ? 14 : 0);
        ctx.beginPath();
        ctx.moveTo(g.ax, g.ay);
        ctx.lineTo(g.bx, g.by);
        ctx.stroke();
      }
      // Side walls.
      ctx.lineWidth = 14 + (pass === 0 ? 14 : 0);
      ctx.beginPath();
      ctx.moveTo(0, Math.max(top, -2000));
      ctx.lineTo(0, Math.min(bottom, track.bottomY));
      ctx.moveTo(W, Math.max(top, -2000));
      ctx.lineTo(W, Math.min(bottom, track.bottomY));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Pegs and bumpers.
    track.pegs.forEach((p, i) => {
      if (p.y + p.r < top || p.y - p.r > bottom) return;
      if (!p.bumper) {
        ctx.fillStyle = th.subtext;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
        return;
      }
      const hits = scene.bumperHits.get(i);
      let flash = 0;
      if (hits) {
        let last = -Infinity;
        for (const h of hits) {
          if (h > t) break;
          last = h;
        }
        flash = Math.exp(-(t - last) / 0.16);
      }
      const R = p.r * (1 + 0.18 * flash);
      ctx.fillStyle = th.danger;
      ctx.globalAlpha = 0.25 + 0.5 * flash;
      ctx.beginPath();
      ctx.arc(p.x, p.y, R + 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, R, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = th.floorInner;
      ctx.beginPath();
      ctx.arc(p.x, p.y, R * 0.55, 0, Math.PI * 2);
      ctx.fill();
    });

    // Spinners (angle is a pure function of time, same as the physics).
    for (const sp of track.spinners) {
      if (sp.cy + sp.half < top || sp.cy - sp.half > bottom) continue;
      const th2 = sp.phase + sp.omega * t;
      const c = Math.cos(th2);
      const sn = Math.sin(th2);
      ctx.strokeStyle = th.accent;
      ctx.lineWidth = sp.r * 2;
      ctx.beginPath();
      ctx.moveTo(sp.cx - c * sp.half, sp.cy - sn * sp.half);
      ctx.lineTo(sp.cx + c * sp.half, sp.cy + sn * sp.half);
      ctx.stroke();
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(sp.cx, sp.cy, sp.r * 1.3, 0, Math.PI * 2);
      ctx.fill();
    }

    // Marbles (leader drawn last, with a ring).
    const r = scene.result.config.radius;
    const n = scene.fighters.length;
    const order = standingsAt(scene, t);
    const leader = t >= scene.result.winnerT ? winnerIndex : order[0];
    const tokenPx = 2 * r * s * this.px;
    for (let k = n - 1; k >= 0; k--) {
      const i = order[k];
      const [x, y, a] = marbleAt(scene, i, t);
      if (y + r < top || y - r > bottom) continue;
      if (i === leader) {
        ctx.strokeStyle = th.accent;
        ctx.lineWidth = 9;
        ctx.globalAlpha = 0.95;
        ctx.beginPath();
        ctx.arc(x, y, r + 10, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      // A countryball rolling down: the flag spins, the eyes stay upright and look ahead. The
      // leader looks determined, finishers smile.
      const [px, py] = marbleAt(scene, i, Math.max(0, t - 1 / 30));
      const sp = Math.hypot(x - px, y - py) || 1;
      const lean = Math.min(1, sp / 10);
      const finished = scene.result.finishT[i] <= t;
      const expression: Expression = finished
        ? 'happy'
        : sp > 40
          ? 'scared'
          : i === leader
            ? 'determined'
            : blinking(scene.seed, i, t)
              ? 'blink'
              : 'open';
      drawCountryball(ctx, this.tokens.get(i, tokenPx), x, y, r, {
        expression,
        look: [((x - px) / sp) * lean, ((y - py) / sp) * lean],
        spin: a,
      });
      if (k === 0 && t < scene.result.winnerT + 0.2) {
        // "1" badge above the leader only.
        ctx.fillStyle = th.accent;
        ctx.beginPath();
        ctx.arc(x, y - r - 22, 17, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#0B0D13';
        ctx.font = `${26}px ${FONT_DISPLAY}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(k + 1), x, y - r - 20);
      }
    }
    ctx.restore();
  }

  // ------------------------------------------------------------------ HUD

  private drawTitle(ctx: Ctx2D): void {
    const { look } = this.scene;
    const L = this.L;
    if (L.safe && (look.title.trim() || look.subtitle.trim())) {
      // Darken the band behind the title so it reads over the track.
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
    const { scene, theme: th } = this;
    const B = this.L.board;
    const order = standingsAt(scene, t);
    const { finishT } = scene.result;
    const rows = Math.min(B.rows, order.length);
    ctx.textBaseline = 'middle';
    for (let k = 0; k < rows; k++) {
      const i = order[k];
      const y = B.y + k * B.rowH;
      const h = B.rowH - 10;
      ctx.globalAlpha = k === 0 ? 0.95 : 0.8;
      ctx.fillStyle = th.hudBg;
      ctx.beginPath();
      ctx.roundRect(B.x, y - h / 2, B.w, h, h / 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      if (k === 0) {
        ctx.strokeStyle = th.accent;
        ctx.lineWidth = 3;
        ctx.stroke();
      }
      let x = B.x + 14;
      ctx.textAlign = 'left';
      ctx.font = `${B.size * 1.15}px ${FONT_DISPLAY}`;
      ctx.fillStyle = k === 0 ? th.accent : th.subtext;
      ctx.fillText(String(k + 1), x, y + 2);
      x += B.size * 1.15;
      const disc = h * 0.78;
      const tok = this.tokens.get(i, disc * this.px);
      const size = disc * TOKEN_SCALE;
      ctx.drawImage(tok, x + disc / 2 - size / 2, y - size / 2, size, size);
      x += disc + 10;
      const done = finishT[i] <= t;
      ctx.font = `600 ${B.size}px ${FONT_SANS}`;
      const tail = done ? '✓' : '';
      const tailW = tail ? ctx.measureText(tail).width + 12 : 0;
      ctx.fillStyle = th.text;
      ctx.fillText(this.ellipsize(ctx, scene.fighters[i].name, B.x + B.w - x - 14 - tailW), x, y);
      if (tail) {
        ctx.textAlign = 'right';
        ctx.fillStyle = th.accent;
        ctx.fillText(tail, B.x + B.w - 16, y);
      }
    }
    if (order.length > rows) {
      ctx.textAlign = 'left';
      ctx.font = `500 ${B.size * 0.8}px ${FONT_SANS}`;
      ctx.fillStyle = th.subtext;
      ctx.fillText(`+${order.length - rows} more racing`, B.x + 14, B.y + rows * B.rowH - 6);
    }
  }

  private drawProgress(ctx: Ctx2D, t: number): void {
    const { scene, theme: th } = this;
    const P = this.L.progress;
    const { track } = scene.result;
    const order = standingsAt(scene, t);
    const lead = marbleAt(scene, order[0], t)[1];
    const p = Math.max(0, Math.min(1, lead / track.finishY));
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = `${30}px ${FONT_DISPLAY}`;
    this.text(ctx, `RACE ${Math.round(p * 100)}%`, P.x, P.y, th.text);
    const y = P.y + 30;
    ctx.fillStyle = th.hudBg;
    ctx.beginPath();
    ctx.roundRect(P.x, y, P.w, 12, 6);
    ctx.fill();
    ctx.fillStyle = th.accent;
    ctx.beginPath();
    ctx.roundRect(P.x, y, Math.max(12, P.w * p), 12, 6);
    ctx.fill();
  }

  private banner(ctx: Ctx2D, text: string, u: number, life: number, y: number): void {
    if (u < 0 || u > life) return;
    const { L } = this;
    // Centered over the track, so it never covers the standings.
    const cx = L.trackX + 500 * L.s;
    bandBanner(ctx, this.theme, {
      text,
      u,
      life,
      cx,
      y,
      maxW: 1000 * L.s * 0.96,
      size: Math.min(L.W, L.H) * 0.09,
    });
  }

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
    const cell = Math.min(areaW / cols, areaH / rows, 160);
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
      paintEyes(ctx, cx, cy - d * 0.04, d * 0.62, 'open');
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    const noun = fighters.every((f) => f.isCountry) ? 'COUNTRIES' : 'MARBLES';
    this.fit(ctx, `${n} ${noun} RACE`, FONT_DISPLAY, '400', Math.min(W, H) * 0.11, W - 120);
    this.text(ctx, `${n} ${noun} RACE`, W / 2, gy - Math.min(W, H) * 0.09, th.text);
    // Start lights: three reds come on with the beeps, then all turn to the accent on GO.
    const m = Math.min(W, H);
    const lightR = m * 0.045;
    const ly = gy + rows * cell + m * 0.14;
    const go = v >= 1.7;
    const housingW = lightR * 2 * 3 + lightR * 1.2 * 4;
    ctx.fillStyle = th.hudBg;
    ctx.beginPath();
    ctx.roundRect(W / 2 - housingW / 2, ly - lightR * 1.6, housingW, lightR * 3.2, lightR * 1.6);
    ctx.fill();
    [0.2, 0.7, 1.2].forEach((at, k) => {
      const x = W / 2 + (k - 1) * lightR * 3.2;
      const on = v >= at;
      ctx.fillStyle = go ? th.accent : on ? th.danger : 'rgba(127,127,127,0.25)';
      ctx.beginPath();
      ctx.arc(x, ly, lightR * (on ? 1 : 0.92), 0, Math.PI * 2);
      ctx.fill();
    });
    if (go) {
      const p = easeOut((v - 1.7) / 0.2);
      ctx.globalAlpha = fade * p;
      ctx.font = `${m * 0.12}px ${FONT_DISPLAY}`;
      this.text(ctx, 'GO', W / 2, ly + lightR * 1.6 + m * 0.09, th.accent);
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
      // A checkered ring, like the finish line, turning slowly.
      const segs = 36;
      ctx.save();
      ctx.rotate(u * 0.25);
      ctx.lineWidth = 16;
      for (let k = 0; k < segs; k++) {
        ctx.strokeStyle = k % 2 ? '#0B0D13' : '#FFFFFF';
        ctx.beginPath();
        ctx.arc(0, 0, R + 26, (k / segs) * Math.PI * 2, ((k + 1) / segs) * Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
      const tok = this.getWinnerToken(2 * R * this.px);
      const size = 2 * R * TOKEN_SCALE;
      ctx.drawImage(tok, -size / 2, -size / 2, size, size);
      paintEyes(ctx, 0, -R * 0.08, R * 1.24, 'happy');
      ctx.restore();
    }
    const tp = easeOut((u - 0.8) / 0.45);
    if (tp > 0) {
      winnerLockup(ctx, th, {
        name: w.name.toUpperCase(),
        verb: 'WINS THE RACE',
        line: `First of ${fighters.length} across the line in ${result.winnerT.toFixed(1)} s`,
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
    paintEyes(ctx, W / 2, discY - R * 0.08, R * 1.24, 'happy');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    const name = `${w.name.toUpperCase()} WINS`;
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

  /** `camY` overrides the camera (the thumbnail frames the whole pack instead of the leader). */
  render(ctx: Ctx2D, v: number, opts: { camY?: number } = {}): void {
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
      this.drawTrack(ctx, t, opts.camY ?? cameraAt(scene, t));
      ctx.setTransform(this.px, 0, 0, this.px, 0, 0);
      if (phase === 'battle' || phase === 'intro') {
        this.drawTitle(ctx);
        if (look.showKillFeed) this.drawBoard(ctx, t);
        if (look.showCounter) this.drawProgress(ctx, t);
        if (scene.finalStretchT !== null)
          this.banner(ctx, 'FINAL STRETCH', v - timeline.videoAt(scene.finalStretchT), 1.8, this.L.H * 0.36);
        if (timeline.vFinal2 !== null)
          this.banner(ctx, 'PHOTO FINISH', v - timeline.vFinal2, SLOWMO_SEC + 0.3, this.L.H * 0.3);
      }
      if (phase === 'intro') this.drawIntro(ctx, v);
      if (phase === 'winner' || phase === 'outro') this.drawWinner(ctx, v);
    }
    if (phase === 'outro') this.drawOutro(ctx, v);
  }
}
