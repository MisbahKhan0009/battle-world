/**
 * Black Hole city generator. A grid of square blocks between roads: parks (trees, bushes,
 * benches), houses with gardens, shops, and downtown towers, with cars, buses, lamps and cones
 * on the roads. Sizes span from things a new hole eats at once to towers only a big one fits,
 * so holes have to grow through the food chain. The same seed is the same city.
 */
import { hash32, Rng } from '../rng';
import type { City, CityObject, ObjectKind } from './types';

/** Block pitch (block plus one road) and road width, in city units. */
export const BLOCK = 220;
export const ROAD = 44;

const rect = (kind: ObjectKind, x: number, y: number, hw: number, hh: number, v: number): CityObject => ({
  kind,
  x,
  y,
  hw,
  hh,
  s: Math.sqrt(hw * hw + hh * hh),
  area: 4 * hw * hh,
  v,
});

const disc = (kind: ObjectKind, x: number, y: number, r: number, v: number): CityObject => ({
  kind,
  x,
  y,
  hw: r,
  hh: r,
  s: r,
  area: 3.14159 * r * r,
  v,
});

type Zone = 'park' | 'homes' | 'shops' | 'downtown';

/** Fills one block (x0, y0 is its top-left corner, w its side). */
function fillBlock(rng: Rng, out: CityObject[], zone: Zone, x0: number, y0: number, w: number): void {
  const v = () => rng.next();
  const at = (u: number) => x0 + u * w;
  const bt = (u: number) => y0 + u * w;
  if (zone === 'park') {
    for (let k = 0; k < 9; k++)
      out.push(disc('tree', at(rng.range(0.1, 0.9)), bt(rng.range(0.1, 0.9)), rng.range(8, 13), v()));
    for (let k = 0; k < 6; k++)
      out.push(disc('bush', at(rng.range(0.08, 0.92)), bt(rng.range(0.08, 0.92)), rng.range(4.5, 6.5), v()));
    out.push(rect('bench', at(0.5), bt(0.3), 8, 3.5, v()), rect('bench', at(0.5), bt(0.7), 8, 3.5, v()));
    out.push(rect('bench', at(0.3), bt(0.5), 3.5, 8, v()));
    return;
  }
  if (zone === 'homes') {
    // Four houses with a tree and a bush each in the garden.
    for (const [u, q] of [
      [0.27, 0.27],
      [0.73, 0.27],
      [0.27, 0.73],
      [0.73, 0.73],
    ]) {
      const hw = rng.range(20, 27);
      const hh = rng.range(17, 23);
      out.push(rect('house', at(u), bt(q), hw, hh, v()));
      out.push(
        disc(
          'tree',
          at(u + (u < 0.5 ? -0.17 : 0.17)),
          bt(q + (q < 0.5 ? -0.17 : 0.17)),
          rng.range(8, 11),
          v(),
        ),
      );
      out.push(
        disc(
          'bush',
          at(u + (u < 0.5 ? 0.17 : -0.17)),
          bt(q + (q < 0.5 ? -0.18 : 0.18)),
          rng.range(4, 6),
          v(),
        ),
      );
    }
    return;
  }
  if (zone === 'shops') {
    out.push(rect('shop', at(0.3), bt(0.5), rng.range(26, 32), rng.range(50, 62), v()));
    out.push(rect('shop', at(0.72), bt(0.3), rng.range(28, 34), rng.range(24, 30), v()));
    out.push(rect('house', at(0.72), bt(0.74), rng.range(20, 26), rng.range(18, 22), v()));
    for (let k = 0; k < 3; k++) out.push(rect('car', at(0.6 + k * 0.12), bt(0.53), 7.5, 14, v()));
    return;
  }
  // Downtown: one big tower or two smaller ones, and a plaza with trees.
  if (rng.next() < 0.5) out.push(rect('tower', at(0.5), bt(0.45), rng.range(52, 62), rng.range(52, 62), v()));
  else {
    out.push(rect('tower', at(0.3), bt(0.38), rng.range(36, 44), rng.range(42, 52), v()));
    out.push(rect('tower', at(0.72), bt(0.42), rng.range(30, 38), rng.range(36, 46), v()));
  }
  for (let k = 0; k < 4; k++) out.push(disc('tree', at(0.15 + k * 0.23), bt(0.9), rng.range(7, 9), v()));
}

/** Builds the city for a config's seed: `blocks` by `blocks` blocks with roads all round. */
export function buildCity(seed: number, blocks: number): City {
  const rng = new Rng(hash32(seed, 0xc17));
  const size = blocks * BLOCK + ROAD;
  const w = BLOCK - ROAD;
  const objects: CityObject[] = [];
  const mid = (blocks - 1) / 2;
  for (let by = 0; by < blocks; by++)
    for (let bx = 0; bx < blocks; bx++) {
      // Downtown in the middle, homes and parks toward the edges.
      const d = Math.max(Math.abs(bx - mid), Math.abs(by - mid)) / Math.max(1, mid);
      const u = rng.next();
      const zone: Zone =
        d < 0.4
          ? u < 0.65
            ? 'downtown'
            : 'shops'
          : d < 0.75
            ? u < 0.35
              ? 'shops'
              : u < 0.75
                ? 'homes'
                : 'park'
            : u < 0.55
              ? 'homes'
              : 'park';
      fillBlock(rng, objects, zone, ROAD + bx * BLOCK, ROAD + by * BLOCK, w);
    }
  // Roads: lamps at every crossing, cars and the odd bus along the lanes, cones here and there.
  for (let gy = 0; gy <= blocks; gy++)
    for (let gx = 0; gx <= blocks; gx++) {
      const cx = gx * BLOCK + ROAD / 2;
      const cy = gy * BLOCK + ROAD / 2;
      objects.push(disc('lamp', cx - ROAD / 2 + 3, cy - ROAD / 2 + 3, 3.5, rng.next()));
      if (gx < blocks) {
        const lanes = rng.int(3);
        for (let k = 0; k < lanes; k++) {
          const bus = rng.next() < 0.15;
          const x = cx + ROAD / 2 + rng.range(0.15, 0.85) * w;
          const y = cy + (k % 2 ? 9 : -9);
          objects.push(bus ? rect('bus', x, y, 25, 8.5, rng.next()) : rect('car', x, y, 14, 7.5, rng.next()));
        }
        if (rng.next() < 0.3)
          objects.push(disc('cone', cx + ROAD / 2 + rng.range(0.1, 0.9) * w, cy, 3, rng.next()));
      }
      if (gy < blocks) {
        const lanes = rng.int(3);
        for (let k = 0; k < lanes; k++) {
          const x = cx + (k % 2 ? 9 : -9);
          const y = cy + ROAD / 2 + rng.range(0.15, 0.85) * w;
          objects.push(rect('car', x, y, 7.5, 14, rng.next()));
        }
      }
    }
  return { size, blocks, objects };
}
