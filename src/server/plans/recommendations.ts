import type { Problem, Settings } from '../../shared/contracts.js';
import {
  defaultRecommendations,
  type RecommendationOptions,
  type RecommendationSettings,
} from '../../shared/recommendations.js';
import manifest from '../../integrations/manifests/neetcode250.json';
import { listProjection } from '../catalogue/list-projection.js';
import { problemView } from '../catalogue/problem-model.js';
import type { AttemptRecord } from '../attempts/attempt-model.js';
import type { Store } from '../db/store.js';

// Source row order, not an invented popularity or difficulty ranking.
const sourceTopics = [...new Set(manifest.problems.map((row) => row.pattern))];
const sourceRows = new Map(
  manifest.problems.map((row, index) => [
    row.link.replace(/\/$/, ''),
    { topic: row.pattern, index },
  ]),
);
export function recommendationContext(
  s: Store,
  config = s.get<Settings & { id: string }>('settings', 'singleton').recommendations ??
    defaultRecommendations,
) {
  const projection = listProjection(s);
  const lists = projection.lists;
  const solved = new Set(
    s
      .all<AttemptRecord>('attempts')
      .filter((a) => a.status === 'completed' && a.outcome === 'solved')
      .map((a) => a.problemId),
  );
  const complete = (p: Problem) =>
    p.legacyCompleted || p.lastOutcome === 'solved' || solved.has(p.id);
  const pool = s
    .all<Problem>('problems')
    .map((p) => problemView(s, p, projection))
    .filter((p) => !config.listId || p.lists.some((l) => l.id === config.listId));
  const verifiedOrder = lists.some(
    (l) => l.id === config.listId && ['NeetCode 250', 'NeetCode 150', 'Blind 75'].includes(l.name),
  );
  const topic = (p: Problem) =>
    (verifiedOrder ? sourceRows.get(p.slug)?.topic : undefined) ??
    p.tags
      .filter((t) => !t.archived && t.kind !== 'pattern')
      .map((t) => t.name)
      .sort()[0] ??
    'Uncategorized';
  const names = [...new Set(pool.map(topic))].sort((a, b) => {
    const ai = sourceTopics.indexOf(a),
      bi = sourceTopics.indexOf(b);
    return verifiedOrder
      ? (ai < 0 ? sourceTopics.length : ai) - (bi < 0 ? sourceTopics.length : bi) ||
          a.localeCompare(b)
      : a.localeCompare(b);
  });
  const topics = names.map((name) => {
    const rows = pool.filter((p) => topic(p) === name);
    return { name, total: rows.length, completed: rows.filter(complete).length };
  });
  const start = config.startTopic ? names.indexOf(config.startTopic) : 0;
  // A removed/unknown starting topic has no fallback: ask the user to choose again.
  const currentTopic =
    start < 0 ? null : (topics.slice(start).find((t) => t.completed < t.total)?.name ?? null);
  const options: RecommendationOptions = {
    lists: lists.map(({ id, name }) => ({ id, name })),
    topics,
    currentTopic,
    orderDescription: verifiedOrder
      ? 'Pinned NeetCode 250 category and question order; other categories follow alphabetically.'
      : 'Alphabetical topic order; the first non-archived topic tag assigns each question. Untagged questions are Uncategorized.',
  };
  return {
    config,
    pool,
    complete,
    topic,
    options,
    sourceRank: (p: Problem) =>
      verifiedOrder ? (sourceRows.get(p.slug)?.index ?? Number.MAX_SAFE_INTEGER) : 0,
  };
}
export function configuredCandidates(
  s: Store,
  ranked: Problem[],
  slots: number,
  retainedRefreshers = 0,
) {
  const ctx = recommendationContext(s),
    { config } = ctx;
  const ids = new Set(ctx.pool.map((p) => p.id));
  const eligible = ranked.filter((p) => ids.has(p.id));
  const fresh = eligible.filter(
    (p) =>
      !ctx.complete(p) &&
      (config.strategy !== 'topic' ||
        ctx.topic(ctx.pool.find((x) => x.id === p.id)!) === ctx.options.currentTopic),
  );
  if (config.strategy === 'topic')
    fresh.sort(
      (a, b) =>
        ctx.sourceRank(a) - ctx.sourceRank(b) ||
        a.title.localeCompare(b.title) ||
        a.id.localeCompare(b.id),
    );
  if (config.strategy === 'balanced' && config.completed === 'legacy')
    return eligible.slice(0, slots);
  const refreshers = eligible.filter(ctx.complete);
  // Prefer verified curated-core membership, never claim measured popularity.
  const core = (p: Problem) =>
    ctx.pool
      .find((x) => x.id === p.id)!
      .lists.some((l) => ['Blind 75', 'NeetCode 150'].includes(l.name));
  refreshers.sort((a, b) => Number(core(b)) - Number(core(a)));
  const limit =
    config.completed === 'exclude'
      ? 0
      : config.completed === 'legacy'
        ? slots
        : Math.max(0, config.refresherSlots - retainedRefreshers);
  // Unlimited inclusion must not let completed questions displace the topic's unfinished work.
  const refresherCapacity =
    config.strategy === 'topic' && config.completed === 'legacy'
      ? Math.max(0, slots - fresh.length)
      : slots;
  const chosenRefreshers = refreshers.slice(0, Math.min(limit, refresherCapacity));
  return [...fresh.slice(0, slots - chosenRefreshers.length), ...chosenRefreshers];
}
export function recommendationReason(s: Store, p: Problem, day: string) {
  const ctx = recommendationContext(s),
    config: RecommendationSettings = ctx.config;
  if (!s.get<Settings & { id: string }>('settings', 'singleton').recommendations)
    return p.nextReviewDate && p.nextReviewDate <= day ? 'Scheduled review' : 'Balanced practice';
  const source = config.listId
    ? (ctx.options.lists.find((l) => l.id === config.listId)?.name ?? 'Unavailable list')
    : 'All questions';
  const reason = ctx.complete(p)
    ? 'Completed-question refresher'
    : config.strategy === 'topic'
      ? 'Next unfinished question in current topic'
      : p.nextReviewDate && p.nextReviewDate <= day
        ? 'Scheduled review'
        : 'Balanced practice';
  // Do not disclose question tags/patterns on mixed-practice surfaces.
  return `${source} · ${reason}`;
}
