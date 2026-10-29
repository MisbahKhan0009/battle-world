// Rasterizes the world-countries shapes into a coarse pixel world map for Territory Wars and
// writes src/data/worldGrid.json. Run again only when the country list changes.
//
// Equirectangular grid, STEP degrees per cell, from (LON0, LAT0) at the top left. Every cell is
// 0 (sea), the index + 1 of a country in src/data/countries.json, or 255 (land of a territory
// that is not in the list). Cells are run-length encoded as "value*run" pairs. Countries too
// small for the grid get the cell under their center point, so every country is on the map.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const STEP = 0.5;
const LON0 = -180;
const LAT0 = 84;
const LAT1 = -58;
const W = Math.round(360 / STEP);
const H = Math.round((LAT0 - LAT1) / STEP);
const OTHER = 255;

const root = new URL('../', import.meta.url);
const countries = JSON.parse(readFileSync(new URL('src/data/countries.json', root), 'utf8'));
const world = JSON.parse(readFileSync(new URL('node_modules/world-countries/countries.json', root), 'utf8'));
const indexOf = new Map(countries.map((c, i) => [c.iso2, i + 1]));

function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const grid = new Uint8Array(W * H);
const centers = {};
let shapes = 0;
for (const c of world) {
  const iso2 = c.cca2.toLowerCase();
  if (iso2 === 'aq') continue;
  const file = new URL(`node_modules/world-countries/data/${c.cca3.toLowerCase()}.geo.json`, root);
  if (!existsSync(file)) continue;
  const value = indexOf.get(iso2) ?? OTHER;
  if (value !== OTHER) centers[iso2] = [c.latlng[1], c.latlng[0]];
  const geo = JSON.parse(readFileSync(file, 'utf8'));
  for (const f of geo.features) {
    const g = f.geometry;
    if (!g) continue;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    for (const poly of polys) {
      shapes++;
      let x0 = Infinity;
      let x1 = -Infinity;
      let y0 = Infinity;
      let y1 = -Infinity;
      for (const [x, y] of poly[0]) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
      const c0 = Math.max(0, Math.floor((x0 - LON0) / STEP));
      const c1 = Math.min(W - 1, Math.floor((x1 - LON0) / STEP));
      const r0 = Math.max(0, Math.floor((LAT0 - y1) / STEP));
      const r1 = Math.min(H - 1, Math.floor((LAT0 - y0) / STEP));
      for (let r = r0; r <= r1; r++) {
        const lat = LAT0 - (r + 0.5) * STEP;
        for (let col = c0; col <= c1; col++) {
          const lon = LON0 + (col + 0.5) * STEP;
          if (!inRing(lon, lat, poly[0])) continue;
          if (poly.slice(1).some((hole) => inRing(lon, lat, hole))) continue;
          const k = r * W + col;
          // A listed country wins a cell over an unlisted territory.
          if (grid[k] === 0 || grid[k] === OTHER) grid[k] = value;
        }
      }
    }
  }
}

// Tiny countries: the cell under the center point.
let forced = 0;
for (const [iso2, [lon, lat]] of Object.entries(centers)) {
  const value = indexOf.get(iso2);
  if (!value) continue;
  if (grid.some((v) => v === value)) continue;
  const col = Math.min(W - 1, Math.max(0, Math.floor((lon - LON0) / STEP)));
  const row = Math.min(H - 1, Math.max(0, Math.floor((LAT0 - lat) / STEP)));
  grid[row * W + col] = value;
  forced++;
}

// The UK's nations share its cells; the game places them by their center.
const NATIONS = { 'gb-eng': [-1.5, 52.6], 'gb-sct': [-4.2, 56.8], 'gb-wls': [-3.7, 52.3] };
Object.assign(centers, NATIONS);

const missing = countries
  .filter((c) => !NATIONS[c.iso2] && !grid.some((v) => v === indexOf.get(c.iso2)))
  .map((c) => c.iso2);
if (missing.length) throw new Error(`not on the map: ${missing.join(', ')}`);

const runs = [];
for (let k = 0; k < grid.length; ) {
  let n = 1;
  while (k + n < grid.length && grid[k + n] === grid[k]) n++;
  runs.push(`${grid[k].toString(36)}*${n.toString(36)}`);
  k += n;
}
const out = {
  step: STEP,
  lon0: LON0,
  lat0: LAT0,
  w: W,
  h: H,
  codes: countries.map((c) => c.iso2),
  centers: Object.fromEntries(
    countries.map((c) => [c.iso2, (centers[c.iso2] ?? [0, 0]).map((v) => Math.round(v * 100) / 100)]),
  ),
  rle: runs.join(' '),
};
writeFileSync(new URL('src/data/worldGrid.json', root), JSON.stringify(out) + '\n');
console.log(`world grid ${W}x${H}: ${shapes} shapes, ${forced} tiny countries placed, ${runs.length} runs`);
