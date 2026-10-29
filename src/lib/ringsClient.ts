import type { RingsPlanInput } from '../engine/rings/show';
import type { RingsRequest, RingsResponse } from '../workers/rings.worker';

type Ok = Extract<RingsResponse, { ok: true }>;

/** Promise wrapper around a dedicated Ring Escape worker. */
export class RingsClient {
  private worker = new Worker(new URL('../workers/rings.worker.ts', import.meta.url), { type: 'module' });
  private seq = 0;
  private pending = new Map<number, { resolve: (r: Ok) => void; reject: (e: Error) => void }>();

  constructor() {
    this.worker.onmessage = (e: MessageEvent<RingsResponse>) => {
      const p = this.pending.get(e.data.id);
      if (!p) return;
      this.pending.delete(e.data.id);
      if (e.data.ok) p.resolve(e.data);
      else p.reject(new Error(e.data.message));
    };
  }

  run(input: RingsPlanInput): Promise<Ok> {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, input } satisfies RingsRequest);
    });
  }

  dispose(): void {
    this.worker.terminate();
    this.pending.clear();
  }
}
