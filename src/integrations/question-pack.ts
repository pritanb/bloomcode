import { createHash } from 'node:crypto';
import { z } from 'zod';
import { canonical } from '../server/db/idempotency.js';
import { problemUrl } from '../server/catalogue/catalogue.js';
import type { ImportPayload } from '../shared/contracts.js';

const title = z.string().trim().min(1).max(300);
export const questionPackSchema = z
  .object({
    version: z.literal(1),
    name: title,
    questions: z
      .array(
        z
          .object({
            title,
            url: problemUrl,
            difficulty: z.enum(['Easy', 'Medium', 'Hard']).nullable().optional(),
            tags: z.array(title).max(50).default([]),
          })
          .strict(),
      )
      .min(1)
      .max(1000),
  })
  .strict();

/** A metadata-only format: cannot import scores, solved flags or executable code. */
export function mapQuestionPack(value: unknown): ImportPayload {
  const pack = questionPackSchema.parse(value);
  if (
    ['blind 75', 'neetcode 150', 'neetcode 250'].includes(pack.name.toLowerCase()) ||
    /^sheet:/i.test(pack.name)
  )
    throw Error('Use a custom list name; bundled and source-archive names are reserved.');
  const keys = pack.questions.map((question) => new URL(question.url).pathname.split('/')[2]!);
  if (new Set(keys).size !== keys.length)
    throw Error('A question pack cannot contain duplicate LeetCode slugs.');
  const digest = createHash('sha256').update(canonical(pack)).digest('hex');
  return {
    importId: `question-pack-v1-${digest}`,
    dryRun: true,
    source: { retrievedAt: '1970-01-01T00:00:00Z' }, // Content-addressed local file, not a web retrieval.
    problems: pack.questions.map((question, index) => ({
      ...question,
      key: keys[index]!,
      lists: [pack.name],
    })),
    attempts: [],
    topics: [],
    movements: [],
    planned: [],
    records: pack.questions.map((question, index) => ({
      sourceKey: keys[index]!,
      tab: pack.name,
      row: index + 1,
      raw: question,
      status: 'metadata',
    })),
  };
}
