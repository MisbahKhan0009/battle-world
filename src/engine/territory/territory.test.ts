import { describe, expect, test } from 'vitest';
import countries from '../../data/countries.json';
import { buildMap, centerOf } from './map';
import { simulateTerritory } from './sim';
import { planShow, runShow } from './show';
import type { TerritoryConfig } from './types';

const EUROPE = ['fr', 'de', 'es', 'it', 'pl'];
const cfg = (seed: number, isos = EUROPE, maxTicks = 1500): TerritoryConfig => ({
  seed,
  ids: isos.map((s) => `f-${s}`),
  isos,
  rate: 30,
  maxTicks,
});

/** Every cell's owner at the end of a recorded war (-1 nobody). */
function finalOwners(c: TerritoryConfig) {
  const out = simulateTerritory(c, { record: true });
  const map = buildMap(c.isos);
  const owner = new Int16Array(map.cols * map.rows).fill(-1);
  const rec = out.rec!;
  for (let k = 0; k < rec.cells.length; k++) owner[rec.cells[k]] = rec.owners[k] - 1;
  return { out, map, owner };
}

describe('territory map', () => {
  test('every country in the list has a place on the map', () => {
    for (const c of countries) expect(centerOf(c.iso2)).not.toEqual([0, 0]);
  });

  test('equal starting land, on land, and every landmass reachable', () => {
    for (const isos of [EUROPE, ['us', 'cn', 'br', 'ng', 'au'], ['gb', 'gb-eng', 'gb-sct', 'ie', 'lu']]) {
      const map = buildMap(isos);
      const sizes = map.homes.map((h) => h.length);
      expect(new Set(sizes).size).toBe(1);
      const all = map.homes.flat();
      expect(new Set(all).size).toBe(all.length);
      for (const q of all) expect(map.land[q]).toBe(1);
      // Flood over the neighbor lists (land plus sea crossings) from one home.
      const seen = new Uint8Array(map.land.length);
      const queue = [map.homes[0][0]];
      seen[queue[0]] = 1;
      for (let h = 0; h < queue.length; h++)
        for (let a = map.adjStart[queue[h]]; a < map.adjStart[queue[h] + 1]; a++) {
          const nb = map.adj[a];
          if (!seen[nb]) {
            seen[nb] = 1;
            queue.push(nb);
          }
        }
      expect(queue.length).toBe(map.cells.length);
    }
  });
});

describe('territory war', () => {
  test('the same config gives the same war', () => {
    const a = simulateTerritory(cfg(4), { record: true });
    const b = simulateTerritory(cfg(4), { record: true });
    expect(a.endTick).toBe(b.endTick);
    expect(Array.from(a.rec!.cells)).toEqual(Array.from(b.rec!.cells));
  });

  test('territory always adds up to the map, and the record replays to the final land', () => {
    for (const seed of [1, 2, 3]) {
      const { out, map, owner } = finalOwners(cfg(seed));
      const counts = out.land.map((_, i) => owner.reduce((s, o) => s + (o === i ? 1 : 0), 0));
      expect(counts).toEqual(out.land);
      const neutral = Array.from(map.cells).filter((q) => owner[q] < 0).length;
      expect(out.land.reduce((a, b) => a + b, 0) + neutral).toBe(map.cells.length);
      for (let q = 0; q < owner.length; q++) if (owner[q] >= 0) expect(map.land[q]).toBe(1);
      const n = out.rec!.n;
      const last = (out.rec!.ticks - 1) * n * 3;
      expect(out.land.map((_, i) => out.rec!.stats[last + i * 3])).toEqual(out.land);
      expect(Math.max(...out.land)).toBe(out.land[out.winnerIndex]);
      if (out.conquered) expect(out.land[out.winnerIndex]).toBe(map.cells.length - neutral);
    }
  }, 30_000);

  test('falls are reported once each, and a conquest leaves one country', () => {
    const out = simulateTerritory(cfg(2, EUROPE, 6000), { record: false });
    const outs = out.events.filter((e) => e.type === 'out').map((e) => e.i);
    expect(new Set(outs).size).toBe(outs.length);
    expect(outs).not.toContain(out.winnerIndex);
    if (out.conquered) expect(outs).toHaveLength(EUROPE.length - 1);
  }, 30_000);
});

describe('territory planning', () => {
  test('a Short fits its length', () => {
    for (const seed of [1, 2, 3]) {
      const isos = ['br', 'ar', 'cl', 'pe', 'co', 've'];
      const show = planShow({ seed, ids: isos, isos, targetSec: 40, maxSec: 49 }, 2);
      const res = runShow(show, { record: false });
      expect(res.winnerT).toBeLessThanOrEqual(49);
      expect(res.winnerT).toBeGreaterThan(20);
      expect(res.runnerUp).not.toBe(res.winnerIndex);
    }
  }, 30_000);

  test('a recent winner is avoided when another war works', () => {
    const isos = ['br', 'ar', 'cl', 'pe', 'co', 've'];
    const free = runShow(planShow({ seed: 5, ids: isos, isos, targetSec: 40, maxSec: 49 }, 3), {
      record: false,
    });
    const again = runShow(
      planShow({ seed: 5, ids: isos, isos, targetSec: 40, maxSec: 49, avoid: [free.winnerIndex] }, 3),
      { record: false },
    );
    // Not guaranteed (geography can favor one country), but this lineup has several contenders.
    expect(again.winnerIndex).not.toBe(free.winnerIndex);
  }, 30_000);
});
