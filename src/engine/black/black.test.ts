import { describe, expect, test } from 'vitest';
import { buildCity } from './city';
import { cityBlocks, EAT_MARGIN, FIT, R0, simulateBlack } from './sim';
import { planShow, roundAt, runRound, runShow } from './show';
import type { BlackConfig } from './types';

const ids = (n: number) => Array.from({ length: n }, (_, i) => `f${i}`);
const cfg = (seed: number, n: number, limit = 36): BlackConfig => ({
  seed,
  ids: ids(n),
  blocks: cityBlocks(n, limit),
  limit,
});

describe('black hole city', () => {
  test('the same seed is the same city, and it has small and big things to eat', () => {
    const a = buildCity(7, 6);
    expect(buildCity(7, 6)).toEqual(a);
    const sizes = a.objects.map((o) => o.s);
    expect(Math.min(...sizes)).toBeLessThan(FIT * R0);
    expect(Math.max(...sizes)).toBeGreaterThan(60);
    for (const o of a.objects) {
      expect(o.x).toBeGreaterThan(0);
      expect(o.x).toBeLessThan(a.size);
      expect(o.y).toBeGreaterThan(0);
      expect(o.y).toBeLessThan(a.size);
    }
  });
});

describe('black hole rules', () => {
  test('the same config gives the same game', () => {
    const a = runRound(cfg(5, 5), { record: true, holdSec: 1 });
    const b = runRound(cfg(5, 5), { record: true, holdSec: 1 });
    expect(a.winnerIndex).toBe(b.winnerIndex);
    expect(a.events).toEqual(b.events);
    expect(Array.from(a.rec!.data)).toEqual(Array.from(b.rec!.data));
  });

  test('nothing larger than a hole falls in, and only clearly bigger holes swallow', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const n = 3 + (seed % 5);
      const res = runRound(cfg(seed, n), { record: true, holdSec: 0 });
      const r = res.config.ids.map(() => R0);
      const seen = new Set<number>();
      for (const e of res.events) {
        if (e.type === 'eat') {
          const o = res.city.objects[e.o];
          expect(o.s).toBeLessThanOrEqual(FIT * r[e.i] + 1e-9);
          expect(seen.has(e.o)).toBe(false);
          seen.add(e.o);
          expect(e.r).toBeGreaterThan(r[e.i]);
        } else {
          expect(r[e.i]).toBeGreaterThanOrEqual(EAT_MARGIN * r[e.j] - 1e-9);
          r[e.j] = 0;
        }
        r[e.i] = e.r;
      }
      expect(res.eaten).toBe(seen.size);
    }
  });

  test('the biggest hole wins when the clock runs out', () => {
    for (const seed of [11, 12, 13, 14]) {
      const res = runRound(cfg(seed, 5), { record: false, holdSec: 0 });
      expect(Math.max(...res.radii)).toBe(res.radii[res.winnerIndex]);
      if (!res.lastStanding) expect(res.winnerT).toBeCloseTo(36, 5);
      expect(res.eaten).toBeGreaterThan(50);
    }
  });

  test('holes stay in the city', () => {
    const res = runRound(cfg(3, 6), { record: true, holdSec: 0.5 });
    const { data, frames, n } = res.rec!;
    for (let f = 0; f < frames; f++)
      for (let i = 0; i < n; i++) {
        const o = (f * n + i) * 3;
        if (!data[o + 2]) continue;
        expect(data[o]).toBeGreaterThanOrEqual(0);
        expect(data[o]).toBeLessThanOrEqual(res.city.size);
        expect(data[o + 1]).toBeGreaterThanOrEqual(0);
        expect(data[o + 1]).toBeLessThanOrEqual(res.city.size);
      }
  });

  test('a longer clock eats more of the city', () => {
    const short = simulateBlack({ ...cfg(9, 4), limit: 20 }, { record: false, holdSec: 0 });
    const long = simulateBlack({ ...cfg(9, 4), limit: 45 }, { record: false, holdSec: 0 });
    expect(long.eaten).toBeGreaterThan(short.eaten);
  });
});

describe('black hole planning', () => {
  test('a Short is one game on a clock of its length', () => {
    for (const seed of [1, 2, 3, 4]) {
      const show = planShow({ seed, ids: ids(4 + (seed % 4)), heats: null, targetSec: 42, maxSec: 49 }, 2);
      const res = runShow(show, { record: false });
      expect(res.winnerT).toBeLessThanOrEqual(42.01);
      expect(res.winnerT).toBeGreaterThan(20);
    }
  }, 20_000);

  test('a long video is a knockout: heat winners meet in the final', () => {
    const heats = [
      [0, 1, 2],
      [3, 4, 5],
      [6, 7, 8, 9],
    ];
    const show = planShow({ seed: 77, ids: ids(10), heats, targetSec: 170, maxSec: 200 }, 1);
    expect(show.rounds).toHaveLength(4);
    const res = runShow(show, { record: false });
    heats.forEach((h, k) => expect(show.entrants[3][k]).toBe(h[res.rounds[k].winnerIndex]));
    expect(show.entrants[3]).toContain(res.winnerIndex);
    expect(res.runnerUp).not.toBe(res.winnerIndex);
    expect(res.winnerT).toBeLessThanOrEqual(171);
    expect(res.winnerT).toBeGreaterThan(110);
    expect(roundAt(res, res.offsets[1] + 0.2).k).toBe(1);
  }, 30_000);
});
