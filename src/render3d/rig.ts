/**
 * Camera and light rig shared by the 3D game views. Sim coordinates (x right, y down the screen)
 * map to the floor plane: world x = sim x, world z = sim y, world y = up. The camera looks down
 * at a tilt, framed so the play area lands where the 2D layout expects it (centered on (cx, cy)
 * with radius P in design pixels).
 */
import * as THREE from 'three';

export type Frame = { W: number; H: number; cx: number; cy: number; P: number };

/**
 * Points the camera at `center` from `tilt` radians off vertical, far enough that a circle of
 * `radius` world units spans about P design pixels, and shifts the view so `center` appears at
 * (cx, cy). `yaw` turns the camera around the vertical axis.
 */
export function frameCamera(
  camera: THREE.PerspectiveCamera,
  frame: Frame,
  center: THREE.Vector3,
  radius: number,
  tilt: number,
  yaw = 0,
): void {
  const { W, H, cx, cy, P } = frame;
  camera.aspect = W / H;
  const half = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const d = (radius * (H / 2)) / (P * half);
  const up = Math.cos(tilt);
  const back = Math.sin(tilt);
  camera.position.set(
    center.x + Math.sin(yaw) * back * d,
    center.y + up * d,
    center.z + Math.cos(yaw) * back * d,
  );
  camera.up.set(0, 1, 0);
  camera.lookAt(center);
  camera.near = Math.max(1, d * 0.05);
  camera.far = d * 6;
  camera.setViewOffset(W, H, W / 2 - cx, H / 2 - cy, W, H);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
}

/** Sky and ground fill plus one soft-shadowed sun, sized to a play area of `radius`. */
export function addLights(
  scene: THREE.Scene,
  radius: number,
  opts: { sky: string; ground: string; sun?: number; fill?: number },
): THREE.DirectionalLight {
  scene.add(
    new THREE.HemisphereLight(new THREE.Color(opts.sky), new THREE.Color(opts.ground), opts.fill ?? 1.4),
  );
  const sun = new THREE.DirectionalLight(0xffffff, opts.sun ?? 2.2);
  sun.position.set(-radius * 0.5, radius * 2, radius * 0.9);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const s = sun.shadow.camera;
  s.left = -radius * 1.4;
  s.right = radius * 1.4;
  s.top = radius * 1.4;
  s.bottom = -radius * 1.4;
  s.near = radius * 0.2;
  s.far = radius * 5;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  sun.shadow.radius = 3;
  scene.add(sun, sun.target);
  return sun;
}

/** Where a world point lands on the 2D frame (design pixels), and how many pixels one unit spans there. */
export function project(
  camera: THREE.PerspectiveCamera,
  frame: Frame,
  p: THREE.Vector3,
): { x: number; y: number; scale: number } {
  const v = p.clone().project(camera);
  const q = p
    .clone()
    .add(new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion))
    .project(camera);
  const x = ((v.x + 1) / 2) * frame.W;
  const y = ((1 - v.y) / 2) * frame.H;
  const x2 = ((q.x + 1) / 2) * frame.W;
  const y2 = ((1 - q.y) / 2) * frame.H;
  return { x, y, scale: Math.hypot(x2 - x, y2 - y) };
}
