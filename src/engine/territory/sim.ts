/**
 * Territory Wars automaton. Every tick, each owned cell picks one neighbor at random and tries to
 * take it: empty land falls easily, a rival's cell falls with a chance set by the two countries'
 * strength. Strength grows slowly with size (so empires snowball, but not too fast) and with
 * morale, a seeded random walk; now and then a country rallies (a surge), small ones more often,
 * which makes comebacks. Cells taken this tick can't attack until the next one, so the scan order
 * doesn't bias the borders.
 *
 * Every country plays by the same rules: the winner comes from geography and seeded luck. A
 * seeded RNG keeps it deterministic: the same config is the same war.
 */
import { hash32, Rng } from '../rng';
import { buildMap } from './map';
import type { TerritoryConfig, TerritoryEvent, TerritoryTrack } from './types';

/** Chance an attack on empty land succeeds. */
const P_CLAIM = 0.45;
/** Chance an attack on a rival succeeds between equals (scaled by relative strength). */
const P_WAR = 0.16;
/** Strength grows as cells^SIZE_EXP. */
const SIZE_EXP = 0.3;
/** Sea crossings are harder to win. */
const SEA = 0.35;
/** No rallies in the opening land grab (ticks). */
const CALM = 60;
/** A rally lasts this many ticks and multiplies strength by SURGE. */
const SURGE_TICKS = [50, 110] as const;
const SURGE = 2.2;
/** A country counts as the new leader once it is this much bigger. */
const LEAD_MARGIN = 1.05;

export type TerritorySimOut = {
  events: TerritoryEvent[];
  winnerIndex: number;
  endTick: number;
  land: number[];
  total: number;
  conquered: boolean;
  leadChanges: number;
  outTicks: number[];
  rec: TerritoryTrack | null;
};

export function simulateTerritory(config: TerritoryConfig, opts: { record: boolean }): TerritorySimOut {
  const map = buildMap(config.isos);
  const { cols, cells, adjStart, adj } = map;
  const n = config.ids.length;
  const N = cols * map.rows;
  const rng = new Rng(hash32(config.seed, 0x7e4));
  const owner = new Int16Array(N).fill(-1);
  const count = new Int32Array(n);
  const sx = new Float64Array(n);
  const sy = new Float64Array(n);
  const take = (q: number, i: number) => {
    const j = owner[q];
    const c = q % cols;
    const r = (q - c) / cols;
    if (j >= 0) {
      count[j]--;
      sx[j] -= c;
      sy[j] -= r;
    }
    owner[q] = i;
    count[i]++;
    sx[i] += c;
    sy[i] += r;
  };
  map.homes.forEach((home, i) => home.forEach((q) => take(q, i)));

  const morale = new Float64Array(n).fill(1);
  const surge = new Int32Array(n);
  const alive = new Uint8Array(n).fill(1);
  let living = n;
  const events: TerritoryEvent[] = [];
  const outTicks: number[] = [];
  let leader = -1;
  let leadChanges = 0;

  // Recording: change groups per tick, plus each country's size and anchor cell.
  const changeStart: number[] = [0];
  const chCells: number[] = [];
  const chOwners: number[] = [];
  const stats: number[] = [];
  const taken: number[] = [0];
  const anchor = new Int32Array(n).fill(-1);
  const snapStats = () => {
    // The owned cell nearest each territory's center (where its countryball sits).
    const bestD = new Float64Array(n).fill(Infinity);
    for (let h = 0; h < cells.length; h++) {
      const q = cells[h];
      const i = owner[q];
      if (i < 0) continue;
      const c = q % cols;
      const dx = c - sx[i] / count[i];
      const dy = (q - c) / cols - sy[i] / count[i];
      const d = dx * dx + dy * dy;
      if (d < bestD[i]) {
        bestD[i] = d;
        anchor[i] = q;
      }
    }
    for (let i = 0; i < n; i++) {
      const q = anchor[i];
      stats.push(count[i], q >= 0 ? q % cols : 0, q >= 0 ? Math.floor(q / cols) : 0);
    }
  };
  if (opts.record) {
    for (let i = 0; i < n; i++)
      for (const q of map.homes[i]) {
        chCells.push(q);
        chOwners.push(i + 1);
      }
    changeStart.push(chCells.length);
    snapStats();
  }

  const strength = new Float64Array(n);
  const prev = new Int16Array(N);
  let tick = 0;
  let conquered = false;
  while (tick < config.maxTicks) {
    tick++;
    const t = tick / config.rate;
    let share = 0;
    for (let i = 0; i < n; i++) share = Math.max(share, count[i]);
    for (let i = 0; i < n; i++) {
      if (!alive[i]) continue;
      // Morale drifts back toward 1; rallies come more often to the small.
      if (tick % 10 === 0)
        morale[i] = Math.max(0.6, Math.min(1.5, morale[i] + rng.range(-0.2, 0.2) + (1 - morale[i]) * 0.2));
      if (surge[i] > 0) surge[i]--;
      else if (tick > CALM && living > 1) {
        const small = count[i] < share * 0.35 ? 3 : 1;
        if (rng.next() < 0.0016 * small) {
          surge[i] = SURGE_TICKS[0] + rng.int(SURGE_TICKS[1] - SURGE_TICKS[0]);
          const q = anchor[i] >= 0 ? anchor[i] : map.homes[i][0];
          events.push({ t, type: 'surge', i, x: q % cols, y: Math.floor(q / cols) });
        }
      }
      strength[i] = Math.pow(Math.max(1, count[i]), SIZE_EXP) * morale[i] * (surge[i] > 0 ? SURGE : 1);
    }
    prev.set(owner);
    let gained = 0;
    for (let h = 0; h < cells.length; h++) {
      const q = cells[h];
      const i = prev[q];
      const deg = adjStart[q + 1] - adjStart[q];
      if (i < 0 || deg === 0) continue;
      const nb = adj[adjStart[q] + rng.int(deg)];
      const j = prev[nb];
      if (j === i || owner[nb] !== j) continue;
      let p: number;
      if (j < 0) p = P_CLAIM * morale[i];
      else {
        p = (2 * P_WAR * strength[i]) / (strength[i] + strength[j]);
        // The last few cells of a country fall fast, so nobody lingers as a speck.
        if (count[j] < 6) p *= 1.6;
      }
      const dc = (nb % cols) - (q % cols);
      if (dc > 1 || dc < -1 || nb - q > cols + 1 || q - nb > cols + 1) p *= SEA;
      if (rng.next() >= p) continue;
      take(nb, i);
      if (j >= 0) gained++;
      if (opts.record) {
        chCells.push(nb);
        chOwners.push(i + 1);
      }
      if (j >= 0 && count[j] === 0 && alive[j]) {
        alive[j] = 0;
        living--;
        outTicks.push(tick);
        events.push({ t, type: 'out', i: j, by: i, x: nb % cols, y: Math.floor(nb / cols) });
      }
    }
    // Who leads (with a margin, so near-ties don't flicker)?
    let big = 0;
    for (let i = 1; i < n; i++) if (count[i] > count[big]) big = i;
    if (leader < 0) leader = big;
    else if (big !== leader && count[big] > count[leader] * LEAD_MARGIN) {
      leader = big;
      leadChanges++;
      events.push({ t, type: 'lead', i: big });
    }
    if (opts.record) {
      changeStart.push(chCells.length);
      taken.push(gained);
      snapStats();
    }
    if (living <= 1) {
      conquered = true;
      break;
    }
  }

  let winnerIndex = 0;
  for (let i = 1; i < n; i++) if (count[i] > count[winnerIndex]) winnerIndex = i;
  let rec: TerritoryTrack | null = null;
  if (opts.record) {
    rec = {
      ticks: tick + 1,
      n,
      changeStart: Int32Array.from(changeStart),
      cells: Int32Array.from(chCells),
      owners: Uint8Array.from(chOwners),
      stats: Float32Array.from(stats),
      taken: Uint16Array.from(taken),
    };
  }
  return {
    events,
    winnerIndex,
    endTick: tick,
    land: Array.from(count),
    total: cells.length,
    conquered,
    leadChanges,
    outTicks,
    rec,
  };
}
