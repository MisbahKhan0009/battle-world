import { describe, expect, test } from 'vitest';
import countries from '../../data/countries.json';
import type { Country } from '../../data/countries';
import type { ContentRecord } from '../../autopilot/types';
import { planPaperLand, paperRecord } from './content';

const all = countries as Country[];

describe('paper land content', () => {
  test('Shorts are one game of 4 to 7 flags; videos are knockouts', () => {
    for (let seed = 1; seed < 40; seed++) {
      const p = planPaperLand({ format: 'short', seed, kids: true }, all);
      expect(p.fighters.length).toBeGreaterThanOrEqual(4);
      expect(p.fighters.length).toBeLessThanOrEqual(7);
      expect(p.heats).toBeNull();
      expect(p.maxSec + 8.6).toBeLessThan(60);
      expect(p.meta.title).toContain('#shorts');
      expect([p.look.subtitle, p.look.outroCta, p.meta.description].join(' ').toLowerCase()).not.toMatch(
        /comment/,
      );
      const v = planPaperLand({ format: 'video', seed }, all);
      expect(v.look.aspect).toBe('16:9');
      expect(v.heats!.flat().sort((a, b) => a - b)).toEqual(v.fighters.map((_, i) => i));
      for (const h of v.heats!) expect(h.length).toBeGreaterThanOrEqual(3);
    }
  });

  test('flag counts do not repeat back to back', () => {
    const recent: ContentRecord[] = [];
    for (let seed = 1; seed <= 12; seed++) {
      const p = planPaperLand({ format: 'short', seed }, all, recent);
      if (recent.length) expect(p.fighters.length).not.toBe(recent[recent.length - 1].count);
      recent.push({
        slotId: String(seed),
        at: seed,
        format: 'short',
        moduleId: 'paper-land',
        ...paperRecord(p, {}),
      });
    }
  });
});
