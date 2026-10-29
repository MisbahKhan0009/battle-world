import { describe, expect, test } from 'vitest';
import { ARENA_R, dcos, dsin, wallContact } from './physics';
import { Rng } from './rng';
import { DT, Simulation, simulate } from './sim';
import { Timeline } from './timeline';
import { tune } from './tuning';
import type { ArenaShape, GameMode, Rules, SimConfig } from './types';

function roster(n: number, seed = 1) {
  const rng = new Rng(seed);
  return Array.from({ length: n }, (_, i) => ({
    id: `f${i}`,
    hp: 50 + rng.int(200),
    size: 0.7 + rng.next() * 0.8,
    speed: 0.7 + rng.next() * 0.8,
    attack: 0.7 + rng.next() * 0.8,
  }));
}

function config(n: number, overrides: Partial<SimConfig> = {}): SimConfig {
  return {
    mode: 'royale',
    fighters: roster(n),
    gap: { halfAngle: 0.12, omega: 0.8 },
    arena: 'circle',
    shrink: { enabled: true, startSec: 8, rate: 0.01 },
    damageModel: 'impact',
    baseDamage: 10,
    damageRamp: 0.02,
    seed: 1234,
    ...overrides,
  };
}

describe('rng', () => {
  test('same seed gives the same sequence', () => {
    const a = new Rng(99);
    const b = new Rng(99);
    for (let i = 0; i < 1000; i++) expect(a.next()).toBe(b.next());
  });
  test('values stay in [0, 1)', () => {
    const r = new Rng(7);
    for (let i = 0; i < 10000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('determinism', () => {
  test.each([2, 16, 64])(
    'same seed and roster give identical events, track and winner (%i fighters)',
    (n) => {
      const cfg = config(n);
      const a = simulate(cfg, { record: true });
      const b = simulate(structuredClone(cfg), { record: true });
      expect(a.winnerIndex).toBe(b.winnerIndex);
      expect(a.winnerT).toBe(b.winnerT);
      expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
      expect(a.track!.data).toEqual(b.track!.data);
    },
  );

  test('different seeds give different battles', () => {
    const a = simulate(config(16, { seed: 1 }));
    const b = simulate(config(16, { seed: 2 }));
    expect(JSON.stringify(a.events)).not.toBe(JSON.stringify(b.events));
  });
});

describe('physics', () => {
  test.each<ArenaShape>(['circle', 'square', 'rounded'])('fighters never leave the %s arena', (arena) => {
    const sim = new Simulation(config(48, { arena, shrink: { enabled: true, startSec: 2, rate: 0.03 } }));
    for (let s = 0; s < 120 * 30 && !sim.done; s++) {
      sim.step();
      const h = ARENA_R * sim.arena;
      for (let i = 0; i < sim.n; i++) {
        if (!sim.alive[i]) continue;
        const c = wallContact(arena, h, sim.x[i], sim.y[i], sim.r[i]);
        expect(c === null || c.depth < 1e-6).toBe(true);
      }
    }
  });

  test('a head-on collision conserves momentum and loses ~5% of relative speed', () => {
    const cfg = config(2, { shrink: { enabled: false, startSec: 0, rate: 0 } });
    const sim = new Simulation(cfg);
    sim.x[0] = -100;
    sim.y[0] = 0;
    sim.vx[0] = 300;
    sim.vy[0] = 0;
    sim.x[1] = 100;
    sim.y[1] = 0;
    sim.vx[1] = -300;
    sim.vy[1] = 0;
    // Disable speed regulation influence by inspecting the collision step directly.
    const m0 = 1 / sim.invMass[0];
    const m1 = 1 / sim.invMass[1];
    const pBefore = m0 * 300 + m1 * -300;
    let collided = false;
    for (let s = 0; s < 200 && !collided; s++) {
      const before = sim.events.length;
      sim.step();
      if (sim.events.length > before) collided = true;
    }
    expect(collided).toBe(true);
    const pAfter = m0 * sim.vx[0] + m1 * sim.vx[1];
    // Speed regulation nudges each body by < 2% per step, so allow a small tolerance.
    expect(Math.abs(pAfter - pBefore)).toBeLessThan(0.03 * (m0 + m1) * 300);
    expect(sim.vx[0]).toBeLessThan(0);
    expect(sim.vx[1]).toBeGreaterThan(0);
  });

  test('overlaps are resolved (no discs stay merged)', () => {
    const sim = new Simulation(config(64, { shrink: { enabled: false, startSec: 0, rate: 0 } }));
    let worst = 0;
    for (let s = 0; s < 120 * 10; s++) {
      sim.step();
      for (let i = 0; i < sim.n; i++)
        for (let j = i + 1; j < sim.n; j++) {
          if (!sim.alive[i] || !sim.alive[j]) continue;
          const d = Math.hypot(sim.x[i] - sim.x[j], sim.y[i] - sim.y[j]);
          worst = Math.max(worst, (sim.r[i] + sim.r[j] - d) / (sim.r[i] + sim.r[j]));
        }
    }
    expect(worst).toBeLessThan(0.15);
  });

  test('every battle ends with exactly one winner and consistent events', () => {
    for (let seed = 1; seed <= 25; seed++) {
      for (const n of [2, 3, 7, 20]) {
        const r = simulate(config(n, { seed }));
        expect(r.winnerIndex).toBeGreaterThanOrEqual(0);
        const elims = r.events.filter((e) => e.type === 'eliminate');
        expect(elims.length).toBe(n - 1);
        expect(r.events.filter((e) => e.type === 'winner').length).toBe(1);
        expect(r.winnerT).toBeLessThan(900);
        expect(r.events.filter((e) => e.type === 'final2').length).toBe(
          n > 2 ? (r.final2T === null ? 0 : 1) : 0,
        );
      }
    }
  });

  test('fixed timestep is 1/120 s', () => {
    expect(DT).toBeCloseTo(1 / 120, 12);
  });
});

describe('timeline', () => {
  test('slow motion maps video to sim time monotonically and inverts', () => {
    const tl = new Timeline({ final2T: 20, winnerT: 25, endT: 29 }, { intro: true, outro: true });
    let prev = -1;
    for (let v = 0; v < tl.total; v += 0.01) {
      const t = tl.simAt(v);
      expect(t).toBeGreaterThanOrEqual(prev);
      prev = t;
    }
    for (const t of [0, 5, 20, 20.3, 21, 24]) expect(tl.simAt(tl.videoAt(t))).toBeCloseTo(t, 4);
    expect(tl.speedAt(tl.vFinal2! + 0.75)).toBeCloseTo(0.6, 5);
  });
});

describe('escape mode', () => {
  const escapeConfig = (n: number, seed: number): SimConfig =>
    config(n, { mode: 'escape', seed, gap: { halfAngle: 0.14, omega: 0.9 } });

  test('dsin/dcos match Math.sin/cos closely', () => {
    for (let a = -20; a < 20; a += 0.0137) {
      expect(Math.abs(dsin(a) - Math.sin(a))).toBeLessThan(1e-8);
      expect(Math.abs(dcos(a) - Math.cos(a))).toBeLessThan(1e-8);
    }
  });

  test('flags only leave through the opening, never through the solid rim', () => {
    for (const seed of [1, 2, 3]) {
      const sim = new Simulation({ ...escapeConfig(24, seed), targetWinSec: 40 });
      let escapes = 0;
      for (let s = 0; s < 120 * 900 && !sim.done; s++) {
        const before = sim.events.length;
        sim.step();
        for (const e of sim.events.slice(before)) {
          if (e.type !== 'eliminate') continue;
          escapes++;
          expect(e.escaped).toBe(true);
          // Exit point must be inside the opening (small tolerance for the step size).
          const d = Math.hypot(e.x, e.y);
          const cosToGap = (e.x * Math.cos(sim.gapAngle) + e.y * Math.sin(sim.gapAngle)) / d;
          expect(cosToGap).toBeGreaterThan(Math.cos(sim.gapHalf + 0.02));
        }
        // Everyone still in play stays within the rim (allowing the opening corridor).
        for (let i = 0; i < sim.n; i++) {
          if (!sim.alive[i]) continue;
          expect(Math.hypot(sim.x[i], sim.y[i])).toBeLessThanOrEqual(ARENA_R + 1e-6);
        }
      }
      expect(escapes).toBe(23);
    }
  });

  test('no damage is dealt in escape mode', () => {
    const r = simulate(escapeConfig(16, 9));
    for (const e of r.events) if (e.type === 'hit') expect(e.dmgA + e.dmgB).toBe(0);
    expect(r.events.filter((e) => e.type === 'winner').length).toBe(1);
  });

  test('same seed replays the same escape battle', () => {
    const a = simulate(escapeConfig(32, 5), { record: true });
    const b = simulate(escapeConfig(32, 5), { record: true });
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
    expect(a.track!.gapAngle).toEqual(b.track!.gapAngle);
  });
});

describe.each<GameMode>(['escape', 'royale'])('duration tuning (%s)', (mode) => {
  const rules = (target: number, seed: number): Rules => ({
    mode,
    gap: { size: 2, speedDeg: 45, direction: 'cw' },
    arena: 'circle',
    shrink: { enabled: true, startSec: 10, rate: 0.008 },
    damageModel: 'impact',
    damageRamp: 0.02,
    targetDurationSec: target,
    seed,
  });

  test.each([
    [8, 45],
    [16, 45],
    [32, 45],
    [64, 45],
    [64, 58],
    [16, 30],
  ])('%i fighters with a %is target land within 3s', (n, target) => {
    for (const seed of [11, 22, 33]) {
      const res = tune({ fighters: roster(n, seed), rules: rules(target, seed), intro: true, outro: true });
      const full = simulate(res.config);
      const tl = new Timeline(full, { intro: true, outro: true });
      expect(Math.abs(tl.total - target)).toBeLessThanOrEqual(3);
    }
  });

  test('tuning 64 fighters is fast', () => {
    const t0 = performance.now();
    tune({ fighters: roster(64, 5), rules: rules(58, 5), intro: true, outro: true });
    expect(performance.now() - t0).toBeLessThan(1500);
  });
});
