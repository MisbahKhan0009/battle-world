import { describe, expect, test } from 'vitest';
import type { Slot } from '../autopilot/types';
import { addSnapshot, byGame, byHour, change, enrich, median } from './insights';
import { parseDuration, type VideoStat } from './youtube';

const NOW = Date.UTC(2026, 9, 29, 12);
const vid = (
  id: string,
  views: number,
  hoursAgo: number,
  dur = 45,
  extra: Partial<VideoStat> = {},
): VideoStat => ({
  id,
  title: id,
  publishedAt: NOW - hoursAgo * 3_600_000,
  durationSec: dur,
  views,
  likes: views / 20,
  comments: 0,
  thumbnail: '',
  privacy: 'public',
  madeForKids: true,
  ...extra,
});

describe('dashboard insights', () => {
  test('durations', () => {
    expect(parseDuration('PT58S')).toBe(58);
    expect(parseDuration('PT3M20S')).toBe(200);
    expect(parseDuration('PT1H2M')).toBe(3720);
  });

  test('games come from the autopilot records; formats fall back to duration', () => {
    const slots = [
      { videoId: 'a', format: 'short', moduleId: 'flag-battle' },
      { videoId: 'b', format: 'short', moduleId: 'marble-race' },
    ] as Slot[];
    const out = enrich([vid('a', 100, 10), vid('b', 300, 20), vid('c', 900, 30, 600)], slots, NOW);
    expect(out.find((v) => v.id === 'c')!.format).toBe('video');
    const games = byGame(out);
    expect(games.find((g) => g.key === 'marble-race:short')!.avgViews).toBe(300);
    expect(games.some((g) => g.key.startsWith('null'))).toBe(false);
    // Typical = median of Shorts (100, 300) = 200.
    expect(out.find((v) => v.id === 'b')!.vsTypical).toBe(1.5);
  });

  test('scheduled and private uploads do not count as live', () => {
    const out = enrich([vid('s', 0, 1, 45, { privacy: 'private', publishAt: NOW + 3_600_000 })], [], NOW);
    expect(out[0].live).toBe(false);
    expect(byHour(out, 1).every((h) => h.count === 0)).toBe(true);
  });

  test('change over time uses snapshots; one per hour is kept', () => {
    let pts = [] as { t: number; subs: number; views: number; videos: number }[];
    for (let d = 10; d >= 0; d--)
      pts = addSnapshot(pts, { t: NOW - d * 86_400_000, subs: 1000 + (10 - d) * 10, views: 0, videos: 0 });
    pts = addSnapshot(pts, { t: NOW + 60_000, subs: 1101, views: 0, videos: 0 });
    expect(pts.length).toBe(11);
    expect(change(pts, 'subs', 7, NOW)).toBe(71);
    expect(median([5, 1, 3])).toBe(3);
  });
});
