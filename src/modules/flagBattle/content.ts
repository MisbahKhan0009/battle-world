/**
 * Turns a seed into a varied, ready-to-render Flag Battle (roster, rules, look) plus YouTube
 * metadata. Pure and deterministic: the same job always yields the same video and text.
 * Variety matters for the channel: rosters, modes, themes, opening speeds and titles all rotate.
 */
import type { ContentFormat, VideoMeta } from '../../autopilot/types';
import { GROUPS, REGIONS, type Country, type Region } from '../../data/countries';
import { Rng } from '../../engine/rng';
import type { Fighter, Look, Rules } from '../../engine/types';
import { countryFighter, DEFAULT_LOOK, DEFAULT_RULES } from '../../store/app';

export type FlagBattlePlan = {
  fighters: Fighter[];
  rules: Rules;
  look: Look;
  /** Human label for the roster ("Europe", "G20", "Random 24"). */
  group: string;
  meta: VideoMeta;
};

const pick = <T>(rng: Rng, arr: readonly T[]): T => arr[rng.int(arr.length)];

function shuffled<T>(rng: Rng, arr: readonly T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function roster(rng: Rng, countries: Country[], format: ContentFormat): { list: Country[]; group: string } {
  const byIso = new Map(countries.map((c) => [c.iso2, c]));
  const [lo, hi] = format === 'short' ? [10, 32] : [32, 64];
  const count = lo + rng.int(hi - lo + 1);
  const r = rng.next();
  if (r < 0.2) {
    const region: Region = pick(rng, REGIONS);
    const list = shuffled(
      rng,
      countries.filter((c) => c.region === region),
    ).slice(0, Math.max(8, Math.min(count, 64)));
    return { list, group: region };
  }
  if (r < 0.3 && format === 'short') {
    return { list: GROUPS.g20.map((i) => byIso.get(i)!).filter(Boolean), group: 'G20' };
  }
  if (r < 0.42) {
    const list = GROUPS.population
      .slice(0, count)
      .map((i) => byIso.get(i)!)
      .filter(Boolean);
    return { list, group: 'Most populous' };
  }
  if (r < 0.47 && format === 'short') {
    return { list: GROUPS.saarc.map((i) => byIso.get(i)!).filter(Boolean), group: 'South Asia' };
  }
  return { list: shuffled(rng, countries).slice(0, count), group: 'World' };
}

const ESCAPE_SHORT_TITLES = [
  'Last Country Inside Wins 🌍 ({n} Flags)',
  'Which Flag Stays Inside the Longest? 🔥',
  '{n} Countries, One Rotating Exit 😱',
  'Can {fav} Survive the Spinning Circle? 🌀',
  '{group} Flags Escape Challenge 🌍',
  'Only One Flag Can Stay Inside 👀',
  'Guess the Last Flag Inside 🤔 ({n} Countries)',
];
const ROYALE_SHORT_TITLES = [
  '{n} Countries Battle Royale ⚔️ Who Wins?',
  'Last Flag Standing Wins 🏆 ({group})',
  'Can {fav} Win the Flag Battle? ⚔️',
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

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '');
}

export function buildMeta(
  rng: Rng,
  args: { format: ContentFormat; mode: Rules['mode']; n: number; group: string; fav: string },
): VideoMeta {
  const { format, mode, n, group, fav } = args;
  const titles =
    format === 'short'
      ? mode === 'escape'
        ? ESCAPE_SHORT_TITLES
        : ROYALE_SHORT_TITLES
      : mode === 'escape'
        ? ESCAPE_VIDEO_TITLES
        : ROYALE_VIDEO_TITLES;
  const vars = { n: String(n), group: group === 'World' ? 'World' : group, fav };
  let title = fill(pick(rng, titles), vars);
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
    'Who were you rooting for? Comment your country 👇',
    'Subscribe for a new flag battle every day.',
    '',
    hashtags.join(' '),
  ].join('\n');
  return { title, description, tags };
}

export function planFlagBattle(
  job: { format: ContentFormat; seed: number },
  countries: Country[],
): FlagBattlePlan {
  const rng = new Rng(job.seed);
  const { list, group } = roster(rng, countries, job.format);
  const fighters = list.map(countryFighter);
  const mode: Rules['mode'] = rng.next() < 0.75 ? 'escape' : 'royale';
  const short = job.format === 'short';
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
    targetDurationSec: short
      ? pick(rng, [42, 48, 52, 56] as const)
      : pick(rng, [150, 180, 210, 240] as const),
  };
  const theme = pick(rng, ['night', 'night', 'neon', 'space', 'paper'] as const);
  const fav = pick(rng, fighters).name;
  const meta = buildMeta(rng, { format: job.format, mode, n: fighters.length, group, fav });
  const look: Look = {
    ...DEFAULT_LOOK,
    aspect: short ? '9:16' : '16:9',
    theme,
    title: mode === 'escape' ? 'Last flag inside wins 🔥' : 'Last flag standing wins ⚔️',
    subtitle: 'Comment your country 👇',
    outroCta: pick(rng, [
      'Which flags should battle next? Comment below 👇',
      'Did your country make it? Tell us 👇',
      'Subscribe for a new battle every day 🔔',
    ]),
  };
  return { fighters, rules, look, group, meta };
}
