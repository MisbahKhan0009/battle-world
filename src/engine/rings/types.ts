/** Ring Escape: world types. World units, origin at the rings' center, y grows downward. */

/** One ring: a thin circular wall with a single gap, turning at a constant rate. */
export type Ring = {
  /** Radius of the wall's centerline. */
  R: number;
  /** Half thickness of the wall (its ends are round caps of this radius). */
  w: number;
  /** Half-angle of the gap (radians). */
  gap: number;
  /** Gap center angle at t = 0, and its angular speed (rad/s, + = clockwise on screen). */
  phase: number;
  omega: number;
  /** Rainbow hue for drawing (degrees). */
  hue: number;
};

/** Fully resolved, serializable game input. The rings are regenerated from it deterministically. */
export type RingsConfig = {
  seed: number;
  /** Ball ids, one per competitor (labels only: every ball is physically identical). */
  ids: string[];
  /** Ball radius in world units. */
  radius: number;
  /** How many rings stand between the balls and freedom. */
  rings: number;
};

export type RingsEvent =
  | {
      t: number;
      type: 'hit';
      a: number;
      /** Other ball, or -1 for a ring. */
      b: number;
      kind: 'ball' | 'ring' | 'edge';
      impulse: number;
      x: number;
      y: number;
      /** Ring index for ring and edge hits. */
      ring?: number;
    }
  | { t: number; type: 'shatter'; ring: number; by: number; x: number; y: number };

/** Positions sampled at hz, laid out [frame][ball][x, y]. */
export type RingsTrackData = { hz: number; frames: number; n: number; data: Float32Array };

export type RingsResult = {
  config: RingsConfig;
  rings: Ring[];
  events: RingsEvent[];
  /** When each ring shattered (sim seconds), and which ball broke it. */
  shatterT: number[];
  shatterBy: number[];
  winnerIndex: number;
  winnerT: number;
  /** Start of the final slow motion (the last escape). */
  final2T: number | null;
  endT: number;
  rec: RingsTrackData | null;
};
