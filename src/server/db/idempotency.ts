import { createHash } from 'node:crypto';
import { z } from 'zod';
import { Store } from './store.js';
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
  s: Store,
  scope: string,
  key: unknown,
  payload: unknown,
  fn: () => T,
): T {
  const id = z.string().min(1).max(200).parse(key),
    fingerprint = createHash('sha256').update(canonical({ scope, payload })).digest('hex');
  return s.transaction(() => {
    const prior = s.sql
      .prepare('SELECT fingerprint,response FROM idempotency WHERE id=?')
      .get(id) as { fingerprint: string; response: string } | undefined;
    if (prior) {
      if (prior.fingerprint !== fingerprint)
        throw conflict('Idempotency key was used with a different request');
      return JSON.parse(prior.response) as T;
    }
    const response = fn();
    s.sql
      .prepare('INSERT INTO idempotency(id,fingerprint,response) VALUES (?,?,?)')
      .run(id, fingerprint, JSON.stringify(response));
    return response;
  });
}
