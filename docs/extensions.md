# Extending LeetCode Tutor

The initial extension surface is data and local APIs. There is no runtime plugin loader or execution of code supplied by a question pack. The app currently supports original LeetCode problem URLs; adding other exercise providers requires a separate identity/schema change.

## Question packs, version 1

See [the runnable example](../examples/question-pack.json). The top-level fields are `version: 1`, `name`, and `questions`. Each question has a title, an HTTPS LeetCode problem URL, optional difficulty (`Easy`, `Medium`, `Hard` or null), and optional tag names. Unknown fields, unsupported versions, duplicate slugs and reserved bundled-list names are rejected. Maximum: 1,000 questions per file.

Run `npm run import:pack -- --input <file> --dry-run` first, then use `--apply` with the app running. Dry-run checks format and identities; it does not preview how data merges with an existing workspace. Import reads back saved source records. Identical normalized content has the same import ID. Changed packs are additive: they can add questions and tags but do not delete old memberships or overwrite saved work. Rename a list if it represents a different collection. Existing titles and non-null difficulties are retained by the core importer.

Version 1 is an additive metadata format. Do not add attempts, scores, executable scripts or solved flags to it. A new incompatible format must use a new version, with a reader/migration documented before release. The source timestamp for a local pack is a fixed epoch marker, not a claimed web retrieval date.

## Progress import adapters

For another progress source, write a mapper returning `ImportPayload` from `src/shared/contracts.ts`. Validate it with `importSchema` from `src/server/catalogue/import.ts`. Follow `src/integrations/lists.ts` and the [list provenance notes](../src/integrations/manifests/README.md) for provenance, unknown fields and source identity.

Use the authenticated `/api/import` endpoint and `applyAndVerify` helper rather than writing SQLite directly. Preserve source records, stable import IDs, and explicit unknowns. Set `dryRun: true` for a transactional server preview that rolls back. Source history imports have more authority than question packs: test replay, ambiguous records, and export/restore on disposable data.

## Tutor adapters

Prefer the built MCP adapter; its `tools/list` response is the executable tool contract. The six tools are `get_today`, `search_questions`, `get_attempt_context`, `finish_attempt`, `save_review`, and `set_review_date`. See [Tutor integration](tutor-integration.md).

For custom local HTTP integrations, use `LocalApi` from `src/integrations/local-api.ts`. Respect optimistic versions, idempotency keys, disclosure restrictions and read-back verification. A 409 means re-read and reconcile, not blindly overwrite. Never create a new idempotency key after an uncertain write. The current HTTP API and TypeScript interfaces are pre-1.0; pin your integration to a tested app release/commit. Question-pack versioning does not imply the entire HTTP API is frozen.

## Boundaries

Keep scoring, schedule decisions and persistence in the core. Imports and tutors use those same domain operations. Do not bypass authentication, loosen loopback binding, expose the bearer token to the browser, or install downloaded code. Add only tests that protect the changed critical behavior; follow [Testing](testing.md).
