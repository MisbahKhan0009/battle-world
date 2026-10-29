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
import { GROUPS, REGIONS, type Country, type Region } from '../../data/countries';
import { hash32, Rng } from '../../engine/rng';
import type { Fighter, Look, Rules } from '../../engine/types';
import { countryFighter, DEFAULT_LOOK, DEFAULT_RULES } from '../../store/app';

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

const pick = <T>(rng: Rng, arr: readonly T[]): T => arr[rng.int(arr.length)];

function shuffled<T>(rng: Rng, arr: readonly T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const keyOf = (f: { iso2?: string; name: string }) => f.iso2 ?? f.name;

function roster(
  rng: Rng,
  countries: Country[],
  format: ContentFormat,
  usedCounts: Set<number>,
): { list: Country[]; group: string } {
  const byIso = new Map(countries.map((c) => [c.iso2, c]));
  const [lo, hi] = format === 'short' ? [10, 32] : [32, 64];
  const counts = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  const fresh = counts.filter((c) => !usedCounts.has(c));
  const count = pick(rng, fresh.length ? fresh : counts);
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
    // A random subset, so G20 battles differ in size and lineup.
    const all = GROUPS.g20.map((i) => byIso.get(i)!).filter(Boolean);
    return { list: shuffled(rng, all).slice(0, Math.min(all.length, Math.max(10, count))), group: 'G20' };
  }
  if (r < 0.42) {
    // Draw from the most populous countries rather than always taking the top N.
    const pool = GROUPS.population
      .slice(0, Math.min(GROUPS.population.length, count + 12))
      .map((i) => byIso.get(i)!)
      .filter(Boolean);
    return { list: shuffled(rng, pool).slice(0, count), group: 'Most populous' };
  }
  if (r < 0.47 && format === 'short') {
    return { list: GROUPS.saarc.map((i) => byIso.get(i)!).filter(Boolean), group: 'South Asia' };
  }
  return { list: shuffled(rng, countries).slice(0, count), group: 'World' };
}

function jaccard(a: Set<string>, b: string[]): number {
  if (!a.size || !b.length) return 0;
  let inter = 0;
  for (const x of b) if (a.has(x)) inter++;
  return inter / (a.size + b.length - inter);
}

/** How much a candidate lineup repeats recent posts (0 = completely fresh). */
function rosterPenalty(list: Country[], group: string, recentSame: ContentRecord[], recent: ContentRecord[]) {
  let p = 0;
  if (recentSame.slice(-15).some((r) => r.count === list.length)) p += 5;
  const set = new Set(list.map((c) => c.iso2));
  for (const r of recent.slice(-25)) {
    const j = jaccard(set, r.roster);
    if (j > 0.4) p += (j - 0.4) * 20;
  }
  if (group !== 'World' && recent.slice(-3).some((r) => r.group === group)) p += 3;
  return p;
}

/** Picks from `options`, avoiding values in `avoid` when possible. */
function pickFresh<T>(rng: Rng, options: readonly T[], avoid: readonly (T | undefined)[]): T {
  const fresh = options.filter((o) => !avoid.includes(o));
  return pick(rng, fresh.length ? fresh : options);
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
  args: {
    format: ContentFormat;
    mode: Rules['mode'];
    n: number;
    group: string;
    fav: string;
    avoidTemplates?: string[];
  },
): VideoMeta & { template: string } {
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
    'Who were you rooting for? Comment your country 👇',
    'Subscribe for a new flag battle every day.',
    '',
    hashtags.join(' '),
  ].join('\n');
  return { title, description, tags, template };
}

const ESCAPE_HOOKS = ['WHO ESCAPES LAST?', 'WHO STAYS INSIDE?', 'LAST ONE INSIDE WINS', 'GUESS THE WINNER'];
const ROYALE_HOOKS = ['WHO SURVIVES?', 'LAST FLAG STANDING', 'WHO WINS?', 'GUESS THE WINNER'];

export function planFlagBattle(
  job: { format: ContentFormat; seed: number },
  countries: Country[],
  recent: ContentRecord[] = [],
): FlagBattlePlan {
  const rng = new Rng(job.seed);
  const mine = recent.filter((r) => r.moduleId === 'flag-battle' || !r.moduleId);
  const same = mine.filter((r) => r.format === job.format);
  const usedCounts = new Set(same.slice(-15).map((r) => r.count));

  // Try a few lineups and keep the freshest.
  let best: { list: Country[]; group: string } | null = null;
  let bestPenalty = Infinity;
  for (let attempt = 0; attempt < 12 && bestPenalty > 0; attempt++) {
    const cand = roster(rng, countries, job.format, usedCounts);
    const p = rosterPenalty(cand.list, cand.group, same, mine);
    if (p < bestPenalty) {
      best = cand;
      bestPenalty = p;
    }
  }
  const { list, group } = best!;
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
    ['night', 'night', 'neon', 'space', 'paper'] as const,
    same.slice(-1).map((r) => r.theme as Look['theme']),
  );
  const fav = pick(rng, fighters).name;
  const { template, ...meta } = buildMeta(rng, {
    format: job.format,
    mode,
    n: fighters.length,
    group,
    fav,
    avoidTemplates: mine.slice(-6).map((r) => r.template ?? ''),
  });
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
  const thumb = {
    hook: pick(rng, mode === 'escape' ? ESCAPE_HOOKS : ROYALE_HOOKS),
    sub:
      group === 'World' ? `${fighters.length} COUNTRIES` : `${fighters.length} ${group.toUpperCase()} FLAGS`,
  };
  return { fighters, rules, look, group, meta, template, thumb };
}

/** Swaps who is drawn on two balls (ids stay put, so the simulation stays valid). */
function swapIdentity(f: Fighter[], a: number, b: number): void {
  if (a === b) return;
  const [ida, idb] = [f[a].id, f[b].id];
  [f[a], f[b]] = [
    { ...f[b], id: ida },
    { ...f[a], id: idb },
  ];
}

const sameStats = (a: Fighter, b: Fighter) =>
  a.hp === b.hp && a.size === b.size && a.speed === b.speed && a.attack === b.attack;

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
  if (w < 0 || w >= fighters.length) return {};
  const rng = new Rng(hash32(seed, 0x5eed));
  let r = -1;
  for (let i = 0; i < fighters.length; i++) {
    if (i === w || !Number.isFinite(result.elimT[i])) continue;
    if (r < 0 || result.elimT[i] > result.elimT[r]) r = i;
  }

  // Winner: the competitor whose last win is oldest (never won = best).
  const lastWin = new Map<string, number>();
  recent.forEach((rec, i) => rec.winner && lastWin.set(rec.winner, i));
  const age = (i: number) => lastWin.get(keyOf(fighters[i])) ?? -1;
  const swappable = fighters.map((_, i) => i).filter((i) => sameStats(fighters[i], fighters[w]));
  const bestAge = Math.min(...swappable.map(age));
  if (age(w) > bestAge) {
    const options = swappable.filter((i) => age(i) === bestAge);
    // Balls keep their indices; only the flags move. If the pick was the runner-up's ball, the old
    // winner's flag now finishes second, which is fine.
    swapIdentity(fighters, w, pick(rng, options));
  }

  // Final pairing: avoid a winner/runner-up pair that already happened.
  if (r >= 0) {
    const pairs = new Set(recent.map((rec) => [rec.winner, rec.runnerUp].sort().join('|')));
    const pairKey = (i: number) => [keyOf(fighters[w]), keyOf(fighters[i])].sort().join('|');
    if (pairs.has(pairKey(r))) {
      const options = fighters
        .map((_, i) => i)
        .filter((i) => i !== w && i !== r && sameStats(fighters[i], fighters[r]) && !pairs.has(pairKey(i)));
      if (options.length) swapIdentity(fighters, r, pick(rng, options));
    }
  }
  return { winner: keyOf(fighters[w]), runnerUp: r >= 0 ? keyOf(fighters[r]) : undefined };
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
