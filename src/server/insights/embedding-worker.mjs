import { parentPort, workerData } from 'node:worker_threads';
import { pipeline, env } from '@huggingface/transformers';
env.cacheDir = workerData.cacheDir;
env.allowLocalModels = false;
let extractor;
let queue = Promise.resolve();
parentPort.on('message', (message) => {
  queue = queue.then(() => processMessage(message));
});
async function processMessage({ id, texts }) {
  try {
    extractor ??= await pipeline('feature-extraction', workerData.model, {
      revision: workerData.revision,
      dtype: 'q8',
      device: 'cpu',
    });
    const vectors = [];
    for (const text of texts) {
      // Tokenize first; recursively split until every piece fits the model's
      // 256-token limit. Never silently discard the tail of an observation.
      const split = (value) => {
        const tokens = extractor.tokenizer(value, { truncation: false });
        if (tokens.input_ids.size <= 256) return [value];
        const mid = Math.floor(value.length / 2);
        return [...split(value.slice(0, mid)), ...split(value.slice(mid))];
      };
      const chunks = split(text);
      const output = await extractor(chunks, { pooling: 'mean', normalize: true });
      const rows = output.tolist();
      const mean = rows[0].map((_, i) => rows.reduce((sum, row) => sum + row[i], 0) / rows.length);
      const norm = Math.hypot(...mean);
      vectors.push(mean.map((n) => n / (norm || 1)));
    }
    parentPort.postMessage({ id, vectors });
  } catch (error) {
    extractor = undefined;
    parentPort.postMessage({
      id,
      error: error instanceof Error ? error.message : 'Embedding failed',
    });
  }
}
