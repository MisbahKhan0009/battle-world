/**
 * Runs duration tuning and the recorded simulation off the main thread.
 */
import { simulate } from '../engine/sim';
import { WINNER_HOLD_SEC } from '../engine/timeline';
import { tune, type TuneInput } from '../engine/tuning';
import type { SimConfig, SimResult } from '../engine/types';

export type SimRequest = { id: number; input: TuneInput };
export type SimResponse =
  | { id: number; ok: true; config: SimConfig; result: SimResult; tuneMs: number; error: number }
  | { id: number; ok: false; message: string };

const scope = self as unknown as {
  postMessage(message: SimResponse, transfer: Transferable[]): void;
  onmessage: ((e: MessageEvent<SimRequest>) => void) | null;
};

scope.onmessage = (e) => {
  const { id, input } = e.data;
  try {
    const t0 = performance.now();
    const tuned = tune(input);
    const tuneMs = performance.now() - t0;
    const result = simulate(tuned.config, { record: true, holdSec: WINNER_HOLD_SEC + 1 });
    const transfer: Transferable[] = result.track
      ? [result.track.data.buffer, result.track.arena.buffer]
      : [];
    scope.postMessage({ id, ok: true, config: tuned.config, result, tuneMs, error: tuned.error }, transfer);
  } catch (err) {
    scope.postMessage({ id, ok: false, message: err instanceof Error ? err.message : String(err) }, []);
  }
};
