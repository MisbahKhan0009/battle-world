/**
 * The battle renderer. Draws a frame as a pure function of (scene, video time); internal caches
 * (baked tokens, background layers) are memoization only. Preview and export both use this
 * class, so the exported video matches the preview frame for frame.
 */
import { bandBanner, legibleText, winnerLockup } from './overlay';
import { ARENA_R, ROUNDED_CORNER } from '../engine/physics';
import { hashFloat } from '../engine/rng';
import type { ArenaShape } from '../engine/types';
import { context2d, createCanvas, FONT_DISPLAY, FONT_SANS, type AnyCanvas, type Ctx2D } from './canvas';
import {
  drawConfetti,
  drawShatter,
  drawSparks,
  easeBack,
  easeInOut,
  easeOut,
  lastHitTime,
  shakeOffset,
} from './effects';
import { computeLayout, type Layout } from './layout';
import { upperIndex, type Scene } from './scene';
import { hpColor, THEMES, type Theme } from './themes';
import { TOKEN_SCALE, TokenCache, bakeToken } from './tokens';

export type RenderOptions = { safeArea?: boolean };

type Camera = { x: number; y: number; z: number };

export class BattleRenderer {
  readonly layout: Layout;
  readonly theme: Theme;
  /** Canvas pixels per design pixel. */
  readonly px: number;
  private readonly ws: number;
  private readonly tokens: TokenCache;
  private bgBase: AnyCanvas | null = null;
  private bgTop: AnyCanvas | null = null;
  private winnerToken: { canvas: AnyCanvas; size: number } | null = null;
  private readonly x: Float32Array;
  private readonly y: Float32Array;
  private readonly hp: Float32Array;
  private readonly accents: string[];

  constructor(
    readonly scene: Scene,
    readonly width: number,
    readonly height: number,
  ) {
    this.layout = computeLayout(scene.look);
    this.theme = THEMES[scene.look.theme];
    this.px = width / this.layout.W;
    this.ws = this.layout.arena.size / (2 * ARENA_R);
    this.accents = scene.fighters.map((f) => f.accent);
    this.tokens = new TokenCache(
      scene.fighters.map((f) => f.image),
      this.accents,
    );
    const n = scene.fighters.length;
    this.x = new Float32Array(n);
    this.y = new Float32Array(n);
    this.hp = new Float32Array(n);
  }

  get duration(): number {
    return this.scene.timeline.total;
  }

  // ---------------------------------------------------------------- track sampling

  private frameAt(t: number): { f0: number; f1: number; a: number } {
    const track = this.scene.result.track!;
    const f = Math.max(0, Math.min(track.frames - 1, t * track.hz));
    const f0 = Math.floor(f);
    return { f0, f1: Math.min(track.frames - 1, f0 + 1), a: f - f0 };
  }

  private sample(t: number): void {
    const { data, n } = this.scene.result.track!;
    const { f0, f1, a } = this.frameAt(t);
    const o0 = f0 * n * 3;
    const o1 = f1 * n * 3;
    for (let i = 0; i < n; i++) {
      const k = i * 3;
      this.x[i] = data[o0 + k] + (data[o1 + k] - data[o0 + k]) * a;
      this.y[i] = data[o0 + k + 1] + (data[o1 + k + 1] - data[o0 + k + 1]) * a;
      this.hp[i] = data[o0 + k + 2] + (data[o1 + k + 2] - data[o0 + k + 2]) * a;
    }
  }

  private posAt(i: number, t: number): [number, number] {
    const { data, n } = this.scene.result.track!;
    const { f0, f1, a } = this.frameAt(t);
    const o0 = f0 * n * 3 + i * 3;
    const o1 = f1 * n * 3 + i * 3;
    return [data[o0] + (data[o1] - data[o0]) * a, data[o0 + 1] + (data[o1 + 1] - data[o0 + 1]) * a];
  }

  private hpAt(i: number, t: number): number {
    const { data, n } = this.scene.result.track!;
    const { f0, f1, a } = this.frameAt(t);
    const o0 = f0 * n * 3 + i * 3 + 2;
    const o1 = f1 * n * 3 + i * 3 + 2;
    return data[o0] + (data[o1] - data[o0]) * a;
  }

  private get escapeMode(): boolean {
    return this.scene.result.config.mode === 'escape';
  }

  /** Opening center angle and half-angle at sim time t. */
  private gapAt(t: number): { angle: number; half: number } {
    const track = this.scene.result.track!;
    const { f0, f1, a } = this.frameAt(t);
    return {
      angle: track.gapAngle[f0] + (track.gapAngle[f1] - track.gapAngle[f0]) * a,
      half: track.gapHalf[f0] + (track.gapHalf[f1] - track.gapHalf[f0]) * a,
    };
  }

  private arenaAt(t: number): number {
    const track = this.scene.result.track!;
    const { f0, f1, a } = this.frameAt(t);
    return track.arena[f0] + (track.arena[f1] - track.arena[f0]) * a;
  }

  private isAlive(i: number, t: number): boolean {
    return this.scene.result.elimT[i] > t;
  }

  aliveCount(t: number): number {
    let c = 0;
    for (let i = 0; i < this.scene.fighters.length; i++) if (this.isAlive(i, t)) c++;
    return c;
  }

  // ---------------------------------------------------------------- camera

  /** Deterministic eased camera: full arena, then framing the final two, then the winner. */
  private camera(t: number, v: number): Camera {
    const { result, timeline } = this.scene;
    let cam: Camera = { x: 0, y: 0, z: 1 };
    const smoothPos = (ids: number[], at: number) => {
      let sx = 0;
      let sy = 0;
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      const samples = 6;
      for (let s = 0; s < samples; s++) {
        const ts = Math.max(0, at - (0.5 * s) / (samples - 1));
        let cx = 0;
        let cy = 0;
        for (const i of ids) {
          const [x, y] = this.posAt(i, ts);
          cx += x;
          cy += y;
          const r = result.radii[i];
          minX = Math.min(minX, x - r);
          maxX = Math.max(maxX, x + r);
          minY = Math.min(minY, y - r);
          maxY = Math.max(maxY, y + r);
        }
        sx += cx / ids.length;
        sy += cy / ids.length;
      }
      return { x: sx / samples, y: sy / samples, span: Math.max(maxX - minX, maxY - minY) };
    };
    const clampCam = (c: Camera): Camera => {
      const lim = ARENA_R * Math.max(0, 1 - 1 / c.z) * 1.05;
      return { z: c.z, x: Math.max(-lim, Math.min(lim, c.x)), y: Math.max(-lim, Math.min(lim, c.y)) };
    };

    // Escape mode keeps the whole circle in frame so the opening stays visible.
    if (result.final2T !== null && t >= result.final2T && !this.escapeMode) {
      const pair: number[] = [];
      for (let i = 0; i < this.scene.fighters.length; i++) if (result.elimT[i] > result.final2T) pair.push(i);
      const p = easeInOut((t - result.final2T) / 1.2);
      const ref = Math.min(t, result.winnerT);
      const s = smoothPos(pair, ref);
      const zFit = Math.max(1, Math.min(1.45, (2 * ARENA_R * 0.92) / (s.span + 220)));
      cam = clampCam({ x: s.x * p, y: s.y * p, z: 1 + (zFit - 1) * p });
    }
    if (v >= timeline.vWinner) {
      const u = v - timeline.vWinner;
      const q = easeInOut(u / 1.4);
      const w = smoothPos([result.winnerIndex], t);
      const target = clampCam({ x: w.x, y: w.y, z: 1.7 });
      cam = {
        x: cam.x + (target.x - cam.x) * q,
        y: cam.y + (target.y - cam.y) * q,
        z: cam.z + (target.z - cam.z) * q,
      };
    }
    return cam;
  }

  // ---------------------------------------------------------------- background

  private buildBackground(): void {
    const { W, H, arena } = this.layout;
    const th = this.theme;
    const w = Math.round(W * this.px);
    const h = Math.round(H * this.px);

    const base = createCanvas(w, h);
    const b = context2d(base);
    b.scale(this.px, this.px);
    const g = b.createRadialGradient(arena.cx, arena.cy, 0, arena.cx, arena.cy, Math.hypot(W, H) * 0.65);
    g.addColorStop(0, th.bgInner);
    g.addColorStop(1, th.bgOuter);
    b.fillStyle = g;
    b.fillRect(0, 0, W, H);
    // Stadium glow from above.
    const glow = b.createRadialGradient(W / 2, -H * 0.05, 0, W / 2, -H * 0.05, Math.max(W, H) * 0.75);
    glow.addColorStop(0, th.glow);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    b.fillStyle = glow;
    b.fillRect(0, 0, W, H);
    if (th.stars) {
      for (let i = 0; i < 260; i++) {
        const x = hashFloat(91, i, 1) * W;
        const y = hashFloat(91, i, 2) * H;
        const r = 0.6 + 1.8 * Math.pow(hashFloat(91, i, 3), 3);
        b.globalAlpha = 0.25 + 0.6 * hashFloat(91, i, 4);
        b.fillStyle = '#FFFFFF';
        b.beginPath();
        b.arc(x, y, r, 0, Math.PI * 2);
        b.fill();
      }
      b.globalAlpha = 1;
      const neb = b.createRadialGradient(W * 0.8, H * 0.25, 0, W * 0.8, H * 0.25, W * 0.7);
      neb.addColorStop(0, 'rgba(120,70,255,0.16)');
      neb.addColorStop(1, 'rgba(0,0,0,0)');
      b.fillStyle = neb;
      b.fillRect(0, 0, W, H);
    }
    this.bgBase = base;

    // Vignette + grain on top of the animated grid.
    const top = createCanvas(w, h);
    const t = context2d(top);
    t.scale(this.px, this.px);
    const vg = t.createRadialGradient(
      W / 2,
      H / 2,
      Math.min(W, H) * 0.35,
      W / 2,
      H / 2,
      Math.hypot(W, H) * 0.62,
    );
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, th.dark ? 'rgba(0,0,0,0.55)' : 'rgba(60,50,30,0.18)');
    t.fillStyle = vg;
    t.fillRect(0, 0, W, H);
    const tile = 96;
    const noise = createCanvas(tile, tile);
    const nctx = context2d(noise);
    const img = nctx.createImageData(tile, tile);
    for (let i = 0; i < tile * tile; i++) {
      const v = Math.floor(hashFloat(7, i) * 255);
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = th.dark ? 16 : 22;
    }
    nctx.putImageData(img, 0, 0);
    t.setTransform(1, 0, 0, 1, 0, 0);
    const pattern = t.createPattern(noise, 'repeat');
    if (pattern) {
      t.fillStyle = pattern;
      t.fillRect(0, 0, w, h);
    }
    this.bgTop = top;
  }

  private drawBackground(ctx: Ctx2D, v: number): void {
    if (!this.bgBase) this.buildBackground();
    const { W, H } = this.layout;
    ctx.drawImage(this.bgBase!, 0, 0, W, H);
    // Slowly drifting grid.
    const step = 64;
    const off = (v * 10) % step;
    ctx.beginPath();
    for (let x = (W / 2) % step; x < W; x += step) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
    }
    for (let y = off - step; y < H; y += step) {
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
    }
    ctx.strokeStyle = this.theme.grid;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.drawImage(this.bgTop!, 0, 0, W, H);
  }

  // ---------------------------------------------------------------- arena

  private arenaPath(ctx: Ctx2D, shape: ArenaShape, h: number): void {
    ctx.beginPath();
    if (shape === 'circle') ctx.arc(0, 0, h, 0, Math.PI * 2);
    else if (shape === 'square') ctx.rect(-h, -h, 2 * h, 2 * h);
    else ctx.roundRect(-h, -h, 2 * h, 2 * h, ROUNDED_CORNER * h);
  }

  /** Escape mode: a fixed circle whose rim has one rotating opening. */
  private drawEscapeArena(ctx: Ctx2D, t: number, v: number, k: number): void {
    const th = this.theme;
    const R = ARENA_R;
    const { angle, half } = this.gapAt(t);

    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 1.1);
    g.addColorStop(0, th.floorInner);
    g.addColorStop(1, th.floorOuter);
    ctx.fillStyle = g;
    ctx.fill();

    ctx.save();
    ctx.clip();
    ctx.globalAlpha = th.dark ? 0.07 : 0.1;
    ctx.strokeStyle = th.border;
    ctx.lineWidth = 3 * k;
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.28, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // Exit glow fanning out from the opening.
    const glow = ctx.createRadialGradient(0, 0, R * 0.82, 0, 0, R * 1.32);
    glow.addColorStop(0, 'rgba(0,0,0,0)');
    glow.addColorStop(0.35, withAlphaHex(th.accent, 0.28));
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, R * 1.32, angle - half * 1.15, angle + half * 1.15);
    ctx.closePath();
    ctx.fill();

    // Chevrons pointing out through the opening.
    const cx = Math.cos(angle);
    const cy = Math.sin(angle);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 5 * k;
    ctx.strokeStyle = th.accent;
    for (let c = 0; c < 3; c++) {
      const phase = (v * 1.6 + c / 3) % 1;
      const dist = R + (14 + 46 * phase) * k;
      const s = 11 * k;
      ctx.globalAlpha = Math.sin(phase * Math.PI) * 0.85;
      const px = cx * dist;
      const py = cy * dist;
      ctx.beginPath();
      ctx.moveTo(px - cx * s - cy * s, py - cy * s + cx * s);
      ctx.lineTo(px, py);
      ctx.lineTo(px - cx * s + cy * s, py - cy * s - cx * s);
      ctx.stroke();
    }
    ctx.restore();

    // Solid rim: everything except the opening.
    ctx.lineCap = 'round';
    ctx.strokeStyle = th.border;
    ctx.beginPath();
    ctx.arc(0, 0, R, angle + half, angle - half + Math.PI * 2);
    ctx.globalAlpha = 0.16;
    ctx.lineWidth = 20 * k;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 7 * k;
    ctx.stroke();
    // Edge posts.
    ctx.fillStyle = '#FFFFFF';
    for (const side of [1, -1]) {
      const a = angle + side * half;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * R, Math.sin(a) * R, 6.5 * k, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.lineCap = 'butt';
  }

  /** Escape mode: flags that just left slide out through the opening and fade. */
  private drawEscapes(ctx: Ctx2D, t: number, k: number, zoomPx: number): void {
    const { fx, result } = this.scene;
    const life = 1.1;
    for (const e of fx.elims) {
      const age = t - e.t;
      if (!e.escaped || age < 0 || age > life) continue;
      const p = age / life;
      const r = result.radii[e.i];
      // Exit pulse at the rim.
      if (age < 0.5) {
        const q = age / 0.5;
        ctx.globalAlpha = (1 - q) * 0.9;
        ctx.strokeStyle = this.theme.accent;
        ctx.lineWidth = (8 * (1 - q) + 1) * k;
        ctx.beginPath();
        ctx.arc(e.x, e.y, r * (1 + 1.4 * easeOut(q)), 0, Math.PI * 2);
        ctx.stroke();
      }
      const scale = 1 - 0.35 * p;
      const tok = this.tokens.get(e.i, 2 * r * zoomPx * scale);
      const size = 2 * r * TOKEN_SCALE * scale;
      ctx.globalAlpha = 1 - p * p;
      ctx.drawImage(tok, e.x + e.vx * age - size / 2, e.y + e.vy * age - size / 2, size, size);
    }
    ctx.globalAlpha = 1;
  }

  private drawArena(ctx: Ctx2D, t: number, k: number): void {
    const shape = this.scene.result.config.arena;
    const th = this.theme;
    const s = this.arenaAt(t);
    const h = ARENA_R * s;
    const shrinking = s < 0.999;

    if (shrinking) {
      // Closed-off zone between the original and the current wall.
      this.arenaPath(ctx, shape, ARENA_R);
      ctx.fillStyle = 'rgba(255,77,94,0.09)';
      ctx.fill();
      ctx.setLineDash([14 * k, 12 * k]);
      ctx.strokeStyle = 'rgba(255,77,94,0.35)';
      ctx.lineWidth = 2 * k;
      ctx.stroke();
      ctx.setLineDash([]);
    }

    this.arenaPath(ctx, shape, h);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, h * 1.1);
    g.addColorStop(0, th.floorInner);
    g.addColorStop(1, th.floorOuter);
    ctx.fillStyle = g;
    ctx.fill();

    // Center marks, like a stadium pitch.
    ctx.save();
    ctx.clip();
    ctx.globalAlpha = th.dark ? 0.07 : 0.1;
    ctx.strokeStyle = th.border;
    ctx.lineWidth = 3 * k;
    ctx.beginPath();
    ctx.arc(0, 0, h * 0.28, 0, Math.PI * 2);
    ctx.moveTo(-h * 1.5, 0);
    ctx.lineTo(h * 1.5, 0);
    ctx.stroke();
    ctx.restore();

    const border = shrinking ? th.danger : th.border;
    this.arenaPath(ctx, shape, h);
    ctx.strokeStyle = border;
    ctx.globalAlpha = 0.16;
    ctx.lineWidth = 18 * k;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 5 * k;
    ctx.stroke();
  }

  // ---------------------------------------------------------------- fighters

  private drawFighters(ctx: Ctx2D, t: number, k: number, zoomPx: number): void {
    const { scene } = this;
    const { look, result, fx } = scene;
    const n = scene.fighters.length;
    const radii = result.radii;
    const th = this.theme;
    let alive = 0;
    for (let i = 0; i < n; i++) if (this.isAlive(i, t)) alive++;

    // Discs.
    for (let i = 0; i < n; i++) {
      if (!this.isAlive(i, t)) continue;
      const r = radii[i];
      const age = t - lastHitTime(fx, i, t);
      // Bumps in escape mode do no damage, so they get a lighter pop and flash.
      const pop = age < 0.16 ? 1 + (this.escapeMode ? 0.05 : 0.09) * (1 - age / 0.16) : 1;
      const tok = this.tokens.get(i, 2 * r * zoomPx * pop);
      const size = 2 * r * TOKEN_SCALE * pop;
      ctx.drawImage(tok, this.x[i] - size / 2, this.y[i] - size / 2, size, size);
      if (age < 0.18) {
        ctx.globalAlpha = (this.escapeMode ? 0.3 : 0.85) * (1 - age / 0.18) ** 2;
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.arc(this.x[i], this.y[i], r * pop, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    // HP rings (battle royale only).
    const hpMode = !this.escapeMode;
    ctx.lineCap = 'round';
    for (let i = 0; i < n && hpMode; i++) {
      if (!this.isAlive(i, t)) continue;
      const r = radii[i];
      const ring = Math.max(3.2 * k, r * 0.1);
      const rr = r + ring * 0.5 + 2.5 * k;
      const max = result.maxHp[i];
      const frac = Math.max(0, this.hp[i] / max);
      const prev = Math.max(frac, Math.min(1, this.hpAt(i, Math.max(0, t - 0.45)) / max));
      ctx.lineWidth = ring;
      ctx.strokeStyle = th.dark ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0.12)';
      ctx.beginPath();
      ctx.arc(this.x[i], this.y[i], rr, 0, Math.PI * 2);
      ctx.stroke();
      const start = -Math.PI / 2;
      if (prev - frac > 0.002) {
        ctx.strokeStyle = 'rgba(255,255,255,0.75)';
        ctx.beginPath();
        ctx.arc(this.x[i], this.y[i], rr, start + frac * Math.PI * 2, start + prev * Math.PI * 2);
        ctx.stroke();
      }
      if (frac > 0) {
        ctx.strokeStyle = hpColor(frac);
        ctx.beginPath();
        ctx.arc(this.x[i], this.y[i], rr, start, start + frac * Math.PI * 2);
        ctx.stroke();
      }
    }

    // Labels: HP numbers, plus names once few remain.
    const showNames = alive <= 4;
    const showHp = look.showHpNumbers && hpMode;
    if (showHp || showNames) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      for (let i = 0; i < n; i++) {
        if (!this.isAlive(i, t)) continue;
        const r = radii[i];
        let y = this.y[i] + r + (hpMode ? Math.max(3.2 * k, r * 0.1) : 0) + 6 * k;
        if (showNames) {
          const size = Math.max(30 * k, Math.min(r * 0.6, 46 * k));
          ctx.font = `${size}px ${FONT_DISPLAY}`;
          y += size * 0.55;
          this.text(ctx, scene.fighters[i].name.toUpperCase(), this.x[i], y, th.text);
          y += size * 0.62;
        }
        if (showHp) {
          const size = Math.max(15 * k, Math.min(r * 0.5, 34 * k));
          ctx.font = `${size}px ${FONT_DISPLAY}`;
          y += size * 0.55;
          const hp = Math.max(1, Math.ceil(this.hp[i]));
          this.text(ctx, String(hp), this.x[i], y, hpColor(this.hp[i] / result.maxHp[i]));
        }
      }
    }
  }

  /** Overlay text with the shared soft shadow (overlay.ts), readable over any arena. */
  private text(ctx: Ctx2D, text: string, x: number, y: number, fill: string): void {
    legibleText(ctx, this.theme, text, x, y, fill);
  }

  private drawDamageNumbers(ctx: Ctx2D, t: number, k: number): void {
    const { fx, result } = this.scene;
    const life = 0.75;
    const to = upperIndex(fx.hitT, t);
    let shown = 0;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (let h = to; h >= 0 && shown < 28; h--) {
      const age = t - fx.hitT[h];
      if (age > life) break;
      const p = age / life;
      for (const side of [0, 1] as const) {
        const i = side === 0 ? fx.hitA[h] : fx.hitB[h];
        const dmg = side === 0 ? fx.hitDmgA[h] : fx.hitDmgB[h];
        if (dmg <= 0) continue; // the fighter was invulnerable
        const [x, y] = this.posAt(i, fx.hitT[h]);
        const r = result.radii[i];
        const size = (26 + Math.min(dmg, 40) * 0.5) * k * (p < 0.15 ? 0.6 + (0.4 * p) / 0.15 : 1);
        ctx.globalAlpha = p < 0.6 ? 1 : 1 - (p - 0.6) / 0.4;
        ctx.font = `${size}px ${FONT_DISPLAY}`;
        const drift = (hashFloat(this.scene.seed, h, side) - 0.5) * 30 * k;
        this.text(
          ctx,
          `-${Math.max(1, Math.round(dmg))}`,
          x + drift,
          y - r - 14 * k - 60 * k * easeOut(p),
          this.theme.danger,
        );
        shown++;
      }
    }
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- HUD and overlays

  private fitFont(
    ctx: Ctx2D,
    text: string,
    family: string,
    weight: string,
    size: number,
    maxW: number,
  ): number {
    ctx.font = `${weight} ${size}px ${family}`;
    const w = ctx.measureText(text).width;
    if (w <= maxW) return size;
    const s = Math.max(10, (size * maxW) / w);
    ctx.font = `${weight} ${s}px ${family}`;
    return s;
  }

  private drawTitle(ctx: Ctx2D): void {
    const { look } = this.scene;
    const L = this.layout;
    const th = this.theme;
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    if (look.title.trim()) {
      ctx.textAlign = L.title.align;
      const display = look.titleFont === 'display';
      this.fitFont(
        ctx,
        look.title,
        display ? FONT_DISPLAY : FONT_SANS,
        display ? '400' : '800',
        display ? L.title.size : L.title.size * 0.78,
        L.title.maxW,
      );
      this.text(ctx, look.title, L.title.x, L.title.y, th.text);
    }
    if (look.subtitle.trim()) {
      ctx.textAlign = L.subtitle.align;
      this.fitFont(ctx, look.subtitle, FONT_SANS, '500', L.subtitle.size, L.subtitle.maxW);
      this.text(ctx, look.subtitle, L.subtitle.x, L.subtitle.y, th.subtext);
    }
  }

  private drawCounter(ctx: Ctx2D, t: number): void {
    const L = this.layout.counter;
    const th = this.theme;
    const alive = this.aliveCount(t);
    const total = this.scene.fighters.length;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.lineJoin = 'round';
    ctx.font = `${L.size}px ${FONT_DISPLAY}`;
    const num = String(alive);
    const base = L.y + L.size * 0.36;
    this.text(ctx, num, L.x, base, th.text);
    const w = ctx.measureText(num).width;
    ctx.font = `${L.size * 0.42}px ${FONT_DISPLAY}`;
    const label = this.escapeMode ? 'INSIDE' : 'LEFT';
    this.text(ctx, `/ ${total} ${label}`, L.x + w + L.size * 0.14, base, th.subtext);
  }

  private drawKillFeed(ctx: Ctx2D, t: number): void {
    const { fx, fighters } = this.scene;
    const F = this.layout.feed;
    const th = this.theme;
    const keep = F.max > 3 ? 14 : 5;
    const entries = fx.elims
      .filter((e) => e.t <= t && t - e.t < keep)
      .slice(-F.max)
      .reverse();
    if (!entries.length) return;
    const size = F.size;
    const disc = size * 1.3;
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    entries.forEach((e, row) => {
      const age = t - e.t;
      const inP = easeOut(age / 0.3);
      const outP = age > keep - 0.5 ? (keep - age) / 0.5 : 1;
      const killer = e.by >= 0 ? fighters[e.by] : null;
      const victim = fighters[e.i];
      if (e.escaped) {
        this.drawEscapeFeedRow(ctx, e.i, victim.name, row, inP, outP);
        return;
      }
      ctx.font = `600 ${size}px ${FONT_SANS}`;
      const kName = this.ellipsize(ctx, killer?.name ?? '', F.maxW * 0.36);
      const vName = this.ellipsize(ctx, victim.name, F.maxW * 0.36);
      const kW = ctx.measureText(kName).width;
      const vW = ctx.measureText(vName).width;
      const gap = size * 0.4;
      const cross = size * 0.9;
      const padX = size * 0.5;
      const width = padX * 2 + (killer ? disc + gap + kW + gap : 0) + cross + gap + disc + gap + vW;
      const h = F.lineH - 8;
      const y = F.y + row * F.lineH;
      const slide = (1 - inP) * 40 * (F.align === 'right' ? 1 : -1);
      let x = (F.align === 'right' ? F.x - width : F.x) + slide;
      ctx.globalAlpha = Math.max(0, Math.min(inP, outP)) * (row === 0 ? 1 : 0.82);
      ctx.fillStyle = th.hudBg;
      ctx.beginPath();
      ctx.roundRect(x, y - h / 2, width, h, h / 2);
      ctx.fill();
      x += padX;
      const tokenAt = (i: number, cx: number, faded: boolean) => {
        const tok = this.tokens.get(i, disc * this.px);
        const s = disc * TOKEN_SCALE;
        const a = ctx.globalAlpha;
        if (faded) ctx.globalAlpha = a * 0.55;
        ctx.drawImage(tok, cx + disc / 2 - s / 2, y - s / 2, s, s);
        ctx.globalAlpha = a;
      };
      ctx.textAlign = 'left';
      if (killer) {
        tokenAt(e.by, x, false);
        x += disc + gap;
        ctx.fillStyle = th.text;
        ctx.fillText(kName, x, y);
        x += kW + gap;
      }
      // Crossed-out mark.
      ctx.strokeStyle = th.danger;
      ctx.lineWidth = size * 0.14;
      ctx.lineCap = 'round';
      const c = cross * 0.32;
      ctx.beginPath();
      ctx.moveTo(x + cross / 2 - c, y - c);
      ctx.lineTo(x + cross / 2 + c, y + c);
      ctx.moveTo(x + cross / 2 + c, y - c);
      ctx.lineTo(x + cross / 2 - c, y + c);
      ctx.stroke();
      x += cross + gap;
      tokenAt(e.i, x, true);
      x += disc + gap;
      ctx.fillStyle = th.subtext;
      ctx.fillText(vName, x, y);
      ctx.strokeStyle = th.subtext;
      ctx.lineWidth = Math.max(1.5, size * 0.07);
      ctx.beginPath();
      ctx.moveTo(x, y + 1);
      ctx.lineTo(x + vW, y + 1);
      ctx.stroke();
    });
    ctx.globalAlpha = 1;
  }

  /** Kill-feed row for a flag that left through the opening: [flag] Name OUT. */
  private drawEscapeFeedRow(
    ctx: Ctx2D,
    i: number,
    name: string,
    row: number,
    inP: number,
    outP: number,
  ): void {
    const F = this.layout.feed;
    const th = this.theme;
    const size = F.size;
    const disc = size * 1.3;
    const gap = size * 0.4;
    const padX = size * 0.5;
    ctx.font = `600 ${size}px ${FONT_SANS}`;
    const label = this.ellipsize(ctx, name, F.maxW * 0.6);
    const nameW = ctx.measureText(label).width;
    ctx.font = `${size * 1.05}px ${FONT_DISPLAY}`;
    const outW = ctx.measureText('OUT').width;
    const width = padX * 2 + disc + gap + nameW + gap + outW;
    const h = F.lineH - 8;
    const y = F.y + row * F.lineH;
    const slide = (1 - inP) * 40 * (F.align === 'right' ? 1 : -1);
    let x = (F.align === 'right' ? F.x - width : F.x) + slide;
    ctx.globalAlpha = Math.max(0, Math.min(inP, outP)) * (row === 0 ? 1 : 0.82);
    ctx.fillStyle = th.hudBg;
    ctx.beginPath();
    ctx.roundRect(x, y - h / 2, width, h, h / 2);
    ctx.fill();
    x += padX;
    const tok = this.tokens.get(i, disc * this.px);
    const s = disc * TOKEN_SCALE;
    ctx.drawImage(tok, x + disc / 2 - s / 2, y - s / 2, s, s);
    x += disc + gap;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = `600 ${size}px ${FONT_SANS}`;
    ctx.fillStyle = th.text;
    ctx.fillText(label, x, y);
    x += nameW + gap;
    ctx.font = `${size * 1.05}px ${FONT_DISPLAY}`;
    ctx.fillStyle = th.danger;
    ctx.fillText('OUT', x, y + size * 0.05);
    ctx.globalAlpha = 1;
  }

  private ellipsize(ctx: Ctx2D, text: string, maxW: number): string {
    if (ctx.measureText(text).width <= maxW) return text;
    let s = text;
    while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
    return s.trimEnd() + '…';
  }

  private drawFinal2(ctx: Ctx2D, v: number): void {
    const { timeline, result, fighters } = this.scene;
    if (timeline.vFinal2 === null) return;
    const u = v - timeline.vFinal2;
    const life = 2.3;
    if (u < 0 || u > life || v >= timeline.vWinner + 0.2) return;
    const { arena, W } = this.layout;
    const th = this.theme;
    const fade = u > life - 0.4 ? (life - u) / 0.4 : 1;
    // Dim the arena a little, announce the final two on the accent band, name them below.
    ctx.save();
    ctx.globalAlpha = fade * 0.3 * Math.min(1, u / 0.2);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, this.layout.H);
    ctx.restore();
    const y = arena.cy - arena.size * 0.1;
    bandBanner(ctx, th, { text: 'FINAL 2', u, life, cx: arena.cx, y, maxW: arena.size * 0.9, size: 130 });
    const pair = fighters
      .filter((_, i) => result.elimT[i] > (result.final2T ?? 0))
      .map((f) => f.name.toUpperCase());
    if (pair.length === 2) {
      const p = easeOut((u - 0.2) / 0.3);
      ctx.save();
      ctx.globalAlpha = fade * p;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const line = `${pair[0]}  VS  ${pair[1]}`;
      this.fitFont(ctx, line, FONT_DISPLAY, '400', 64, arena.size * 0.9);
      this.text(ctx, line, arena.cx, y + 118 + (1 - p) * 12, th.text);
      ctx.restore();
    }
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
    const { W, H, arena } = this.layout;
    const th = this.theme;
    const w = fighters[result.winnerIndex];
    const m = Math.min(W, H);

    if (u < 0.35) {
      ctx.globalAlpha = 0.55 * (1 - u / 0.35);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, W, H);
    }
    ctx.globalAlpha = 0.78 * easeOut((u - 0.4) / 0.6);
    ctx.fillStyle = th.bgOuter;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;

    const cy = look.aspect === '16:9' ? H * 0.42 : arena.cy - arena.size * 0.06;
    const R = m * (look.aspect === '16:9' ? 0.2 : 0.22);
    const s = easeBack((u - 0.55) / 0.5);
    if (s > 0) {
      ctx.save();
      ctx.translate(W / 2, cy);
      ctx.scale(s, s);
      // Two accent rings: the arena it survived, drawn around the winner.
      ctx.save();
      ctx.strokeStyle = th.accent;
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.arc(0, 0, R + 22, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, R + 44 + 6 * Math.sin(u * 3), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      const tok = this.getWinnerToken(2 * R * this.px);
      const size = 2 * R * TOKEN_SCALE;
      ctx.drawImage(tok, -size / 2, -size / 2, size, size);
      ctx.restore();
    }

    const tp = easeOut((u - 0.8) / 0.45);
    if (tp > 0) {
      const kills = result.kills[result.winnerIndex];
      winnerLockup(ctx, th, {
        name: w.name.toUpperCase(),
        verb: this.escapeMode ? 'STAYS INSIDE' : 'WINS',
        line: this.escapeMode
          ? `Last of ${fighters.length} flags inside`
          : `${kills} elimination${kills === 1 ? '' : 's'} out of ${fighters.length - 1} rivals`,
        x: W / 2,
        y: cy + R + m * 0.07,
        maxW: W - 120,
        m,
        t: tp,
      });
    }
    drawConfetti(ctx, u - 0.5, W, H, w.palette, this.scene.seed);
  }

  private drawIntro(ctx: Ctx2D, v: number): void {
    const { timeline, fighters } = this.scene;
    if (v >= timeline.intro) return;
    const { W, H, arena } = this.layout;
    const th = this.theme;
    const end = timeline.intro;
    const fade = v > end - 0.35 ? (end - v) / 0.35 : 1;
    ctx.save();
    ctx.globalAlpha = 0.9 * fade;
    ctx.fillStyle = th.bgOuter;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = fade;

    const n = fighters.length;
    const areaW = Math.min(W - 120, arena.size * 0.95);
    const areaH = arena.size * 0.62;
    const cols = Math.max(1, Math.ceil(Math.sqrt((n * areaW) / areaH)));
    const rows = Math.ceil(n / cols);
    const cell = Math.min(areaW / cols, areaH / rows, 170);
    const gx = W / 2 - (cols * cell) / 2;
    const gy = arena.cy - (rows * cell) / 2 + arena.size * 0.08;
    const fightP = (v - (end - 0.75)) / 0.25;
    for (let i = 0; i < n; i++) {
      // The first flags are already in place on frame 0, which doubles as the video thumbnail.
      const appear = -0.25 + (0.95 * i) / Math.max(1, n);
      const s = easeBack((v - appear) / 0.25) * (fightP > 0 ? 1 - 0.2 * easeOut(fightP) : 1);
      if (s <= 0) continue;
      const cx = gx + (i % cols) * cell + cell / 2;
      const cy = gy + Math.floor(i / cols) * cell + cell / 2;
      const d = cell * 0.78 * s;
      const tok = this.tokens.get(i, d * this.px);
      const size = d * TOKEN_SCALE;
      ctx.drawImage(tok, cx - size / 2, cy - size / 2, size, size);
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    const noun = fighters.every((f) => f.isCountry) ? 'COUNTRIES' : 'FIGHTERS';
    const headline = `${n} ${noun} ENTER`;
    const hp = 1;
    ctx.globalAlpha = fade * hp;
    this.fitFont(ctx, headline, FONT_DISPLAY, '400', Math.min(W, H) * 0.11, W - 120);
    this.text(ctx, headline, W / 2, gy - Math.min(W, H) * 0.09 - (1 - hp) * 30, th.text);

    if (fightP > 0) {
      // FIGHT arrives on the accent band, over the lineup.
      ctx.globalAlpha = fade;
      bandBanner(ctx, th, {
        text: 'FIGHT',
        u: v - (end - 0.75),
        life: 1,
        cx: W / 2,
        y: arena.cy + arena.size * 0.08,
        maxW: arena.size * 0.8,
        size: Math.min(W, H) * 0.17,
      });
    }
    ctx.restore();
  }

  private drawOutro(ctx: Ctx2D, v: number): void {
    const { timeline, result, fighters, look } = this.scene;
    const u = v - timeline.vOutro;
    if (u < 0 || timeline.outro <= 0) return;
    const { W, H, safe } = this.layout;
    const th = this.theme;
    const a = easeOut(u / 0.45);
    ctx.globalAlpha = a;
    ctx.drawImage(this.bgBase!, 0, 0, W, H);
    ctx.drawImage(this.bgTop!, 0, 0, W, H);
    const top = safe ? safe.top : 0;
    const bottom = safe ? safe.bottom : H;
    const m = Math.min(W, H);
    const midY = (top + bottom) / 2;
    const R = m * 0.15;
    const discY = midY - m * 0.3;
    const w = fighters[result.winnerIndex];
    const tok = this.getWinnerToken(2 * R * this.px);
    const size = 2 * R * TOKEN_SCALE * (0.9 + 0.1 * easeOut(u / 0.6));
    ctx.drawImage(tok, W / 2 - size / 2, discY - size / 2, size, size);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    const name = `${w.name.toUpperCase()} WINS`;
    this.fitFont(ctx, name, FONT_DISPLAY, '400', m * 0.12, W - 120);
    this.text(ctx, name, W / 2, discY + R + m * 0.1, th.text);

    const cta = look.outroCta.trim();
    if (cta) {
      ctx.font = `600 ${m * 0.05}px ${FONT_SANS}`;
      const lines = wrapText(ctx, cta, W - 160).slice(0, 3);
      const lh = m * 0.066;
      const y0 = discY + R + m * 0.24;
      const cp = easeOut((u - 0.25) / 0.4);
      ctx.globalAlpha = a * cp;
      lines.forEach((line, i) => this.text(ctx, line, W / 2, y0 + i * lh + (1 - cp) * 16, th.accent));
    }
    ctx.globalAlpha = 1;
  }

  private drawSafeArea(ctx: Ctx2D): void {
    const { safe, W, H } = this.layout;
    if (!safe) return;
    ctx.save();
    ctx.fillStyle = 'rgba(255,77,94,0.14)';
    ctx.fillRect(0, 0, W, safe.top);
    ctx.fillRect(0, safe.bottom, W, H - safe.bottom);
    ctx.setLineDash([16, 12]);
    ctx.strokeStyle = 'rgba(255,77,94,0.9)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, safe.top);
    ctx.lineTo(W, safe.top);
    ctx.moveTo(0, safe.bottom);
    ctx.lineTo(W, safe.bottom);
    ctx.stroke();
    ctx.font = `600 26px ${FONT_SANS}`;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('YouTube overlay zone', W / 2, safe.top / 2);
    ctx.fillText('YouTube overlay zone', W / 2, (safe.bottom + H) / 2);
    ctx.restore();
  }

  // ---------------------------------------------------------------- frame

  render(ctx: Ctx2D, v: number, opts: RenderOptions = {}): void {
    const { scene, layout: L, theme: th } = this;
    const { timeline, look, fx } = scene;
    v = Math.max(0, Math.min(v, timeline.total));
    const phase = timeline.phaseAt(v);
    const t = timeline.simAt(v);

    ctx.setTransform(this.px, 0, 0, this.px, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.imageSmoothingEnabled = true;
    this.drawBackground(ctx, v);

    const outroCovered = phase === 'outro' && v - timeline.vOutro > 0.45;
    if (!outroCovered) {
      this.sample(t);
      const cam = this.camera(t, v);
      const shake = look.screenShake && phase === 'battle' ? shakeOffset(fx, t, scene.seed) : { x: 0, y: 0 };
      const scale = this.ws * cam.z;
      const k = 1 / scale; // world units per design pixel

      ctx.save();
      ctx.setTransform(
        this.px * scale,
        0,
        0,
        this.px * scale,
        this.px * (L.arena.cx + shake.x - cam.x * scale),
        this.px * (L.arena.cy + shake.y - cam.y * scale),
      );
      if (this.escapeMode) this.drawEscapeArena(ctx, t, v, k);
      else this.drawArena(ctx, t, k);
      if (this.escapeMode) this.drawEscapes(ctx, t, k, scale * this.px);
      if (look.particles && !this.escapeMode) {
        drawShatter(
          ctx,
          fx,
          t,
          scene.seed,
          k,
          scene.result.radii,
          (i) => ({
            image: this.tokens.get(i, 2 * scene.result.radii[i] * scale * this.px),
            scale: TOKEN_SCALE,
          }),
          th.danger,
        );
      }
      this.drawFighters(ctx, t, k, scale * this.px);
      if (look.particles) drawSparks(ctx, fx, t, scene.seed, k, this.accents);
      if (look.showDamageNumbers && phase === 'battle' && !this.escapeMode) this.drawDamageNumbers(ctx, t, k);
      ctx.restore();

      if (phase === 'battle' || phase === 'intro') {
        this.drawTitle(ctx);
        if (look.showCounter) this.drawCounter(ctx, t);
        if (look.showKillFeed) this.drawKillFeed(ctx, t);
      }
      this.drawFinal2(ctx, v);
      if (phase === 'intro') this.drawIntro(ctx, v);
      if (phase === 'winner' || phase === 'outro') this.drawWinner(ctx, v);
    }
    if (phase === 'outro') this.drawOutro(ctx, v);
    if (opts.safeArea) this.drawSafeArea(ctx);
  }
}

function wrapText(ctx: Ctx2D, text: string, maxW: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxW && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/** #RRGGBB plus alpha as an rgba() string. */
function withAlphaHex(hex: string, a: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return `rgba(198,255,61,${a})`;
  const v = parseInt(m[1], 16);
  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`;
}
