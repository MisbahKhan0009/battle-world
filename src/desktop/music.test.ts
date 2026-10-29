import { describe, expect, test } from 'vitest';
import type { ContentRecord } from '../autopilot/types';
import { pickTrack } from './music';

const tracks = ['Alpha', 'Bravo', 'Charlie', 'Delta'].map((name) => ({
  name,
  path: `C:/Music/${name}.mp3`,
  attribution: null,
}));
const used = (...names: string[]): ContentRecord[] =>
  names.map((music, i) => ({
    slotId: String(i),
    at: i,
    format: 'short',
    moduleId: 'flag-battle',
    count: 8,
    roster: [],
    music,
  }));

describe('music picks', () => {
  test('the same post always gets the same track', () => {
    expect(pickTrack(tracks, 42, [])).toEqual(pickTrack(tracks, 42, []));
  });

  test('tracks the channel used recently wait until the others have had a turn', () => {
    for (let seed = 1; seed < 50; seed++)
      expect(['Charlie', 'Delta']).toContain(pickTrack(tracks, seed, used('Alpha', 'Bravo'))!.name);
    // Everything used: the one used longest ago comes back first.
    for (let seed = 1; seed < 50; seed++)
      expect(pickTrack(tracks, seed, used('Charlie', 'Alpha', 'Delta', 'Bravo'))!.name).toBe('Charlie');
  });

  test('an empty folder gives no track', () => {
    expect(pickTrack([], 1, [])).toBeNull();
  });
});
