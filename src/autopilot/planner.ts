/**
 * Organic posting planner. For a channel and a calendar day it picks how many Shorts and long
 * videos to post and when, deterministically (same channel + day = same plan):
 * - times are spread across the active window with random offsets, never on round minutes; with
 *   peak hours on, they follow the audience's activity curve (more posts when more people watch);
 * - a minimum gap separates posts; long videos go to the slots where long-form viewing peaks;
 * - every game has its own number of Shorts a day; long videos are a set number a day that take
 *   turns between the games (or, on older settings, a weekly pace per game); all games share one timeline, so their posts never overlap and keep the minimum gap;
 * - the daily count wobbles by one per game when enabled, balanced within each week so weekly
 *   totals always match the pace;
 * - the daily upload cap is shared and always wins, trimmed fairly from the busiest game.
 */
import { hash32, Rng } from '../engine/rng';
import { audienceClock, engagement } from './engagement';
import {
  channelGames,
  channelSchedule,
  paceFor,
  platformOf,
  PROJECT_UPLOADS_PER_DAY,
  type Channel,
  type ContentFormat,
  type ScheduleSettings,
  type Slot,
} from './types';

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

/**
 * Long videos on this day: evenly spaced (every 7 / perWeek days) from an offset unique to the
 * channel and game, so any 7 days in a row hold exactly `perWeek` of them and each game keeps its
 * own regular days, like a real channel's upload schedule.
 */
export function videosOnDay(key: string, d: Date, perWeek: number): number {
  if (perWeek <= 0) return 0;
  const day = Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);
  const offset = (hash32(strHash(key), 11) / 4294967296) * 7;
  return Math.floor(((day + 1 + offset) * perWeek) / 7) - Math.floor(((day + offset) * perWeek) / 7);
}

/**
 * Organic day-to-day variation that still adds up: each week, a game gets one or two days with
 * one Short more and as many days with one fewer, so the weekly total always matches its pace.
 */
export function weeklyWobble(key: string, d: Date, perDay: number): number {
  if (perDay <= 0) return 0;
  const rng = new Rng(hash32(strHash(key), weekIndex(d), 23));
  const days = [0, 1, 2, 3, 4, 5, 6];
  for (let i = days.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [days[i], days[j]] = [days[j], days[i]];
  }
  const pairs = 1 + rng.int(2);
  const offsets = [0, 0, 0, 0, 0, 0, 0];
  for (let p = 0; p < pairs; p++) {
    offsets[days[2 * p]] += 1;
    offsets[days[2 * p + 1]] -= 1;
  }
  return offsets[weekday(d)];
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
    const base = Math.max(0, Math.round(pace.shortsPerDay));
    const shorts = base + (settings.varyDaily ? weeklyWobble(`${channelId}:${m}`, day, base) : 0);
    const videos =
      settings.longPerDay === undefined
        ? videosOnDay(`${channelId}:${m}`, day, Math.round(pace.videosPerWeek))
        : 0;
    return { m, shorts, videos };
  });
  // Long videos a day, taking turns between the games (each game's long video comes round regularly).
  if (settings.longPerDay !== undefined) {
    const dayNo = Math.round(Date.UTC(y, mo - 1, d) / 86_400_000);
    const per = Math.max(0, Math.round(settings.longPerDay));
    const offset = strHash(channelId) % mods.length;
    for (let j = 0; j < per; j++) want[(dayNo * per + j + offset) % mods.length].videos++;
  }
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

/**
 * Shares `cap` posts between demands, one at a time round-robin (starting at `start`, so the odd
 * post rotates between channels from day to day). Nobody gets more than they asked for.
 */
export function shareFairly(want: number[], cap: number, start: number): number[] {
  const got = want.map(() => 0);
  let left = Math.max(0, Math.floor(cap));
  for (let progress = true; left > 0 && progress; ) {
    progress = false;
    for (let q = 0; q < want.length && left > 0; q++) {
      const k = (start + q) % want.length;
      if (got[k] < want[k]) {
        got[k]++;
        left--;
        progress = true;
      }
    }
  }
  return got;
}

/**
 * Every enabled channel's plan for a day. Each channel keeps its own games, pace and daily limit,
 * and all of them together stay within the shared all-channels limit (`schedule.projectCap`).
 */
export function planChannelsDay(
  day: Date,
  channels: Channel[],
  base: ScheduleSettings,
  ready: string[],
): Map<string, PlannedSlot[]> {
  const active = channels.filter((c) => c.enabled);
  const own = active.map((ch) => planDay(ch.id, day, channelSchedule(base, ch), channelGames(ch, ready)));
  const dayNo = Math.round(Date.UTC(day.getFullYear(), day.getMonth(), day.getDate()) / 86_400_000);
  // Only YouTube channels share the Google project's upload quota; Facebook and Instagram keep
  // their own plans.
  const yt = active.map((ch) => platformOf(ch) === 'youtube');
  const ytShare = shareFairly(
    own.filter((_, k) => yt[k]).map((p) => p.length),
    base.projectCap ?? PROJECT_UPLOADS_PER_DAY,
    yt.filter(Boolean).length ? dayNo % yt.filter(Boolean).length : 0,
  );
  let q = 0;
  const share = own.map((p, k) => (yt[k] ? ytShare[q++] : p.length));
  return new Map(
    active.map((ch, k) => [
      ch.id,
      share[k] === own[k].length
        ? own[k]
        : planDay(ch.id, day, { ...channelSchedule(base, ch), dailyCap: share[k] }, channelGames(ch, ready)),
    ]),
  );
}
