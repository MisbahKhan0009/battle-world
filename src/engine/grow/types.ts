/** Growing Ball: world types. World units, origin at the arena center, y grows downward. */

/** Fully resolved, serializable game input. */
export type GrowConfig = {
  seed: number;
  /** Ball ids, one per competitor (labels only: every ball starts identical). */
  ids: string[];
  /** Starting ball radius. */
  r0: number;
  /** Area a firm wall bounce adds, as a share of the arena's area. */
  growth: number;
};

export type GrowEvent =
  | {
      t: number;
      type: 'wall';
      i: number;
      x: number;
      y: number;
      impulse: number;
      /** Radius after growing. */
      r: number;
    }
  | {
      t: number;
      type: 'bump';
      a: number;
      b: number;
      impulse: number;
      x: number;
      y: number;
    };

/** Positions and radii sampled at hz, laid out [frame][ball][x, y, r]. */
export type GrowTrackData = { hz: number; frames: number; n: number; data: Float32Array };

export type GrowResult = {
  config: GrowConfig;
  events: GrowEvent[];
  winnerIndex: number;
  winnerT: number;
  /** Start of the final slow motion. */
  final2T: number | null;
  endT: number;
  /** How often the biggest ball changed (by a clear margin). */
  leadChanges: number;
  rec: GrowTrackData | null;
};
