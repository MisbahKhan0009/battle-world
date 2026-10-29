import { describe, expect, test } from 'vitest';
import countries from '../../data/countries.json';
import type { Country } from '../../data/countries';
import { planMarbleRace } from './content';

const all = countries as Country[];

describe('marble race content', () => {
  test('kids races never ask for comments; Shorts fit under a minute', () => {
    for (let seed = 1; seed < 40; seed++) {
      const p = planMarbleRace({ format: 'short', seed, kids: true }, all);
      expect([p.look.subtitle, p.look.outroCta, p.meta.description].join(' ').toLowerCase()).not.toMatch(
        /comment/,
      );
      expect(p.maxSec + 8.5).toBeLessThan(60);
      expect(p.meta.title).toContain('#shorts');
      const v = planMarbleRace({ format: 'video', seed }, all);
      expect(v.look.aspect).toBe('16:9');
      expect(v.fighters.length).toBeGreaterThanOrEqual(8);
    }
  });
});
