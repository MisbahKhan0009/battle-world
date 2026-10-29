/**
 * One WebGL renderer per thread (the export worker, or the page), shared by every 3D game view.
 * Browsers allow only a few live WebGL contexts, and rendering is strictly one frame at a time,
 * so a single renderer is resized as needed. Each frame is rendered and then copied into the
 * game's 2D canvas, where the overlay (titles, banners, winner card) is drawn on top.
 */
import * as THREE from 'three';
import { createCanvas, type AnyCanvas, type Ctx2D } from '../render/canvas';

let shared: { renderer: THREE.WebGLRenderer; canvas: AnyCanvas } | null = null;

export function glRenderer(
  width: number,
  height: number,
): { renderer: THREE.WebGLRenderer; canvas: AnyCanvas } {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  if (!shared) {
    const canvas = createCanvas(w, h);
    const renderer = new THREE.WebGLRenderer({
      canvas: canvas as HTMLCanvasElement,
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(1);
    // Transparent where nothing is drawn, so the game's 2D background shows through.
    renderer.setClearColor(0x000000, 0);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    shared = { renderer, canvas };
  }
  if (shared.canvas.width !== w || shared.canvas.height !== h) shared.renderer.setSize(w, h, false);
  return shared;
}

/** Renders a scene at the canvas' device size and copies it over the whole 2D frame. */
export function drawScene(
  ctx: Ctx2D,
  scene: THREE.Scene,
  camera: THREE.Camera,
  width: number,
  height: number,
  designW: number,
  designH: number,
): void {
  const { renderer, canvas } = glRenderer(width, height);
  renderer.render(scene, camera);
  ctx.drawImage(canvas, 0, 0, designW, designH);
}
