import { describe, expect, test } from 'vitest';
import { boardSize, simulatePaper } from './sim';
import { planShow, runRound, runShow } from './show';
import type { PaperConfig } from './types';

const ids = (n: number) => Array.from({ length: n }, (_, i) => `f${i}`);
const cfg = (seed: number, n: number, limit = 40): PaperConfig => ({
  seed,
  ids: ids(n),
  size: boardSize(n),
  limit,
});

describe('paper land rules', () => {
  test('the same config gives the same game', () => {
    const a = runRound(cfg(5, 5), { record: true, holdSec: 1 });
    const b = runRound(cfg(5, 5), { record: true, holdSec: 1 });
    expect(a.winnerT).toBe(b.winnerT);
    expect(Array.from(a.rec!.pos)).toEqual(Array.from(b.rec!.pos));
    expect(Array.from(a.rec!.grids)).toEqual(Array.from(b.rec!.grids));
  });

  test("the board matches every flag's land, flags stay on it, and the most land wins", () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const n = 4 + (seed % 4);
      const res = runRound(cfg(seed, n), { record: true, holdSec: 0 });
      const { grids, gridTicks, size, ticks, state, pos } = res.rec!;
      const N = size * size;
      for (const e of res.events) if (e.type === 'claim') expect(e.cells).toBeGreaterThan(0);
      const last = gridTicks.length - 1;
      const counts = new Array(n).fill(0);
      for (let c = 0; c < N; c++) if (grids[last * N + c]) counts[grids[last * N + c] - 1]++;
      expect(counts).toEqual(res.land.map((l, i) => (state[(ticks - 1) * n + i] ? l : 0)));
      // Every flag stays on the board.
      for (let k = 0; k < pos.length; k++) {
        expect(pos[k]).toBeGreaterThanOrEqual(0);
        expect(pos[k]).toBeLessThan(size);
      }
      const alive = res.land.map((_, i) => state[(ticks - 1) * n + i] > 0);
      const best = Math.max(...res.land.filter((_, i) => alive[i]));
      if (!res.lastStanding) expect(res.land[res.winnerIndex]).toBe(best);
      expect(res.winnerT).toBeLessThanOrEqual(40);
    }
  }, 20_000);

  test('cutting a trail knocks that flag out and wipes its land', () => {
    let seen = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const res = simulatePaper(cfg(seed, 6), { record: true, holdSec: 0 });
      const { grids, gridTicks, size, n, state } = res.rec!;
      const N = size * size;
      for (const e of res.events) {
        if (e.type !== 'cut') continue;
        seen++;
        const tick = Math.round(e.t * 10);
        expect(state[tick * n + e.i]).toBe(0);
        let s = 0;
        while (s + 1 < gridTicks.length && gridTicks[s + 1] <= tick) s++;
        for (let c = 0; c < N; c++) expect(grids[s * N + c]).not.toBe(e.i + 1);
      }
    }
    expect(seen).toBeGreaterThan(3);
  }, 20_000);
});

describe('paper land planning', () => {
  test('a Short is one game on a clock of its length', () => {
    for (const seed of [1, 2, 3]) {
      const show = planShow({ seed, ids: ids(4 + seed), heats: null, targetSec: 40, maxSec: 49 }, 3);
      const res = runShow(show, { record: false });
      expect(show.rounds[0].limit).toBe(40);
      expect(res.winnerT).toBeLessThanOrEqual(40);
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
  }, 30_000);
});
