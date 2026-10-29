import { describe, expect, test } from 'vitest';
import countries from '../data/countries.json';
import type { Country } from '../data/countries';
import { planBlackHole } from './blackHole/content';
import { planFlagBattle } from './flagBattle/content';
import { planGrowingBall } from './growingBall/content';
import { planMarbleRace } from './marbleRace/content';
import { planPaperLand } from './paperLand/content';
import { planRingEscape } from './ringEscape/content';
import { planTerritoryWars } from './territoryWars/content';

const all = countries as Country[];
const PLANNERS = [
  planFlagBattle,
  planMarbleRace,
  planRingEscape,
  planGrowingBall,
  planPaperLand,
  planTerritoryWars,
  planBlackHole,
];

describe('video titles', () => {
  test('never name a country', () => {
    const names = all.map((c) => c.name.toLowerCase());
    for (const plan of PLANNERS)
      for (let seed = 1; seed <= 60; seed++)
        for (const format of ['short', 'video'] as const) {
          const title = plan({ format, seed }, all).meta.title.toLowerCase();
          const hit = names.find((n) =>
            new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(title),
          );
          expect(hit, title).toBeUndefined();
        }
  });
});
