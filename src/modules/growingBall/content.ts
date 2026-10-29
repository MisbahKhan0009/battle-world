/**
 * Turns a seed into a varied, ready-to-render Growing Ball (lineup, heats, length, look) plus
 * YouTube metadata. Same freshness rules as the other games: flag counts, lineups, themes and
 * titles avoid recent posts, and the winner is relabelled after the game so winners never
 * repeat (every ball is physically identical, so only the flags move).
 */
import type { ContentFormat, ContentRecord, VideoMeta } from '../../autopilot/types';
import type { Country } from '../../data/countries';
import { Rng } from '../../engine/rng';
import type { Fighter, Look } from '../../engine/types';
import { countryFighter, DEFAULT_LOOK } from '../../store/app';
import { chooseLineup, fill, keyOf, pick, pickFresh, splitHeats } from '../common';

export const MODULE_ID = 'growing-ball';

/** Flags per Short (one game) and per long video (a knockout of heats and a final). */
const COUNTS: Record<ContentFormat, [number, number]> = { short: [3, 6], video: [9, 16] };

export type GrowingBallPlan = {
  fighters: Fighter[];
  /** Heats as groups of fighter indices (long videos), or null for one game. */
  heats: number[][] | null;
  look: Look;
  group: string;
  meta: VideoMeta;
  template: string;
  thumb: { hook: string; sub: string };
  /** Seed for the start positions. */
  gameSeed: number;
  /** Desired and maximum length (sim seconds, start to the final win). */
  targetSec: number;
  maxSec: number;
};

const SHORT_TITLES = [
  'Which Country Grows the Biggest? 🎈',
  'Every Bounce Makes It Bigger 🎈 {n} Countries',
  'Can {fav} Grow the Biggest? 🎈',
  '{group} Growing Ball Battle 🌍 ({n} Countries)',
  'Guess Who Grows Biggest 👀 {n} Countries',
  'Growing Ball: {n} Countries 🔥 Watch Till the End',
];
const VIDEO_TITLES = [
  'Growing Ball Tournament | {n} Countries, One Champion',
  '{group} Growing Ball Championship | {n} Countries',
  'Country Growing Ball Knockout | {h} Heats and a Grand Final',
];
const HOOKS = ['WHO GROWS BIGGEST?', 'CAN YOU GUESS?', 'WHICH FLAG WINS?', 'BIGGEST BALL WINS!'];

/** Video overhead around the game: intro 2 s, winner card 3 s, outro 3 s, slow motion. */
const OVERHEAD = 8.6;

export function buildGrowMeta(
  rng: Rng,
  args: {
    format: ContentFormat;
    n: number;
    heats: number;
    group: string;
    fav: string;
    avoidTemplates?: string[];
    kids?: boolean;
  },
): VideoMeta & { template: string } {
  const { format, n, group, fav } = args;
  const template = pickFresh(
    rng,
    format === 'short' ? SHORT_TITLES : VIDEO_TITLES,
    args.avoidTemplates ?? [],
  );
  let title = fill(template, { n: String(n), group, fav, h: String(args.heats) });
  if (format === 'short') title = `${title} #shorts`;
  title = title.slice(0, 100);
  const hashtags = ['#growingball', '#satisfying', '#countries', '#flags'];
  if (format === 'short') hashtags.unshift('#shorts');
  const description = [
    format === 'short'
      ? `${n} country balls bounce in an arena, and every bounce off the wall makes a ball bigger. Big balls get boxed in while small ones keep bouncing. When the arena is full, the biggest flag wins.`
      : `${n} countries, ${args.heats} heats and a grand final. Every bounce off the wall makes a ball bigger; when the arena is full, the biggest ball wins. Each heat winner reaches the final, and the biggest flag in the final is the champion.`,
    '',
    args.kids
      ? 'Which flag did you pick? Watch till the end to see if you were right 🏆'
      : 'Who were you cheering for? Comment your country 👇',
    'Subscribe for a new battle every day.',
    '',
    hashtags.join(' '),
  ].join('\n');
  const tags = [
    'growing ball',
    'bouncing ball',
    'every bounce gets bigger',
    'satisfying',
    'country balls',
    'countries',
    'flags',
    'simulation',
    ...(group === 'World' ? [] : [group.toLowerCase()]),
    ...(format === 'short' ? ['shorts'] : ['tournament']),
  ];
  return { title, description, tags, template };
}

export function planGrowingBall(
  job: { format: ContentFormat; seed: number; kids?: boolean },
  countries: Country[],
  recent: ContentRecord[] = [],
): GrowingBallPlan {
  const rng = new Rng(job.seed);
  const mine = recent.filter((r) => r.moduleId === MODULE_ID);
  const same = mine.filter((r) => r.format === job.format);
  const lineup = chooseLineup(rng, countries, job.format, same, mine, COUNTS);
  // Group draws (regions, G20) come in bigger, and the range is small: keep a count that fits
  // and differs from the last couple of posts.
  const [lo, hi] = COUNTS[job.format];
  const last = same.slice(-2).map((r) => r.count);
  const options = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i).filter(
    (c) => c <= lineup.list.length,
  );
  const n = lineup.list.length;
  const keep = n <= hi && !last.includes(n) ? n : pickFresh(rng, options.length ? options : [n], last);
  const list = lineup.list.slice(0, keep);
  const group = lineup.group;
  const fighters = list.map(countryFighter);
  const short = job.format === 'short';
  let heatCount = fighters.length <= 12 ? 3 : 4;
  while (heatCount > 2 && fighters.length / heatCount < 3) heatCount--;
  const heats = short ? null : splitHeats(fighters.length, heatCount);
  const total = pick(rng, short ? ([44, 48, 52, 56] as const) : ([150, 180, 210, 240] as const));
  const theme = pickFresh(
    rng,
    ['space', 'neon', 'night', 'space', 'paper'] as const,
    same.slice(-1).map((r) => r.theme as Look['theme']),
  );
  const fav = pick(rng, fighters).name;
  const { template, ...meta } = buildGrowMeta(rng, {
    format: job.format,
    n: fighters.length,
    heats: heats?.length ?? 0,
    group,
    fav,
    avoidTemplates: mine.slice(-6).map((r) => r.template ?? ''),
    kids: job.kids,
  });
  const look: Look = {
    ...DEFAULT_LOOK,
    aspect: short ? '9:16' : '16:9',
    theme,
    title: 'Every bounce grows 🎈',
    subtitle: job.kids ? 'Pick your flag before it starts 👀' : 'Comment your country 👇',
    showKillFeed: true,
    showCounter: true,
    outroCta: pick(
      rng,
      job.kids
        ? ['Did you pick the winner? 🏆', 'Subscribe for a new battle every day 🔔', 'Watch the next one! 🔁']
        : [
            'Which countries should play next? Comment below 👇',
            'Did your country win? Tell us 👇',
            'Subscribe for a new battle every day 🔔',
          ],
    ),
  };
  return {
    fighters,
    heats,
    look,
    group,
    meta,
    template,
    thumb: {
      hook: pick(rng, HOOKS),
      sub:
        group === 'World'
          ? `${fighters.length} COUNTRIES`
          : `${fighters.length} ${group.toUpperCase()} FLAGS`,
    },
    gameSeed: rng.int(999_999) + 1,
    targetSec: total - OVERHEAD,
    // Shorts must stay under a minute.
    maxSec: short ? 58.5 - OVERHEAD : total + 20,
  };
}

/** The history record for a finished game. */
export function growRecord(
  plan: GrowingBallPlan,
  outcome: { winner?: string; runnerUp?: string },
): Omit<ContentRecord, 'slotId' | 'at' | 'format' | 'moduleId'> {
  return {
    count: plan.fighters.length,
    roster: plan.fighters.map(keyOf),
    ...outcome,
    mode: plan.heats ? 'grow-knockout' : 'grow',
    group: plan.group,
    theme: plan.look.theme,
    template: plan.template,
  };
}
