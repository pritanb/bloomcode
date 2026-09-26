// Attempt records and their public views; shared by every feature that reads attempts.
import { z } from 'zod';
import type { Attempt } from '../../shared/contracts.js';
import { conflict } from '../db/errors.js';
export interface AttemptRecord extends Attempt {
  context: 'mixed' | 'targeted' | 'review';
  gapSeconds: number;
  sourceKey?: string;
  importId?: string;
}
export const version = z.number().int().min(1);
export function studyDate(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  return ['year', 'month', 'day'].map((k) => parts.find((p) => p.type === k)!.value).join('-');
}
export function attemptView(a: AttemptRecord): Attempt {
  const {
    context: _context,
    gapSeconds: _gap,
    sourceKey: _source,
    importId: _import,
    ...publicAttempt
  } = a;
  return publicAttempt;
}
export function reflectionSafeView(a: AttemptRecord, hideReflection: boolean): Attempt {
  const view = attemptView(a);
  if (hideReflection) {
    delete view.mistakeLabels;
    delete view.takeaway;
  }
  return view;
}
export function newestAttempt(a: Attempt, b: Attempt): number {
  return (
    (b.finishedAt ?? b.startedAt).localeCompare(a.finishedAt ?? a.startedAt) ||
    b.id.localeCompare(a.id)
  );
}
export function checkVersion(a: { version: number }, v: number) {
  if (a.version !== v) throw conflict();
}
export const outcome = z.enum(['solved', 'not_solved', 'stopped']);
export const help = z.enum(['none', 'small', 'major', 'solution', 'unknown']);
export const seconds = z.number().int().min(0).max(604800).nullable();
