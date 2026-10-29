import { describe, expect, test } from 'vitest';
import countries from '../../data/countries.json';
import type { Country } from '../../data/countries';
import { planFlagBattle } from './content';

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
