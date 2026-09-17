# Read-only Sheet migration

The Sheet remains authoritative. Reading/mapping a snapshot is not cutover permission; never write back to it or create two writable study histories.

## Snapshot format (version 1)

`import-sheet.ts` reads a UTF-8 JSON file, not a Google account. Obtain it separately through an authorised **read-only** Sheets export. No credentials are needed by this importer.

```json
{
  "spreadsheetId": "optional-source-id",
  "retrievedAt": "2026-09-16T00:00:00Z",
  "metadata": { "sheets": [{ "properties": { "title": "Tutor Tracker", "sheetId": 123 } }] },
  "sheets": [
    {
      "title": "Tutor Tracker",
      "sheetId": 123,
      "values": [
        ["Date", "Problem", "Link", "Result", "Time Min", "Notes"],
        ["2026-09-01", "Example title", "https://leetcode.com/problems/example-slug/", "Clean", "12:34", "Original notes"]
      ],
      "unformattedValues": [],
      "gridData": []
    }
  ]
}
```

The example is a format illustration, not production study data. `values` contains formatted rows starting at spreadsheet row **1**, whose first row is the header. Preserve blank rows and column positions. `unformattedValues` is optional and uses the same origin; `gridData` optionally retains the Sheets grid response (formulas, links, number formats, cell notes). `metadata` and `spreadsheetId` are optional, `retrievedAt` is required ISO datetime. Never compact rows or merge disjoint ranges before exporting.

The allowlist is **Neetcode List, Others, Tutor Tracker, Topic Ratings, Current Plan, Microsoft Top Questions, Neetcode 250 Additions**. `Neetcode250 Additions` is also accepted. All other tabs are excluded, including HI/system-design tabs and 3-Week Goals. Metadata can list all 14 workbook tabs while `sheets` contains only the seven exported LC tabs. Excluded titles are reconciled from both metadata and supplied sheets; their study rows are not imported.

## Review, then explicitly apply

```sh
npx tsx scripts/import-sheet.ts \
  --input "$HOME/Library/Application Support/LeetcodeTutor-dev/imports/source-sheet.json" \
  --dry-run --output /absolute/existing-private-directory/mapped-review.json

# Only after reviewing the mapping and confirming the local pilot target:
DATA_DIR=/absolute/pilot-directory PORT=4317 npx tsx scripts/import-sheet.ts \
  --input /absolute/source-sheet.json --apply
```

`--dry-run` works fully offline: no token access or backend connection. `--output` exclusively creates a 0600 file containing `{payload, report}`. Stdout contains counts, warnings and source references without full raw rows. Exactly one of `--dry-run` and `--apply` is required. Apply uses the canonical `/api/import`, then `/api/export` to verify the batch and **every source record's tab, row and raw data**. Backend unresolved canonical references must still be reviewed; source-record verification does not mean every ambiguous field was interpreted.

The deterministic `sheet-v2-<SHA256>` import ID fingerprints the original parsed snapshot. Retrying exactly the same snapshot is idempotent. With a spreadsheet ID, evidence is compared across snapshots by spreadsheet identity and source row key: unchanged evidence is a no-op, while changed existing evidence rejects the whole transaction with 409 for explicit reconciliation. Keep the spreadsheet ID in every export; anonymous snapshots do not establish this cross-extraction identity. Do not layer a new mapper version over an older pilot—rebuild a fresh isolated database. The `--output` review artifact always records the mapped payload with `dryRun:true`; only the explicit apply request changes that flag.

The corrected real-data pilot contains 293 questions after public-list ingestion, 114 source attempts, 20 unchanged topic scores and 107 explicit score decisions. Its 537 source records account for 536 original rows. Before cutover, review 33 unresolved source records (31 ambiguous durations and two unsupported URLs), plus 33 composite topic references that were preserved but not guessed into tracked-topic associations. These are separate categories that can overlap by row. The per-source report and CSV live outside Git in the pilot's `imports/` directory.

## Mapping rules and reconciliation

- Each supplied LC row—including headers and blank rows—has one `ImportRecord`. `sourceKey` is `<sheetId>:<1-based-row>` (encoded title fallback); raw formatted and unformatted row arrays are retained. One extra `_snapshot`/row-0 metadata record preserves workbook metadata, excluded titles and all supplied LC grid data. Thus `records = sourceRows + 1`. The report distinguishes imported, duplicate/merged, metadata and unresolved rows through these records; an unresolved row may still produce an attempt with unknown time.
- Header matching ignores punctuation/case, with explicit aliases: problem/name/title, link/URL, category, status, notes; Tracker uses date, result, time min, hint level, code/answer, evidence type, next review date, tracked topic(s) and tutor rating change. Topic Ratings uses topic, rating (1-5), notes and last practiced. Current Plan uses date, problem, link, status, notes. Unmapped columns remain in raw provenance, not inferred into other fields.
- Problems match **strict original LeetCode HTTPS URL/slug**, with recognised description/editorial/solutions/submissions suffixes. Whitespace, unrelated URLs and unsupported aliases are unresolved rather than silently repaired. Original URLs remain intact. Overlapping rows merge memberships and notes; no title-only guesses. Foreign-platform links remain source records for manual resolution.
- Sheet inventory memberships are named `Sheet: <tab>`, explicitly distinct from verified public lists. Only an explicit inventory `Completed` status creates legacy completion. `Skipped`, curriculum retirements, queued plans and notes never create a solved attempt. Completed Current Plan rows remain plans, not new completion proof.
- Tracker results follow the existing tutor vocabulary: Clean/Small Hint/Major Hint/Struggled/Looked Up are eventual solves; Failed is not solved; Stopped is stopped. Clean means no help, Small Hint small, Major Hint major, Looked Up solution. Explicit hint levels can increase recorded help: 0 none; 1–2 small; 3–4 major; 5 solution. Struggled/Failed with missing hint level retain unknown help. Unsupported results/dates stay unresolved. Code is imported only from an explicit code/answer cell, never reconstructed from notes.
- Numeric `Time Min` (including numeric strings) is **minutes**, converted to integer seconds. Exact `mm:ss` is supported. Three-component strings such as `33:44:00`, multiple durations, approximate prose and missing/invalid values become **null/Unknown** with warnings. Unformatted values remain provenance, not a reason to reinterpret a suspicious formatted time. Notes do not override the time cell.
- Existing 1–5 decimal scores are retained unchanged, marked provisional legacy evidence. Invalid/missing scores remain null. Historical score movements never replace the imported current rating.
- Supported movement syntax is `Topic 3.50 -> 3.65` or `Topic 3.50 → 3.65`, with optional balanced parenthesised rationales (including nested complexity expressions). Separate movements with semicolons or an unambiguous ` and ` **outside** parentheses. Every topic must match an imported current topic, independent of tab order. Explicit equal endpoints, `Topic remains 3.25 (...)`, and `Topic 3.75 (no change — rationale)` preserve no-change decisions only when the full grammar and stated score are valid. Deltas, inferred endpoints, malformed conjunctions, unknown topics and missing dates are rejected; original strings remain available for review.
- Dates are ISO `YYYY-MM-DD`; no locale/timezone guessing or fabricated dates. Historical plans are candidates, not mandatory overdue work. Instructions remain metadata. Dated placeholders with no problem URL retain their title in plan notes without inventing a question identity.

Before approval, reconcile per-tab source rows, deduplicated question inventory, all tracker attempts, unknown times, every topic score and explicit movement. Review the unresolved records, aliases, out-of-range data and legacy evidence labels. Keep the original snapshot unchanged and outside Git.

## Verified public lists and licensing

```sh
npx tsx scripts/import-lists.ts --dry-run
# Explicit local write, after review:
npx tsx scripts/import-lists.ts --apply
```

The original **NeetCode 150 and Blind 75** source remains unchanged: `neetcode-gh/leetcode/.problemSiteData.json`, immutable revision `9f104d45b1efc8c2e42b6dcc7b1216cdf8c4f80e`, SHA-256 `436dd487beb9126e30e9da8717ff76f2a78e3a94ca0ec4181d9d04de9f7b953c`. Its original metadata and MIT licence remain in `src/integrations/manifests/`. That file has no `neetcode250` flag; it is not the authority for the new membership.[3]

**NeetCode 250 is now independently verified from the public first-party application.** The official page renders “NeetCode 250”, `0/250`, and describes it as NeetCode 150 plus 100 problems.[1] Its public application asset contains explicit `neetcode250:!0` flags: a static AST extraction found **250 distinct original LeetCode links among 973 metadata rows**.[2] The importer does not infer these flags from the Sheet, titles, list size, or assumed nesting.

Website provenance, separate from the Git/MIT source:

- Page: `https://neetcode.io/practice/practice/neetcode250`.
- Retrieved asset: `https://neetcode.io/main.f39af0c52a4e9fb5.js`; recorded retrieval `2026-09-15T16:56:59.726Z`.
- Exact downloaded asset SHA-256: `426da304cbc42c91a25986ed680c06fd632fc25da741ac2881fd928ac9a051a8`; list `sourceVersion` is `sha256:` followed by this digest. The fingerprinted asset URL is not a promise of permanent hosting; the digest pins the observed bytes.
- Bundled minimal factual extraction: `src/integrations/manifests/neetcode250.json`. SHA-256 of UTF-8 `JSON.stringify(JSON.parse(file))`: `021e599c37e9d5770acc55bc212ef43b1f4e161eab7cb769bd069566b786c027`. This second hash covers both facts and provenance, and is checked before ingestion. Whitespace formatting does not change it; property order does.
- **No MIT licence is asserted for the website.** Only factual title/link/category/difficulty metadata and source references are retained, under the public-metadata-only scope. No application code, full statements, solutions, videos, premium pages, or personal progress is bundled. `LICENSE-neetcode.txt` applies to the original Git source, not the website extraction. See `manifests/README.md` for the retrieval and extraction procedure.

The utility verifies **150 unique NeetCode 150**, **75 unique Blind 75**, and **250 unique NeetCode 250** memberships, strict LC identities, and both pinned metadata checksums. Independent set reconciliation produces **150 overlaps with NeetCode 150, 75 with Blind 75, 100 additional identities relative to NeetCode 150, and a 250-question union**. These are computed intersections, not acceptance of the Sheet additions. Sheet memberships remain `Sheet: <tab>` and require separate row-level reconciliation.

No attempts, score movements, completion, or exposure are created. Original 150/75 titles, list source URLs/versions, and 150 source records are preserved; 250 additional website source records retain per-row asset URL/hash, extracted-metadata hash, page URL, and actual website retrieval time. The unchanged CLI automatically includes the bundled third list and uses the unchanged canonical `/api/lists`, `/api/import`, and `/api/export` contracts. The new deterministic `lists-v2-<old revision>-<old metadata hash>-<250 metadata hash>` batch distinguishes this import from the old two-list batch. Same-batch retries are idempotent. Existing conflicting list provenance still errors rather than silently relabelling; list metadata creation precedes the atomic import and can be retried if import fails.

Verification: strict RED/GREEN mapper tests cover count/identity rejection, tampering, per-source provenance, computed overlap, no invented history, and deterministic retries. An isolated real-backend CLI test applies twice and reads back all three paginated list filters: **250 problems, 475 membership edges, 400 source records, one batch, zero attempts/score decisions**. This is not a live-pilot import or a reconciliation against the user's Sheet. Updating either source requires fresh first-party retrieval, rights review, re-extraction/checksums, identity-set reconciliation, and explicit list-version migration—not simply editing a pin to accept arbitrary data.

Sources:

[1] https://neetcode.io/practice/practice/neetcode250
[2] https://neetcode.io/main.f39af0c52a4e9fb5.js
[3] https://github.com/neetcode-gh/leetcode/blob/9f104d45b1efc8c2e42b6dcc7b1216cdf8c4f80e/.problemSiteData.json

## Catalogue list display

The normal `/api/lists` response and problem list badges/filters share a read-only projection. `Sheet: Neetcode List`, both additions spellings, `Sheet: Others`, `Sheet: Tutor Tracker`, `Sheet: Current Plan`, and `Sheet: Topic Ratings` are source provenance, not selectable study lists. Meaningful company/custom lists remain visible; for example, `Sheet: Microsoft Top Questions` displays as **Microsoft Top Questions**, with its original ID unchanged.

Once canonical list records exist (normally via the verified-list import above), every stored question with a matching canonical slug appears in each independently verified public list, regardless of its import source or missing stored public-list membership edges. The projection uses the bundled manifests' explicit flags/identities, never Sheet names, titles, or assumed nesting. Existing explicit memberships are retained. It does not create list records, questions, or membership edges, and does not combine the overlapping NeetCode 150, NeetCode 250, and Blind 75 lists.

Old `listId` URLs for hidden Sheet inventories still filter their **original stored memberships**, not a guessed canonical replacement. Export/backup retain all original names, source records, memberships, and study history. Saving the displayed memberships back through the question editor preserves hidden source memberships and does not materialise manifest-derived edges; canonical slug membership remains derived rather than a removable custom assignment. No migration or live-data rewrite is required.

## Cutover gate

Keep the live Sheet/tutor configuration unchanged until the import report is approved, a fresh isolated app import is reconciled, representative answers/ratings/dates are checked, and an empty-database restore has been exercised. Preserve the source archive and original database. Cutover itself is not performed by any script here.
