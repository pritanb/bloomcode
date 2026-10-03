// Download and apply the LeetCode problem bank in the background. Estimates and the
// bank's problems change in one transaction; saved attempts and existing problems'
// titles, notes and tags are never overwritten (the import is additive by slug).
import type { FastifyInstance } from 'fastify';
import {
  BANK_LIST,
  buildProblemBank,
  fetchLeetCodeQuestions,
  type ProblemBank,
} from '../../integrations/problem-bank.js';
import { type Db, maybe, run, transaction } from '../db/db.js';
import { contestRatings, forgetEstimates } from '../topics/ratings.js';
import { applyImport } from './import.js';

export interface BankStatus {
  state: 'idle' | 'running' | 'done' | 'failed';
  message: string | null;
  problems: number;
  method: string | null;
  fittedAt: string | null;
}

export function applyProblemBank(db: Db, bank: ProblemBank, clock: () => Date) {
  return transaction(db, () => {
    const fittedAt = clock().toISOString();
    run(db, 'DELETE FROM rating_estimates');
    const insert = db.prepare(
      'INSERT INTO rating_estimates (slug, rating, method, fittedAt) VALUES (?, ?, ?, ?)',
    );
    for (const e of bank.estimates) insert.run(e.slug, e.rating, bank.model.method, fittedAt);
    run(db, 'DELETE FROM problem_popularity');
    const popular = db.prepare(
      'INSERT INTO problem_popularity (slug, likes, dislikes, percentile) VALUES (?, ?, ?, ?)',
    );
    for (const p of bank.popularity) popular.run(p.slug, p.likes, p.dislikes, p.percentile);
    forgetEstimates(db);
    return applyImport(db, bank.payload, clock);
  });
}

export function bankSummary(db: Db) {
  const fitted = maybe<{ method: string; fittedAt: string }>(
    db,
    'SELECT method, fittedAt FROM rating_estimates LIMIT 1',
  );
  const problems =
    maybe<{ n: number }>(
      db,
      `SELECT count(*) AS n FROM list_memberships m JOIN lists l ON l.id = m.listId
       WHERE lower(l.name) = lower(?)`,
      BANK_LIST,
    )?.n ?? 0;
  return { problems, method: fitted?.method ?? null, fittedAt: fitted?.fittedAt ?? null };
}

export class ProblemBankService {
  private state: BankStatus['state'] = 'idle';
  private message: string | null = null;
  constructor(
    private db: Db,
    private clock: () => Date,
    private fetcher: typeof fetch = fetch,
  ) {}
  status(): BankStatus {
    return { state: this.state, message: this.message, ...bankSummary(this.db) };
  }
  /** Start a refresh unless one is running. Resolves when it finishes (or fails). */
  refresh(): Promise<void> {
    if (this.state === 'running') return Promise.resolve();
    this.state = 'running';
    this.message = 'Downloading LeetCode problems…';
    return (async () => {
      try {
        const questions = await fetchLeetCodeQuestions(this.fetcher);
        this.message = 'Rating problems…';
        const bank = buildProblemBank(questions, contestRatings(), this.clock().toISOString());
        applyProblemBank(this.db, bank, this.clock);
        this.state = 'done';
        this.message = `Rated ${questions.length.toLocaleString('en')} LeetCode problems.`;
      } catch (error) {
        this.state = 'failed';
        this.message = `Couldn't update the problem bank. ${
          error instanceof Error ? error.message : ''
        }`.trim();
      }
    })();
  }
}

export function registerProblemBank(app: FastifyInstance, bank: ProblemBankService) {
  app.get('/api/problem-bank', () => bank.status());
  app.post('/api/problem-bank/refresh', () => {
    void bank.refresh();
    return bank.status();
  });
}
