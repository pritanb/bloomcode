import { Worker } from 'node:worker_threads';
import { EMBEDDING_MODEL, EMBEDDING_REVISION } from '../../shared/insights.js';
export type Embed = (texts: string[]) => Promise<number[][]>;
export class LocalEmbeddings {
  private worker?: Worker;
  private sequence = 0;
  private pending = new Map<number, {resolve:(vectors:number[][])=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  constructor(private cacheDir: string) {}
  embed: Embed = texts => new Promise((resolve, reject) => {
    if (!this.worker) {
      this.worker = new Worker(new URL('./embedding-worker.mjs', import.meta.url), { workerData: {cacheDir:this.cacheDir, model:EMBEDDING_MODEL, revision:EMBEDDING_REVISION} });
      this.worker.on('message', ({id,vectors,error}) => {
        const request = this.pending.get(id); if (!request) return;
        clearTimeout(request.timer); this.pending.delete(id);
        if (error) request.reject(new Error(error)); else request.resolve(vectors);
      });
      this.worker.on('error', error => this.fail(error instanceof Error?error:new Error(String(error))));
      this.worker.on('exit', () => { if(this.pending.size)this.fail(new Error('Embedding worker stopped')); this.worker=undefined; });
    }
    const id = ++this.sequence;
    const timer = setTimeout(() => { this.fail(new Error('Embedding timed out. Check the model download and retry.')); void this.worker?.terminate(); }, 180_000);
    this.pending.set(id, {resolve,reject,timer}); this.worker.postMessage({id,texts});
  });
  private fail(error: Error) { for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(error);}this.pending.clear(); }
  async close() { this.fail(new Error('Application closed')); await this.worker?.terminate(); }
}
