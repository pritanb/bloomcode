# Public list metadata provenance

## Two independent sources

`neetcode-problems.json` and `LICENSE-neetcode.txt` are the unchanged first-party Git/MIT source for NeetCode 150 and the NeetCode-published Blind 75 edition. The immutable revision and byte checksum remain in `../lists.ts`. Do not extend that licence attribution to other files here.

`neetcode250.json` is a **minimal factual extraction**, not a copy of the website's application or a claim that its code is MIT licensed. Its envelope records the public first-party page, exact application asset URL, asset SHA-256, retrieval timestamp and rights limitation. Each row retains only `problem` (title), original LeetCode-relative `link`, `pattern` (category) and `difficulty`. No descriptions, solutions, video IDs, code, personal progress or premium content are retained.

## Observed source and extraction procedure

1. An unauthenticated read of `https://neetcode.io/practice/neetcode250` returned the public application shell referencing `main.f39af0c52a4e9fb5.js`. The rendered canonical route is `https://neetcode.io/practice/practice/neetcode250`. A clean headless Chromium context rendered the NeetCode 250 title, `0/250`, its difficulty totals and its introductory 150-plus-100 description. No login or user browser profile was used. The first HTML response SHA-256 was `d1066648d74f98fe6a721aa8477b3ebe1d114cad71c018a78b48b9051c4f6706` (shell evidence, not membership evidence).
2. Read `https://neetcode.io/main.f39af0c52a4e9fb5.js` without authentication. Its exact downloaded bytes hash to `426da304cbc42c91a25986ed680c06fd632fc25da741ac2881fd928ac9a051a8`. A content-fingerprinted filename alone is not sufficient verification. If the URL disappears or returns different bytes, stop; do not silently fetch a newer asset under this pin.
3. Parse the application as JavaScript **syntax**, using the repository's installed TypeScript `createSourceFile(..., ScriptTarget.Latest, true, ScriptKind.JS)`. Do not execute downloaded JavaScript with `eval`, `Function`, or Node imports. In this asset, the array beginning `O=[{problem:"Concatenation of Array",...` has 973 object-literal problem metadata records. The selected array's first object has the explicit `neetcode250:!0` property.
4. Decode only literal string fields and boolean `!0` (true); select only rows with an explicit true `neetcode250` property. Discard everything except title/link/category/difficulty. This yields the 250 rows in `neetcode250.json`, in source order. There are exactly 250 distinct original LeetCode-relative links; no title matching or invented nesting is used. Rendered category groups were collapsed, so per-row membership evidence comes from these explicit application metadata flags, not a claim that all rendered problem titles were scraped.
5. Compare sets by original LeetCode slug against the independent pinned Git flags. Observed overlap: 150 with NeetCode 150 and 75 with Blind 75; 100 additional identities relative to NeetCode 150; union 250. These are computed results, not a validation of any Sheet additions tab.
6. SHA-256 of UTF-8 `JSON.stringify(JSON.parse(neetcode250.json))` is `021e599c37e9d5770acc55bc212ef43b1f4e161eab7cb769bd069566b786c027`. It covers the full minimal manifest including provenance. The importer checks this independent pin before importing; indentation changes are immaterial, property order is significant. The asset hash versions the list; the extracted-metadata hash fingerprints the deterministic v2 import batch and each new source record.

The downloaded application bytes were used only as temporary retrieval evidence; they are not bundled or executed by this importer. The importer is offline and has no browser, account, statement or solution-fetching path. Updating the public snapshot requires explicit provenance/rights review, re-extraction, checksums, set reconciliation and list-version migration. A site update is not authority to change the preserved Git/MIT source.

## Verification

From the repository root:

```sh
npx vitest run tests/integrations/list-projection.test.ts tests/integrations/lists-api.test.ts
npm run typecheck
npx tsx scripts/import-lists.ts --dry-run
```

The API test uses a newly created temporary database and deletes it afterward. It exercises the real unchanged CLI twice, verifies every source record via canonical export, enumerates all three paginated list filters against expected source identities, and confirms no attempts, scores or completion evidence were invented. It does not touch a live pilot, Sheet or tutor configuration.
