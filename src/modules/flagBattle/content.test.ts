import { describe, expect, test } from 'vitest';
import countries from '../../data/countries.json';
import type { ContentRecord } from '../../autopilot/types';
import type { Country } from '../../data/countries';
import { contentRecord, freshenOutcome, planFlagBattle } from './content';

const all = countries as Country[];

describe('flag battle autopilot content', () => {
  test('same seed gives the same plan and metadata', () => {
    const a = planFlagBattle({ format: 'short', seed: 42 }, all);
    const b = planFlagBattle({ format: 'short', seed: 42 }, all);
    expect(a.meta).toEqual(b.meta);
    expect(a.fighters.map((f) => f.iso2)).toEqual(b.fighters.map((f) => f.iso2));
    expect(a.rules).toEqual(b.rules);
  });

  test('shorts are vertical with #shorts; videos are 16:9 and longer', () => {
    for (let seed = 1; seed < 200; seed++) {
      const s = planFlagBattle({ format: 'short', seed }, all);
      expect(s.look.aspect).toBe('9:16');
      expect(s.meta.title.length).toBeLessThanOrEqual(100);
      expect(s.meta.title).toContain('#shorts');
      expect(s.fighters.length).toBeGreaterThanOrEqual(8);
      expect(s.fighters.length).toBeLessThanOrEqual(64);
      expect(s.rules.targetDurationSec).toBeLessThanOrEqual(58);
      const v = planFlagBattle({ format: 'video', seed }, all);
      expect(v.look.aspect).toBe('16:9');
      expect(v.meta.title).not.toContain('#shorts');
      expect(v.rules.targetDurationSec).toBeGreaterThanOrEqual(120);
    }
  });

  test('content varies across seeds (titles, modes, rosters)', () => {
    const plans = Array.from({ length: 60 }, (_, i) =>
      planFlagBattle({ format: 'short', seed: 1000 + i }, all),
    );
    expect(new Set(plans.map((p) => p.meta.title.replace(/\d+/g, ''))).size).toBeGreaterThan(5);
    expect(new Set(plans.map((p) => p.rules.mode)).size).toBe(2);
    expect(new Set(plans.map((p) => p.group)).size).toBeGreaterThan(3);
  });
});

describe('freshness across posts', () => {
  test('flag counts, lineups and title templates avoid recent repeats', () => {
    const recent: ContentRecord[] = [];
    for (let i = 0; i < 40; i++) {
      const plan = planFlagBattle({ format: 'short', seed: 5000 + i }, all, recent);
      const last = recent.slice(-10);
      expect(last.map((r) => r.count)).not.toContain(plan.fighters.length);
      const iso = new Set(plan.fighters.map((f) => f.iso2!));
      for (const r of last) {
        const inter = r.roster.filter((x) => iso.has(x)).length;
        expect(inter / (iso.size + r.roster.length - inter)).toBeLessThan(0.75);
      }
      recent.push({
        ...contentRecord(plan, {}),
        slotId: `s${i}`,
        at: i,
        format: 'short',
        moduleId: 'flag-battle',
      });
    }
  });

  test('the winner is relabelled to a country that has not won yet', () => {
    const recent: ContentRecord[] = [];
    const winners: string[] = [];
    for (let i = 0; i < 60; i++) {
      const plan = planFlagBattle({ format: 'short', seed: 9000 + i }, all, recent);
      const n = plan.fighters.length;
      // Fake simulation: ball 0 always wins, ball 1 is runner-up.
      const elimT = Float64Array.from({ length: n }, (_, k) => (k === 0 ? Infinity : k === 1 ? 50 : k));
      const ids = plan.fighters.map((f) => f.id);
      const outcome = freshenOutcome(plan.fighters, { winnerIndex: 0, elimT }, recent, 9000 + i);
      // Ids stay on their balls; only flags move.
      expect(plan.fighters.map((f) => f.id)).toEqual(ids);
      expect(outcome.winner).toBe(plan.fighters[0].iso2);
      winners.push(outcome.winner!);
      recent.push({
        ...contentRecord(plan, outcome),
        slotId: `s${i}`,
        at: i,
        format: 'short',
        moduleId: 'flag-battle',
      });
    }
    expect(new Set(winners).size).toBe(winners.length);
  });
});
