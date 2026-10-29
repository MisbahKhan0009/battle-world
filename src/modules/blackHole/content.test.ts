import { describe, expect, test } from 'vitest';
import countries from '../../data/countries.json';
import type { Country } from '../../data/countries';
import type { ContentRecord } from '../../autopilot/types';
import { planBlackHole, blackRecord } from './content';

const all = countries as Country[];

describe('black hole content', () => {
  test('Shorts are one game of 4 to 7 holes; videos are knockouts', () => {
    for (let seed = 1; seed < 40; seed++) {
      const p = planBlackHole({ format: 'short', seed, kids: true }, all);
      expect(p.fighters.length).toBeGreaterThanOrEqual(4);
      expect(p.fighters.length).toBeLessThanOrEqual(7);
      expect(p.heats).toBeNull();
      expect(p.maxSec + 8.6).toBeLessThan(60);
      expect(p.meta.title).toContain('#shorts');
      expect([p.look.subtitle, p.look.outroCta, p.meta.description].join(' ').toLowerCase()).not.toMatch(
        /comment/,
      );
      const v = planBlackHole({ format: 'video', seed }, all);
      expect(v.look.aspect).toBe('16:9');
      expect(v.heats!.flat().sort((a, b) => a - b)).toEqual(v.fighters.map((_, i) => i));
      for (const h of v.heats!) expect(h.length).toBeGreaterThanOrEqual(3);
    }
  });

  test('hole counts do not repeat back to back', () => {
    const recent: ContentRecord[] = [];
    for (let seed = 1; seed <= 12; seed++) {
      const p = planBlackHole({ format: 'short', seed }, all, recent);
      if (recent.length) expect(p.fighters.length).not.toBe(recent[recent.length - 1].count);
      recent.push({
        slotId: String(seed),
        at: seed,
        format: 'short',
        moduleId: 'black-hole',
        ...blackRecord(p, {}),
      });
    }
  });
});
