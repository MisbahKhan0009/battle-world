/**
 * Paper Land: world types. The board is a square of `size` units; land is kept on a grid of one
 * cell per unit, (0, 0) top left. Flags move continuously and steer with a limited turn rate.
 */

/** Fully resolved, serializable game input. */
export type PaperConfig = {
  seed: number;
  /** Flag ids, one per competitor (labels only: every flag plays by the same rules). */
  ids: string[];
  /** Board side in land cells. */
  size: number;
  /** Game clock in sim seconds; the game ends sooner if only one flag is left. */
  limit: number;
};

/** How a flag was knocked out. */
export type PaperCause = 'trail' | 'head' | 'self' | 'wall' | 'land';

export type PaperEvent =
  | {
      t: number;
      type: 'claim';
      i: number;
      /** Cells gained, and how many of them were a rival's land. */
      cells: number;
      stolen: number;
      /** Center of the claimed area. */
      x: number;
      y: number;
    }
  | {
      t: number;
      type: 'cut';
      /** The flag knocked out, and who did it (-1 when nobody did). */
      i: number;
      by: number;
      cause: PaperCause;
      x: number;
      y: number;
    };

/**
 * Recorded game. Flags are sampled at `hz`: `pos` and `dir` are [frame][flag][x, y] (position,
 * and the unit heading), `state` is [frame][flag] (0 out of the game, 1 inside its land, 2 outside
 * drawing a trail). Land is stored as changes: change group g happens at `changeT[g]` and sets
 * cells `cells[changeStart[g] .. changeStart[g + 1])` to `owners` (owner + 1, 0 = nobody). Group 0
 * is the starting land.
 */
export type PaperTrack = {
  hz: number;
  frames: number;
  n: number;
  size: number;
  pos: Float32Array;
  dir: Float32Array;
  state: Uint8Array;
  changeT: Float32Array;
  changeStart: Int32Array;
  cells: Int32Array;
  owners: Uint8Array;
};

export type PaperResult = {
  config: PaperConfig;
  events: PaperEvent[];
  winnerIndex: number;
  winnerT: number;
  /** Start of the final slow motion. */
  final2T: number | null;
  endT: number;
  /** Land (cells) of every flag when the game ended. */
  land: number[];
  /** The game ended because only one flag was left (otherwise the clock ran out). */
  lastStanding: boolean;
  /** How often the biggest flag changed (by a clear margin), and how many flags were cut. */
  leadChanges: number;
  cuts: number;
  rec: PaperTrack | null;
};
