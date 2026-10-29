import { describe, expect, test } from 'vitest';
import countries from '../../data/countries.json';
import type { Country } from '../../data/countries';
import type { ContentRecord } from '../../autopilot/types';
import { splitHeats } from '../common';
import { planGrowingBall, growRecord } from './content';

const all = countries as Country[];

describe('growing ball content', () => {
  test('Shorts are one game of 3 to 6 flags; videos are knockouts', () => {
    for (let seed = 1; seed < 40; seed++) {
      const p = planGrowingBall({ format: 'short', seed, kids: true }, all);
      expect(p.fighters.length).toBeGreaterThanOrEqual(3);
      expect(p.fighters.length).toBeLessThanOrEqual(6);
      expect(p.heats).toBeNull();
      expect(p.maxSec + 8.6).toBeLessThan(60);
      expect(p.meta.title).toContain('#shorts');
      expect([p.look.subtitle, p.look.outroCta, p.meta.description].join(' ').toLowerCase()).not.toMatch(
        /comment/,
      );
      const v = planGrowingBall({ format: 'video', seed }, all);
      expect(v.look.aspect).toBe('16:9');
      expect(v.heats!.flat().sort((a, b) => a - b)).toEqual(v.fighters.map((_, i) => i));
      for (const h of v.heats!) expect(h.length).toBeGreaterThanOrEqual(3);
    }
  });

  test('flag counts do not repeat back to back', () => {
    const recent: ContentRecord[] = [];
    for (let seed = 1; seed <= 12; seed++) {
      const p = planGrowingBall({ format: 'short', seed }, all, recent);
      if (recent.length) expect(p.fighters.length).not.toBe(recent[recent.length - 1].count);
      recent.push({
        slotId: String(seed),
        at: seed,
        format: 'short',
        moduleId: 'growing-ball',
        ...growRecord(p, {}),
      });
    }
  });

  test('heats split evenly', () => {
    expect(splitHeats(10, 3).map((h) => h.length)).toEqual([4, 3, 3]);
    expect(splitHeats(16, 4).map((h) => h.length)).toEqual([4, 4, 4, 4]);
  });
});
