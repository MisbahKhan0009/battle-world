/**
 * Territory Wars: world types. The war is a cellular automaton on a pixel crop of the world map
 * (see map.ts), advancing in ticks; `rate` ticks play per sim second.
 */

/** Fully resolved, serializable game input. */
export type TerritoryConfig = {
  seed: number;
  /** Competitor ids (labels only: every country fights by the same rules). */
  ids: string[];
  /** Country code each competitor starts on (its real place on the map). */
  isos: string[];
  /** Ticks per sim second. */
  rate: number;
  /** The war stops after this many ticks if nobody has conquered the map; the biggest wins. */
  maxTicks: number;
};

export type TerritoryEvent =
  | {
      t: number;
      type: 'out';
      /** The country wiped off the map, and who took its last cell. */
      i: number;
      by: number;
      /** Cell (column, row) of its last stand. */
      x: number;
      y: number;
    }
  | {
      t: number;
      /** A country rallies and strikes back (a few seconds of extra strength). */
      type: 'surge';
      i: number;
      x: number;
      y: number;
    }
  | { t: number; type: 'lead'; i: number };

/**
 * Recorded war. Tick g sets cells `cells[changeStart[g] .. changeStart[g + 1])` to `owners`
 * (competitor + 1); tick 0 is the starting land. `stats` is [tick][country][cells, x, y], where
 * (x, y) is the owned cell nearest the territory's center (where its countryball sits), and
 * `taken` counts the cells won from rivals (not empty land) on each tick.
 */
export type TerritoryTrack = {
  ticks: number;
  n: number;
  changeStart: Int32Array;
  cells: Int32Array;
  owners: Uint8Array;
  stats: Float32Array;
  taken: Uint16Array;
};

export type TerritoryResult = {
  config: TerritoryConfig;
  events: TerritoryEvent[];
  winnerIndex: number;
  winnerT: number;
  /** Start of the final slow motion. */
  final2T: number | null;
  endT: number;
  /** Tick the war ended on. */
  endTick: number;
  /** Cells of every country when the war ended. */
  land: number[];
  /** Land cells on the map. */
  total: number;
  /** One country took the whole map (otherwise the clock ran out). */
  conquered: boolean;
  leadChanges: number;
  /** Ticks at which countries fell, in order. */
  outTicks: number[];
  rec: TerritoryTrack | null;
};
