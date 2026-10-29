/**
 * Plans (duration fitting, heats) and records a Ring Escape show off the main thread.
 */
import {
  planShow,
  runShow,
  type RingsPlanInput,
  type RingsShow,
  type RingsShowResult,
} from '../engine/rings/show';

export type RingsRequest = { id: number; input: RingsPlanInput };
export type RingsResponse =
  | { id: number; ok: true; config: RingsShow; result: RingsShowResult }
  | { id: number; ok: false; message: string };

const scope = self as unknown as {
  postMessage(message: RingsResponse, transfer: Transferable[]): void;
  onmessage: ((e: MessageEvent<RingsRequest>) => void) | null;
};

scope.onmessage = (e) => {
  const { id, input } = e.data;
  try {
    const config = planShow(input, input.heats ? 2 : 4);
    const result = runShow(config, { record: true });
    const transfer = result.rounds.flatMap((r) => (r.rec ? [r.rec.data.buffer] : []));
    scope.postMessage({ id, ok: true, config, result }, transfer);
  } catch (err) {
    scope.postMessage({ id, ok: false, message: err instanceof Error ? err.message : String(err) }, []);
  }
};
