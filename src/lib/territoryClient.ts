import type { TerritoryPlanInput } from '../engine/territory/show';
import type { TerritoryRequest, TerritoryResponse } from '../workers/territory.worker';

type Ok = Extract<TerritoryResponse, { ok: true }>;

/** Promise wrapper around a dedicated Territory Wars worker. */
export class TerritoryClient {
  private worker = new Worker(new URL('../workers/territory.worker.ts', import.meta.url), { type: 'module' });
  private seq = 0;
  private pending = new Map<number, { resolve: (r: Ok) => void; reject: (e: Error) => void }>();

  constructor() {
    this.worker.onmessage = (e: MessageEvent<TerritoryResponse>) => {
      const p = this.pending.get(e.data.id);
      if (!p) return;
      this.pending.delete(e.data.id);
      if (e.data.ok) p.resolve(e.data);
      else p.reject(new Error(e.data.message));
    };
  }

  run(input: TerritoryPlanInput): Promise<Ok> {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, input } satisfies TerritoryRequest);
    });
  }

  dispose(): void {
    this.worker.terminate();
    this.pending.clear();
  }
}
