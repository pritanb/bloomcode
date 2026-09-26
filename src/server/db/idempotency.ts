import { createHash } from 'node:crypto';
import { z } from 'zod';
import { type Db, maybe, run, transaction } from './db.js';
import { conflict } from './errors.js';
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ':' + canonical(v))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
export function idempotent<T>(
  db: Db,
  scope: string,
  key: unknown,
  payload: unknown,
  fn: () => T,
): T {
  const id = z.string().min(1).max(200).parse(key),
    fingerprint = createHash('sha256').update(canonical({ scope, payload })).digest('hex');
  return transaction(db, () => {
    const prior = maybe<{ fingerprint: string; response: string }>(
      db,
      'SELECT fingerprint, response FROM idempotency WHERE id = ?',
      id,
    );
    if (prior) {
      if (prior.fingerprint !== fingerprint)
        throw conflict('Idempotency key was used with a different request');
      return JSON.parse(prior.response) as T;
    }
    const response = fn();
    run(
      db,
      'INSERT INTO idempotency (id, fingerprint, response) VALUES (?, ?, ?)',
      id,
      fingerprint,
      JSON.stringify(response),
    );
    return response;
  });
}
