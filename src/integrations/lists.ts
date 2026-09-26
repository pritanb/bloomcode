import { createHash } from 'node:crypto';
import { z } from 'zod';
import { leetcodeSlug } from '../shared/leetcode.js';
import type { ImportPayload } from '../shared/contracts.js';
export const PINNED_REVISION = '9f104d45b1efc8c2e42b6dcc7b1216cdf8c4f80e';
export const PINNED_SHA256 = '436dd487beb9126e30e9da8717ff76f2a78e3a94ca0ec4181d9d04de9f7b953c';
export const sourceUrl = (revision: string) =>
  `https://raw.githubusercontent.com/neetcode-gh/leetcode/${revision}/.problemSiteData.json`;
const problemSchema = z.object({
  problem: z.string().min(1),
  link: z.string(),
  pattern: z.string(),
  difficulty: z.enum(['Easy', 'Medium', 'Hard']),
  neetcode150: z.boolean().optional(),
  blind75: z.boolean().optional(),
});
export function mapVerifiedLists(raw: string, revision: string, retrievedAt: string) {
  if (!/^[a-f0-9]{40}$/.test(revision))
    throw Error('Source revision must be a full immutable Git commit hash.');
  if (revision !== PINNED_REVISION)
    throw Error(
      'Unverified source revision: review provenance/licence and pin its checksum before accepting new membership data.',
    );
  z.iso.datetime({ offset: true }).parse(retrievedAt);
  const rows = z.array(problemSchema).parse(JSON.parse(raw));
  const digest = createHash('sha256').update(raw).digest('hex');
  const definitions = [
    { flag: 'neetcode150' as const, name: 'NeetCode 150', count: 150 },
    { flag: 'blind75' as const, name: 'Blind 75', count: 75 },
  ];
  const blockers: string[] = [];
  for (const list of definitions) {
    const members = rows.filter((r) => r[list.flag]);
    const slugs = members.map((r) => leetcodeSlug(`https://leetcode.com/problems/${r.link}`));
    if (members.length !== list.count || slugs.includes(null) || new Set(slugs).size !== list.count)
      throw Error(
        `${list.name} count/identity mismatch; expected ${list.count} unique original LeetCode links. Refusing partial import.`,
      );
  }
  if (rows.some((r) => r.blind75 && !r.neetcode150))
    throw Error('Blind 75 is not nested in NeetCode 150 in this source.');
  if (revision === PINNED_REVISION && digest !== PINNED_SHA256)
    throw Error('Pinned manifest checksum mismatch.');
  const payload: ImportPayload = {
    // v1 and v2 were used by earlier releases (v2 also carried a NeetCode 250
    // list); a fresh ID keeps replays of those batches from conflicting.
    importId: `lists-v3-${revision}-${digest}`,
    dryRun: true,
    source: { retrievedAt },
    problems: [],
    attempts: [],
    topics: [],
    movements: [],
    records: [],
  };
  for (const [index, row] of rows.entries()) {
    const lists = definitions.filter((l) => row[l.flag]).map((l) => l.name);
    if (!lists.length) continue;
    const url = `https://leetcode.com/problems/${row.link}`,
      key = leetcodeSlug(url)!;
    payload.problems.push({
      key,
      title: row.problem,
      url,
      difficulty: row.difficulty,
      tags: [row.pattern],
      lists,
      legacyCompleted: false,
      exposed: false,
    });
    payload.records.push({
      sourceKey: `${revision}:${index + 1}`,
      tab: 'NeetCode public manifest',
      row: index + 1,
      raw: { sourceUrl: sourceUrl(revision), sourceVersion: revision, sha256: digest, row },
      status: 'imported',
    });
  }
  return {
    payload,
    lists: definitions.map(({ name, count }) => ({
      name,
      count,
      sourceUrl: sourceUrl(revision),
      sourceVersion: revision,
    })),
    blockers,
    sha256: digest,
  };
}
