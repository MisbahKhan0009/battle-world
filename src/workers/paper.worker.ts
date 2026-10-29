/**
 * Plans (heats, the liveliest start) and records a Paper Land show off the main thread.
 */
import {
  planShow,
  runShow,
  type PaperPlanInput,
  type PaperShow,
  type PaperShowResult,
} from '../engine/paper/show';

export type PaperRequest = { id: number; input: PaperPlanInput };
export type PaperResponse =
  | { id: number; ok: true; config: PaperShow; result: PaperShowResult }
  | { id: number; ok: false; message: string };

const scope = self as unknown as {
  postMessage(message: PaperResponse, transfer: Transferable[]): void;
  onmessage: ((e: MessageEvent<PaperRequest>) => void) | null;
};

scope.onmessage = (e) => {
  const { id, input } = e.data;
  try {
    const config = planShow(input, input.heats ? 2 : 4);
    const result = runShow(config, { record: true });
    const transfer = result.rounds.flatMap((r) =>
      r.rec
        ? [
            r.rec.pos,
            r.rec.dir,
            r.rec.state,
            r.rec.changeT,
            r.rec.changeStart,
            r.rec.cells,
            r.rec.owners,
          ].map((a) => a.buffer)
        : [],
    );
    scope.postMessage({ id, ok: true, config, result }, transfer);
  } catch (err) {
    scope.postMessage({ id, ok: false, message: err instanceof Error ? err.message : String(err) }, []);
  }
};
