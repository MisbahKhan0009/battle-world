import { create } from 'zustand';
import type { SimConfig } from '../engine/types';
import type { Scene, SceneFighter } from '../render/scene';

export type BattleStatus = 'idle' | 'tuning' | 'ready' | 'error';

type BattleState = {
  status: BattleStatus;
  error: string | null;
  scene: Scene | null;
  config: SimConfig | null;
  /** Scene fighters (with flag rasters) in sim order. */
  fighters: SceneFighter[] | null;
  winnerImage: ImageBitmap | null;
  tuneMs: number;
  /** Video-length error of the tuned battle (s). */
  tuneError: number;
};

export const useBattle = create<BattleState>(() => ({
  status: 'idle',
  error: null,
  scene: null,
  config: null,
  fighters: null,
  winnerImage: null,
  tuneMs: 0,
  tuneError: 0,
}));
