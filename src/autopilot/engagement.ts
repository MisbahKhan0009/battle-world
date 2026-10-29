/**
 * When YouTube audiences are most active, by hour of their local day. The curves follow the
 * widely reported pattern for YouTube (and Shorts in particular): quiet overnight, a morning
 * commute bump, a lunch peak, and the biggest peak in the evening; weekends start later and stay
 * busy through the afternoon. Long videos do best published a little before the evening peak so
 * they are indexed and recommended when people sit down to watch.
 *
 * Values are relative weights (1 = busiest hour), not absolute traffic.
 */
import type { ContentFormat } from './types';

// prettier-ignore
const SHORT_WEEKDAY = [
  0.22, 0.14, 0.08, 0.05, 0.05, 0.08, 0.2, 0.38, 0.45, 0.42, 0.45, 0.55,
  0.72, 0.75, 0.68, 0.7, 0.78, 0.85, 0.92, 0.98, 1.0, 0.95, 0.75, 0.45,
];
// prettier-ignore
const SHORT_WEEKEND = [
  0.35, 0.25, 0.15, 0.08, 0.06, 0.06, 0.1, 0.2, 0.35, 0.55, 0.72, 0.82,
  0.88, 0.88, 0.85, 0.85, 0.88, 0.92, 0.96, 1.0, 1.0, 0.95, 0.8, 0.55,
];
// prettier-ignore
const VIDEO_WEEKDAY = [
  0.12, 0.08, 0.05, 0.04, 0.04, 0.05, 0.1, 0.2, 0.28, 0.3, 0.35, 0.45,
  0.55, 0.62, 0.75, 0.88, 0.97, 1.0, 0.95, 0.85, 0.7, 0.5, 0.32, 0.2,
];
// prettier-ignore
const VIDEO_WEEKEND = [
  0.2, 0.12, 0.08, 0.05, 0.04, 0.05, 0.08, 0.15, 0.3, 0.5, 0.7, 0.88,
  1.0, 1.0, 0.95, 0.92, 0.9, 0.88, 0.82, 0.72, 0.6, 0.45, 0.32, 0.22,
];

/** Relative audience activity at a fractional hour (0..24) of the audience's day. */
export function engagement(format: ContentFormat, weekend: boolean, hour: number): number {
  const curve =
    format === 'short' ? (weekend ? SHORT_WEEKEND : SHORT_WEEKDAY) : weekend ? VIDEO_WEEKEND : VIDEO_WEEKDAY;
  const h = ((hour % 24) + 24) % 24;
  const i = Math.floor(h);
  const a = h - i;
  return curve[i] * (1 - a) + curve[(i + 1) % 24] * a;
}

const formatters = new Map<string, Intl.DateTimeFormat | null>();

function formatter(tz: string): Intl.DateTimeFormat | null {
  if (!formatters.has(tz)) {
    try {
      formatters.set(
        tz,
        new Intl.DateTimeFormat('en-US', {
          timeZone: tz,
          hourCycle: 'h23',
          hour: 'numeric',
          minute: 'numeric',
          weekday: 'short',
        }),
      );
    } catch {
      formatters.set(tz, null); // unknown zone: fall back to local time
    }
  }
  return formatters.get(tz)!;
}

/** Hour of day (fractional) and weekend flag at an instant, in the given zone ('' = local). */
export function audienceClock(ms: number, tz: string): { hour: number; weekend: boolean } {
  const f = tz ? formatter(tz) : null;
  if (!f) {
    const d = new Date(ms);
    const wd = d.getDay();
    return { hour: d.getHours() + d.getMinutes() / 60, weekend: wd === 0 || wd === 6 };
  }
  let hour = 0;
  let minute = 0;
  let weekday = '';
  for (const p of f.formatToParts(new Date(ms))) {
    if (p.type === 'hour') hour = Number(p.value);
    else if (p.type === 'minute') minute = Number(p.value);
    else if (p.type === 'weekday') weekday = p.value;
  }
  return { hour: hour + minute / 60, weekend: weekday === 'Sat' || weekday === 'Sun' };
}

/** Time zones offered in settings (main YouTube audiences). */
export const AUDIENCE_ZONES: { tz: string; label: string }[] = [
  { tz: '', label: 'Same as this computer' },
  { tz: 'America/New_York', label: 'USA East (New York)' },
  { tz: 'America/Chicago', label: 'USA Central (Chicago)' },
  { tz: 'America/Los_Angeles', label: 'USA West (Los Angeles)' },
  { tz: 'America/Mexico_City', label: 'Mexico' },
  { tz: 'America/Sao_Paulo', label: 'Brazil' },
  { tz: 'Europe/London', label: 'UK' },
  { tz: 'Europe/Berlin', label: 'Central Europe' },
  { tz: 'Europe/Istanbul', label: 'Turkey' },
  { tz: 'Africa/Lagos', label: 'West Africa (Nigeria)' },
  { tz: 'Africa/Cairo', label: 'Egypt' },
  { tz: 'Asia/Dubai', label: 'Gulf (Dubai)' },
  { tz: 'Asia/Karachi', label: 'Pakistan' },
  { tz: 'Asia/Kolkata', label: 'India' },
  { tz: 'Asia/Dhaka', label: 'Bangladesh' },
  { tz: 'Asia/Jakarta', label: 'Indonesia (Jakarta)' },
  { tz: 'Asia/Manila', label: 'Philippines' },
  { tz: 'Asia/Tokyo', label: 'Japan' },
  { tz: 'Australia/Sydney', label: 'Australia East' },
];
