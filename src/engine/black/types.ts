/**
 * Black Hole: world types. A square city of `size` units seen from above, (0, 0) top left, y grows
 * downward. Holes are countries; city objects are rectangles or circles with a size.
 */

/** Fully resolved, serializable game input. */
export type BlackConfig = {
  seed: number;
  /** Hole ids, one per competitor (labels only: every hole plays by the same rules). */
  ids: string[];
  /** Blocks per city side (the city is `blocks * BLOCK + ROAD` units across). */
  blocks: number;
  /** Game clock in sim seconds; the game ends sooner if only one hole is left. */
  limit: number;
};

export type ObjectKind =
  | 'cone'
  | 'lamp'
  | 'bush'
  | 'bench'
  | 'tree'
  | 'car'
  | 'bus'
  | 'house'
  | 'shop'
  | 'tower';

/** A city object. Circles have hw = hh = their radius. */
export type CityObject = {
  kind: ObjectKind;
  x: number;
  y: number;
  hw: number;
  hh: number;
  /** Size that must fit in a hole: the radius of its bounding circle. */
  s: number;
  /** Footprint area (what the hole gains, before GAIN). */
  area: number;
  /** Small per-object variation for drawing (color pick, roof direction). */
  v: number;
};

export type City = {
  size: number;
  blocks: number;
  objects: CityObject[];
};

export type BlackEvent =
  | {
      t: number;
      type: 'eat';
      /** Hole that ate, and the object index. */
      i: number;
      o: number;
      /** Hole radius after eating. */
      r: number;
    }
  | {
      t: number;
      type: 'swallow';
      /** Hole i swallowed hole j. */
      i: number;
      j: number;
      x: number;
      y: number;
      r: number;
    };

/** Hole centers and radii sampled at hz, laid out [frame][hole][x, y, r]; r = 0 once swallowed. */
export type BlackTrack = { hz: number; frames: number; n: number; data: Float32Array };

export type BlackResult = {
  config: BlackConfig;
  city: City;
  events: BlackEvent[];
  winnerIndex: number;
  winnerT: number;
  /** Start of the final slow motion. */
  final2T: number | null;
  endT: number;
  /** Radius of every hole when the game ended (0 when swallowed). */
  radii: number[];
  /** The game ended because only one hole was left (otherwise the clock ran out). */
  lastStanding: boolean;
  /** How often the biggest hole changed (by a clear margin), and how many holes were swallowed. */
  leadChanges: number;
  swallows: number;
  /** Objects eaten, and their share of everything in the city. */
  eaten: number;
  rec: BlackTrack | null;
};
