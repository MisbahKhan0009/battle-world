import { describe, expect, test } from 'vitest';
import countries from '../../data/countries.json';
import type { Country } from '../../data/countries';
import type { ContentRecord } from '../../autopilot/types';
import { splitHeats } from '../common';
import { planRingEscape, ringsRecord } from './content';

const all = countries as Country[];

describe('ring escape content', () => {
  test('Shorts are one game of 4 to 8 flags; videos are knockouts', () => {
    for (let seed = 1; seed < 40; seed++) {
      const p = planRingEscape({ format: 'short', seed, kids: true }, all);
      expect(p.fighters.length).toBeGreaterThanOrEqual(4);
      expect(p.fighters.length).toBeLessThanOrEqual(8);
      expect(p.heats).toBeNull();
      expect(p.maxSec + 8.6).toBeLessThan(60);
      expect(p.meta.title).toContain('#shorts');
      expect([p.look.subtitle, p.look.outroCta, p.meta.description].join(' ').toLowerCase()).not.toMatch(
        /comment/,
      );
      const v = planRingEscape({ format: 'video', seed }, all);
      expect(v.look.aspect).toBe('16:9');
      expect(v.heats!.flat().sort((a, b) => a - b)).toEqual(v.fighters.map((_, i) => i));
      for (const h of v.heats!) expect(h.length).toBeGreaterThanOrEqual(3);
    }
  });

  test('flag counts do not repeat back to back', () => {
    const recent: ContentRecord[] = [];
    for (let seed = 1; seed <= 12; seed++) {
      const p = planRingEscape({ format: 'short', seed }, all, recent);
      if (recent.length) expect(p.fighters.length).not.toBe(recent[recent.length - 1].count);
      recent.push({
        slotId: String(seed),
        at: seed,
        format: 'short',
        moduleId: 'ring-escape',
        ...ringsRecord(p, {}),
      });
    }
  });

  test('heats split evenly', () => {
    expect(splitHeats(13, 3).map((h) => h.length)).toEqual([5, 4, 4]);
    expect(splitHeats(20, 4).map((h) => h.length)).toEqual([5, 5, 5, 5]);
  });
});
