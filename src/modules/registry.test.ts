import { describe, expect, test } from 'vitest';
import { DEFAULT_PACE } from '../autopilot/types';
import { PLANS } from './plans';
import { MODULES } from './registry';

describe('module registry', () => {
  test('every ready game renders and has a default pace; every coming game has a full plan', () => {
    for (const m of MODULES) {
      if (m.status === 'ready') {
        expect(m.render).toBeTypeOf('function');
        expect(DEFAULT_PACE[m.id]).toBeDefined();
      } else {
        const p = PLANS[m.id];
        expect(p, m.id).toBeDefined();
        for (const part of [p.howItPlays, p.simulation, p.video, p.steps])
          expect(part.length).toBeGreaterThan(0);
      }
    }
    expect(MODULES.map((m) => m.id)).toEqual(
      expect.arrayContaining(['black-hole', 'paper-land', 'ring-escape', 'growing-ball']),
    );
    expect(MODULES.map((m) => m.id)).not.toContain('territory-wars');
  });
});
