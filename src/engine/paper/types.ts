/** Paper Land: world types. The board is a square grid of cells, (0, 0) top left. */

/** Fully resolved, serializable game input. */
export type PaperConfig = {
  seed: number;
  /** Flag ids, one per competitor (labels only: every flag plays by the same rules). */
  ids: string[];
  /** Board side in cells. */
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
      /** Center of the claimed area (cells). */
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
 * Recorded game at one frame per move tick. `pos` is [tick][flag][x, y] in cells, `state` is
 * [tick][flag] (0 out of the game, 1 inside its land, 2 outside drawing a trail). The land map is
 * stored only when it changes: `grids` holds one board (owner + 1, 0 = nobody) per `gridTicks`.
 */
export type PaperTrack = {
  hz: number;
  ticks: number;
  n: number;
  size: number;
  pos: Int16Array;
  state: Uint8Array;
  gridTicks: Int32Array;
  grids: Uint8Array;
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
