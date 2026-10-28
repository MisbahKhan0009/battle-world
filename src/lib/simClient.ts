import type { TuneInput } from '../engine/tuning';
import type { SimRequest, SimResponse } from '../workers/sim.worker';

type Ok = Extract<SimResponse, { ok: true }>;

/** Promise wrapper around a dedicated simulation worker. Newer requests supersede older ones. */
export class SimClient {
  private worker: Worker;
  private seq = 0;
  private pending = new Map<number, { resolve: (r: Ok) => void; reject: (e: Error) => void }>();

  constructor() {
    this.worker = new Worker(new URL('../workers/sim.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<SimResponse>) => {
      const p = this.pending.get(e.data.id);
      if (!p) return;
      this.pending.delete(e.data.id);
      if (e.data.ok) p.resolve(e.data);
      else p.reject(new Error(e.data.message));
    };
  }

  run(input: TuneInput): Promise<Ok> {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, input } satisfies SimRequest);
    });
  }

  dispose(): void {
    this.worker.terminate();
    this.pending.clear();
  }
}
