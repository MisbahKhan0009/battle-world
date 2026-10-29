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
};
