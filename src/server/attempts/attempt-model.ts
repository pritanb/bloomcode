// Attempt records and their public views; shared by every feature that reads attempts.
import { z } from 'zod';
import type { Attempt, Help, MistakeLabel, Outcome } from '../../shared/contracts.js';
import { type Db, many } from '../db/db.js';
import { conflict, missing } from '../db/errors.js';
export interface AttemptRecord extends Attempt {
  context: 'mixed' | 'targeted' | 'review';
  gapSeconds: number;
  sourceKey?: string;
  importId?: string;
}
interface AttemptRow extends Omit<
  AttemptRecord,
  'problem' | 'mistakeLabels' | 'takeaway' | 'needsGapDecision' | 'sourceKey' | 'importId'
> {
  mistakeLabels: string | null;
  takeaway: string | null;
  needsGapDecision: number;
  sourceKey: string | null;
  importId: string | null;
  problemTitle: string;
  problemUrl: string;
  problemDifficulty: string | null;
}
/** Newest first: the order history, recaps and notebooks show attempts in. */
export const NEWEST = 'ORDER BY coalesce(a.finishedAt, a.startedAt) DESC, a.id DESC';
/** Attempts with the problem they belong to. `where` may refer to the attempt as `a`. */
export function attempts(db: Db, where = '', ...params: (string | number)[]): AttemptRecord[] {
  return many<AttemptRow>(
    db,
    `SELECT a.*, p.title AS problemTitle, p.url AS problemUrl, p.difficulty AS problemDifficulty
     FROM attempts a JOIN problems p ON p.id = a.problemId ${where}`,
    ...params,
  ).map(
    ({
      problemTitle,
      problemUrl,
      problemDifficulty,
      mistakeLabels,
      takeaway,
      sourceKey,
      importId,
      ...a
    }) => ({
      ...a,
      problem: {
        id: a.problemId,
        title: problemTitle,
        url: problemUrl,
        difficulty: problemDifficulty,
      },
      needsGapDecision: !!a.needsGapDecision,
      outcome: a.outcome as Outcome | null,
      help: a.help as Help,
      ...(mistakeLabels !== null
        ? { mistakeLabels: JSON.parse(mistakeLabels) as MistakeLabel[] }
        : {}),
      ...(takeaway !== null ? { takeaway } : {}),
      ...(sourceKey !== null ? { sourceKey } : {}),
      ...(importId !== null ? { importId } : {}),
    }),
  );
}
export function getAttempt(db: Db, id: string): AttemptRecord {
  const [a] = attempts(db, 'WHERE a.id = ?', id);
  if (!a) throw missing();
  return a;
}
/** The attempt in progress, if any; at most one can be active or paused. */
export const activeAttempt = (db: Db): AttemptRecord | undefined =>
  attempts(db, "WHERE a.status != 'completed'")[0];
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
export function checkVersion(a: { version: number }, v: number) {
  if (a.version !== v) throw conflict();
}
export const outcome = z.enum(['solved', 'not_solved', 'stopped']);
export const help = z.enum(['none', 'small', 'major', 'solution', 'unknown']);
export const seconds = z.number().int().min(0).max(604800).nullable();
