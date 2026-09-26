// Topic scores and score decisions as the API shows them.
import type { ScoreDecision, Topic } from '../../shared/contracts.js';
import { type Db, many, one } from '../db/db.js';
export type TopicRow = Omit<Topic, 'lastMovement' | 'provisional'> & { provisional: number };
/** Score decisions with their topic's name. `where` may refer to the decision as `d`. */
export function decisions(db: Db, where = '', ...params: string[]): ScoreDecision[] {
  return many<ScoreDecision>(
    db,
    `SELECT d.id, d.topicId, t.name AS topicName, d.attemptId, d.oldScore, d.newScore, d.rationale,
       d.evidence, d.date, d.recordedAt
     FROM score_decisions d JOIN topics t ON t.id = d.topicId ${where}`,
    ...params,
  );
}
/** Newest first by study date, then by when it was recorded. */
export const NEWEST_DECISION = 'ORDER BY d.date DESC, d.recordedAt DESC';
export function topicView(db: Db, t: TopicRow): Topic {
  const [last] = decisions(
    db,
    `WHERE d.topicId = ? ${NEWEST_DECISION}, d.rowid DESC LIMIT 1`,
    t.id,
  );
  return { ...t, provisional: !!t.provisional, lastMovement: last ?? null };
}
export const topicRows = (db: Db, where = '', ...params: string[]) =>
  many<TopicRow>(db, `SELECT * FROM topics ${where} ORDER BY rowid`, ...params);
export const getTopic = (db: Db, id: string) =>
  one<TopicRow>(db, 'SELECT * FROM topics WHERE id = ?', id);
export const topics = (db: Db) => topicRows(db).map((t) => topicView(db, t));
