// The learner's own ordered study list (e.g. a course's problems, by LeetCode slug).
// While the plan source is "list", each new day's plan starts with its next problems,
// repeats included; a problem leaves the list once an attempt on it is finished after it
// was listed. Bloom or the rules fill the rest of the day. Switched to Bloom, the list and
// its progress wait unchanged. Slugs not in the library wait until they are.
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { type Db, many, one, run } from '../db/db.js';
import { readSettings } from '../db/settings.js';
import { ApiError } from '../db/errors.js';
import { repoRoot } from '../paths.js';
import { slug } from '../../shared/study-list.js';
import { leetcodeSlug } from '../../shared/leetcode.js';
import { mapVerifiedLists, PINNED_REVISION, sourceUrl } from '../../integrations/lists.js';
import type { PlanSpec } from './shortlist.js';

export const LIST_REASON = 'From your study list';

type Row = { slug: string; problemId: string | null; title: string | null; done: number };
const rows = (db: Db) =>
  many<Row>(
    db,
    `SELECT s.slug, p.id AS problemId, p.title, EXISTS (
       SELECT 1 FROM attempts a WHERE a.problemId = p.id AND a.status = 'completed'
       AND a.startedAt >= s.addedAt) AS done
     FROM study_list s LEFT JOIN problems p ON p.slug = s.slug ORDER BY s.position`,
  );

const listOn = (db: Db) => readSettings(db).planSource === 'list';

/** Library problems on the list, finished or not, while it plans: a re-plan keeps them. */
export const listedIds = (db: Db) =>
  new Set(listOn(db) ? rows(db).flatMap((r) => (r.problemId ? [r.problemId] : [])) : []);

/** The list's next unfinished problems, in order. Known-topic practice, not unseen evidence. */
export function listPicks(db: Db, count: number, exclude = new Set<string>()): PlanSpec[] {
  if (!listOn(db)) return [];
  return rows(db)
    .filter((r) => r.problemId && !r.done && !exclude.has(r.problemId))
    .slice(0, Math.max(0, count))
    .map((r) => ({
      problemId: r.problemId!,
      title: r.title!,
      reason: LIST_REASON,
      kind: 'topic',
      reviewOf: null,
    }));
}

export function studyListView(db: Db) {
  const all = rows(db);
  const { name } = one<{ name: string | null }>(
    db,
    'SELECT studyListName AS name FROM settings WHERE id = 1',
  );
  return {
    planSource: readSettings(db).planSource ?? 'bloom',
    name,
    slugs: all.map((r) => r.slug),
    remaining: all.filter((r) => r.problemId && !r.done).map((r) => r.title!),
    finished: all.filter((r) => r.done).map((r) => r.title!),
    notInLibrary: all.filter((r) => !r.problemId).map((r) => r.slug),
  };
}

/** Replace the list. Slugs already on it keep when they were listed, so finished stays finished. */
export function setStudyList(db: Db, clock: () => Date, slugs: string[], name?: string | null) {
  const added = new Map(
    many<{ slug: string; addedAt: string }>(db, 'SELECT slug, addedAt FROM study_list').map((r) => [
      r.slug,
      r.addedAt,
    ]),
  );
  const now = clock().toISOString();
  run(db, 'DELETE FROM study_list');
  [...new Set(slugs)].forEach((s, position) =>
    run(
      db,
      'INSERT INTO study_list (slug, position, addedAt) VALUES (?, ?, ?)',
      s,
      position,
      added.get(s) ?? now,
    ),
  );
  if (name !== undefined) run(db, 'UPDATE settings SET studyListName = ? WHERE id = 1', name);
}

const studySets = z.object({
  sets: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      source: z.string(),
      sections: z.array(z.object({ name: z.string(), slugs: z.array(slug) })),
    }),
  ),
});
type StudySet = z.infer<typeof studySets>['sets'][number];
const manifest = (file: string) =>
  readFileSync(new URL(`src/integrations/manifests/${file}`, repoRoot), 'utf8');
/** Blind 75 and NeetCode 150 from the verified NeetCode manifest, in roadmap order by pattern. */
function neetcodeSets(): StudySet[] {
  const { payload } = mapVerifiedLists(
    manifest('neetcode-problems.json'),
    PINNED_REVISION,
    '2026-09-16T00:00:00Z',
  );
  return [
    { id: 'blind-75', name: 'Blind 75' },
    { id: 'neetcode-150', name: 'NeetCode 150' },
  ].map(({ id, name }) => {
    const sections: StudySet['sections'] = [];
    for (const p of payload.problems.filter((x) => x.lists?.includes(name))) {
      const pattern = p.tags?.[0] ?? 'Other';
      const section = sections.find((x) => x.name === pattern);
      if (section) section.slugs.push(p.key);
      else sections.push({ name: pattern, slugs: [p.key] });
    }
    return { id, name, source: sourceUrl(PINNED_REVISION), sections };
  });
}
let sets: StudySet[] | undefined;
/** Courses bundled with the app: study-sets.json plus the NeetCode lists. */
export function studySetList() {
  sets ??= [...studySets.parse(JSON.parse(manifest('study-sets.json'))).sets, ...neetcodeSets()];
  return sets;
}

const titleKey = (t: string) =>
  t
    .toLowerCase()
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
/**
 * Turn pasted entries (LeetCode links, slugs or titles, with or without "1." numbering)
 * into slugs in order. A title not in the library becomes LeetCode's usual slug for it,
 * so it joins the list if that problem is added later.
 */
export function resolveEntries(db: Db, entries: string[]) {
  const library = many<{ slug: string; title: string }>(db, 'SELECT slug, title FROM problems');
  const bySlug = new Set(library.map((p) => p.slug));
  const byTitle = new Map(library.map((p) => [titleKey(p.title), p.slug]));
  const unmatched: string[] = [];
  const slugs = entries.flatMap((raw) => {
    const entry = raw
      .trim()
      .replace(/^(?:[-*\u2022]\s*)?(?:\d+[.)]\s+)?/, '')
      .trim();
    if (!entry) return [];
    const link = /leetcode\.com\/problems\/([a-z0-9-]+)/i.exec(entry)?.[1]?.toLowerCase();
    const candidate = link ?? entry.toLowerCase();
    if (link || (/^[a-z0-9-]+$/.test(candidate) && (bySlug.has(candidate) || !/\s/.test(entry))))
      return bySlug.has(candidate) || leetcodeSlug(`https://leetcode.com/problems/${candidate}/`)
        ? [candidate]
        : [];
    const known = byTitle.get(titleKey(entry));
    if (known) return [known];
    const guess = titleKey(entry)
      .replace(/[^a-z0-9 -]/g, '')
      .replace(/[\s-]+/g, '-')
      .replace(/^-|-$/g, '');
    if (!guess) return [];
    unmatched.push(entry);
    return [guess];
  });
  return { slugs: [...new Set(slugs)], unmatched };
}

/**
 * The slugs a proposed list would hold: a bundled course (optionally from a section or
 * problem onward) or the entries given, with how many are in the library and the first up.
 */
export function previewList(db: Db, input: { set?: string; from?: string; problems?: string[] }) {
  let name: string | null = null;
  let { slugs, unmatched } = resolveEntries(db, input.problems ?? []);
  if (input.set) {
    const set = studySetList().find((s) => s.id === input.set);
    if (!set)
      throw new ApiError(
        400,
        'UNKNOWN_SET',
        `Unknown course. Courses: ${studySetList()
          .map((s) => s.id)
          .join(', ')}`,
      );
    name = set.name;
    slugs = set.sections.flatMap((s) => s.slugs);
    unmatched = [];
    if (input.from) {
      const from = input.from.trim().toLowerCase();
      const section =
        set.sections.find((s) => s.name.toLowerCase() === from) ??
        set.sections.find((s) => s.name.toLowerCase().includes(from));
      const start = slugs.indexOf(section ? section.slugs[0]! : from);
      if (start < 0)
        throw new ApiError(
          400,
          'UNKNOWN_START',
          `Start from a section or a slug in the course. Sections: ${set.sections
            .map((s) => s.name)
            .join(', ')}`,
        );
      slugs = slugs.slice(start);
    }
  }
  const titles = new Map(
    many<{ slug: string; title: string }>(db, 'SELECT slug, title FROM problems').map((p) => [
      p.slug,
      p.title,
    ]),
  );
  const known = slugs.filter((s) => titles.has(s));
  return {
    name,
    slugs,
    inLibrary: known.length,
    firstUp: known.slice(0, 3).map((s) => titles.get(s)!),
    unmatched,
  };
}
