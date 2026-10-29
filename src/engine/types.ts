export type ArenaShape = 'circle' | 'square' | 'rounded';
/** escape: flags leave through a rotating opening, last one inside wins. royale: flags damage each other. */
export type GameMode = 'escape' | 'royale';
export type DamageModel = 'impact' | 'fixed';

export type Fighter = {
  id: string;
  kind: 'country' | 'custom';
  iso2?: string;
  name: string;
  /** Flag URL (relative), `idb:<key>` for an uploaded image, or a data URL. */
  imageSrc: string;
  /** Hex color. Empty string means "auto" (extracted from the flag). */
  accent: string;
  hp: number;
  size: number;
  speed: number;
  attack: number;
};

export type Rules = {
  mode: GameMode;
  /** Escape mode: opening width (multiple of the average flag width), rotation speed and direction. */
  gap: { size: number; speedDeg: number; direction: 'cw' | 'ccw' };
  arena: ArenaShape;
  shrink: { enabled: boolean; startSec: number; rate: number };
  damageModel: DamageModel;
  /** Damage multiplier growth per second (linear): ramp(t) = 1 + damageRamp * t. */
  damageRamp: number;
  targetDurationSec: number | 'auto';
  seed: number;
};

export type Look = {
  aspect: '9:16' | '16:9' | '1:1';
  theme:
    | 'night'
    | 'neon'
    | 'paper'
    | 'space'
    | 'circuit'
    | 'asphalt'
    | 'daylight'
    | 'plum'
    | 'aurora'
    | 'ember'
    | 'peach'
    | 'mint'
    | 'kraft'
    | 'atlas'
    | 'parchment';
  title: string;
  subtitle: string;
  titleFont: 'display' | 'sans';
  titleSize: 'S' | 'M' | 'L';
  titlePosition: 'safe' | 'edge';
  showHpNumbers: boolean;
  showKillFeed: boolean;
  showCounter: boolean;
  showDamageNumbers: boolean;
  particles: boolean;
  screenShake: boolean;
  intro: boolean;
  outro: boolean;
  outroCta: string;
};

export type Preset = {
  id: string;
  name: string;
  fighters: Fighter[];
  rules: Rules;
  look: Look;
  balanced?: boolean;
  updatedAt: number;
};

export type SimEvent =
  | {
      t: number;
      type: 'hit';
      a: string;
      b: string;
      dmgA: number;
      dmgB: number;
      impact: number;
      x: number;
      y: number;
    }
  | {
      t: number;
      type: 'eliminate';
      id: string;
      by?: string;
      x: number;
      y: number;
      /** Escape mode: the flag left through the opening with this velocity. */
      escaped?: boolean;
      vx?: number;
      vy?: number;
    }
  | { t: number; type: 'final2' }
  | { t: number; type: 'winner'; id: string };

/** Fully resolved, serializable input to the simulation. */
export type SimConfig = {
  mode: GameMode;
  fighters: { id: string; hp: number; size: number; speed: number; attack: number }[];
  /** Escape mode: base half-angle of the opening (radians) and rotation speed (rad/s, signed). */
  gap: { halfAngle: number; omega: number };
  arena: ArenaShape;
  shrink: { enabled: boolean; startSec: number; rate: number };
  damageModel: DamageModel;
  baseDamage: number;
  damageRamp: number;
  seed: number;
  /**
   * Optional target winner time (sim seconds). When set, a deterministic pacing "director"
   * scales damage so the shared HP pool follows a planned curve, and fighters hunt each other
   * once the target passes. This keeps tuned battles close to their target length.
   */
  targetWinSec?: number;
};

/** Positions and HP sampled at TRACK_HZ, laid out [frame][fighter][x, y, hp]. */
export type Track = {
  hz: number;
  frames: number;
  n: number;
  data: Float32Array;
  /** Arena scale per frame (1 = full size). */
  arena: Float32Array;
  /** Escape mode: opening center angle (unwrapped, radians) and half-angle per frame. */
  gapAngle: Float32Array;
  gapHalf: Float32Array;
};

export type SimResult = {
  config: SimConfig;
  events: SimEvent[];
  radii: Float32Array;
  maxHp: Float32Array;
  winnerIndex: number;
  winnerT: number;
  final2T: number | null;
  endT: number;
  /** Elimination sim-time per fighter (Infinity if never eliminated). */
  elimT: Float64Array;
  /** Eliminations credited per fighter. */
  kills: Uint16Array;
  /** Average pacing-director damage multiplier (1 when the director is off). */
  meanDirector: number;
  track: Track | null;
};
