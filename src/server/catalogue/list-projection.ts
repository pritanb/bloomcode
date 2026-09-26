import publicLists from '../../integrations/manifests/neetcode-problems.json';
import public250 from '../../integrations/manifests/neetcode250.json';
import { leetcodeSlug } from '../../shared/leetcode.js';
import type { ProblemList } from '../../shared/contracts.js';
import { type Db, many } from '../db/db.js';

// These bundled, pinned manifests are also verified by the public-list importer.
// Only their explicit flags/identities establish membership.
const slugs = (rows: { link: string }[]) =>
  new Set(rows.map((row) => leetcodeSlug(`https://leetcode.com/problems/${row.link}`)));
const canonicalMembers = new Map([
  ['neetcode 150', slugs(publicLists.filter((row) => row.neetcode150))],
  ['neetcode 250', slugs(public250.problems)],
  ['blind 75', slugs(publicLists.filter((row) => row.blind75))],
]);
type ProblemRef = { id: string; slug: string };

export function listProjection(db: Db) {
  const lists = many<ProblemList>(db, 'SELECT * FROM lists ORDER BY rowid');
  const memberships = new Map<string, Set<string>>();
  for (const edge of many<{ problemId: string; listId: string }>(
    db,
    'SELECT problemId, listId FROM list_memberships',
  )) {
    if (!memberships.has(edge.problemId)) memberships.set(edge.problemId, new Set());
    memberships.get(edge.problemId)!.add(edge.listId);
  }
  const canonical = (list: ProblemList, problem: ProblemRef) =>
    canonicalMembers.get(list.name.toLowerCase())?.has(problem.slug) ?? false;
  return {
    lists,
    // A form round-trip is not an import: do not materialise memberships
    // supplied only by the pinned public manifests.
    forEdit: (problem: ProblemRef, requested: string[]) => {
      const stored = memberships.get(problem.id) ?? new Set<string>();
      const derived = new Set(
        lists.filter((l) => !stored.has(l.id) && canonical(l, problem)).map((l) => l.id),
      );
      return requested.filter((id) => !derived.has(id));
    },
    forProblem: (problem: ProblemRef) =>
      lists.filter((l) => memberships.get(problem.id)?.has(l.id) || canonical(l, problem)),
  };
}
