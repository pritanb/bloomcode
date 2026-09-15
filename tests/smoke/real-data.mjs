// Read-only reconciliation against the actual pilot; never changes study state.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { LocalApi } from '../../src/integrations/local-api.ts';
import { mapVerifiedLists, PINNED_REVISION } from '../../src/integrations/lists.ts';
const dir = process.env.DATA_DIR ?? join(homedir(), 'Library/Application Support/LeetcodeTutor-dev');
const { payload } = JSON.parse(readFileSync(process.env.REVIEW_FILE ?? join(dir, 'imports/mapped-review.json'), 'utf8'));
const api = new LocalApi();
const { tables } = await api.request('GET', '/api/export');
const bySource = name => new Map(tables[name].filter(row => row.importId === payload.importId).map(row => [row.sourceKey, row]));
const batch = tables.import_batches.find(row => row.id === payload.importId);
assert.deepEqual(batch.source, payload.source);
const records = bySource('import_records');
assert.equal(records.size, payload.records.length);
for (const row of payload.records) {
  const actual = records.get(row.sourceKey);
  assert.ok(actual, row.sourceKey);
  for (const field of ['tab', 'row', 'raw', 'status']) assert.deepEqual(actual[field], row[field], `${row.sourceKey}.${field}`);
}
const problems = new Map(tables.problems.map(row => [row.slug, row]));
for (const row of payload.problems) {
  const slug = new URL(row.url).pathname.split('/')[2];
  const actual = problems.get(slug);
  assert.ok(actual, slug);
  assert.equal(actual.title, row.title.trim(), slug); // Display-name whitespace is normalised; raw source was verified above.
  assert.equal(actual.legacyCompleted, row.legacyCompleted ?? false, slug);
  assert.equal(actual.notes, row.notes ?? '', `${slug} source notes`);
  const expectedLists = row.lists ?? [];
  const actualLists = tables.list_memberships.filter(link => link.problemId === actual.id).map(link => tables.lists.find(list => list.id === link.listId).name);
  for (const name of expectedLists) assert.ok(actualLists.includes(name), `${slug} missing list ${name}`);
}
const attempts = bySource('attempts');
assert.equal(attempts.size, payload.attempts.length);
for (const row of payload.attempts) {
  const actual = attempts.get(row.sourceKey);
  assert.ok(actual, row.sourceKey);
  for (const field of ['outcome', 'help', 'activeSeconds', 'notes', 'evidence']) assert.deepEqual(actual[field], row[field], `${row.sourceKey}.${field}`);
  assert.equal(actual.code, row.code ?? '');
  assert.equal(actual.studyDate, row.date);
  assert.equal(actual.nextReviewDate, row.nextReviewDate ?? null);
}
for (const row of payload.topics) {
  const actual = tables.topics.find(topic => topic.name === row.name);
  for (const field of ['score', 'notes', 'provisional']) assert.deepEqual(actual[field], row[field], `${row.name}.${field}`);
}
const decisions = bySource('score_decisions');
assert.equal(decisions.size, payload.movements.length);
for (const row of payload.movements) for (const field of ['topicName', 'oldScore', 'newScore', 'rationale', 'evidence', 'date']) {
  assert.deepEqual(decisions.get(row.sourceKey)[field], row[field], `${row.sourceKey}.${field}`);
}
const plans = bySource('import_plans');
assert.equal(plans.size, payload.planned.length);
for (const row of payload.planned) for (const field of ['date', 'status', 'notes']) assert.deepEqual(plans.get(row.sourceKey)[field], row[field]);
const verifiedLists = mapVerifiedLists(readFileSync('src/integrations/manifests/neetcode-problems.json','utf8'), PINNED_REVISION, payload.source.retrievedAt);
const listCounts = {};
for (const definition of verifiedLists.lists) {
  const list = tables.lists.find(row => row.name === definition.name);
  assert.ok(list, definition.name);
  const ids = tables.list_memberships.filter(row => row.listId === list.id).map(row=>row.problemId);
  const slugs = tables.problems.filter(row=>ids.includes(row.id)).map(row=>row.slug).sort();
  const expected = verifiedLists.payload.problems.filter(row=>row.lists.includes(list.name));
  assert.deepEqual(slugs, expected.map(row=>row.key).sort());
  assert.equal(slugs.length, definition.count);
  listCounts[list.name] = slugs.length;
  for (const row of expected) assert.ok(problems.get(row.key).difficulty, `Verified difficulty missing for ${row.key}`);
}
const knownTopics = new Set(payload.topics.map(row=>row.name.toLowerCase()));
const unmatchedTopicReferences = payload.attempts.flatMap(row=>(row.topicNames??[]).filter(name=>!knownTopics.has(name.toLowerCase())).map(name=>({sourceKey:row.sourceKey,name})));
for (const row of payload.attempts) {
  const actual = attempts.get(row.sourceKey);
  for (const name of row.topicNames??[]) {
    const topic = tables.topics.find(topic=>topic.name.toLowerCase()===name.toLowerCase());
    if (topic) assert.ok(tables.attempt_topics.some(link=>link.attemptId===actual.id&&link.topicId===topic.id), `${row.sourceKey} missing known topic ${name}`);
  }
}
console.log(JSON.stringify({ verified: true, totalQuestions: tables.problems.length, listCounts, sourceRecords: records.size, sourceProblems: payload.problems.length, attempts: attempts.size,
  unchangedTopicScores: payload.topics.length, explicitMovements: decisions.size, planCandidates: plans.size,
  unresolvedSourceRows: payload.records.filter(row => row.status === 'unresolved').length,
  unknownTimes: payload.attempts.filter(row => row.activeSeconds === null).length,
  actualStoredAnswers: payload.attempts.filter(row => row.code).length,
  unmatchedCompositeTopicReferences: unmatchedTopicReferences.length,
}, null, 2));
