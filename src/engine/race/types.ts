/** Marble Race: world types. World units, y grows downward (the race goes down the screen). */

/** Static segment (a wall, ramp or divider) with a half thickness. */
export type Seg = { ax: number; ay: number; bx: number; by: number; r: number };

/** Round obstacle: a peg, or a bumper that kicks marbles away. */
export type Peg = { x: number; y: number; r: number; bumper: boolean };

/** A bar rotating about its center at a constant angular speed (rad/s, + = clockwise on screen). */
export type Spinner = { cx: number; cy: number; half: number; r: number; omega: number; phase: number };

export type SectionKind = 'ramps' | 'pegs' | 'spinners' | 'funnel' | 'fork';

export type Section = { kind: SectionKind; y0: number; y1: number };

export type Track = {
  width: number;
  segs: Seg[];
  pegs: Peg[];
  spinners: Spinner[];
  sections: Section[];
  /** Marbles start above this line. */
  startY: number;
  /** Finish line (center crossing counts); Infinity on probe tracks without a finish. */
  finishY: number;
  /** Lowest point of the track. */
  bottomY: number;
};

/** Fully resolved, serializable race input. The track is regenerated from it deterministically. */
export type RaceConfig = {
  seed: number;
  /** Marble ids, one per competitor (labels only: every marble is physically identical). */
  ids: string[];
  /** Marble radius in world units. */
  radius: number;
  /** Sections before the finish line. */
  sections: number;
};

export type RaceEvent =
  | {
      t: number;
      type: 'hit';
      a: number;
      /** Other marble, or -1 for the track. */
      b: number;
      kind: 'marble' | 'wall' | 'peg' | 'bumper' | 'spinner';
      impulse: number;
      x: number;
      y: number;
      /** Index of the bumper (in track.pegs) for bumper hits. */
      obstacle?: number;
    }
  | { t: number; type: 'finish'; i: number; place: number };

/** Positions and spin sampled at hz, laid out [frame][marble][x, y, angle]. */
export type RaceTrackData = { hz: number; frames: number; n: number; data: Float32Array };

export type RaceResult = {
  config: RaceConfig;
  track: Track;
  events: RaceEvent[];
  /** Finish time per marble (Infinity if it had not finished when the recording ended). */
  finishT: Float64Array;
  /** Marble indices in finishing order (only those that finished). */
  order: number[];
  winnerIndex: number;
  winnerT: number;
  /** Start of the photo-finish slow motion, or null for a clear win. */
  final2T: number | null;
  endT: number;
  /** How often the lead changed hands during the race. */
  leadChanges: number;
  rec: RaceTrackData | null;
};
