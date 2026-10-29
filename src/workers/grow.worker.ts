/**
 * Plans (duration fitting, heats) and records a Growing Ball show off the main thread.
 */
import {
  planShow,
  runShow,
  type GrowPlanInput,
  type GrowShow,
  type GrowShowResult,
} from '../engine/grow/show';

export type GrowRequest = { id: number; input: GrowPlanInput };
export type GrowResponse =
  | { id: number; ok: true; config: GrowShow; result: GrowShowResult }
  | { id: number; ok: false; message: string };

const scope = self as unknown as {
  postMessage(message: GrowResponse, transfer: Transferable[]): void;
  onmessage: ((e: MessageEvent<GrowRequest>) => void) | null;
};

scope.onmessage = (e) => {
  const { id, input } = e.data;
  try {
    const config = planShow(input, input.heats ? 1 : 3);
    const result = runShow(config, { record: true });
    const transfer = result.rounds.flatMap((r) => (r.rec ? [r.rec.data.buffer] : []));
    scope.postMessage({ id, ok: true, config, result }, transfer);
  } catch (err) {
    scope.postMessage({ id, ok: false, message: err instanceof Error ? err.message : String(err) }, []);
  }
};
