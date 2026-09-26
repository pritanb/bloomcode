import type { FastifyInstance } from 'fastify';
import { dirname } from 'node:path';
import { ApiError } from '../../integrations/local-api.js';
import type { Api } from '../../integrations/generate.js';
import type { TutorSettings } from '../../shared/tutor.js';
import { CodexWorker, TutorSettingsFile, tutorSettingsSchema } from './worker.js';

const WORKER_HEADER = 'x-tutor-worker';
export interface TutorControl {
  status(): ReturnType<CodexWorker['status']>;
  active(): boolean;
  wake(): void;
}

// The worker calls the app's own routes in-process, with the same bearer
// credential and validation as the MCP adapter; nothing listens on a socket.
function injectApi(app: FastifyInstance, token: string): Api {
  return {
    async request(method, path, body, idempotencyKey) {
      const response = await app.inject({
        method: method as 'GET',
        url: path,
        payload: body === undefined ? undefined : JSON.stringify(body),
        headers: {
          authorization: `Bearer ${token}`,
          [WORKER_HEADER]: '1',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
        },
      });
      let result: unknown;
      try {
        result = response.json();
      } catch {
        throw new ApiError(
          'INVALID_RESPONSE',
          'Local API returned invalid JSON.',
          response.statusCode,
        );
      }
      if (response.statusCode >= 400) {
        const error = (result as { error?: { code?: string; message?: string } })?.error;
        throw new ApiError(
          error?.code ?? 'HTTP_ERROR',
          error?.message ?? 'Local API request failed.',
          response.statusCode,
        );
      }
      return result;
    },
  };
}

export function registerTutor(
  app: FastifyInstance,
  dbPath: string,
  token: string,
  clock: () => Date,
): TutorControl {
  const settings = new TutorSettingsFile(dbPath === ':memory:' ? null : dirname(dbPath));
  const worker = new CodexWorker(settings, injectApi(app, token), clock);
  app.addHook('onReady', async () => {
    worker.start();
  });
  app.addHook('onClose', async () => {
    worker.stop();
  });
  // Any write can create tutor work, so wake the worker after each one it did not make itself.
  app.addHook('onResponse', async (req, reply) => {
    if (
      !['GET', 'HEAD'].includes(req.method) &&
      reply.statusCode < 400 &&
      !req.headers[WORKER_HEADER]
    )
      worker.wake();
  });
  app.get('/api/tutor', () => ({ settings: settings.get(), status: worker.status() }));
  app.post('/api/tutor/settings', (req) => {
    const saved = settings.save(tutorSettingsSchema.parse(req.body) as TutorSettings);
    worker.reset();
    return { settings: saved, status: worker.status() };
  });
  app.post('/api/tutor/test', (req) =>
    worker.test(tutorSettingsSchema.parse(req.body) as TutorSettings),
  );
  return {
    status: () => worker.status(),
    active: () => worker.active(),
    wake: () => worker.wake(),
  };
}
