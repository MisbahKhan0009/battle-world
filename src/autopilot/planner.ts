/**
 * Organic posting planner. For a channel and a calendar day it picks how many Shorts and long
 * videos to post and when, deterministically (same channel + day = same plan):
 * - times are spread across the active window with random offsets, never on round minutes; with
 *   peak hours on, they follow the audience's activity curve (more posts when more people watch);
 * - a minimum gap separates posts; long videos go to the slots where long-form viewing peaks;
 * - every game has its own pace (Shorts a day, long videos a week, spread over the week per
 *   game); all games share one timeline, so their posts never overlap and keep the minimum gap;
 * - the daily count wobbles by one per game when enabled;
 * - the daily upload cap is shared and always wins, trimmed fairly from the busiest game.
 */
import { hash32, Rng } from '../engine/rng';
import { audienceClock, engagement } from './engagement';
import { paceFor, type ContentFormat, type ScheduleSettings, type Slot } from './types';

export function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseDayKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function strHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Monday-based week number since the epoch (local calendar). */
function weekIndex(d: Date): number {
  const utcDays = Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);
  return Math.floor((utcDays + 3) / 7); // 1970-01-01 was a Thursday
}

function weekday(d: Date): number {
  return (d.getDay() + 6) % 7; // Monday = 0
}

/** Long videos scheduled for this day under a per-week budget spread over random days. */
export function videosOnDay(channelId: string, d: Date, perWeek: number): number {
  if (perWeek <= 0) return 0;
  const rng = new Rng(hash32(strHash(channelId), weekIndex(d), 11));
  const days = [0, 1, 2, 3, 4, 5, 6];
  for (let i = days.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [days[i], days[j]] = [days[j], days[i]];
  }
  const wd = weekday(d);
  let count = 0;
  for (let k = 0; k < perWeek; k++) if (days[k % 7] === wd) count++;
  return count;
}

export type PlannedSlot = Pick<Slot, 'id' | 'channelId' | 'at' | 'format' | 'moduleId' | 'seed'>;

export function planDay(
  channelId: string,
  day: Date,
  settings: ScheduleSettings,
  moduleIds: string[],
): PlannedSlot[] {
  if (!moduleIds.length) return [];
  const key = dayKey(day);
  const [y, mo, d] = key.split('-').map(Number);
  const rng = new Rng(hash32(strHash(channelId), y * 10000 + mo * 100 + d, 77));

  // Each game's own pace for the day (long-video days are spread per game).
  const mods = [...moduleIds].sort();
  const want = mods.map((m) => {
    const pace = paceFor(settings, m);
    let shorts = Math.max(0, Math.round(pace.shortsPerDay));
    if (settings.varyDaily && shorts > 0) {
      const r = rng.next();
      if (r < 0.2) shorts -= 1;
      else if (r > 0.85) shorts += 1;
    } else rng.next();
    const videos = videosOnDay(`${channelId}:${m}`, day, Math.round(pace.videosPerWeek));
    return { m, shorts, videos };
  });
  const count = () => want.reduce((sum, w) => sum + w.shorts + w.videos, 0);
  // Over the limit: take one post at a time from the game with the most, Shorts first.
  const trimTo = (limit: number) => {
    while (count() > limit) {
      const w = want.reduce((a, b) => (b.shorts + b.videos > a.shorts + a.videos ? b : a));
      if (w.shorts > 0) w.shorts--;
      else w.videos--;
    }
  };
  trimTo(Math.max(0, Math.round(settings.dailyCap)));

  let start = Math.max(0, Math.min(24 * 60 - 1, settings.activeStartMin));
  let end = Math.max(0, Math.min(24 * 60, settings.activeEndMin));
  if (end - start < 30) {
    start = 9 * 60;
    end = 23 * 60;
  }
  const gap = Math.max(10, settings.minGapMin);
  // Only as many posts as fit with the minimum gap.
  trimTo(Math.floor((end - start) / gap) + 1);
  const n = count();
  if (n === 0) return [];
  const videos = want.reduce((sum, w) => sum + w.videos, 0);

  const clockAt = (m: number) =>
    audienceClock(new Date(y, mo - 1, d, 0, Math.round(m)).getTime(), settings.audienceTz);
  const times: number[] = [];
  if (settings.peakHours) {
    // Stratified sampling of the audience-activity distribution over the window: each post
    // gets an equal share of the day's viewers, at a random point inside its share.
    const STEP = 5;
    const grid: number[] = [];
    const cum: number[] = [];
    let total = 0;
    // Cell i covers [grid[i], grid[i] + STEP); cum[i] is the weight up to its end.
    for (let m = start; m < end; m += STEP) {
      const c = clockAt(m + STEP / 2);
      // The floor keeps quieter hours possible, which reads as more human.
      total += 0.12 + engagement('short', c.weekend, c.hour) ** 1.5;
      grid.push(m);
      cum.push(total);
    }
    for (let k = 0; k < n; k++) {
      const q = ((k + 0.1 + 0.8 * rng.next()) / n) * total;
      let i = 0;
      while (i < cum.length - 1 && cum[i] < q) i++;
      const prev = i > 0 ? cum[i - 1] : 0;
      const frac = cum[i] > prev ? (q - prev) / (cum[i] - prev) : 0;
      times.push(Math.min(end, grid[i] + STEP * frac));
    }
  } else {
    const seg = (end - start) / n;
    for (let k = 0; k < n; k++) times.push(start + seg * (k + 0.1 + 0.8 * rng.next()));
  }
  times.sort((a, b) => a - b);
  // Enforce the minimum gap, then pull back anything that spilled past the window.
  for (let k = 1; k < n; k++) if (times[k] - times[k - 1] < gap) times[k] = times[k - 1] + gap;
  if (times[n - 1] > end) {
    times[n - 1] = end;
    for (let k = n - 2; k >= 0; k--) if (times[k + 1] - times[k] < gap) times[k] = times[k + 1] - gap;
  }
  // Avoid machine-looking round minutes.
  const minutes = times.map((t) => {
    let m = Math.floor(t);
    if (m % 5 === 0) m += 1 + rng.int(3);
    return Math.min(end, Math.max(start, m));
  });

  // Long videos take the slots where long-form viewing peaks (or the evening without peak hours).
  const formats: ContentFormat[] = minutes.map(() => 'short');
  const order = minutes
    .map((m, i) => {
      const noise = rng.next();
      if (!settings.peakHours) return { i, score: Math.abs(m - 19 * 60) + noise * 60 };
      const c = clockAt(m);
      return { i, score: -engagement('video', c.weekend, c.hour) - noise * 0.15 };
    })
    .sort((a, b) => a.score - b.score);
  for (let v = 0; v < videos; v++) formats[order[v].i] = 'video';

  // Which game each slot belongs to. Videos are dealt in random order; Shorts go to the game with
  // the most left, avoiding the same game twice in a row so the feed alternates naturally.
  const videoMods = want.flatMap((w) => Array<string>(w.videos).fill(w.m));
  for (let i = videoMods.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [videoMods[i], videoMods[j]] = [videoMods[j], videoMods[i]];
  }
  const shortsLeft = new Map(want.map((w) => [w.m, w.shorts]));
  let prev = '';
  const slotMods = formats.map((f) => {
    let m: string;
    if (f === 'video') m = videoMods.pop()!;
    else {
      const open = mods.filter((x) => (shortsLeft.get(x) ?? 0) > 0);
      const pool = open.filter((x) => x !== prev).length ? open.filter((x) => x !== prev) : open;
      const most = Math.max(...pool.map((x) => shortsLeft.get(x)!));
      const top = pool.filter((x) => shortsLeft.get(x) === most);
      m = top[rng.int(top.length)];
      shortsLeft.set(m, shortsLeft.get(m)! - 1);
    }
    prev = m;
    return m;
  });

  return minutes.map((m, i) => ({
    id: `${channelId}:${key}:${i}`,
    channelId,
    at: new Date(y, mo - 1, d, Math.floor(m / 60), m % 60, rng.int(60)).getTime(),
    format: formats[i],
    moduleId: slotMods[i],
    seed: (rng.int(999_999) + 1) >>> 0,
  }));
}
