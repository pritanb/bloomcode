// Learning-insight records (jobs, observations, reports, topic analysis) stay as JSON:
// each kind is checked by learningRecordSchema and they are always read whole.
import { type Db, many, maybe, run } from '../db/db.js';
export function learningRecords<T>(db: Db, kind?: string): T[] {
  return many<{ data: string }>(
    db,
    `SELECT data FROM learning_insights ${kind ? "WHERE json_extract(data, '$.kind') = ?" : ''} ORDER BY rowid`,
    ...(kind ? [kind] : []),
  ).map((r) => JSON.parse(r.data) as T);
}
export function learningRecord<T>(db: Db, id: string): T | undefined {
  const row = maybe<{ data: string }>(db, 'SELECT data FROM learning_insights WHERE id = ?', id);
  return row && (JSON.parse(row.data) as T);
}
export function putLearningRecord<T extends { id: string }>(db: Db, record: T): T {
  run(
    db,
    'INSERT INTO learning_insights (id, data) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET data = excluded.data',
    record.id,
    JSON.stringify(record),
  );
  return record;
}
