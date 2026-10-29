/**
 * Countryballs: a glossy ball wearing its flag, with cartoon eyes. The flag is projected onto the
 * front of the ball, the face turns toward the camera and leans toward where the ball is heading,
 * and the eyes change with what is happening (blink, squint on a hit, scared near danger, happy
 * when it wins, crosses when it is out). The same eyes are painted in 2D for the intro and the
 * winner card.
 */
import * as THREE from 'three';
import { hashFloat } from '../engine/rng';
import { context2d, createCanvas, type Ctx2D, type ImageSource } from '../render/canvas';

export type Expression = 'open' | 'blink' | 'squint' | 'scared' | 'happy' | 'dead' | 'determined';

const EXPRESSIONS: Expression[] = ['open', 'blink', 'squint', 'scared', 'happy', 'dead', 'determined'];
const COLS = 4;
const ROWS = 2;
const CELL_W = 256;
const CELL_H = 128;
const INK = '#111318';

/**
 * Paints a pair of eyes centered at (cx, cy); `w` is the width of the pair. `look` nudges the
 * pupils of the expressions that have them (-1..1 on each axis).
 */
export function paintEyes(
  ctx: Ctx2D,
  cx: number,
  cy: number,
  w: number,
  e: Expression,
  look: [number, number] = [0, 0],
): void {
  const rx = w * 0.17;
  const ry = w * 0.21;
  const lw = w * 0.04;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = INK;
  ctx.fillStyle = '#FFFFFF';
  ctx.lineWidth = lw;
  for (const side of [-1, 1]) {
    const x = cx + side * w * 0.24;
    const y = cy;
    ctx.beginPath();
    if (e === 'open' || e === 'determined' || e === 'scared') {
      const k = e === 'scared' ? 1.12 : 1;
      ctx.ellipse(x, y, rx * k, ry * k, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (e === 'scared') {
        ctx.fillStyle = INK;
        ctx.beginPath();
        ctx.arc(x + look[0] * rx * 0.45, y + look[1] * ry * 0.45, rx * 0.26, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#FFFFFF';
      }
      if (e === 'determined') {
        // A brow slanting down toward the middle.
        ctx.lineWidth = lw * 1.6;
        ctx.beginPath();
        ctx.moveTo(x + side * rx * 1.15, y - ry * 1.25);
        ctx.lineTo(x - side * rx * 0.95, y - ry * 0.55);
        ctx.stroke();
        ctx.lineWidth = lw;
      }
    } else if (e === 'blink') {
      ctx.moveTo(x - rx, y + ry * 0.1);
      ctx.quadraticCurveTo(x, y + ry * 0.45, x + rx, y + ry * 0.1);
      ctx.stroke();
    } else if (e === 'squint') {
      // ">" on the left eye, "<" on the right.
      ctx.moveTo(x - side * rx, y - ry * 0.7);
      ctx.lineTo(x + side * rx * 0.8, y);
      ctx.lineTo(x - side * rx, y + ry * 0.7);
      ctx.stroke();
    } else if (e === 'happy') {
      ctx.moveTo(x - rx, y + ry * 0.35);
      ctx.quadraticCurveTo(x, y - ry * 1.1, x + rx, y + ry * 0.35);
      ctx.stroke();
    } else if (e === 'dead') {
      ctx.moveTo(x - rx * 0.8, y - ry * 0.7);
      ctx.lineTo(x + rx * 0.8, y + ry * 0.7);
      ctx.moveTo(x + rx * 0.8, y - ry * 0.7);
      ctx.lineTo(x - rx * 0.8, y + ry * 0.7);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** Every expression in one texture, one cell each. */
let atlasCanvas: ReturnType<typeof createCanvas> | null = null;
function eyeAtlas() {
  if (!atlasCanvas) {
    atlasCanvas = createCanvas(CELL_W * COLS, CELL_H * ROWS);
    const c = context2d(atlasCanvas);
    EXPRESSIONS.forEach((e, k) => {
      const col = k % COLS;
      const row = Math.floor(k / COLS);
      paintEyes(c, col * CELL_W + CELL_W / 2, row * CELL_H + CELL_H / 2, CELL_W * 0.86, e);
    });
  }
  return atlasCanvas;
}

let ballGeometry: THREE.SphereGeometry | null = null;
/** A unit sphere whose UVs project the flag straight onto its front (+z). */
function geometry(): THREE.SphereGeometry {
  if (!ballGeometry) {
    const g = new THREE.SphereGeometry(1, 40, 28);
    const p = g.attributes.position;
    const uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, 0.5 + p.getX(i) * 0.5, 0.5 - p.getY(i) * 0.5);
    uv.needsUpdate = true;
    ballGeometry = g;
  }
  return ballGeometry;
}

const eyesGeometry = new THREE.PlaneGeometry(1.3, 0.65);
const target = new THREE.Vector3();

/** Blinks every few seconds, at its own rhythm. */
export function blinking(seed: number, i: number, t: number): boolean {
  const period = 2.6 + 2.2 * hashFloat(seed, i, 0xb11);
  const phase = (t + period * hashFloat(seed, i, 0xb12)) % period;
  return phase < 0.12;
}

export class Countryball {
  /** Positioned at the ball's center, scaled to its radius. */
  readonly root = new THREE.Group();
  /** Turns the flag and the eyes toward the camera and the way the ball is heading. */
  readonly face = new THREE.Group();
  readonly body: THREE.Mesh;
  private readonly eyes: THREE.Mesh;
  private readonly eyeMap: THREE.CanvasTexture;
  private readonly flagMap: THREE.Texture | null;

  constructor(flag: ImageSource | null, color: string) {
    if (flag) {
      this.flagMap = new THREE.Texture(flag as TexImageSource);
      this.flagMap.flipY = false;
      this.flagMap.colorSpace = THREE.SRGBColorSpace;
      this.flagMap.anisotropy = 4;
      this.flagMap.needsUpdate = true;
    } else this.flagMap = null;
    // Flipped UVs above match an unflipped upload; a plain color needs no map.
    this.body = new THREE.Mesh(
      geometry(),
      new THREE.MeshPhysicalMaterial({
        map: this.flagMap,
        color: this.flagMap ? 0xffffff : new THREE.Color(color),
        roughness: 0.42,
        metalness: 0,
        clearcoat: 0.75,
        clearcoatRoughness: 0.22,
      }),
    );
    this.body.castShadow = true;
    this.eyeMap = new THREE.CanvasTexture(eyeAtlas() as HTMLCanvasElement);
    this.eyeMap.colorSpace = THREE.SRGBColorSpace;
    this.eyeMap.repeat.set(1 / COLS, 1 / ROWS);
    this.eyes = new THREE.Mesh(
      eyesGeometry,
      new THREE.MeshBasicMaterial({
        map: this.eyeMap,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    this.eyes.renderOrder = 2;
    this.face.add(this.body, this.eyes);
    this.root.add(this.face);
  }

  /**
   * Places the ball. `facing` is the world direction the face should point (toward the camera,
   * leaned toward the heading); `look` shifts the eyes across the face (-1..1); `spin` rolls the
   * flag around the facing axis.
   */
  set(args: {
    x: number;
    y: number;
    z: number;
    r: number;
    facing: THREE.Vector3;
    look?: [number, number];
    expression?: Expression;
    spin?: number;
    visible?: boolean;
  }): void {
    const { root } = this;
    root.visible = args.visible ?? true;
    if (!root.visible) return;
    root.position.set(args.x, args.y, args.z);
    root.scale.setScalar(args.r);
    root.updateMatrixWorld();
    target.copy(root.position).add(args.facing);
    this.face.lookAt(target);
    this.body.rotation.z = args.spin ?? 0;
    const [lx, ly] = args.look ?? [0, 0];
    this.eyes.position.set(lx * 0.3, 0.16 + ly * 0.2, 0.995 - (lx * lx + ly * ly) * 0.06);
    this.eyes.rotation.set(-ly * 0.3, lx * 0.35, 0);
    const k = EXPRESSIONS.indexOf(args.expression ?? 'open');
    this.eyeMap.offset.set((k % COLS) / COLS, 1 - (Math.floor(k / COLS) + 1) / ROWS);
  }

  dispose(): void {
    (this.body.material as THREE.Material).dispose();
    (this.eyes.material as THREE.Material).dispose();
    this.flagMap?.dispose();
    this.eyeMap.dispose();
  }
}
