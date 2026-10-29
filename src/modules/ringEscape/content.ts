/**
 * Turns a seed into a varied, ready-to-render Ring Escape (lineup, heats, length, look) plus
 * YouTube metadata. Same freshness rules as the other games: flag counts, lineups, themes and
 * titles avoid recent posts, and the winner is relabelled after the game so winners never
 * repeat (every ball is physically identical, so only the flags move).
 */
import type { ContentFormat, ContentRecord, VideoMeta } from '../../autopilot/types';
import type { Country } from '../../data/countries';
import { Rng } from '../../engine/rng';
import type { Fighter, Look } from '../../engine/types';
import { GAME_THEMES } from '../../render/themes';
import { countryFighter, DEFAULT_LOOK } from '../../store/app';
import { chooseLineup, fill, keyOf, pick, pickFresh, splitHeats } from '../common';

export const MODULE_ID = 'ring-escape';

/** Flags per Short (one game) and per long video (a knockout of heats and a final). */
const COUNTS: Record<ContentFormat, [number, number]> = { short: [4, 8], video: [12, 20] };

export type RingEscapePlan = {
  fighters: Fighter[];
  /** Heats as groups of fighter indices (long videos), or null for one game. */
  heats: number[][] | null;
  look: Look;
  group: string;
  meta: VideoMeta;
  template: string;
  thumb: { hook: string; sub: string };
  /** Seed for the rings and the start positions. */
  gameSeed: number;
  /** Desired and maximum length (sim seconds, start to the final escape). */
  targetSec: number;
  maxSec: number;
};

const SHORT_TITLES = [
  'Which Country Escapes the Rings First? 🌀',
  'Escape the Spinning Rings 🌀 {n} Countries',
  'Only One Flag Gets Out First 🌀',
  '{group} Ring Escape 🌍 ({n} Countries)',
  'Guess Who Escapes First 👀 {n} Countries',
  'Ring Escape: {n} Countries 🔥 Watch Till the End',
];
const VIDEO_TITLES = [
  'Ring Escape Tournament | {n} Countries, One Champion',
  '{group} Ring Escape Championship | {n} Countries',
  'Country Ring Escape Knockout | {h} Heats and a Grand Final',
];
const HOOKS = ['WHO ESCAPES FIRST?', 'CAN YOU GUESS?', 'WHICH FLAG GETS OUT?', 'ESCAPE THE RINGS!'];

/** Video overhead around the game: intro 2 s, winner card 3 s, outro 3 s, slow motion. */
const OVERHEAD = 8.6;

export function buildRingsMeta(
  rng: Rng,
  args: {
    format: ContentFormat;
    n: number;
    heats: number;
    group: string;
    avoidTemplates?: string[];
    kids?: boolean;
  },
): VideoMeta & { template: string } {
  const { format, n, group } = args;
  const template = pickFresh(
    rng,
    format === 'short' ? SHORT_TITLES : VIDEO_TITLES,
    args.avoidTemplates ?? [],
  );
  let title = fill(template, { n: String(n), group, h: String(args.heats) });
  if (format === 'short') title = `${title} #shorts`;
  title = title.slice(0, 100);
  const hashtags = ['#ringescape', '#satisfying', '#countries', '#flags'];
  if (format === 'short') hashtags.unshift('#shorts');
  const description = [
    format === 'short'
      ? `${n} country balls bounce inside spinning rings. Slip through a gap and the ring shatters. The first flag out of the last ring wins.`
      : `${n} countries, ${args.heats} heats and a grand final. Balls bounce inside spinning rings; slip through a gap and the ring shatters. Each heat winner reaches the final, and the first flag out of the last ring is the champion.`,
    '',
    args.kids
      ? 'Which flag did you pick? Watch till the end to see if you were right 🏆'
      : 'Who were you cheering for? Comment your country 👇',
    'Subscribe for a new escape every day.',
    '',
    hashtags.join(' '),
  ].join('\n');
  const tags = [
    'ring escape',
    'escape the rings',
    'bouncing ball',
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

export function planRingEscape(
  job: { format: ContentFormat; seed: number; kids?: boolean },
  countries: Country[],
  recent: ContentRecord[] = [],
): RingEscapePlan {
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
  let heatCount = fighters.length <= 15 ? 3 : 4;
  while (heatCount > 2 && fighters.length / heatCount < 3) heatCount--;
  const heats = short ? null : splitHeats(fighters.length, heatCount);
  const total = pick(rng, short ? ([44, 48, 52, 56] as const) : ([150, 180, 210, 240] as const));
  const theme = pickFresh(
    rng,
    GAME_THEMES['ring-escape'],
    same.slice(-1).map((r) => r.theme as Look['theme']),
  );
  const { template, ...meta } = buildRingsMeta(rng, {
    format: job.format,
    n: fighters.length,
    heats: heats?.length ?? 0,
    group,
    avoidTemplates: mine.slice(-6).map((r) => r.template ?? ''),
    kids: job.kids,
  });
  const look: Look = {
    ...DEFAULT_LOOK,
    aspect: short ? '9:16' : '16:9',
    theme,
    title: 'Escape the rings',
    subtitle: job.kids ? 'Pick your flag before it starts' : 'Comment your country',
    showKillFeed: true,
    showCounter: true,
    outroCta: pick(
      rng,
      job.kids
        ? ['Did you pick the winner?', 'Subscribe for a new escape every day', 'Watch the next one!']
        : [
            'Which countries should play next? Comment below',
            'Did your country escape? Tell us',
            'Subscribe for a new escape every day',
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
export function ringsRecord(
  plan: RingEscapePlan,
  outcome: { winner?: string; runnerUp?: string },
): Omit<ContentRecord, 'slotId' | 'at' | 'format' | 'moduleId'> {
  return {
    count: plan.fighters.length,
    roster: plan.fighters.map(keyOf),
    ...outcome,
    mode: plan.heats ? 'rings-knockout' : 'rings',
    group: plan.group,
    theme: plan.look.theme,
    template: plan.template,
  };
}
