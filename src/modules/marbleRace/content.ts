/**
 * Turns a seed into a varied, ready-to-render Marble Race (lineup, length, look) plus YouTube
 * metadata. Same freshness rules as Flag Battle: flag counts, lineups, themes and titles avoid
 * recent posts, and the winner is relabelled after the race so winners never repeat (every
 * marble is physically identical, so only the flags move).
 */
import type { ContentFormat, ContentRecord, VideoMeta } from '../../autopilot/types';
import type { Country } from '../../data/countries';
import { Rng } from '../../engine/rng';
import type { Fighter, Look } from '../../engine/types';
import { GAME_THEMES } from '../../render/themes';
import { countryFighter, DEFAULT_LOOK } from '../../store/app';
import { chooseLineup, fill, keyOf, pick, pickFresh } from '../common';

export const MODULE_ID = 'marble-race';

export type MarbleRacePlan = {
  fighters: Fighter[];
  look: Look;
  group: string;
  meta: VideoMeta;
  template: string;
  thumb: { hook: string; sub: string };
  /** Seed for the track and start grid. */
  raceSeed: number;
  /** Desired and maximum race length (sim seconds, start to winner). */
  targetSec: number;
  maxSec: number;
};

const SHORT_TITLES = [
  'Marble Race: {n} Countries 🏁 Who Wins?',
  '{n} Flag Marbles Race to the Finish 🏁',
  'Which Country Wins the Marble Race? 🤔',
  'Can {fav} Win the Marble Race? 🏁',
  '{group} Marble Race 🌍 ({n} Countries)',
  'Guess the Winner 👀 {n} Country Marbles',
  'Country Marble Race 🔥 Watch Till the End',
];
const VIDEO_TITLES = [
  'Ultimate {n} Country Marble Race | Who Wins the Grand Prix?',
  '{group} Marble Race Championship | {n} Countries',
  'Country Marble Race Grand Prix | {n} Flags, One Winner',
];
const HOOKS = ['WHO WINS THE RACE?', 'GUESS THE WINNER', 'FIRST TO THE FINISH?', 'WHICH FLAG WINS?'];

/** Video overhead around the race: intro 2 s, winner card 3 s, outro 3 s, slow motion. */
const OVERHEAD = 8.5;

export function buildRaceMeta(
  rng: Rng,
  args: {
    format: ContentFormat;
    n: number;
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
  let title = fill(template, { n: String(n), group, fav });
  if (format === 'short') title = `${title} #shorts`;
  title = title.slice(0, 100);
  const hashtags = ['#marblerace', '#marblerun', '#countries', '#flags'];
  if (format === 'short') hashtags.unshift('#shorts');
  const description = [
    `${n} country marbles race down a track packed with ramps, pegs, spinners and bumpers. The first marble across the finish line wins.`,
    '',
    args.kids
      ? 'Which marble did you pick? Watch till the end to see if you were right 🏆'
      : 'Who were you cheering for? Comment your country 👇',
    'Subscribe for a new race every day.',
    '',
    hashtags.join(' '),
  ].join('\n');
  const tags = [
    'marble race',
    'marble run',
    'country marbles',
    'countries',
    'flags',
    'geography',
    'satisfying',
    'simulation',
    ...(group === 'World' ? [] : [group.toLowerCase()]),
    ...(format === 'short' ? ['shorts'] : []),
  ];
  return { title, description, tags, template };
}

export function planMarbleRace(
  job: { format: ContentFormat; seed: number; kids?: boolean },
  countries: Country[],
  recent: ContentRecord[] = [],
): MarbleRacePlan {
  const rng = new Rng(job.seed);
  const mine = recent.filter((r) => r.moduleId === MODULE_ID);
  const same = mine.filter((r) => r.format === job.format);
  const { list, group } = chooseLineup(rng, countries, job.format, same, mine, {
    short: [8, 30],
    video: [24, 48],
  });
  const fighters = list.map(countryFighter);
  const short = job.format === 'short';
  const total = pick(rng, short ? ([42, 48, 52, 56] as const) : ([150, 180, 210, 240] as const));
  const theme = pickFresh(
    rng,
    GAME_THEMES['marble-race'],
    same.slice(-1).map((r) => r.theme as Look['theme']),
  );
  const fav = pick(rng, fighters).name;
  const { template, ...meta } = buildRaceMeta(rng, {
    format: job.format,
    n: fighters.length,
    group,
    fav,
    avoidTemplates: mine.slice(-6).map((r) => r.template ?? ''),
    kids: job.kids,
  });
  const look: Look = {
    ...DEFAULT_LOOK,
    aspect: short ? '9:16' : '16:9',
    theme,
    title: 'First to the finish wins',
    subtitle: job.kids ? 'Pick your marble before the start' : 'Comment your country',
    showKillFeed: true,
    showCounter: true,
    outroCta: pick(
      rng,
      job.kids
        ? ['Did you pick the winner?', 'Subscribe for a new race every day', 'Watch the next race!']
        : [
            'Which countries should race next? Comment below',
            'Did your country win? Tell us',
            'Subscribe for a new race every day',
          ],
    ),
  };
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
    raceSeed: rng.int(999_999) + 1,
    targetSec: total - OVERHEAD,
    // Shorts must stay under a minute.
    maxSec: short ? 58.5 - OVERHEAD : total + 20,
  };
}

/** The history record for a finished race. */
export function raceRecord(
  plan: MarbleRacePlan,
  outcome: { winner?: string; runnerUp?: string },
): Omit<ContentRecord, 'slotId' | 'at' | 'format' | 'moduleId'> {
  return {
    count: plan.fighters.length,
    roster: plan.fighters.map(keyOf),
    ...outcome,
    mode: 'race',
    group: plan.group,
    theme: plan.look.theme,
    template: plan.template,
  };
}
