import type { GrowPlanInput } from '../engine/grow/show';
import type { GrowRequest, GrowResponse } from '../workers/grow.worker';

type Ok = Extract<GrowResponse, { ok: true }>;

/** Promise wrapper around a dedicated Growing Ball worker. */
export class GrowClient {
  private worker = new Worker(new URL('../workers/grow.worker.ts', import.meta.url), { type: 'module' });
  private seq = 0;
  private pending = new Map<number, { resolve: (r: Ok) => void; reject: (e: Error) => void }>();

  constructor() {
    this.worker.onmessage = (e: MessageEvent<GrowResponse>) => {
      const p = this.pending.get(e.data.id);
      if (!p) return;
      this.pending.delete(e.data.id);
      if (e.data.ok) p.resolve(e.data);
      else p.reject(new Error(e.data.message));
    };
  }

  run(input: GrowPlanInput): Promise<Ok> {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, input } satisfies GrowRequest);
    });
  }

  dispose(): void {
    this.worker.terminate();
    this.pending.clear();
  }
}
