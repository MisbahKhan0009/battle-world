import type { PaperPlanInput } from '../engine/paper/show';
import type { PaperRequest, PaperResponse } from '../workers/paper.worker';

type Ok = Extract<PaperResponse, { ok: true }>;

/** Promise wrapper around a dedicated Paper Land worker. */
export class PaperClient {
  private worker = new Worker(new URL('../workers/paper.worker.ts', import.meta.url), { type: 'module' });
  private seq = 0;
  private pending = new Map<number, { resolve: (r: Ok) => void; reject: (e: Error) => void }>();

  constructor() {
    this.worker.onmessage = (e: MessageEvent<PaperResponse>) => {
      const p = this.pending.get(e.data.id);
      if (!p) return;
      this.pending.delete(e.data.id);
      if (e.data.ok) p.resolve(e.data);
      else p.reject(new Error(e.data.message));
    };
  }

  run(input: PaperPlanInput): Promise<Ok> {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, input } satisfies PaperRequest);
    });
  }

  dispose(): void {
    this.worker.terminate();
    this.pending.clear();
  }
}
