import { afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../src/server/core/app.js';
import { LocalApi } from '../../src/integrations/local-api.js';
import { interviewHelp } from '../../src/server/tutor/interview-help.js';
import type { Attempt } from '../../src/shared/contracts.js';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});
const body = {
  stuckAt: '12:30',
  newStuck: true,
  language: 'python',
  code: 'def two_sum(nums, target): ...',
  messages: [{ role: 'user', text: 'I cannot beat O(n^2).' }],
};
const reply = {
  reply: 'What have you seen so far?',
  hint: 'Recall seen values.',
  level: 'small',
  analysis: 'Brute force works.',
};

test('interview help sends only the problem and current work, and only mid-attempt', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lc-interview-help-'));
  const app = await createApp({ dbPath: join(dir, 'leetcode.sqlite') });
  const url = await app.listen({ port: 0, host: '127.0.0.1' });
  cleanups.push(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });
  const api = new LocalApi({ dataDir: dir, baseUrl: url });
  const p = (await api.request('POST', '/api/problems', {
    title: 'Two Sum',
    url: 'https://leetcode.com/problems/two-sum/',
  })) as { id: string };
  const started = (await api.request('POST', '/api/attempts', {
    problemId: p.id,
    context: 'mixed',
  })) as Attempt;
  await api.request('PATCH', `/api/attempts/${started.id}/draft`, {
    version: started.version,
    notes: 'private notes',
  });

  // The default provider is off: the route explains where to turn Bloom on.
  await expect(api.request('POST', `/api/attempts/${started.id}/help`, body)).rejects.toThrow(
    'Choose a tutor in Settings',
  );

  const help = vi.fn(async (_context: unknown) => ({ text: JSON.stringify(reply) }));
  const db = app.tutorJobs.db;
  expect(await interviewHelp(db, started.id, body, help)).toEqual(reply);
  expect(help).toHaveBeenCalledWith({
    problem: { title: 'Two Sum', url: 'https://leetcode.com/problems/two-sum/', difficulty: null },
    ...body,
  });
  await expect(
    interviewHelp(db, started.id, body, async () => ({ text: '{"reply":"Here is the code"}' })),
  ).rejects.toThrow('Bloom could not answer');

  const saved = (await api.request('GET', `/api/attempts/${started.id}`)) as Attempt;
  await api.request(
    'POST',
    `/api/attempts/${started.id}/finish`,
    {
      version: saved.version,
      outcome: 'solved',
      help: 'small',
      activeSeconds: 900,
      code: body.code,
      notes: saved.notes,
      requestReview: false,
    },
    `finish-${started.id}`,
  );
  await expect(interviewHelp(db, started.id, body, help)).rejects.toThrow('attempt in progress');
});
