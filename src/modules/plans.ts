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
  'black-hole': {
    pitch: 'Like Hole.io: country holes roam a city and swallow everything, then each other.',
    howItPlays: [
      'A top-down city full of objects: trees, cars, lamps, houses, towers, each with a size.',
      'Every country is a hole that roams the city. Anything smaller than the hole that rolls over its edge falls in, and the hole grows by what it eats.',
      'A bigger hole swallows a smaller one. When time runs out, the biggest hole wins; a live leaderboard shows sizes.',
    ],
    simulation: [
      'Holes steer with a deterministic AI (seek the best nearby food, avoid bigger holes, chase smaller ones), seeded so the same seed replays exactly.',
      'Objects are rigid shapes; when an object’s footprint is mostly over a big enough hole it tips and falls in with a short physics animation (rotation and shrink).',
      'Every hole has the same speed and growth rules, so winners can be relabelled for freshness; the city layout and round length are fitted from probe runs.',
    ],
    video: [
      'Shorts of 40 to 58 s at a tight top-down camera on the leader; long videos of 2 to 3 minutes with a wider city.',
      'Thumbnail: the city with all holes small at the start and “WHICH HOLE WINS?”.',
    ],
    steps: [
      'City generator (blocks, roads, object sizes) and the swallow rule with tests (nothing larger than a hole ever falls in).',
      'Hole AI and growth; holes-eating-holes rules and ties.',
      'Renderer with falling animations and a size leaderboard; planner, autopilot renderer, preview.',
    ],
  },
  'paper-land': {
    pitch: 'Like Paper.io: flags paint trails to claim land, and cutting a trail knocks them out.',
    howItPlays: [
      'Every country starts with a small square of land on a big board.',
      'Moving outside its land a flag leaves a trail; returning home closes the loop and fills everything inside with its color.',
      'Crossing another flag’s trail eliminates that flag. The most land (or the last flag left) wins, with a live share-of-board leaderboard.',
    ],
    simulation: [
      'Grid-based and deterministic: movement at fixed ticks, flood fill to claim enclosed areas, trail-cut checks every tick.',
      'Steering AI per flag (go out, loop back, take risks when far ahead or behind), seeded; every flag uses the same rules, so winners can be relabelled for freshness.',
      'Round length fitted by board size and speed from probe runs.',
    ],
    video: [
      'Shorts of 40 to 58 s; long videos of 3 minutes on a bigger board with more flags.',
      'Thumbnail: the empty board with starting squares and “WHO CLAIMS THE MOST LAND?”.',
    ],
    steps: [
      'Board, movement and flood-fill claiming with tests (claimed area always matches the grid).',
      'AI and elimination rules; probe-based length fitting.',
      'Renderer (flag-textured land, glowing trails), planner, autopilot renderer, preview.',
    ],
  },
};
