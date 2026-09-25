import { expect, it } from 'vitest';
import type { Attempt } from '../../src/shared/contracts';
import { AttemptQueue } from '../../src/web/attemptQueue';
const initial = { id: 'a1', version: 1, code: '' } as Attempt;
it('serialises timer and draft mutations using the version from the preceding commit', async () => {
  const queue = new AttemptQueue(initial);
  const versions: number[] = [];
  let unblock!: () => void;
  const first = queue.run(async (a) => {
    versions.push(a.version);
    await new Promise<void>((resolve) => {
      unblock = resolve;
    });
    return { ...a, version: a.version + 1, code: 'saved' };
  });
  const second = queue.run(async (a) => {
    versions.push(a.version);
    return { ...a, version: a.version + 1 };
  });
  await Promise.resolve();
  expect(versions).toEqual([1]);
  unblock();
  await Promise.all([first, second]);
  expect(versions).toEqual([1, 2]);
  expect(queue.current.version).toBe(3);
  expect(queue.current.code).toBe('saved');
});

it('blocks queued writes after an ambiguous failure until an explicit retry', async () => {
  const queue = new AttemptQueue(initial);
  let secondRan = false;
  const failed = queue.run(async () => {
    throw new Error('Not saved');
  });
  const later = queue.run(async (a) => {
    secondRan = true;
    return a;
  });
  await expect(failed).rejects.toThrow('Not saved');
  await expect(later).rejects.toThrow('Not saved');
  expect(secondRan).toBe(false);
  queue.clearError();
  await queue.run(async (a) => ({ ...a, version: 2 }));
  expect(queue.current.version).toBe(2);
});
