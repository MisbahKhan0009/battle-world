import { describe, expect, test } from 'vitest';
import { ARENA, END_FILL, simulateGrow, startRadius } from './sim';
import { planShow, roundAt, runRound, runShow } from './show';
import type { GrowConfig } from './types';

const ids = (n: number) => Array.from({ length: n }, (_, i) => `f${i}`);
const cfg = (seed: number, n: number, growth = 0.0022): GrowConfig => ({
  seed,
  ids: ids(n),
  r0: startRadius(n),
  growth,
});

describe('growing ball physics', () => {
  test('the same config gives the same game', () => {
    const a = runRound(cfg(5, 5), { record: true, holdSec: 1 });
    const b = runRound(cfg(5, 5), { record: true, holdSec: 1 });
    expect(a.winnerT).toBe(b.winnerT);
    expect(Array.from(a.rec!.data)).toEqual(Array.from(b.rec!.data));
  });

  test('balls stay inside the arena, never overlap much, and the biggest wins when it is full', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const n = 3 + (seed % 4);
      const res = runRound(cfg(seed, n), { record: true, holdSec: 0.2 });
      const { data, frames, n: m } = res.rec!;
      for (let f = 0; f < frames; f++) {
        for (let i = 0; i < m; i++) {
          const [x, y, r] = [data[(f * m + i) * 3], data[(f * m + i) * 3 + 1], data[(f * m + i) * 3 + 2]];
          if (!r) continue;
          expect(Math.hypot(x, y) + r).toBeLessThanOrEqual(ARENA + 1.5);
          for (let j = i + 1; j < m; j++) {
            const rj = data[(f * m + j) * 3 + 2];
            if (!rj) continue;
            const d = Math.hypot(x - data[(f * m + j) * 3], y - data[(f * m + j) * 3 + 1]);
            // Contacts resolve within a step; allow a little transient overlap.
            expect(d).toBeGreaterThan((r + rj) * 0.9);
          }
        }
      }
      const last = frames - 1;
      const radii = Array.from({ length: m }, (_, i) => data[(last * m + i) * 3 + 2]);
      expect(Math.max(...radii)).toBe(radii[res.winnerIndex]);
      const fill = radii.reduce((s, r) => s + r * r, 0) / (ARENA * ARENA);
      expect(fill).toBeGreaterThanOrEqual(END_FILL - 0.001);
    }
  }, 20_000);

  test('faster growth gives a shorter game', () => {
    const slow = simulateGrow(cfg(9, 4, 0.001), { record: false, holdSec: 0, maxT: 300 });
    const fast = simulateGrow(cfg(9, 4, 0.003), { record: false, holdSec: 0, maxT: 300 });
    expect(fast.winnerT).toBeLessThan(slow.winnerT);
  });
});

describe('growing ball planning', () => {
  test('a Short is one game fitted to its length', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const show = planShow({ seed, ids: ids(3 + (seed % 4)), heats: null, targetSec: 42, maxSec: 49 }, 2);
      const res = runShow(show, { record: false });
      expect(res.winnerT).toBeLessThanOrEqual(49);
      expect(res.winnerT).toBeGreaterThan(28);
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
    expect(res.winnerT).toBeLessThanOrEqual(201);
    expect(res.winnerT).toBeGreaterThan(110);
    expect(roundAt(res, res.offsets[1] + 0.2).k).toBe(1);
  }, 30_000);
});
