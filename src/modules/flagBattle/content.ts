/**
 * Turns a seed into a varied, ready-to-render Flag Battle (roster, rules, look) plus YouTube
 * metadata. Pure and deterministic: the same job and history always yield the same video.
 *
 * Variety matters for the channel, so every post is checked against recent ones: the number of
 * flags, the lineup, the group, theme, mode, length and title all avoid recent repeats, and after
 * the simulation the winner (and the final pairing) are relabelled to countries that have not
 * won before. Country fighters are physically identical, so relabelling never changes the
 * physics, only which flag is drawn on which ball.
 */
import type { ContentFormat, ContentRecord, VideoMeta } from '../../autopilot/types';
import type { Country } from '../../data/countries';
import { Rng } from '../../engine/rng';
import type { Fighter, Look, Rules } from '../../engine/types';
import { countryFighter, DEFAULT_LOOK, DEFAULT_RULES } from '../../store/app';
import { GAME_THEMES } from '../../render/themes';
import {
  chooseLineup,
  ENGAGE_ASK,
  ENGAGE_OUTROS,
  fill,
  freshenPair,
  keyOf,
  pick,
  pickFresh,
  PROMPTS,
} from '../common';

export type FlagBattlePlan = {
  fighters: Fighter[];
  rules: Rules;
  look: Look;
  /** Human label for the roster ("Europe", "G20", "Random 24"). */
  group: string;
  meta: VideoMeta;
  /** Title template used (tracked to avoid repeats). */
  template: string;
  /** Spoiler-free thumbnail text. */
  thumb: { hook: string; sub: string };
};

const ESCAPE_SHORT_TITLES = [
  '99% Guess This Wrong 😱 Last Flag Inside Wins',
  'Wait For The Ending 😳 {n} Flags, One Exit',
  'Last Country Inside Wins 🌍 ({n} Flags)',
  'Which Flag Stays Inside the Longest? 🔥',
  '{n} Countries, One Rotating Exit 😱',
  'Can Your Flag Survive the Spinning Circle? 🌀',
  '{group} Flags Escape Challenge 🌍',
  'Only One Flag Can Stay Inside 👀',
  'Guess the Last Flag Inside 🤔 ({n} Countries)',
];
const ROYALE_SHORT_TITLES = [
  '{n} Countries Battle Royale ⚔️ Who Wins?',
  'Last Flag Standing Wins 🏆 ({group})',
  'Pick Your Flag Before the Battle Starts ⚔️',
  'Country Ball Battle Royale 🌍 {n} Flags',
];
const ESCAPE_VIDEO_TITLES = [
  '{n} Countries Escape the Circle | Who Stays Inside the Longest?',
  'Ultimate {group} Flag Escape Battle | {n} Countries',
  'Last Country Inside Wins | {n} Flags, One Rotating Exit',
];
const ROYALE_VIDEO_TITLES = [
  'Ultimate {n} Country Battle Royale | Who Will Win?',
  '{group} Flag Battle Royale | Last Country Standing',
];

export function buildMeta(
  rng: Rng,
  args: {
    format: ContentFormat;
    mode: Rules['mode'];
    n: number;
    group: string;
    avoidTemplates?: string[];
    /** Made for kids: comments are disabled, so no comment prompts. */
    kids?: boolean;
  },
): VideoMeta & { template: string } {
  const { format, mode, n, group } = args;
  const titles =
    format === 'short'
      ? mode === 'escape'
        ? ESCAPE_SHORT_TITLES
        : ROYALE_SHORT_TITLES
      : mode === 'escape'
        ? ESCAPE_VIDEO_TITLES
        : ROYALE_VIDEO_TITLES;
  const vars = { n: String(n), group: group === 'World' ? 'World' : group };
  const template = pickFresh(rng, titles, args.avoidTemplates ?? []);
  let title = fill(template, vars);
  if (format === 'short') title = `${title} #shorts`;
  title = title.slice(0, 100);

  const hook =
    mode === 'escape'
      ? `${n} countries bounce inside a spinning circle with one small exit. Every flag that slips out is eliminated. The last flag left inside wins.`
      : `${n} countries collide in a battle royale. Every hit drains HP. The last flag standing wins.`;
  const tagsCore = [
    'flags',
    'countries',
    'countryballs',
    'flag battle',
    'geography',
    'satisfying',
    'simulation',
  ];
  const modeTags =
    mode === 'escape'
      ? ['escape the circle', 'last one inside wins', 'marble race']
      : ['battle royale', 'last one standing'];
  const groupTags = group === 'World' ? [] : [group.toLowerCase()];
  const tags = [...tagsCore, ...modeTags, ...groupTags, ...(format === 'short' ? ['shorts'] : [])];
  const hashtags = [
    '#flags',
    '#countryballs',
    mode === 'escape' ? '#escapethecircle' : '#battleroyale',
    '#geography',
  ];
  if (format === 'short') hashtags.unshift('#shorts');
  const description = [
    hook,
    '',
    args.kids ? 'Which country did you pick? Watch till the end to see if you were right 🏆' : ENGAGE_ASK,
    'Subscribe for a new flag battle every day.',
    '',
    hashtags.join(' '),
  ].join('\n');
  return { title, description, tags, template };
}

const ESCAPE_HOOKS = ['WHO ESCAPES LAST?', 'WHO STAYS INSIDE?', 'LAST ONE INSIDE WINS', 'GUESS THE WINNER'];
const ROYALE_HOOKS = ['WHO SURVIVES?', 'LAST FLAG STANDING', 'WHO WINS?', 'GUESS THE WINNER'];

export function planFlagBattle(
  job: { format: ContentFormat; seed: number; kids?: boolean },
  countries: Country[],
  recent: ContentRecord[] = [],
): FlagBattlePlan {
  const rng = new Rng(job.seed);
  const mine = recent.filter((r) => r.moduleId === 'flag-battle' || !r.moduleId);
  const same = mine.filter((r) => r.format === job.format);
  const { list, group } = chooseLineup(rng, countries, job.format, same, mine, {
    short: [10, 32],
    video: [32, 64],
  });
  const fighters = list.map(countryFighter);

  const lastModes = same.slice(-2).map((r) => r.mode);
  let mode: Rules['mode'] = rng.next() < 0.75 ? 'escape' : 'royale';
  // Never three of a kind in a row.
  if (lastModes.length === 2 && lastModes[0] === mode && lastModes[1] === mode)
    mode = mode === 'escape' ? 'royale' : 'escape';
  const short = job.format === 'short';
  const durations = short ? ([42, 48, 52, 56] as const) : ([150, 180, 210, 240] as const);
  const rules: Rules = {
    ...DEFAULT_RULES,
    mode,
    seed: rng.int(999_999) + 1,
    arena: mode === 'royale' ? pick(rng, ['circle', 'circle', 'rounded', 'square'] as const) : 'circle',
    gap: {
      size: 1.7 + rng.next() * 0.9,
      speedDeg: 25 + rng.int(66),
      direction: rng.next() < 0.5 ? 'cw' : 'ccw',
    },
    shrink: { ...DEFAULT_RULES.shrink, enabled: true },
    targetDurationSec: pick(rng, durations),
  };
  const theme = pickFresh(
    rng,
    GAME_THEMES['flag-battle'],
    same.slice(-1).map((r) => r.theme as Look['theme']),
  );
  const { template, ...meta } = buildMeta(rng, {
    format: job.format,
    mode,
    n: fighters.length,
    group,
    avoidTemplates: mine.slice(-6).map((r) => r.template ?? ''),
    kids: job.kids,
  });
  const look: Look = {
    ...DEFAULT_LOOK,
    aspect: short ? '9:16' : '16:9',
    theme,
    title: mode === 'escape' ? 'Last flag inside wins' : 'Last flag standing wins',
    subtitle: job.kids ? 'Pick your country before it starts' : 'Comment your country',
    prompt: job.kids ? undefined : pick(rng, PROMPTS),
    outroCta: pick(
      rng,
      job.kids
        ? ['Did you pick the winner?', 'Subscribe for a new battle every day', 'Watch the next battle!']
        : ENGAGE_OUTROS,
    ),
  };
  const thumb = {
    hook: pick(rng, mode === 'escape' ? ESCAPE_HOOKS : ROYALE_HOOKS),
    sub:
      group === 'World' ? `${fighters.length} COUNTRIES` : `${fighters.length} ${group.toUpperCase()} FLAGS`,
  };
  return { fighters, rules, look, group, meta, template, thumb };
}

/**
 * After the simulation decides which ball wins, puts a country on that ball that has not won
 * recently (never, if possible), and makes sure the final two are a pairing not seen before.
 * Mutates `fighters`. Returns the winner's and runner-up's keys.
 */
export function freshenOutcome(
  fighters: Fighter[],
  result: { winnerIndex: number; elimT: ArrayLike<number> },
  recent: ContentRecord[],
  seed: number,
): { winner?: string; runnerUp?: string } {
  const w = result.winnerIndex;
  let r = -1;
  for (let i = 0; i < fighters.length; i++) {
    if (i === w || !Number.isFinite(result.elimT[i])) continue;
    if (r < 0 || result.elimT[i] > result.elimT[r]) r = i;
  }
  return freshenPair(fighters, w, r, recent, seed);
}

/** The history record for a finished plan. */
export function contentRecord(
  plan: FlagBattlePlan,
  outcome: { winner?: string; runnerUp?: string },
): Omit<ContentRecord, 'slotId' | 'at' | 'format' | 'moduleId'> {
  return {
    count: plan.fighters.length,
    roster: plan.fighters.map(keyOf),
    ...outcome,
    mode: plan.rules.mode,
    group: plan.group,
    theme: plan.look.theme,
    template: plan.template,
  };
}
