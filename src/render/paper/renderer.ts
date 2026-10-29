/**
 * Paper Land in 3D, styled after Paper.io 2. The board is a thick slab; land is painted on it in
 * one solid color per country with a raised lip, trails are ribbons in a lighter shade, and every
 * flag is a countryball rolling over the board with a pointer showing where it is steering and its
 * name above. Claims pop a ring, knock-outs burst into cubes, and the flag with the most land wears
 * a crown. Titles, banners, the intro, winner card and outro come from the shared show frame.
 */
import * as THREE from 'three';
import { TRAIL_R } from '../../engine/paper/sim';
import { hashFloat } from '../../engine/rng';
import { landPaths } from '../../render3d/contour';
import { drawScene } from '../../render3d/gl';
import { addLights, frameCamera, project, type Frame } from '../../render3d/rig';
import { context2d, createCanvas, FONT_DISPLAY, FONT_SANS, type AnyCanvas, type Ctx2D } from '../canvas';
import { blinking, drawCountryball, type Expression } from '../countryball';
import { easeOut } from '../effects';
import { ShowRenderer, type BoardRow } from '../show';
import {
  frameAt,
  groupAt,
  headAt,
  lastBefore,
  leaderAt,
  roundOf,
  sharesAt,
  stateAt,
  trailAt,
  type PaperScene,
} from './scene';

/** Texture pixels per land cell. */
const TEX = 4;
/** Ball radius (share of the board side) and slab thickness (board units). */
const BALL_R = 0.028;
const SLAB = 7;
/** Seconds a claim ring pops, wiped land fades, a knock-out bursts. */
const POP = 0.55;
const WIPE = 0.6;
const BURST = 0.9;
const MAX_TRAIL = 1600;
const CUBES = 18;

/** A #rrggbb color mixed toward white (f > 0) or black (f < 0). */
function tint(hex: string, f: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const v = parseInt(m[1], 16);
  const ch = (s: number) => {
    const c = (v >> s) & 255;
    return Math.round(f >= 0 ? c + (255 - c) * f : c * (1 + f));
  };
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

type Wipe = { t: number; color: string; path: Path2D };

/** One round's board: its slab, land texture, trails, balls and pointers. */
type Board = {
  k: number;
  size: number;
  group: THREE.Group;
  tex: THREE.CanvasTexture;
  canvas: AnyCanvas;
  ctx: Ctx2D;
  /** Land as of change group `g`, and the paths drawn for it. */
  grid: Uint8Array;
  g: number;
  paths: Path2D[];
  wipes: Wipe[];
  pointers: THREE.Mesh[];
  trails: { mesh: THREE.Mesh; pos: Float32Array; geo: THREE.BufferGeometry }[];
  rings: THREE.Mesh[];
  cubes: THREE.InstancedMesh;
  drawnKey: string;
};

export class PaperRenderer extends ShowRenderer<PaperScene> {
  protected readonly countryballs = true;
  private scene3 = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 1, 4000);
  private board: Board | null = null;

  /** World position (board centered on the origin) of a sim point. */
  private world(size: number, x: number, y: number, h = 0): THREE.Vector3 {
    return new THREE.Vector3(x - size / 2, h, y - size / 2);
  }

  private get frame(): Frame {
    return { W: this.L.W, H: this.L.H, cx: this.L.cx, cy: this.L.cy, P: this.L.P };
  }

  private buildBoard(k: number): Board {
    if (this.board) {
      this.scene3.remove(this.board.group);
      this.board.tex.dispose();
    }
    const { scene, theme: th } = this;
    const round = scene.result.rounds[k];
    const size = round.config.size;
    const ids = scene.result.show.entrants[k];
    const group = new THREE.Group();
    if (!this.scene3.children.length)
      addLights(this.scene3, size * 0.75, { sky: '#FFFFFF', ground: th.bgOuter, sun: 2.0 });

    // The slab: a land texture on top, darker sides.
    const canvas = createCanvas(size * TEX, size * TEX);
    const ctx = context2d(canvas);
    const tex = new THREE.CanvasTexture(canvas as HTMLCanvasElement);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const top = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }),
    );
    top.rotation.x = -Math.PI / 2;
    top.receiveShadow = true;
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(size, SLAB, size),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(th.floorOuter), roughness: 0.85 }),
    );
    slab.position.y = -SLAB / 2 - 0.02;
    slab.receiveShadow = true;
    group.add(top, slab);

    const arrow = new THREE.Shape();
    arrow.moveTo(0, 1.4);
    arrow.lineTo(1.1, -0.6);
    arrow.lineTo(0, -0.15);
    arrow.lineTo(-1.1, -0.6);
    arrow.closePath();
    const arrowGeo = new THREE.ShapeGeometry(arrow);
    const pointers = ids.map((f) => {
      const m = new THREE.Mesh(
        arrowGeo,
        new THREE.MeshStandardMaterial({
          color: new THREE.Color(tint(scene.colors[f], -0.15)),
          roughness: 0.6,
        }),
      );
      group.add(m);
      return m;
    });
    const trails = ids.map((f) => {
      const pos = new Float32Array(MAX_TRAIL * 2 * 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
      const normals = new Float32Array(MAX_TRAIL * 2 * 3);
      for (let q = 1; q < normals.length; q += 3) normals[q] = 1;
      geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
      const idx: number[] = [];
      for (let q = 0; q + 1 < MAX_TRAIL; q++)
        idx.push(2 * q, 2 * q + 1, 2 * q + 2, 2 * q + 1, 2 * q + 3, 2 * q + 2);
      geo.setIndex(idx);
      const mesh = new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(tint(scene.colors[f], 0.35)),
          transparent: true,
          opacity: 0.95,
          side: THREE.DoubleSide,
        }),
      );
      mesh.frustumCulled = false;
      group.add(mesh);
      return { mesh, pos, geo };
    });
    const ringGeo = new THREE.RingGeometry(0.82, 1, 48);
    const rings = Array.from({ length: 10 }, () => {
      const m = new THREE.Mesh(
        ringGeo,
        new THREE.MeshBasicMaterial({ transparent: true, toneMapped: false }),
      );
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      group.add(m);
      return m;
    });
    const cubes = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ roughness: 0.5 }),
      CUBES * 4,
    );
    cubes.castShadow = true;
    cubes.frustumCulled = false;
    cubes.count = 0;
    group.add(cubes);
    this.scene3.add(group);
    const board: Board = {
      k,
      size,
      group,
      tex,
      canvas,
      ctx,
      grid: new Uint8Array(size * size),
      g: -1,
      paths: [],
      wipes: [],
      pointers,
      trails,
      rings,
      cubes,
      drawnKey: '',
    };
    this.board = board;
    return board;
  }

  /** Brings the board's land up to change group g (replaying from the start when seeking back). */
  private advance(b: Board, g: number): void {
    if (g === b.g) return;
    const round = this.scene.result.rounds[b.k];
    const { changeStart, changeT, cells, owners } = round.rec!;
    if (g < b.g) {
      b.grid.fill(0);
      b.g = -1;
      b.wipes = [];
    }
    const ids = this.scene.result.show.entrants[b.k];
    for (let q = b.g + 1; q <= g; q++) {
      let wiped: Path2D | null = null;
      let victim = 0;
      for (let c = changeStart[q]; c < changeStart[q + 1]; c++) {
        const cell = cells[c];
        if (!owners[c] && b.grid[cell]) {
          victim = b.grid[cell];
          wiped ??= new Path2D();
          wiped.rect((cell % b.size) * TEX, Math.floor(cell / b.size) * TEX, TEX, TEX);
        }
        b.grid[cell] = owners[c];
      }
      if (wiped) b.wipes.push({ t: changeT[q], color: this.scene.colors[ids[victim - 1]], path: wiped });
    }
    b.g = g;
    b.paths = landPaths(b.grid, b.size, ids.length, TEX);
  }

  /** Paints the board texture: paper, land with a raised lip, and land fading after a knock-out. */
  private paint(b: Board, local: number): void {
    const live = b.wipes.filter((w) => local >= w.t && local - w.t < WIPE);
    const key = `${b.g}:${live.map((w) => Math.round((local - w.t) * 30)).join(',')}`;
    if (key === b.drawnKey) return;
    b.drawnKey = key;
    const { ctx, size } = b;
    const th = this.theme;
    const ids = this.scene.result.show.entrants[b.k];
    const S = size * TEX;
    ctx.fillStyle = th.floorInner;
    ctx.fillRect(0, 0, S, S);
    // A faint paper grid.
    ctx.strokeStyle = th.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let q = 16; q < size; q += 16) {
      ctx.moveTo(q * TEX, 0);
      ctx.lineTo(q * TEX, S);
      ctx.moveTo(0, q * TEX);
      ctx.lineTo(S, q * TEX);
    }
    ctx.stroke();
    for (const w of live) {
      ctx.globalAlpha = 1 - (local - w.t) / WIPE;
      ctx.fillStyle = w.color;
      ctx.fill(w.path);
    }
    ctx.globalAlpha = 1;
    const lip = TEX * 1.1;
    ids.forEach((f, i) => {
      ctx.save();
      ctx.translate(0, lip);
      ctx.fillStyle = tint(this.scene.colors[f], -0.32);
      ctx.fill(b.paths[i]);
      ctx.restore();
    });
    ids.forEach((f, i) => {
      ctx.fillStyle = this.scene.colors[f];
      ctx.fill(b.paths[i]);
    });
    b.tex.needsUpdate = true;
  }

  protected drawArena(ctx: Ctx2D, t: number, opts: { thumbnail?: boolean }): void {
    const { scene } = this;
    const { k, local, round } = roundOf(scene, t);
    const b = this.board?.k === k ? this.board : this.buildBoard(k);
    const size = b.size;
    const ids = scene.result.show.entrants[k];
    this.advance(b, groupAt(round, local));
    this.paint(b, local);

    frameCamera(this.camera, this.frame, new THREE.Vector3(0, 0, size * 0.02), size * 0.52, 0.66);
    const ft = frameAt(round, local);
    const fi = Math.floor(ft);
    const cuts = scene.cuts[k];
    const done = local >= round.winnerT;

    // Trails as ribbons on the board.
    ids.forEach((_, i) => {
      const tr = b.trails[i];
      const pts = trailAt(round, i, fi);
      if (!pts.length) {
        tr.geo.setDrawRange(0, 0);
        return;
      }
      const h = headAt(round, i, ft);
      pts.push([h.x, h.y]);
      const m = Math.min(pts.length, MAX_TRAIL);
      const w = TRAIL_R * 1.7;
      for (let q = 0; q < m; q++) {
        const [ax, ay] = pts[Math.max(0, q - 1)];
        const [bx, by] = pts[Math.min(m - 1, q + 1)];
        const dx = bx - ax;
        const dy = by - ay;
        const l = Math.hypot(dx, dy) || 1;
        const nx = (-dy / l) * w;
        const ny = (dx / l) * w;
        const [px, py] = pts[q];
        const o = q * 6;
        tr.pos[o] = px + nx - size / 2;
        tr.pos[o + 1] = 0.12;
        tr.pos[o + 2] = py + ny - size / 2;
        tr.pos[o + 3] = px - nx - size / 2;
        tr.pos[o + 4] = 0.12;
        tr.pos[o + 5] = py - ny - size / 2;
      }
      tr.geo.attributes.position.needsUpdate = true;
      tr.geo.setDrawRange(0, Math.max(0, (m - 1) * 6));
    });

    // Countryballs (2D, drawn over the board after it is rendered) and their pointers.
    const lead = done ? round.winnerIndex : leaderAt(scene, k, local);
    const sprites: {
      f: number;
      x: number;
      y: number;
      r: number;
      expression: Expression;
      look: [number, number];
      name: string | null;
      lead: boolean;
    }[] = [];
    ids.forEach((f, i) => {
      const ptr = b.pointers[i];
      let scale = 1;
      let expression: Expression = blinking(scene.seed, f, local) ? 'blink' : 'open';
      const h = headAt(round, i, ft);
      if (stateAt(round, i, fi) === 0) {
        const c = cuts.find((x) => x.i === i);
        const u = c ? (local - c.t) / 0.35 : 1;
        if (u >= 1) {
          ptr.visible = false;
          return;
        }
        scale = 1 - easeOut(u);
        expression = 'dead';
      } else if (done) expression = i === round.winnerIndex ? 'happy' : 'blink';
      else if (stateAt(round, i, fi) === 2) {
        // Out on a trail with a rival close by: scared.
        for (let q = 0; q < ids.length; q++) {
          if (q === i || stateAt(round, q, fi) === 0) continue;
          const o = headAt(round, q, ft);
          if (Math.hypot(o.x - h.x, o.y - h.y) < 22) expression = 'scared';
        }
      }
      const R = BALL_R * size;
      const r = R * scale;
      // Where it stands on the board, how big it is there, and which way it looks on screen.
      const base = project(this.camera, this.frame, this.world(size, h.x, h.y, 0));
      const ahead = project(this.camera, this.frame, this.world(size, h.x + h.dx * 10, h.y + h.dy * 10, 0));
      const lx = ahead.x - base.x;
      const ly = ahead.y - base.y;
      const ll = Math.hypot(lx, ly) || 1;
      sprites.push({
        f,
        x: base.x,
        y: base.y,
        r: r * base.scale * 1.3,
        expression,
        look: [(lx / ll) * 0.9, (ly / ll) * 0.9],
        name: scale === 1 ? scene.fighters[f].name : null,
        lead: i === lead && ids.length > 1 && !opts.thumbnail && scale === 1,
      });
      ptr.visible = scale === 1 && !done;
      ptr.position.copy(this.world(size, h.x + h.dx * R * 1.9, h.y + h.dy * R * 1.9, 0.25));
      // Lay the arrow flat, pointing along the heading.
      ptr.rotation.set(-Math.PI / 2, 0, Math.atan2(-h.dx, -h.dy));
      ptr.scale.setScalar(R * 0.42);
    });

    // Claim rings.
    let ring = 0;
    for (const e of round.events) {
      if (e.type !== 'claim' || e.t > local) continue;
      const u = (local - e.t) / POP;
      if (u >= 1 || ring >= b.rings.length) continue;
      const m = b.rings[ring++];
      m.visible = true;
      m.position.copy(this.world(size, e.x, e.y, 0.3));
      m.scale.setScalar(4 + Math.sqrt(e.cells) * 0.9 * easeOut(u));
      const mat = m.material as THREE.MeshBasicMaterial;
      mat.color.set(tint(scene.colors[ids[e.i]], 0.5));
      mat.opacity = 0.85 * (1 - u);
    }
    for (; ring < b.rings.length; ring++) b.rings[ring].visible = false;

    // Knock-outs burst into cubes of the flag's color.
    let n = 0;
    const mtx = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    for (let c = lastBefore(cuts, local); c >= 0 && local - cuts[c].t < BURST; c--) {
      const cut = cuts[c];
      const tt = local - cut.t;
      const u = tt / BURST;
      const color = new THREE.Color(scene.colors[ids[cut.i]]);
      for (let j = 0; j < CUBES && n < CUBES * 4; j++) {
        const a = hashFloat(scene.seed, c * 37 + j, 81) * Math.PI * 2;
        const sp = 10 + 16 * hashFloat(scene.seed, c * 37 + j, 82);
        const up = 18 + 22 * hashFloat(scene.seed, c * 37 + j, 83);
        const p = this.world(
          size,
          cut.x + Math.cos(a) * sp * tt,
          cut.y + Math.sin(a) * sp * tt,
          Math.max(0.6, 2 + up * tt - 45 * tt * tt),
        );
        quat.setFromEuler(new THREE.Euler(tt * 9 + j, tt * 7, 0));
        const s = 1.6 * (1 - u * u);
        mtx.compose(p, quat, new THREE.Vector3(s, s, s));
        b.cubes.setMatrixAt(n, mtx);
        b.cubes.setColorAt(n, color);
        n++;
      }
    }
    b.cubes.count = n;
    b.cubes.instanceMatrix.needsUpdate = true;
    if (b.cubes.instanceColor) b.cubes.instanceColor.needsUpdate = true;

    drawScene(ctx, this.scene3, this.camera, this.width, this.height, this.L.W, this.L.H);

    // The countryballs stand on the board (farther ones first), each on its own shadow, with
    // its name above and a crown on the leader.
    sprites.sort((a, c) => a.y - c.y);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const font = `700 ${Math.round(Math.min(this.L.W, this.L.H) * 0.026)}px ${FONT_SANS}`;
    for (const sp of sprites) {
      ctx.fillStyle = 'rgba(20,40,40,0.22)';
      ctx.beginPath();
      ctx.ellipse(sp.x, sp.y + sp.r * 0.05, sp.r * 0.95, sp.r * 0.38, 0, 0, Math.PI * 2);
      ctx.fill();
      const cy = sp.y - sp.r * 0.9;
      drawCountryball(ctx, this.tokens.get(sp.f, 2 * sp.r * this.px), sp.x, cy, sp.r, {
        expression: sp.expression,
        look: sp.look,
      });
      if (!sp.name) continue;
      const ny = cy - sp.r - 18;
      ctx.font = font;
      ctx.save();
      ctx.shadowColor = 'rgba(255,255,255,0.95)';
      ctx.shadowBlur = 6 * this.px;
      ctx.fillStyle = '#1D2A30';
      ctx.fillText(sp.name, sp.x, ny);
      ctx.restore();
      if (sp.lead) this.crown(ctx, sp.x, ny - 24, 38);
    }
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
    const fi = Math.floor(frameAt(round, local));
    const out = ids.map((_, i) => stateAt(round, i, fi) === 0);
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

  /** Rounded squares of land spreading out from the winner, in its color. */
  protected drawWinnerHalo(ctx: Ctx2D, R: number, u: number): void {
    const color = this.scene.colors[this.scene.result.winnerIndex];
    for (let j = 0; j < 3; j++) {
      const q = (u * 0.6 + j / 3) % 1;
      const h = R + 18 + q * 90;
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.6 * (1 - q);
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.roundRect(-h, -h, 2 * h, 2 * h, h * 0.4);
      ctx.stroke();
    }
  }
}
