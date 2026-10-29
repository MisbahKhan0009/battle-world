import type { BlackPlanInput } from '../engine/black/show';
import type { BlackRequest, BlackResponse } from '../workers/black.worker';

type Ok = Extract<BlackResponse, { ok: true }>;

/** Promise wrapper around a dedicated Black Hole worker. */
export class BlackClient {
  private worker = new Worker(new URL('../workers/black.worker.ts', import.meta.url), { type: 'module' });
  private seq = 0;
  private pending = new Map<number, { resolve: (r: Ok) => void; reject: (e: Error) => void }>();

  constructor() {
    this.worker.onmessage = (e: MessageEvent<BlackResponse>) => {
      const p = this.pending.get(e.data.id);
      if (!p) return;
      this.pending.delete(e.data.id);
      if (e.data.ok) p.resolve(e.data);
      else p.reject(new Error(e.data.message));
    };
  }

  run(input: BlackPlanInput): Promise<Ok> {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, input } satisfies BlackRequest);
    });
  }

  dispose(): void {
    this.worker.terminate();
    this.pending.clear();
  }
}
