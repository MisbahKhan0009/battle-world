import { describe, expect, test } from 'vitest';
import countries from '../../data/countries.json';
import type { Country } from '../../data/countries';
import type { ContentRecord } from '../../autopilot/types';
import { planTerritoryWars, territoryRecord } from './content';

const all = countries as Country[];

describe('territory wars content', () => {
  test('Shorts have 4 to 8 countries and stay under a minute; videos have 10 to 18', () => {
    for (let seed = 1; seed < 40; seed++) {
      const p = planTerritoryWars({ format: 'short', seed, kids: true }, all);
      expect(p.fighters.length).toBeGreaterThanOrEqual(4);
      expect(p.fighters.length).toBeLessThanOrEqual(8);
      expect(p.fighters.every((f) => f.iso2)).toBe(true);
      expect(p.maxSec + 8.6).toBeLessThan(60);
      expect(p.meta.title).toContain('#shorts');
      expect([p.look.subtitle, p.look.outroCta, p.meta.description].join(' ').toLowerCase()).not.toMatch(
        /comment/,
      );
      const v = planTerritoryWars({ format: 'video', seed }, all);
      expect(v.look.aspect).toBe('16:9');
      expect(v.fighters.length).toBeGreaterThanOrEqual(10);
      expect(v.fighters.length).toBeLessThanOrEqual(18);
    }
  });

  test('counts do not repeat back to back, and recent winners are passed on to avoid', () => {
    const recent: ContentRecord[] = [];
    for (let seed = 1; seed <= 12; seed++) {
      const p = planTerritoryWars({ format: 'short', seed }, all, recent);
      if (recent.length) expect(p.fighters.length).not.toBe(recent[recent.length - 1].count);
      for (const i of p.avoid) expect(recent.slice(-6).map((r) => r.winner)).toContain(p.fighters[i].iso2);
      recent.push({
        slotId: String(seed),
        at: seed,
        format: 'short',
        moduleId: 'territory-wars',
        ...territoryRecord(p, { winner: p.fighters[0].iso2 }),
      });
    }
  });
});
