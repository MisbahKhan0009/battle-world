/**
 * Pure dashboard math: totals and their change over time (from saved snapshots), per-game and
 * per-format performance, best posting hours and how each upload compares with the channel's
 * typical result. Knows which game made each video through the autopilot's own records.
 */
import type { ContentFormat, Slot, StatPoint } from '../autopilot/types';
import type { VideoStat } from './youtube';

export type Enriched = VideoStat & {
  format: ContentFormat;
  moduleId: string | null;
  /** Views relative to the median of the same format (1 = typical). */
  vsTypical: number;
  viewsPerDay: number;
  live: boolean;
};

const SHORT_MAX_SEC = 180;

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function enrich(videos: VideoStat[], slots: Slot[], now: number): Enriched[] {
  const byId = new Map(slots.filter((s) => s.videoId).map((s) => [s.videoId!, s]));
  const base = videos.map((v) => {
    const slot = byId.get(v.id);
    const format: ContentFormat =
      slot?.format ?? (v.durationSec > 0 && v.durationSec <= SHORT_MAX_SEC ? 'short' : 'video');
    const live = v.privacy === 'public' && !(v.publishAt && v.publishAt > now);
    const days = Math.max(1, (now - v.publishedAt) / 86_400_000);
    return {
      ...v,
      format,
      moduleId: slot?.moduleId ?? null,
      live,
      viewsPerDay: v.views / days,
      vsTypical: 1,
    };
  });
  for (const f of ['short', 'video'] as const) {
    const typical = median(base.filter((v) => v.format === f && v.live).map((v) => v.views));
    for (const v of base) if (v.format === f) v.vsTypical = typical > 0 ? v.views / typical : 1;
  }
  return base.sort((a, b) => b.publishedAt - a.publishedAt);
}

/** Change of a total over the last `days`, from the snapshot closest to that point. */
export function change(
  points: StatPoint[],
  key: 'subs' | 'views' | 'videos',
  days: number,
  now: number,
): number | null {
  if (points.length < 2) return null;
  const target = now - days * 86_400_000;
  let best: StatPoint | null = null;
  for (const p of points) if (p.t <= target + 3_600_000 && (!best || p.t > best.t)) best = p;
  // Not tracked that long yet: compare with the oldest snapshot if it is at least a day old.
  if (!best) best = points[0].t < now - 86_400_000 ? points[0] : null;
  if (!best) return null;
  return points[points.length - 1][key] - best[key];
}

export type GroupStat = {
  key: string;
  count: number;
  avgViews: number;
  medianViews: number;
  engagement: number;
};

function group(videos: Enriched[], keyOf: (v: Enriched) => string | null): GroupStat[] {
  const map = new Map<string, Enriched[]>();
  for (const v of videos) {
    const k = keyOf(v);
    if (k === null || !v.live) continue;
    map.set(k, [...(map.get(k) ?? []), v]);
  }
  return [...map.entries()].map(([key, list]) => {
    const views = list.reduce((s, v) => s + v.views, 0);
    const eng = list.reduce((s, v) => s + v.likes + v.comments, 0);
    return {
      key,
      count: list.length,
      avgViews: views / list.length,
      medianViews: median(list.map((v) => v.views)),
      engagement: views > 0 ? eng / views : 0,
    };
  });
}

/** Per game and format, e.g. "flag-battle:short". Only videos the autopilot made. */
export const byGame = (videos: Enriched[]) =>
  group(videos, (v) => (v.moduleId ? `${v.moduleId}:${v.format}` : null));

export const byFormat = (videos: Enriched[]) => group(videos, (v) => v.format);

/**
 * Median views of Shorts by the local hour they went live (only hours with at least
 * `minPosts` posts count, so one lucky video does not mark an hour as best).
 */
export function byHour(videos: Enriched[], minPosts = 2): { hour: number; median: number; count: number }[] {
  const buckets: number[][] = Array.from({ length: 24 }, () => []);
  for (const v of videos) {
    if (!v.live || v.format !== 'short') continue;
    buckets[new Date(v.publishAt ?? v.publishedAt).getHours()].push(v.views);
  }
  return buckets.map((b, hour) => ({ hour, median: b.length >= minPosts ? median(b) : 0, count: b.length }));
}

export function engagementRate(videos: Enriched[]): number {
  const live = videos.filter((v) => v.live);
  const views = live.reduce((s, v) => s + v.views, 0);
  return views > 0 ? live.reduce((s, v) => s + v.likes + v.comments, 0) / views : 0;
}

/** Appends a snapshot, keeping at most one per hour and about a year of history. */
export function addSnapshot(points: StatPoint[], p: StatPoint): StatPoint[] {
  const last = points[points.length - 1];
  const next = last && p.t - last.t < 3_600_000 ? [...points.slice(0, -1), p] : [...points, p];
  return next.slice(-9000);
}

export function compact(n: number): string {
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}K`;
  return String(Math.round(n));
}
