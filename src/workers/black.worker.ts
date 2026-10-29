/**
 * Plans (cities on a clock, heats) and records a Black Hole show off the main thread.
 */
import {
  planShow,
  runShow,
  type BlackPlanInput,
  type BlackShow,
  type BlackShowResult,
} from '../engine/black/show';

export type BlackRequest = { id: number; input: BlackPlanInput };
export type BlackResponse =
  | { id: number; ok: true; config: BlackShow; result: BlackShowResult }
  | { id: number; ok: false; message: string };

const scope = self as unknown as {
  postMessage(message: BlackResponse, transfer: Transferable[]): void;
  onmessage: ((e: MessageEvent<BlackRequest>) => void) | null;
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
