import { randomUUID } from 'node:crypto';
import type { Attempt, Dashboard, Problem, ProblemList, Snapshot, ReviewTarget, ScoreDecision, Tag, Topic, TopicDetail } from '../../src/shared/contracts';
import { test, expect, capture, createProblem, currentAttempt, finish, importFixture, noHorizontalOverflow, openLibrary, startTargeted } from './helpers';

// One disposable built server per npm run test:e2e. Unique names keep scenarios independent.
test('empty study desk explains missing data without invented scores', async ({ page, api }, info) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your study desk' })).toBeVisible();
  const dashboard = await api.read<Dashboard>('/dashboard');
  expect(dashboard.topics).toEqual([]);
  expect(dashboard.recentAttempts).toEqual([]);
  await expect(page.getByText('No topic scores yet.', { exact: false })).toBeVisible();
  await expect(page.getByText('No practice recorded yet.', { exact: false })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open library', exact: true })).toBeVisible();
  await capture(page, info, 'empty-dashboard-desktop');
  await page.setViewportSize({ width: 390, height: 844 });
  await noHorizontalOverflow(page);
  await capture(page, info, 'empty-dashboard-mobile');
  await page.emulateMedia({ colorScheme: 'dark' });
  await capture(page, info, 'empty-dashboard-mobile-dark');
  await page.emulateMedia({ colorScheme: 'light' });
  const libraryLink = page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Question library', exact: true });
  await libraryLink.focus();
  await expect(libraryLink).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL('/library');
});

test('catalogue UI creates tags/list/question and persists discriminating URL filters', async ({ page, api }, info) => {
  await page.goto('/library/manage');
  for (const name of ['Journey hash map', 'Journey two pointers']) {
    await page.getByLabel('New tag name', { exact: true }).fill(name);
    await page.getByRole('button', { name: 'Create tag', exact: true }).click();
    await expect(page.getByLabel(`Name for ${name}`, { exact: true })).toBeVisible();
  }
  await page.getByLabel('New list name', { exact: true }).fill('Journey collection');
  await page.getByRole('button', { name: 'Create list', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Journey collection', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Back to library', exact: true }).click();
  await page.getByRole('button', { name: 'Add question', exact: true }).click();
  const form = page.getByRole('region', { name: 'Add question', exact: true });
  await form.getByLabel('Question title', { exact: true }).fill('Journey Two Sum');
  await form.getByLabel('LeetCode URL', { exact: true }).fill('https://leetcode.com/problems/two-sum/');
  await form.getByLabel('LeetCode difficulty', { exact: true }).selectOption('Easy');
  await form.getByLabel('Question notes', { exact: true }).fill('Library fixture note: preserve literal <script> text.');
  for (const name of ['Journey hash map', 'Journey two pointers']) await form.getByLabel(name, { exact: true }).check();
  await form.getByLabel('Journey hash map difficulty (1–10)', { exact: true }).fill('4');
  await form.getByLabel('Journey two pointers difficulty (1–10)', { exact: true }).fill('7');
  await form.getByLabel('Journey collection', { exact: true }).check();
  await form.getByRole('button', { name: 'Save question', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Journey Two Sum', exact: true })).toBeVisible();
  const id = new URL(page.url()).pathname.split('/').at(-1)!;
  const saved = await api.read<{ problem: Problem }>(`/problems/${id}`);
  expect(saved.problem.tags.map(tag => [tag.name, tag.difficulty])).toEqual(expect.arrayContaining([['Journey hash map', 4], ['Journey two pointers', 7]]));
  expect(saved.problem.lists.map(list => list.name)).toContain('Journey collection');
  await expect(page.getByText('Library fixture note: preserve literal <script> text.', { exact: true })).toBeVisible();
  const tags = await api.read<Tag[]>('/tags');
  const lists = await api.read<ProblemList[]>('/lists');
  const hash = tags.find(tag => tag.name === 'Journey hash map')!;
  const collection = lists.find(list => list.name === 'Journey collection')!;
  await api.send('/problems', { title: 'Journey Single Tag', url: 'https://leetcode.com/problems/contains-duplicate/', difficulty: 'Easy', tags: [{ tagId: hash.id, difficulty: 2 }], listIds: [collection.id] });
  await createProblem(api, 'valid-anagram', 'Journey No Tags');
  await page.getByRole('link', { name: 'Back to library', exact: true }).click();
  await page.getByLabel('Search questions', { exact: true }).fill('Journey');
  await expect(page.locator('.library-results h2')).toHaveText('3 questions');
  // Router-backed controlled checkboxes commit on a React transition; assert after the click.
  await page.getByLabel('Journey hash map', { exact: true }).click();
  await expect(page.getByLabel('Journey hash map', { exact: true })).toBeChecked();
  await page.getByLabel('Journey two pointers', { exact: true }).click();
  await expect(page.getByLabel('Journey two pointers', { exact: true })).toBeChecked();
  await page.getByLabel('Tag match', { exact: true }).selectOption('any');
  await expect(page.locator('.library-results h2')).toHaveText('2 questions');
  await page.getByLabel('Tag match', { exact: true }).selectOption('all');
  await expect(page.locator('.library-results h2')).toHaveText('1 question');
  await expect(page.getByRole('link', { name: 'Journey Two Sum', exact: true })).toBeVisible();
  await page.getByLabel('List', { exact: true }).selectOption(collection.id);
  await page.getByLabel('Tag difficulty minimum', { exact: true }).fill('4');
  await page.getByLabel('LeetCode level', { exact: true }).selectOption('Easy');
  await expect(page.locator('.library-results h2')).toHaveText('1 question');
  const filteredUrl = page.url();
  expect(new URL(filteredUrl).searchParams.get('tagMode')).toBe('all');
  await page.reload();
  await expect(page.locator('.library-results h2')).toHaveText('1 question');
  expect(page.url()).toBe(filteredUrl);
  await expect(page.getByLabel('Journey hash map', { exact: true })).toBeChecked();
  await capture(page, info, 'filtered-library-desktop');
  await page.setViewportSize({ width: 390, height: 844 });
  await noHorizontalOverflow(page);
  await capture(page, info, 'filtered-library-mobile');
  await page.getByRole('button', { name: 'Reset filters', exact: true }).click();
  await expect(page).toHaveURL('/library');
  await expect(page.getByRole('link', { name: 'Journey No Tags', exact: true })).toBeVisible();
});

test('targeted solve autosaves CodeMirror, reloads draft, and closes unknown time with no review', async ({ page, api }, info) => {
  await openLibrary(page);
  const problem = await createProblem(api, 'reverse-linked-list', 'Journey Draft Recovery');
  const before = await api.read<Topic[]>('/topics');
  await startTargeted(page, problem);
  const code = 'def reverseList(head):\n    # Acceptance fixture, not executed locally\n    return head';
  await page.locator('.cm-content').fill(code);
  await page.getByLabel('Attempt notes', { exact: true }).fill('Recovered notes with <b>literal markup</b>.');
  await expect(page.getByText('Draft saved', { exact: true })).toBeVisible();
  let attempt = await currentAttempt(page, api);
  expect(attempt.code).toBe(code);
  // Opening catalogue details records disclosure before targeted practice.
  expect(attempt.evidence).toBe('retention');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Resume timer', exact: true })).toBeEnabled();
  await page.reload();
  await expect(page.locator('.cm-content')).toContainText('def reverseList(head):');
  await expect(page.getByLabel('Attempt notes', { exact: true })).toHaveValue('Recovered notes with <b>literal markup</b>.');
  attempt = await currentAttempt(page, api);
  expect(attempt.status).toBe('paused');
  expect(attempt.code).toBe(code);
  await capture(page, info, 'recovered-attempt-desktop');
  await page.getByRole('button', { name: 'Resume timer', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeEnabled();
  await finish(page, { seconds: null, review: 'none' });
  attempt = await currentAttempt(page, api);
  expect(attempt).toMatchObject({ status: 'completed', activeSeconds: null, nextReviewDate: null, reviewedAt: null, code });
  expect(await api.read<Topic[]>('/topics')).toEqual(before);
  const reviews = await api.read<ReviewTarget[]>('/reviews');
  expect(reviews.find(review => review.problemId === problem.id)).toMatchObject({ action: 'none', effectiveDate: null });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Awaiting tutor review', exact: true })).toBeVisible();
  await expect(page.getByText('Next review: Not scheduled', { exact: true })).toBeVisible();
  await expect(page.locator('.cm-content')).toContainText('def reverseList(head):');
  await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable', 'false');
  await page.getByRole('link', { name: 'Done for now', exact: true }).click();
  await expect(page.locator('.recent-practice').getByRole('row').filter({ hasText: problem.title })).toContainText('Unknown');
  await capture(page, info, 'first-use-plan-after-practice');
  await page.goto(`/library?search=${encodeURIComponent(problem.title)}&status=completed&timeBucket=unknown`);
  await expect(page.locator('.library-results h2')).toHaveText('1 question');
  await expect(page.locator('.problem-table tbody tr')).toContainText('Unknown');
});

test('manual active seconds and chosen review date survive reload and time-bucket filters', async ({ page, api }, info) => {
  await openLibrary(page);
  const problem = await createProblem(api, 'maximum-depth-of-binary-tree', 'Journey Manual Timing');
  await startTargeted(page, problem);
  await page.locator('.cm-content').fill('def maxDepth(root):\n    return 1');
  await expect(page.getByText('Draft saved', { exact: true })).toBeVisible();
  await finish(page, { seconds: 625, review: 'manual', date: '2030-01-15' });
  expect(await currentAttempt(page, api)).toMatchObject({ activeSeconds: 625, nextReviewDate: '2030-01-15', reviewedAt: null });
  await page.reload();
  await expect(page.getByText(/10:25 active time/)).toBeVisible();
  await expect(page.getByText('Next review: 15 Jan 2030', { exact: true })).toBeVisible();
  await capture(page, info, 'manual-closeout-desktop');
  await page.goto(`/library?search=${encodeURIComponent(problem.title)}&timeBucket=10-20`);
  await expect(page.locator('.library-results h2')).toHaveText('1 question');
  await expect(page.locator('.problem-table tbody tr')).toContainText('10:25');
  await page.getByLabel('Solve time', { exact: true }).selectOption('0-10');
  await expect(page.getByRole('heading', { name: 'No questions found', exact: true })).toBeVisible();
  const reviews = await api.read<ReviewTarget[]>('/reviews');
  expect(reviews.find(review => review.problemId === problem.id)).toMatchObject({ action: 'manual', effectiveDate: '2030-01-15' });
});

test('mixed workspace hides spoilers; authenticated tutor review refreshes scores, no-change history and evidence', async ({ page, api }, info) => {
  await openLibrary(page);
  const fixture = await importFixture(page, info, {
    importId: `e2e-review-${randomUUID()}`, dryRun: false, source: { retrievedAt: new Date().toISOString() },
    problems: [{ key: 'mixed', title: 'Journey Mixed Candidate', url: 'https://leetcode.com/problems/balanced-binary-tree/', difficulty: 'Easy', tags: ['Journey Trees', 'SECRET pattern classification'], lists: ['SECRET curated list'], notes: 'SECRET solution hint: use postorder traversal.' }],
    topics: [{ name: 'Journey Trees', score: 2.75, notes: 'SECRET topic guidance', provisional: true }, { name: 'Journey Reasoning', score: 3.2, notes: '', provisional: true }],
    attempts: [], movements: [], planned: [], records: [],
  });
  expect(fixture.counts).toMatchObject({ problems: 1, topics: 2 });
  const topics = await api.read<Topic[]>('/topics');
  const trees = topics.find(topic => topic.name === 'Journey Trees')!;
  const reasoning = topics.find(topic => topic.name === 'Journey Reasoning')!;
  // The test harness obtains its fixture identity without browsing pattern
  // metadata in the candidate's catalogue. Deliberate catalogue disclosure
  // correctly invalidates unseen evidence and is covered in release regressions.
  const fixtureSnapshot = await api.read<Snapshot>('/export');
  const candidate = fixtureSnapshot.tables.problems.find(p=>p.title==='Journey Mixed Candidate') as unknown as Problem;
  expect(candidate).toBeDefined();
  expect(candidate.exposed).toBe(false);
  // A distinct test-only timezone creates a new persisted plan without clearing or
  // rewriting an existing day's assignments. Production settings are never touched.
  await api.send('/settings', { timezone: 'UTC' }, 'PATCH');
  await page.goto('/');
  await expect(page.locator('.topic-row').filter({ hasText: 'Journey Trees' })).toContainText('2.75');
  await expect(page.locator('.topic-row').filter({ hasText: 'Journey Reasoning' })).toContainText('3.2');
  const planned = await api.read<Dashboard>('/dashboard');
  expect(planned.plan?.items[0]).toMatchObject({ problemId: candidate.id, status: 'active' });
  await page.reload();
  await expect(page.getByRole('heading', { name: candidate.title, exact: true })).toBeVisible();
  expect((await api.read<Dashboard>('/dashboard')).plan).toEqual(planned.plan);
  await page.locator('.plan-row').filter({ hasText: candidate.title }).getByRole('button', { name: 'Start attempt', exact: true }).click();
  await expect(page.locator('.cm-content')).toBeVisible();
  const started = await currentAttempt(page, api);
  expect(started.planItemId).toBe(planned.plan!.items[0].id);
  const responses: string[] = [];
  page.on('response', response => { if (new URL(response.url()).pathname.startsWith('/api/')) responses.push(new URL(response.url()).pathname); });
  await page.reload();
  await expect(page.locator('.cm-content')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeEnabled();
  await expect(page.getByRole('navigation')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Topic scores', exact: true })).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('SECRET');
  await expect(page.locator('body')).not.toContainText('Journey Trees');
  await expect(page.locator('.cm-content')).toHaveText('');
  const active = await currentAttempt(page, api);
  expect(active.evidence).toBe('unseen');
  expect(Object.keys(active.problem).sort()).toEqual(['difficulty', 'id', 'title', 'url']);
  expect(JSON.stringify(active)).not.toContain('SECRET');
  const denied = await page.request.get(`/api/attempts/${active.id}/context`);
  expect(denied.status()).toBe(403);
  expect(responses.filter(path => /\/(topics|dashboard|problems)(\/|$)/.test(path))).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  await noHorizontalOverflow(page);
  await capture(page, info, 'mixed-workspace-mobile');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('.cm-content').fill('def isBalanced(root):\n    return True');
  await expect(page.getByText('Draft saved', { exact: true })).toBeVisible();
  await finish(page, { seconds: 900, review: 'none' });
  const finished = await currentAttempt(page, api);
  expect((await api.read<Topic[]>('/topics')).find(topic => topic.id === trees.id)?.score).toBe(2.75);
  const reviewPayload = {
    version: finished.version, feedback: 'Acceptance fixture: independent reasoning recorded by the tutor.',
    decisions: [
      { topicId: trees.id, expectedVersion: trees.version, oldScore: 2.75, newScore: 3.25, rationale: 'Independent unseen transfer supports the increase.', evidence: 'unseen' },
      { topicId: reasoning.id, expectedVersion: reasoning.version, oldScore: 3.2, newScore: 3.2, rationale: 'No change: one example does not justify a second increase.', evidence: 'unseen' },
    ],
    followUp: { date: '2030-01-20', action: 'recommended' },
  };
  const key = randomUUID();
  const reviewed = await api.send<{ attempt: Attempt; decisions: ScoreDecision[] }>(`/attempts/${finished.id}/reviews`, reviewPayload, 'POST', key);
  expect(reviewed.decisions).toHaveLength(2);
  const replay = await api.send<typeof reviewed>(`/attempts/${finished.id}/reviews`, reviewPayload, 'POST', key);
  expect(replay).toEqual(reviewed);
  expect((await currentAttempt(page, api)).reviewedAt).toBeTruthy();
  await page.getByRole('button', { name: 'Refresh feedback', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Tutor review saved', exact: true })).toBeVisible();
  await expect(page.getByText(reviewPayload.feedback, { exact: true })).toBeVisible();
  await expect(page.getByText('Next review: Not scheduled', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Done for now', exact: true }).click();
  await expect(page.locator('.topic-row').filter({ hasText: 'Journey Trees' })).toContainText('3.25');
  await expect(page.locator('.movement-list li').filter({ hasText: 'Journey Trees' })).toContainText('2.75 → 3.25');
  await expect(page.locator('.topic-row').filter({ hasText: 'Journey Reasoning' })).toContainText('No change');
  await expect(page.locator('.recent-practice').getByRole('row').filter({ hasText: candidate.title })).toContainText('Reviewed');
  const dashboard = await api.read<Dashboard>('/dashboard');
  // Dashboard movements exclude flat decisions; the topic history retains them.
  expect(dashboard.movements.filter(decision => decision.attemptId === finished.id)).toHaveLength(1);
  expect(dashboard.plan?.items.find(item => item.problemId === candidate.id)?.status).toBe('completed');
  await capture(page, info, 'reviewed-dashboard-desktop');
  await page.setViewportSize({ width: 390, height: 844 });
  await noHorizontalOverflow(page);
  await capture(page, info, 'reviewed-dashboard-mobile');
  await page.locator('.topic-row').filter({ hasText: 'Journey Trees' }).click();
  await expect(page.getByRole('heading', { name: 'Score history & rationale', exact: true })).toBeVisible();
  await expect(page.getByText(reviewPayload.decisions[0].rationale, { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'View evidence', exact: true })).toHaveAttribute('href', `/attempts/${finished.id}`);
  const detail = await api.read<TopicDetail>(`/topics/${trees.id}`);
  expect(detail.stats).toEqual({ attemptCount: 1, knownTimeCount: 1, medianSeconds: 900 });
  await noHorizontalOverflow(page);
  await capture(page, info, 'topic-detail-mobile');
  await page.goto(`/topics/${reasoning.id}`);
  await expect(page.locator('.movement-list li')).toContainText('No change');
  await expect(page.getByText(reviewPayload.decisions[1].rationale, { exact: true })).toBeVisible();
  expect((await api.read<TopicDetail>(`/topics/${reasoning.id}`)).decisions).toHaveLength(1);
});
