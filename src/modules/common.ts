/**
 * Content helpers shared by every game module: picking fresh lineups (counts, regions and
 * rosters that avoid recent posts) and relabelling the outcome so winners and final pairings
 * do not repeat. Pure and deterministic given the seed and the history.
 */
import type { ContentFormat, ContentRecord } from '../autopilot/types';
import { GROUPS, REGIONS, type Country, type Region } from '../data/countries';
import { hash32, Rng } from '../engine/rng';
import type { Fighter } from '../engine/types';

export const pick = <T>(rng: Rng, arr: readonly T[]): T => arr[rng.int(arr.length)];

export function shuffled<T>(rng: Rng, arr: readonly T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const keyOf = (f: { iso2?: string; name: string }) => f.iso2 ?? f.name;

export type CountRange = Record<ContentFormat, [number, number]>;

function roster(
  rng: Rng,
  countries: Country[],
  format: ContentFormat,
  usedCounts: Set<number>,
  range: CountRange,
): { list: Country[]; group: string } {
  const byIso = new Map(countries.map((c) => [c.iso2, c]));
  const [lo, hi] = range[format];
  const counts = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  const fresh = counts.filter((c) => !usedCounts.has(c));
  const count = pick(rng, fresh.length ? fresh : counts);
  const r = rng.next();
  if (r < 0.2) {
    const region: Region = pick(rng, REGIONS);
    const list = shuffled(
      rng,
      countries.filter((c) => c.region === region),
    ).slice(0, Math.max(8, Math.min(count, hi)));
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
export function pickFresh<T>(rng: Rng, options: readonly T[], avoid: readonly (T | undefined)[]): T {
  const fresh = options.filter((o) => !avoid.includes(o));
  return pick(rng, fresh.length ? fresh : options);
}

/** Tries a few lineups and keeps the freshest compared with recent posts. */
export function chooseLineup(
  rng: Rng,
  countries: Country[],
  format: ContentFormat,
  same: ContentRecord[],
  mine: ContentRecord[],
  range: CountRange,
): { list: Country[]; group: string } {
  const usedCounts = new Set(same.slice(-15).map((r) => r.count));
  let best: { list: Country[]; group: string } | null = null;
  let bestPenalty = Infinity;
  for (let attempt = 0; attempt < 12 && bestPenalty > 0; attempt++) {
    const cand = roster(rng, countries, format, usedCounts, range);
    const p = rosterPenalty(cand.list, cand.group, same, mine);
    if (p < bestPenalty) {
      best = cand;
      bestPenalty = p;
    }
  }
  return best!;
}

export function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '');
}

/** Swaps who is drawn on two balls (ids stay put, so the simulation stays valid). */
export function swapIdentity(f: Fighter[], a: number, b: number): void {
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
 * Puts a competitor that has not won recently (never, if possible) on the winning ball `w`,
 * and makes sure the final pairing with the runner-up ball `r` (-1 if none) has not happened
 * before. Competitors with identical stats are physically interchangeable, so this only changes
 * which flag is drawn where. Mutates `fighters`; returns the winner's and runner-up's keys.
 */
export function freshenPair(
  fighters: Fighter[],
  w: number,
  r: number,
  recent: ContentRecord[],
  seed: number,
): { winner?: string; runnerUp?: string } {
  if (w < 0 || w >= fighters.length) return {};
  const rng = new Rng(hash32(seed, 0x5eed));
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
