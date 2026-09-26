import { z } from 'zod';
export const snapshotSchema = z.strictObject({
  schemaVersion: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  exportedAt: z.iso.datetime({ offset: true }),
  tables: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
});
