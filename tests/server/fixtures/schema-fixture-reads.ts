// The read endpoints recorded from schema-v3.sqlite, shared by the fixture builder and the
// migration test so both request exactly the same URLs.
export const FIXTURE_CLOCK = new Date('2026-09-15T05:00:00Z');

type Get = (url: string) => Promise<unknown>;
const ids = (rows: unknown) => (rows as { id: string }[]).map((r) => r.id);

export async function readEndpoints(get: Get): Promise<string[]> {
  const problemIds: string[] = [];
  for (let page = 1; ; page++) {
    const { items } = (await get(`/api/problems?pageSize=100&page=${page}`)) as {
      items: { id: string }[];
    };
    problemIds.push(...items.map((p) => p.id));
    if (items.length < 100) break;
  }
  const attemptIds = new Set<string>();
  for (const id of problemIds) {
    const detail = (await get(`/api/problems/${id}`)) as { attempts?: { id: string }[] };
    for (const a of detail.attempts ?? []) attemptIds.add(a.id);
  }
  const dashboard = (await get('/api/dashboard')) as { activeAttempt: { id: string } | null };
  if (dashboard.activeAttempt) attemptIds.add(dashboard.activeAttempt.id);
  const topicIds = ids(await get('/api/topics'));
  const tagIds = ids(await get('/api/tags'));
  const listIds = ids(await get('/api/lists'));
  const lists = listIds.map((id) => `/api/problems?listId=${id}`);
  return [
    '/api/settings',
    '/api/setup',
    '/api/dashboard',
    '/api/dashboard?date=2026-09-14',
    '/api/recommendations/options',
    '/api/tags',
    '/api/lists',
    '/api/reviews',
    '/api/topics',
    '/api/mistakes',
    '/api/mistakes?label=missed_edge_case',
    '/api/patterns',
    '/api/recap',
    '/api/recap?week=2026-09-14',
    '/api/problems',
    '/api/problems?page=2',
    '/api/problems?status=solved',
    '/api/problems?status=attempted&sort=lastAttempt&direction=desc',
    '/api/problems?status=unsolved&sort=reviewDate',
    '/api/problems?sort=solveTime&direction=desc',
    '/api/problems?sort=difficulty',
    '/api/problems?sort=confidence&direction=desc',
    '/api/problems?timeBucket=10-20',
    '/api/problems?timeBucket=unknown',
    '/api/problems?difficulty=Medium',
    '/api/problems?search=custom',
    '/api/problems?leetcodeTopic=Array',
    `/api/problems?tags=${tagIds.slice(0, 2).join(',')}&tagMode=any`,
    `/api/problems?tags=${tagIds.slice(0, 2).join(',')}&tagMode=all`,
    ...lists,
    ...problemIds.map((id) => `/api/problems/${id}`),
    ...[...attemptIds].flatMap((id) => [`/api/attempts/${id}`, `/api/attempts/${id}/context`]),
    ...topicIds.flatMap((id) => [`/api/topics/${id}`, `/api/topics/${id}/history`]),
    ...tagIds.map((id) => `/api/patterns/${id}`),
  ];
}
