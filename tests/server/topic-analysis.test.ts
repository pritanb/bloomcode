import { expect, it } from 'vitest';
import { insert, one, openDb, run } from '../../src/server/db/db.js';
import { TopicAnalysis } from '../../src/server/topics/topic-analysis.js';
import { Insights } from '../../src/server/insights/service.js';
import { learningRecordSchema } from '../../src/shared/insights.js';

it('generates topics without attempts, embeddings or Learning Insights, preserving scores and refreshing only on request', () => {
  const db = openDb(':memory:'),
    clock = () => new Date(now);
  let now = Date.parse('2026-09-25T00:00:00Z');
  const topics = new TopicAnalysis(db, clock),
    learning = new Insights(db, clock, async () => {
      throw Error('Topic analysis must not need embeddings');
    });
  try {
    const topic = {
      id: 'arrays',
      name: 'Arrays',
      score: 2,
      version: 1,
      notes: '',
      lastReviewed: null,
      provisional: 1,
    };
    insert(db, 'topics', topic);
    const originalLearningFingerprint = learning.corpusFingerprint();
    topics.enable(true);
    expect(learning.enabled()).toBe(false);
    const work = topics.claim()!;
    expect(work.topics).toHaveLength(1);
    expect(topics.claim()).toBeNull();
    expect(() => topics.complete(work.job.claimId!, [])).toThrow('three distinct supplied topics');
    const priority = 'arrays';
    expect(() => topics.complete(work.job.claimId!, [priority], ['one', 'two'])).toThrow();
    topics.complete(work.job.claimId!, [priority], ['Arrays is 2/5, below the 4/5 target.']);
    expect(topics.status()).toMatchObject({
      status: 'done',
      report: { topicIds: [priority], reasons: ['Arrays is 2/5, below the 4/5 target.'] },
    });
    expect(one(db, "SELECT * FROM topics WHERE id = 'arrays'")).toEqual(topic);
    expect(learning.latestReport()).toBeNull();
    learning.put({ id: 'state', kind: 'state', enabled: true });
    learning.put({
      id: 'report-job',
      kind: 'job',
      attemptId: null,
      fingerprint: learning.corpusFingerprint(),
      status: 'failed',
      claimId: null,
      claimedAt: 0,
      error: 'Learning failure',
      model: null,
      durationMs: 0,
      limitation: '',
      evidenceIds: [],
      questionIds: [],
    });
    expect(topics.status().status).toBe('done');
    run(db, "UPDATE topics SET score = 3 WHERE id = 'arrays'");
    expect(learning.corpusFingerprint()).toBe(originalLearningFingerprint);
    expect(topics.status()).toMatchObject({ status: 'done' });
    expect(topics.claim()).toBeNull();
    now += 30 * 24 * 60 * 60 * 1000; // time alone never triggers a refresh
    expect(topics.status()).toMatchObject({ status: 'done', report: { topicIds: [priority] } });
    expect(topics.claim()).toBeNull();
    topics.retry();
    expect(topics.status().status).toBe('pending');
    const next = topics.claim()!;
    topics.fail(next.job.claimId!, 'Topic failure');
    expect(learning.jobs()[0].error).toBe('Learning failure');
    expect(topics.claim()).toBeNull();
    topics.retry();
    expect(learning.jobs()[0].status).toBe('failed');
    const running = topics.claim()!;
    expect(learningRecordSchema.parse(topics.record()).kind).toBe('topic_analysis');
    topics.recover(); // what startup does for a run interrupted by a restart
    expect(topics.record()).toMatchObject({ status: 'pending', claimId: null });
    expect(topics.claim()!.job.claimId).not.toBe(running.job.claimId);
  } finally {
    learning.stop();
    db.close();
  }
});

it('includes recent completed attempts and their score movements without changing saved evidence', () => {
  const db = openDb(':memory:');
  try {
    insert(db, 'topics', {
      id: 'graphs',
      name: 'Graphs',
      score: 2,
      version: 1,
      provisional: false,
    });
    insert(db, 'problems', {
      id: 'p',
      slug: 'p',
      title: 'P',
      url: 'https://leetcode.com/problems/p/',
      difficulty: 'Medium',
    });
    const attempt = {
      problemId: 'p',
      status: 'completed',
      context: 'targeted',
      version: 1,
      language: 'python',
      startedAt: '2026-09-24T00:00:00Z',
      studyDate: '2026-09-24',
      outcome: 'not_solved',
      help: 'small',
      evidence: 'near_transfer',
      confidence: 2,
      activeSeconds: 900,
    };
    insert(db, 'attempts', { ...attempt, id: 'a' });
    insert(db, 'attempts', { ...attempt, id: 'old', studyDate: '2026-07-01' });
    for (const attemptId of ['a', 'old'])
      run(db, "INSERT INTO attempt_topics (attemptId, topicId) VALUES (?, 'graphs')", attemptId);
    insert(db, 'score_decisions', {
      id: 'movement',
      topicId: 'graphs',
      attemptId: 'a',
      date: '2026-09-24',
      recordedAt: '2026-09-24T12:00:00Z',
      oldScore: 3,
      newScore: 2,
      rationale: '',
      evidence: 'near_transfer',
    });
    const saved = one(db, "SELECT * FROM attempts WHERE id = 'a'");
    const analysis = new TopicAnalysis(db, () => new Date('2026-09-25T00:00:00Z'));
    analysis.enable(true);
    expect(analysis.claim()!.topics[0]).toMatchObject({
      id: 'graphs',
      recentAttempts: [
        { outcome: 'not_solved', help: 'small', date: '2026-09-24', difficulty: 'Medium' },
      ],
      scoreMovements: [{ oldScore: 3, newScore: 2, attemptId: 'a' }],
    });
    expect(one(db, "SELECT * FROM attempts WHERE id = 'a'")).toEqual(saved);
  } finally {
    db.close();
  }
});
