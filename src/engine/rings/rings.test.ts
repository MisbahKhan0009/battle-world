import { describe, expect, test } from 'vitest';
import { ballRadius, ringAt, simulateRings } from './sim';
import { planShow, roundAt, runRound, runShow } from './show';
import type { RingsConfig } from './types';

const ids = (n: number) => Array.from({ length: n }, (_, i) => `f${i}`);
const cfg = (seed: number, n: number, rings: number): RingsConfig => ({
  seed,
  ids: ids(n),
  radius: ballRadius(n),
  rings,
});

describe('ring escape physics', () => {
  test('the same seed gives the same game', () => {
    const a = runRound(cfg(7, 6, 6), { record: true, holdSec: 1 });
    const b = runRound(cfg(7, 6, 6), { record: true, holdSec: 1 });
    expect(a.winnerT).toBe(b.winnerT);
    expect(Array.from(a.rec!.data)).toEqual(Array.from(b.rec!.data));
  });

  test('outer rings never change what happened inside (the probe matches the real game)', () => {
    for (const seed of [3, 11, 29]) {
      const probe = simulateRings(cfg(seed, 5, 70), { record: false, holdSec: 0, maxT: 60, ringLimit: 70 });
      const rings = Math.min(7, probe.shatterT.length);
      const real = runRound(cfg(seed, 5, rings), { record: false, holdSec: 0 });
      expect(real.shatterT).toEqual(probe.shatterT.slice(0, rings));
      expect(real.winnerIndex).toBe(probe.shatterBy[rings - 1]);
      expect(real.winnerT).toBe(probe.shatterT[rings - 1]);
    }
  });

  test('balls only ever leave a ring through its gap', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const n = 4 + seed;
      const res = runRound(cfg(seed, n, 8), { record: true, holdSec: 0 });
      const { data, frames, hz } = res.rec!;
      const r = res.config.radius;
      for (let f = 0; f < frames; f++) {
        const t = f / hz;
        if (t >= res.winnerT) break;
        const c = res.shatterT.filter((s) => s <= t).length;
        const ring = ringAt(seed, c, n, r);
        const th = ring.phase + ring.omega * t;
        for (let i = 0; i < n; i++) {
          const x = data[(f * n + i) * 2];
          const y = data[(f * n + i) * 2 + 1];
          const d = Math.hypot(x, y);
          expect(d).toBeLessThanOrEqual(ring.R + 0.01);
          if (d > ring.R - ring.w - r + 0.5) {
            // Touching the wall's zone: only allowed next to the opening.
            const off = Math.abs(
              Math.atan2(Math.sin(Math.atan2(y, x) - th), Math.cos(Math.atan2(y, x) - th)),
            );
            expect(off).toBeLessThan(ring.gap + (r + ring.w) / ring.R + 0.05);
          }
        }
      }
    }
  }, 20_000);
});

describe('ring escape planning', () => {
  test('a Short is one game fitted to its length', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const show = planShow({ seed, ids: ids(6), heats: null, targetSec: 42, maxSec: 49 }, 3);
      expect(show.rounds).toHaveLength(1);
      const res = runShow(show, { record: false });
      expect(res.winnerT).toBeLessThanOrEqual(49);
      expect(res.winnerT).toBeGreaterThan(25);
      expect(show.rounds[0].rings).toBeGreaterThanOrEqual(3);
    }
  }, 20_000);

  test('a long video is a knockout: heat winners meet in the final', () => {
    const heats = [
      [0, 1, 2, 3],
      [4, 5, 6, 7],
      [8, 9, 10, 11, 12],
    ];
    const show = planShow({ seed: 99, ids: ids(13), heats, targetSec: 170, maxSec: 200 }, 2);
    expect(show.rounds).toHaveLength(4);
    const res = runShow(show, { record: false });
    heats.forEach((h, k) => expect(show.entrants[3][k]).toBe(h[res.rounds[k].winnerIndex]));
    expect(show.entrants[3]).toContain(res.winnerIndex);
    expect(res.runnerUp).not.toBe(res.winnerIndex);
    expect(res.winnerT).toBeLessThanOrEqual(200 + 1);
    expect(res.winnerT).toBeGreaterThan(110);
    expect(roundAt(res, res.offsets[2] + 0.5).k).toBe(2);
  }, 30_000);
});
