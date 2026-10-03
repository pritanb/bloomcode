import type { FastifyInstance } from 'fastify';
import { dirname } from 'node:path';
import type { TutorSettings } from '../../shared/tutor.js';
import type { TutorJobs } from './jobs.js';
import { TutorWorker, TutorSettingsFile, tutorSettingsSchema } from './worker.js';

export interface TutorControl {
  status(): ReturnType<TutorWorker['status']>;
  active(): boolean;
  wake(): void;
}

export function registerTutor(
  app: FastifyInstance,
  dbPath: string,
  clock: () => Date,
  jobs: TutorJobs,
): TutorControl {
  const settings = new TutorSettingsFile(dbPath === ':memory:' ? null : dirname(dbPath));
  const worker = new TutorWorker(settings, jobs, clock);
  app.addHook('onReady', async () => {
    worker.start();
  });
  app.addHook('onClose', async () => {
    worker.stop();
  });
  // Any write can create tutor work (the worker's own saves happen in-process, not as requests).
  app.addHook('onResponse', async (req, reply) => {
    if (!['GET', 'HEAD'].includes(req.method) && reply.statusCode < 400) worker.wake();
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
