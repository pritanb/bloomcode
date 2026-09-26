# Extending BloomCode

BloomCode extends through data and local APIs. There is no plugin loader, and question packs never run code. Only LeetCode problem URLs are supported; other exercise providers would need a schema change.

## Question packs, version 1

The app bundles NeetCode 150 and Blind 75 from NeetCode's MIT-licensed repository. To study any other list, such as NeetCode 250 or a company list, write it as a question pack and import it.

See [the runnable example](../examples/question-pack.json). The top-level fields are `version: 1`, `name`, and `questions`. Each question has a title, an HTTPS LeetCode problem URL, optional difficulty (`Easy`, `Medium`, `Hard` or null), and optional tag names. Unknown fields, unsupported versions, duplicate slugs and the bundled list names (Blind 75, NeetCode 150) are rejected. Maximum: 1,000 questions per file.

Run `npm run import:pack -- --input <file> --dry-run` first to check format and identities, then use `--apply` with the app running. Import reads back saved source records. Identical normalized content has the same import ID. Changed packs are additive: they can add questions and tags but do not delete old memberships or overwrite saved work. Rename a list if it represents a different collection. Existing titles and non-null difficulties are retained by the core importer.

Version 1 holds metadata only: no attempts, scores, scripts or solved flags. An incompatible format needs a new version number. A local pack's source timestamp is a fixed epoch marker.

## Progress import adapters

For another progress source, write a mapper returning `ImportPayload` from `src/shared/contracts.ts`. Validate it with `importSchema` from `src/server/catalogue/import.ts`. Follow `src/integrations/lists.ts` and the [list provenance notes](../src/integrations/manifests/README.md) for provenance, unknown fields and source identity.

Use the authenticated `/api/import` endpoint and `applyAndVerify` helper rather than writing SQLite directly. Preserve source records, stable import IDs, and explicit unknowns. Set `dryRun: true` for a transactional server preview that rolls back. Source history imports have more authority than question packs: test replay, ambiguous records, and export/restore on disposable data.

## Tutor adapters

Prefer the built MCP adapter; its `tools/list` response is the tool contract. See [Operations](operations.md#mcp-adapter) for the tool list and [Tutor integration](tutor-integration.md) for setup.

For custom local HTTP integrations, use `LocalApi` from `src/integrations/local-api.ts`. Respect optimistic versions, idempotency keys, disclosure restrictions and read-back verification. A 409 means re-read and reconcile, not blindly overwrite. Never create a new idempotency key after an uncertain write. The HTTP API and TypeScript interfaces are pre-1.0, so pin your integration to a tested release or commit.

## Boundaries

Keep scoring, schedule decisions and persistence in the core. Imports and tutors use those same domain operations. Do not bypass authentication, loosen loopback binding, expose the bearer token to the browser, or install downloaded code. Add only tests that protect the changed critical behavior; follow [Testing](testing.md).
