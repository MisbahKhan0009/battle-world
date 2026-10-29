/**
 * Build plans for the games that are coming next. Each follows the same principles as the ready
 * games: deterministic physics from a seed (same seed, same video), countries as identical
 * competitors so winners never repeat, a length fitted to the format without bending the
 * physics, spoiler-free thumbnails and a per-game schedule.
 */
export type GamePlan = {
  /** One-line pitch. */
  pitch: string;
  howItPlays: string[];
  simulation: string[];
  video: string[];
  steps: string[];
};

export const PLANS: Record<string, GamePlan> = {
  'territory-wars': {
    pitch: 'Countries conquer a pixel world map, tile by tile.',
    howItPlays: [
      'A pixel world map where every country starts on its real land.',
      'Borders push back and forth each tick; strength depends on size and a little luck, and small countries can form surprise comebacks.',
      'A live leaderboard shows the share of the world each flag holds; last country standing (or the biggest when time runs out) wins.',
    ],
    simulation: [
      'Deterministic cellular automaton on a fixed grid, seeded PRNG for every border contest.',
      'Each country’s “army” is identical per tile, so the winner is decided by geography and seeded luck, and can be relabelled for freshness like the other games.',
      'Length is fitted by the number of ticks per second of video, picked from a probe run.',
    ],
    video: [
      'Long videos of 3 to 4 minutes are the main format (time-lapse of the whole war); Shorts show the final 50 seconds of a war.',
      'Thumbnail: the starting map with “WHO TAKES OVER THE WORLD?”.',
    ],
    steps: [
      'Map rasterizer (country shapes to a grid) and the automaton with tests (territory always sums to the map).',
      'Renderer: flag-textured territories, border flashes, share-of-world leaderboard.',
      'Planner, autopilot renderer and preview page.',
    ],
  },
};
