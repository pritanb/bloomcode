import publicLists from '../integrations/manifests/neetcode-problems.json';
import public250 from '../integrations/manifests/neetcode250.json';
import { leetcodeSlug } from '../integrations/sheet.js';
import type { Problem, ProblemList } from '../shared/contracts.js';
import type { ListLink } from './catalogue.js';
import type { Store } from './store.js';

// These bundled, pinned manifests are also verified by the public-list importer.
// Only their explicit flags/identities establish membership, never Sheet names.
const slugs = (rows: { link: string }[]) =>
  new Set(rows.map((row) => leetcodeSlug(`https://leetcode.com/problems/${row.link}`)));
const canonicalMembers = new Map([
  ['neetcode 150', slugs(publicLists.filter((row) => row.neetcode150))],
  ['neetcode 250', slugs(public250.problems)],
  ['blind 75', slugs(publicLists.filter((row) => row.blind75))],
]);
const sourceNames = new Set([
  'neetcode list',
  'neetcode 250 additions',
  'neetcode250 additions',
  'tutor tracker',
  'current plan',
  'topic ratings',
  'others',
]);

/** Read-only display policy. Stored names, IDs and membership edges never change. */
export function listView(list: ProblemList): ProblemList | null {
  const tab = /^Sheet:\s*(.+)$/i.exec(list.name)?.[1];
  if (!tab) return list;
  if (sourceNames.has(tab.toLowerCase())) return null;
  return { ...list, name: tab };
}

export function listProjection(s: Store) {
  const lists = s.all<ProblemList>('lists');
  const memberships = new Map<string, Set<string>>();
  for (const edge of s.all<ListLink>('list_memberships')) {
    if (!memberships.has(edge.problemId)) memberships.set(edge.problemId, new Set());
    memberships.get(edge.problemId)!.add(edge.listId);
  }
  const visible = lists.flatMap((list) => {
    const view = listView(list);
    return view ? [{ stored: list, view }] : [];
  });
  return {
    lists: visible.map(({ view }) => view),
    // A form round-trip is not an import: keep hidden source edges and do not
    // materialise memberships supplied only by the pinned public manifests.
    forEdit: (problem: Problem, requested: string[]) => {
      const stored = memberships.get(problem.id) ?? new Set<string>();
      const derived = new Set(
        visible
          .filter(
            ({ stored: list }) =>
              !stored.has(list.id) &&
              canonicalMembers.get(list.name.toLowerCase())?.has(problem.slug),
          )
          .map(({ stored: list }) => list.id),
      );
      const hidden = lists
        .filter((list) => stored.has(list.id) && !listView(list))
        .map((list) => list.id);
      return [...requested.filter((id) => !derived.has(id)), ...hidden];
    },
    forProblem: (problem: Problem) =>
      visible
        .filter(
          ({ stored }) =>
            memberships.get(problem.id)?.has(stored.id) ||
            canonicalMembers.get(stored.name.toLowerCase())?.has(problem.slug),
        )
        .map(({ view }) => view),
    // Preserve exact source-filter semantics for legacy URLs; do not alias a
    // Sheet inventory to a canonical public list with a different question set.
    hasStoredMembership: (problemId: string, listId: string) =>
      memberships.get(problemId)?.has(listId) ?? false,
  };
}
