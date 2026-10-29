/**
 * Plans (seed and playback rate) and records a Territory Wars show off the main thread.
 */
import {
  planShow,
  runShow,
  type TerritoryPlanInput,
  type TerritoryShow,
  type TerritoryShowResult,
} from '../engine/territory/show';

export type TerritoryRequest = { id: number; input: TerritoryPlanInput };
export type TerritoryResponse =
  | { id: number; ok: true; config: TerritoryShow; result: TerritoryShowResult }
  | { id: number; ok: false; message: string };

const scope = self as unknown as {
  postMessage(message: TerritoryResponse, transfer: Transferable[]): void;
  onmessage: ((e: MessageEvent<TerritoryRequest>) => void) | null;
};

scope.onmessage = (e) => {
  const { id, input } = e.data;
  try {
    // Big long-video wars take longer to play: fewer tries.
    const config = planShow(input, input.ids.length > 9 ? 2 : 3);
    const result = runShow(config, { record: true });
    const transfer = result.rounds.flatMap((r) =>
      r.rec
        ? [
            r.rec.changeStart.buffer,
            r.rec.cells.buffer,
            r.rec.owners.buffer,
            r.rec.stats.buffer,
            r.rec.taken.buffer,
          ]
        : [],
    );
    scope.postMessage({ id, ok: true, config, result }, transfer);
  } catch (err) {
    scope.postMessage({ id, ok: false, message: err instanceof Error ? err.message : String(err) }, []);
  }
};
