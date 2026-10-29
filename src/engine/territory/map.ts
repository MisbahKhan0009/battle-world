/**
 * Territory Wars map: a pixel crop of the world map around the competing countries. The crop is
 * square in kilometers (longitude cells are widened by 1/cos(latitude), so Europe is not squashed),
 * tiny islands are dropped, every landmass is linked to the rest by the shortest sea crossings
 * (so island countries can fight too), and every competitor starts with an equal blob of land
 * around its real center, preferring its own land.
 *
 * A pure function of the country codes: the sim and the renderer rebuild the same map.
 */
import world from '../../data/worldGrid.json';
import { dcos } from '../physics';

export type TerritoryMap = {
  cols: number;
  rows: number;
  /** 1 for land, 0 for sea, per cell (row-major). */
  land: Uint8Array;
  /** Land cells in raster order. */
  cells: Int32Array;
  /** Neighbors of each cell (CSR): the four touching land cells, plus any sea crossing. */
  adjStart: Int32Array;
  adj: Int32Array;
  /** Sea crossings between landmasses, as cell pairs. */
  bridges: [number, number][];
  /** Starting cells per competitor (equal counts). */
  homes: number[][];
};

/** Cells along the longer side of the crop. */
export const MAP_CELLS = 120;
/** Narrowest crop (degrees of latitude), so neighbors don't play on a handful of cells. */
const MIN_SPAN = 26;
/** A cell is land when this much of it is. */
const LAND_SHARE = 0.4;
/** Landmasses smaller than this (cells) are dropped unless someone starts there. */
const MIN_ISLAND = 4;

type WorldGrid = {
  step: number;
  lon0: number;
  lat0: number;
  w: number;
  h: number;
  codes: string[];
  centers: Record<string, [number, number]>;
  rle: string;
};

const W = world as unknown as WorldGrid;
const LAT_MIN = W.lat0 - W.h * W.step;
let source: Uint8Array | null = null;

function worldCells(): Uint8Array {
  if (source) return source;
  const out = new Uint8Array(W.w * W.h);
  let k = 0;
  for (const run of W.rle.split(' ')) {
    const [v, n] = run.split('*').map((s) => parseInt(s, 36));
    out.fill(v, k, k + n);
    k += n;
  }
  return (source = out);
}

/** World cell value at a longitude/latitude (0 sea, country index + 1, 255 other land). */
function sample(lon: number, lat: number): number {
  const col = Math.floor((((((lon - W.lon0) % 360) + 360) % 360) / W.step) % W.w);
  const row = Math.floor((W.lat0 - lat) / W.step);
  if (row < 0 || row >= W.h) return 0;
  return worldCells()[row * W.w + col];
}

/** Longitude and latitude of a country's center ([0, 0] if unknown). */
export function centerOf(iso: string): [number, number] {
  return W.centers[iso] ?? [0, 0];
}

const cache = new Map<string, TerritoryMap>();

export function buildMap(isos: string[]): TerritoryMap {
  const key = isos.join(',');
  let map = cache.get(key);
  if (!map) {
    map = makeMap(isos);
    if (cache.size > 6) cache.delete(cache.keys().next().value!);
    cache.set(key, map);
  }
  return map;
}

function makeMap(isos: string[]): TerritoryMap {
  // The crop: around every center, square in kilometers.
  const pts = isos.map(centerOf);
  const lons = pts.map((p) => p[0]);
  const lats = pts.map((p) => p[1]);
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const k = Math.max(0.5, dcos((midLat * Math.PI) / 180));
  const lonSpan = (Math.max(...lons) - Math.min(...lons)) * k;
  const latSpan = Math.max(...lats) - Math.min(...lats);
  const pad = Math.max(6, 0.22 * Math.max(lonSpan, latSpan));
  const side = Math.max(MIN_SPAN, lonSpan + 2 * pad, latSpan + 2 * pad);
  const latH = Math.min(side, W.lat0 - LAT_MIN);
  const lonW = Math.min(360, side / k);
  let top = midLat + latH / 2;
  if (top > W.lat0) top = W.lat0;
  if (top - latH < LAT_MIN) top = LAT_MIN + latH;
  const left = (Math.min(...lons) + Math.max(...lons)) / 2 - lonW / 2;
  const wide = lonW * k >= latH;
  const cols = wide ? MAP_CELLS : Math.max(24, Math.round((MAP_CELLS * lonW * k) / latH));
  const rows = wide ? Math.max(24, Math.round((MAP_CELLS * latH) / (lonW * k))) : MAP_CELLS;
  const dLon = lonW / cols;
  const dLat = latH / rows;
  const N = cols * rows;

  // Land and the country under each cell, from a 3x3 sample of its footprint.
  const land = new Uint8Array(N);
  const code = new Uint8Array(N);
  const votes = new Map<number, number>();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      votes.clear();
      let hits = 0;
      for (let sy = 0; sy < 3; sy++) {
        for (let sx = 0; sx < 3; sx++) {
          const v = sample(left + (c + (sx + 0.5) / 3) * dLon, top - (r + (sy + 0.5) / 3) * dLat);
          if (!v) continue;
          hits++;
          votes.set(v, (votes.get(v) ?? 0) + 1);
        }
      }
      if (hits / 9 < LAND_SHARE) continue;
      land[r * cols + c] = 1;
      let best = 0;
      let most = 0;
      for (const [v, n] of votes) if (n > most || (n === most && v < best)) [best, most] = [v, n];
      code[r * cols + c] = best;
    }
  }

  // Where each competitor starts: the land cell nearest its center that nobody else took.
  const cellOf = (lon: number, lat: number) => {
    const c = Math.floor((((((lon - left) % 360) + 360) % 360) / dLon) % cols);
    const r = Math.floor((top - lat) / dLat);
    return Math.max(0, Math.min(rows - 1, r)) * cols + Math.max(0, Math.min(cols - 1, c));
  };
  const taken = new Int16Array(N).fill(-1);
  const seeds = pts.map((p, i) => {
    const at = nearest(cellOf(p[0], p[1]), cols, rows, (q) => land[q] === 1 && taken[q] < 0);
    // Nowhere left (never expected): make the cell land.
    const cell = at >= 0 ? at : cellOf(p[0], p[1]);
    land[cell] = 1;
    taken[cell] = i;
    return cell;
  });

  // Drop tiny islands nobody starts on.
  const comp = components(land, cols, rows);
  const size = new Map<number, number>();
  const seeded = new Set(seeds.map((s) => comp[s]));
  for (let q = 0; q < N; q++) if (land[q]) size.set(comp[q], (size.get(comp[q]) ?? 0) + 1);
  for (let q = 0; q < N; q++) {
    if (land[q] && size.get(comp[q])! < MIN_ISLAND && !seeded.has(comp[q])) {
      land[q] = 0;
      comp[q] = -1;
    }
  }

  // Equal starting blobs, grown one cell per competitor per turn, own country's land first.
  const total = land.reduce((a, b) => a + b, 0);
  const want = Math.max(4, Math.min(90, Math.round(total * 0.012), Math.floor((total * 0.4) / isos.length)));
  const own = isos.map((iso) => W.codes.indexOf(iso) + 1);
  const homes = seeds.map((s) => [s]);
  const fronts = seeds.map((s) => [s]);
  for (let turn = 1; turn < want; turn++) {
    homes.forEach((home, i) => {
      let pickAt = -1;
      let pickScore = Infinity;
      for (const q of fronts[i]) {
        for (const nb of touching(q, cols, rows)) {
          if (!land[nb] || taken[nb] >= 0) continue;
          const dc = (nb % cols) - (seeds[i] % cols);
          const dr = Math.floor(nb / cols) - Math.floor(seeds[i] / cols);
          const score = (code[nb] === own[i] ? 0 : 1000) + dc * dc + dr * dr;
          if (score < pickScore || (score === pickScore && nb < pickAt)) [pickAt, pickScore] = [nb, score];
        }
      }
      if (pickAt < 0) return;
      taken[pickAt] = i;
      home.push(pickAt);
      fronts[i].push(pickAt);
    });
  }

  const bridges = seaBridges(land, comp, cols, rows);
  const cells: number[] = [];
  for (let q = 0; q < N; q++) if (land[q]) cells.push(q);
  const extra = new Map<number, number[]>();
  for (const [a, b] of bridges) {
    extra.set(a, [...(extra.get(a) ?? []), b]);
    extra.set(b, [...(extra.get(b) ?? []), a]);
  }
  const adjStart = new Int32Array(N + 1);
  const adj: number[] = [];
  for (let q = 0; q < N; q++) {
    adjStart[q] = adj.length;
    if (!land[q]) continue;
    for (const nb of touching(q, cols, rows)) if (land[nb]) adj.push(nb);
    adj.push(...(extra.get(q) ?? []));
  }
  adjStart[N] = adj.length;
  return {
    cols,
    rows,
    land,
    cells: Int32Array.from(cells),
    adjStart,
    adj: Int32Array.from(adj),
    bridges,
    homes,
  };
}

/** The four cells touching q (inside the crop). */
function touching(q: number, cols: number, rows: number): number[] {
  const c = q % cols;
  const r = (q - c) / cols;
  const out: number[] = [];
  if (r > 0) out.push(q - cols);
  if (c > 0) out.push(q - 1);
  if (c < cols - 1) out.push(q + 1);
  if (r < rows - 1) out.push(q + cols);
  return out;
}

/** Nearest cell to `from` (breadth first over every cell) that passes `ok`, or -1. */
function nearest(from: number, cols: number, rows: number, ok: (q: number) => boolean): number {
  const seen = new Uint8Array(cols * rows);
  const queue = [from];
  seen[from] = 1;
  for (let h = 0; h < queue.length; h++) {
    const q = queue[h];
    if (ok(q)) return q;
    for (const nb of touching(q, cols, rows)) {
      if (seen[nb]) continue;
      seen[nb] = 1;
      queue.push(nb);
    }
  }
  return -1;
}

/** Landmass id per cell (-1 for sea). */
function components(land: Uint8Array, cols: number, rows: number): Int32Array {
  const comp = new Int32Array(land.length).fill(-1);
  let id = 0;
  for (let s = 0; s < land.length; s++) {
    if (!land[s] || comp[s] >= 0) continue;
    comp[s] = id;
    const queue = [s];
    for (let h = 0; h < queue.length; h++) {
      for (const nb of touching(queue[h], cols, rows)) {
        if (!land[nb] || comp[nb] >= 0) continue;
        comp[nb] = id;
        queue.push(nb);
      }
    }
    id++;
  }
  return comp;
}

/**
 * The shortest sea crossings that join every landmass (a minimum spanning tree). The sea is
 * flooded from all coasts at once; where two floods from different landmasses meet, the coasts
 * they came from are a candidate crossing.
 */
function seaBridges(land: Uint8Array, comp: Int32Array, cols: number, rows: number): [number, number][] {
  const N = land.length;
  const from = new Int32Array(N).fill(-1);
  const dist = new Int32Array(N);
  const queue: number[] = [];
  for (let q = 0; q < N; q++) {
    if (!land[q]) continue;
    from[q] = q;
    queue.push(q);
  }
  const best = new Map<number, { d: number; a: number; b: number }>();
  const meet = (p: number, q: number) => {
    const ca = comp[from[p]];
    const cb = comp[from[q]];
    if (ca === cb) return;
    const d = dist[p] + dist[q] + 1;
    const key = Math.min(ca, cb) * 65536 + Math.max(ca, cb);
    const cur = best.get(key);
    if (!cur || d < cur.d) best.set(key, { d, a: from[p], b: from[q] });
  };
  for (let h = 0; h < queue.length; h++) {
    const p = queue[h];
    for (const nb of touching(p, cols, rows)) {
      if (from[nb] >= 0) {
        meet(p, nb);
        continue;
      }
      from[nb] = from[p];
      dist[nb] = dist[p] + 1;
      queue.push(nb);
    }
  }
  // Kruskal over the candidates, shortest first.
  const parent = new Map<number, number>();
  const find = (x: number): number => {
    let r = x;
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  const out: [number, number][] = [];
  const edges = [...best.entries()].sort((a, b) => a[1].d - b[1].d || a[0] - b[0]);
  for (const [, e] of edges) {
    const ra = find(comp[e.a]);
    const rb = find(comp[e.b]);
    if (ra === rb) continue;
    parent.set(ra, rb);
    out.push([e.a, e.b]);
  }
  return out;
}
