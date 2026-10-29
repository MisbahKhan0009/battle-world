/**
 * Turns a seed into a varied, ready-to-render Territory War (lineup, length, look) plus YouTube
 * metadata. Same freshness rules as the other games for counts, lineups, themes and titles. Unlike
 * the arena games, countries start on their real place on the map, so the winner can't be
 * relabelled afterwards; instead the planner is told who won lately and prefers a war someone
 * else wins.
 */
import type { ContentFormat, ContentRecord, VideoMeta } from '../../autopilot/types';
import type { Country } from '../../data/countries';
import { Rng } from '../../engine/rng';
import type { Fighter, Look } from '../../engine/types';
import { GAME_THEMES } from '../../render/themes';
import { countryFighter, DEFAULT_LOOK } from '../../store/app';
import { chooseLineup, fill, keyOf, pick, pickFresh } from '../common';

export const MODULE_ID = 'territory-wars';

/** Countries per Short and per long video (one war on one map either way). */
const COUNTS: Record<ContentFormat, [number, number]> = { short: [4, 8], video: [10, 18] };

export type TerritoryWarsPlan = {
  fighters: Fighter[];
  look: Look;
  group: string;
  meta: VideoMeta;
  template: string;
  thumb: { hook: string; sub: string };
  /** Seed for the war. */
  gameSeed: number;
  /** Fighter indices that won recently (the planner prefers a war they lose). */
  avoid: number[];
  /** Desired and maximum length (sim seconds, start to the win). */
  targetSec: number;
  maxSec: number;
};

const SHORT_TITLES = [
  'Which Country Takes Over the Map? 🗺️',
  'Territory War: {n} Countries, One Map 🗺️',
  '{group} Territory War 🌍 Who Conquers It All?',
  'Guess Who Rules the Map 👀 {n} Countries',
  'Pixel Map War 🔥 {n} Countries Fight for Land',
  'Last Country Standing Takes the Map 🗺️',
];
const VIDEO_TITLES = [
  'Territory Wars | {n} Countries Battle for the Map',
  '{group} Territory War | {n} Countries, One Winner',
  'Country Territory War Simulation | Who Conquers the Map?',
];
const HOOKS = ['WHO TAKES OVER THE MAP?', 'WHO CONQUERS IT ALL?', 'WHICH FLAG WINS?', 'WHO RULES THE MAP?'];

/** Video overhead around the war: intro 2 s, winner card 3 s, outro 3 s, slow motion. */
const OVERHEAD = 8.6;

export function buildTerritoryMeta(
  rng: Rng,
  args: { format: ContentFormat; n: number; group: string; avoidTemplates?: string[]; kids?: boolean },
): VideoMeta & { template: string } {
  const { format, n, group } = args;
  const template = pickFresh(
    rng,
    format === 'short' ? SHORT_TITLES : VIDEO_TITLES,
    args.avoidTemplates ?? [],
  );
  let title = fill(template, { n: String(n), group });
  if (format === 'short') title = `${title} #shorts`;
  title = title.slice(0, 100);
  const hashtags = ['#territorywars', '#map', '#countries', '#flags'];
  if (format === 'short') hashtags.unshift('#shorts');
  const description = [
    format === 'short'
      ? `${n} countries start on their real place on a pixel map and fight for every tile. Borders push back and forth, small countries strike back, and the last country standing takes the map.`
      : `${n} countries, one pixel map. Every country starts on its own land with the same army, then the borders start moving. Empires grow, rivals fall, comebacks happen, and the last country standing rules the map.`,
    '',
    args.kids
      ? 'Which flag did you pick? Watch till the end to see if you were right 🏆'
      : 'Who were you cheering for? Comment your country 👇',
    'Subscribe for a new battle every day.',
    '',
    hashtags.join(' '),
  ].join('\n');
  const tags = [
    'territory wars',
    'map war',
    'pixel map',
    'country war simulation',
    'countries',
    'flags',
    'simulation',
    ...(group === 'World' ? [] : [group.toLowerCase()]),
    ...(format === 'short' ? ['shorts'] : ['world war simulation']),
  ];
  return { title, description, tags, template };
}

export function planTerritoryWars(
  job: { format: ContentFormat; seed: number; kids?: boolean },
  countries: Country[],
  recent: ContentRecord[] = [],
): TerritoryWarsPlan {
  const rng = new Rng(job.seed);
  const mine = recent.filter((r) => r.moduleId === MODULE_ID);
  const same = mine.filter((r) => r.format === job.format);
  const lineup = chooseLineup(rng, countries, job.format, same, mine, COUNTS);
  // Group draws can come in bigger than the range: keep a count that fits and differs from the
  // last couple of posts.
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
  const total = pick(rng, short ? ([44, 48, 52, 56] as const) : ([180, 210, 240] as const));
  const theme = pickFresh(
    rng,
    GAME_THEMES[MODULE_ID],
    same.slice(-1).map((r) => r.theme as Look['theme']),
  );
  const { template, ...meta } = buildTerritoryMeta(rng, {
    format: job.format,
    n: fighters.length,
    group,
    avoidTemplates: mine.slice(-6).map((r) => r.template ?? ''),
    kids: job.kids,
  });
  const look: Look = {
    ...DEFAULT_LOOK,
    aspect: short ? '9:16' : '16:9',
    theme,
    title: 'Conquer the map',
    subtitle: job.kids ? 'Pick your flag before it starts' : 'Comment your country',
    showKillFeed: true,
    showCounter: true,
    outroCta: pick(
      rng,
      job.kids
        ? ['Did you pick the winner?', 'Subscribe for a new battle every day', 'Watch the next one!']
        : [
            'Which countries should fight next? Comment below',
            'Did your country win? Tell us',
            'Subscribe for a new battle every day',
          ],
    ),
  };
  const recentWinners = new Set(mine.slice(-6).map((r) => r.winner));
  return {
    fighters,
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
    avoid: fighters.flatMap((f, i) => (recentWinners.has(keyOf(f)) ? [i] : [])),
    targetSec: total - OVERHEAD,
    // Shorts must stay under a minute.
    maxSec: short ? 58.5 - OVERHEAD : total + 20,
  };
}

/** The history record for a finished war. */
export function territoryRecord(
  plan: TerritoryWarsPlan,
  outcome: { winner?: string; runnerUp?: string },
): Omit<ContentRecord, 'slotId' | 'at' | 'format' | 'moduleId'> {
  return {
    count: plan.fighters.length,
    roster: plan.fighters.map(keyOf),
    ...outcome,
    mode: 'territory',
    group: plan.group,
    theme: plan.look.theme,
    template: plan.template,
  };
}
