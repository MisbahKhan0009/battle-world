/**
 * Plans (duration tuning) and records a Marble Race off the main thread.
 */
import { planBestRace, runRace, type RacePlanInput } from '../engine/race/race';
import type { RaceConfig, RaceResult } from '../engine/race/types';

export type RaceRequest = { id: number; input: RacePlanInput };
export type RaceResponse =
  | { id: number; ok: true; config: RaceConfig; result: RaceResult }
  | { id: number; ok: false; message: string };

const scope = self as unknown as {
  postMessage(message: RaceResponse, transfer: Transferable[]): void;
  onmessage: ((e: MessageEvent<RaceRequest>) => void) | null;
};

scope.onmessage = (e) => {
  const { id, input } = e.data;
  try {
    // Shorts are cheap to probe, so try more candidate tracks for them.
    const config = planBestRace(input, input.maxSec < 80 ? 4 : 2);
    const result = runRace(config, { record: true });
    scope.postMessage({ id, ok: true, config, result }, result.rec ? [result.rec.data.buffer] : []);
  } catch (err) {
    scope.postMessage({ id, ok: false, message: err instanceof Error ? err.message : String(err) }, []);
  }
};
