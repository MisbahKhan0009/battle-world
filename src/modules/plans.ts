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

export const PLANS: Record<string, GamePlan> = {};
