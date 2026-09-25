import type { Store } from '../db/store.js';
import type { LearningRecord } from '../../shared/insights.js';
import { ApiError } from '../db/errors.js';
/** Validate logical references that are stored inside JSON, then clear leases/cache. */
export function restoreLearningReferences(s: Store) {
  const rows = s.all<LearningRecord>('learning_insights');
  const observations = new Map(rows.filter((r) => r.kind === 'observation').map((r) => [r.id, r]));
  const invalid = (message: string): never => {
    throw new ApiError(400, 'SNAPSHOT_REFERENCE', message);
  };
  for (const record of rows) {
    if (record.kind === 'observation') {
      const a = s.get<{ id: string; problemId: string }>('attempts', record.attemptId);
      if (a.problemId !== record.problemId) invalid('Observation problem mismatch');
    }
    if (record.kind === 'correction') {
      const o = observations.get(record.observationId);
      if (
        !o ||
        o.attemptId !== record.attemptId ||
        o.sourceField !== record.sourceField ||
        o.excerpt !== record.excerpt
      )
        invalid('Correction does not match its source observation');
    }
    if (record.kind === 'report') {
      for (const id of record.evidenceIds)
        if (!observations.has(id)) invalid('Report refers to a missing observation');
      for (const finding of record.findings) {
        for (const id of finding.evidenceIds)
          if (!record.evidenceIds.includes(id))
            invalid('Finding cites evidence outside its report');
        for (const q of finding.suggestions) s.get('problems', q.problemId);
      }
    }
    if (record.kind === 'topic_analysis' && record.status === 'running')
      s.put('learning_insights', { ...record, status: 'pending', claimId: null, claimedAt: 0 });
    if (record.kind === 'job') {
      if (record.attemptId) {
        s.get('attempts', record.attemptId);
        if (record.id !== `attempt-${record.attemptId}`) invalid('Analysis job identity mismatch');
      } else if (record.id !== 'report-job') invalid('Report job identity mismatch');
      for (const id of record.evidenceIds)
        if (!observations.has(id)) invalid('Analysis job refers to a missing observation');
      for (const id of record.questionIds) s.get('problems', id);
      if (record.status === 'running')
        s.put('learning_insights', { ...record, status: 'pending', claimId: null, claimedAt: 0 });
    }
  }
  s.sql.prepare('DELETE FROM insight_embeddings').run();
}
