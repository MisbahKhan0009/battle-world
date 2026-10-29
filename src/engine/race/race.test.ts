import { describe, expect, test } from 'vitest';
import { RACE_HOLD_SEC, marbleRadius, planBestRace, planRace, raceScore, runRace } from './race';
import { simulateRace } from './sim';
import { buildTrack, finishLevel, TRACK_W } from './track';

const ids = (n: number) => Array.from({ length: n }, (_, i) => `m${i}`);

describe('marble race physics', () => {
  test('same config replays bit for bit', () => {
    const cfg = planRace({ seed: 7, ids: ids(16), targetSec: 30, maxSec: 36 });
    const a = runRace(cfg, { record: true });
    const b = runRace(cfg, { record: true });
    expect(a.winnerIndex).toBe(b.winnerIndex);
    expect(a.winnerT).toBe(b.winnerT);
    expect(a.order).toEqual(b.order);
    expect(a.rec!.data).toEqual(b.rec!.data);
  });

  test('the finish line does not change the race above it', () => {
    for (const seed of [3, 11, 19]) {
      const n = 20;
      const radius = marbleRadius(n);
      const cfg = planRace({ seed, ids: ids(n), targetSec: 30, maxSec: 38 });
      // Probe the same track without a finish and compare when the front reaches the line.
      const probe = buildTrack(seed, cfg.sections + 3, radius, false);
      const level = finishLevel(probe.sections[cfg.sections - 1].y1, radius);
      const out = simulateRace(cfg, probe, { record: false, holdSec: 0, maxT: 60, levels: [level] });
      const res = runRace(cfg, { record: false });
      expect(Math.abs(res.winnerT - out.levelT[0])).toBeLessThanOrEqual(1 / 120 + 1e-9);
    }
  });

  test('marbles never leave the track and nobody stays stuck', () => {
    for (const seed of [1, 2, 5, 8]) {
      const n = 10 + seed * 4;
      const cfg = planRace({ seed, ids: ids(n), targetSec: 36, maxSec: 44 });
      const track = buildTrack(cfg.seed, cfg.sections, cfg.radius, true);
      const out = simulateRace(cfg, track, { record: true, holdSec: 120, maxT: 400 });
      const { data, frames } = out.rec!;
      let minX = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (let k = 0; k < frames * n; k++) {
        minX = Math.min(minX, data[k * 3]);
        maxX = Math.max(maxX, data[k * 3]);
        maxY = Math.max(maxY, data[k * 3 + 1]);
      }
      expect(minX).toBeGreaterThan(0);
      expect(maxX).toBeLessThan(TRACK_W);
      expect(maxY).toBeLessThan(track.bottomY);
      // Everyone gets down eventually: no permanent jams anywhere on the track.
      expect(out.order.length).toBe(n);
    }
  }, 60_000);

  test('race length lands near the target for Shorts and long videos', () => {
    for (const [n, target, max] of [
      [12, 38, 46],
      [30, 42, 48],
      [44, 170, 210],
    ] as const) {
      for (let seed = 21; seed <= 23; seed++) {
        const cfg = planRace({ seed, ids: ids(n), targetSec: target, maxSec: max });
        const res = runRace(cfg, { record: false });
        expect(res.winnerT).toBeLessThanOrEqual(max);
        expect(Math.abs(res.winnerT - target)).toBeLessThan(target * 0.12);
        expect(res.endT).toBeGreaterThanOrEqual(res.winnerT + RACE_HOLD_SEC - 0.01);
      }
    }
  }, 60_000);

  test('rolling: a marble on a ramp spins at v / r (no slipping)', () => {
    // On a long, gentle ramp the contact friction should bring the marble to rolling without
    // slipping: angular speed times radius equals its speed along the ramp.
    const radius = 20;
    const track = {
      width: TRACK_W,
      segs: [{ ax: 0, ay: 100, bx: 1000, by: 250, r: 7 }],
      pegs: [],
      spinners: [],
      sections: [],
      startY: 0,
      finishY: Infinity,
      bottomY: 2000,
    };
    const out = simulateRace({ seed: 1, ids: ['a'], radius, sections: 1 }, track, {
      record: true,
      holdSec: 0,
      maxT: 1.6,
    });
    const { data, frames, hz } = out.rec!;
    const f = frames - 2;
    const vx = (data[(f + 1) * 3] - data[f * 3]) * hz;
    const vy = (data[(f + 1) * 3 + 1] - data[f * 3 + 1]) * hz;
    const w = (data[(f + 1) * 3 + 2] - data[f * 3 + 2]) * hz;
    const v = Math.hypot(vx, vy);
    expect(v).toBeGreaterThan(100);
    expect(Math.abs(w * radius - v) / v).toBeLessThan(0.05);
  });
});

describe('race selection', () => {
  test('picks the most exciting candidate, deterministically and within the length limit', () => {
    let plain = 0;
    let picked = 0;
    for (let seed = 30; seed < 36; seed++) {
      const input = { seed, ids: ids(14), targetSec: 38, maxSec: 46 };
      const a = planBestRace(input, 4);
      expect(planBestRace(input, 4)).toEqual(a);
      const best = runRace(a, { record: false });
      expect(best.winnerT).toBeLessThanOrEqual(46);
      plain += raceScore(runRace(planRace(input), { record: false }));
      picked += raceScore(best);
    }
    expect(picked).toBeGreaterThanOrEqual(plain);
  }, 120_000);
});
