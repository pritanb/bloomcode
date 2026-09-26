-- Fill values the Google Sheet import left empty, using the source rows it kept in
-- import_records and public problem metadata. Nothing here recalculates scores or review
-- dates. On a database without these imports every statement matches no rows.
-- Tutor Tracker columns: 6 = Time Min, 7 = Confidence, 8 = Mistake Type.

-- Solve times: Sheets read "29:51" (minutes:seconds) as 29:51:00 (hours), so the importer
-- left them Unknown. Read the first two parts as minutes and seconds.
UPDATE `attempts` SET `data` = json_set(`data`, '$.activeSeconds', (
  SELECT CAST(substr(t, 1, instr(t, ':') - 1) AS INTEGER) * 60 + CAST(substr(t, instr(t, ':') + 1, 2) AS INTEGER)
  FROM (SELECT json_extract(r.`data`, '$.raw.formatted[6]') AS t FROM `import_records` r
        WHERE json_extract(r.`data`, '$.sourceKey') = json_extract(`attempts`.`data`, '$.sourceKey')
          AND json_extract(r.`data`, '$.tab') = 'Tutor Tracker'))
)
WHERE json_extract(`data`, '$.activeSeconds') IS NULL AND EXISTS (
  SELECT 1 FROM `import_records` r
  WHERE json_extract(r.`data`, '$.sourceKey') = json_extract(`attempts`.`data`, '$.sourceKey')
    AND json_extract(r.`data`, '$.tab') = 'Tutor Tracker'
    AND (json_extract(r.`data`, '$.raw.formatted[6]') GLOB '[0-9]:[0-5][0-9]:00'
      OR json_extract(r.`data`, '$.raw.formatted[6]') GLOB '[0-9][0-9]:[0-5][0-9]:00'));
--> statement-breakpoint
-- Times written as two readings: use the final accepted solution.
UPDATE `attempts` SET `data` = json_set(`data`, '$.activeSeconds', (
  SELECT CASE json_extract(r.`data`, '$.raw.formatted[6]')
    WHEN '9:33 final / 7:41 first' THEN 573
    WHEN '16:34 first AC / 24:05 one-pass' THEN 994
    WHEN '27:54 O(n*M) / 40:00 O(n)' THEN 2400
    WHEN '17:20 optimal / 10:01 brute force' THEN 1040
    WHEN '8:15 after hint / ~5m before hint' THEN 495
  END FROM `import_records` r
  WHERE json_extract(r.`data`, '$.sourceKey') = json_extract(`attempts`.`data`, '$.sourceKey')
    AND json_extract(r.`data`, '$.tab') = 'Tutor Tracker')
)
WHERE json_extract(`data`, '$.activeSeconds') IS NULL AND EXISTS (
  SELECT 1 FROM `import_records` r
  WHERE json_extract(r.`data`, '$.sourceKey') = json_extract(`attempts`.`data`, '$.sourceKey')
    AND json_extract(r.`data`, '$.tab') = 'Tutor Tracker'
    AND json_extract(r.`data`, '$.raw.formatted[6]') IN ('9:33 final / 7:41 first',
      '16:34 first AC / 24:05 one-pass', '27:54 O(n*M) / 40:00 O(n)',
      '17:20 optimal / 10:01 brute force', '8:15 after hint / ~5m before hint'));
--> statement-breakpoint
-- Confidence (1-5, halves allowed) was never mapped from the Sheet.
UPDATE `attempts` SET `data` = json_set(`data`, '$.confidence', (
  SELECT CAST(json_extract(r.`data`, '$.raw.formatted[7]') AS REAL) FROM `import_records` r
  WHERE json_extract(r.`data`, '$.sourceKey') = json_extract(`attempts`.`data`, '$.sourceKey')
    AND json_extract(r.`data`, '$.tab') = 'Tutor Tracker')
)
WHERE json_extract(`data`, '$.confidence') IS NULL AND EXISTS (
  SELECT 1 FROM `import_records` r
  WHERE json_extract(r.`data`, '$.sourceKey') = json_extract(`attempts`.`data`, '$.sourceKey')
    AND json_extract(r.`data`, '$.tab') = 'Tutor Tracker'
    AND json_extract(r.`data`, '$.raw.formatted[7]') IN ('1', '1.5', '2', '2.5', '3', '3.5', '4', '4.5', '5'));
--> statement-breakpoint
-- Mistake types that map clearly onto the app's labels; free-text ones stay as they are.
UPDATE `attempts` SET `data` = json_set(`data`, '$.mistakeLabels', json((
  SELECT CASE json_extract(r.`data`, '$.raw.formatted[8]')
    WHEN 'Implementation' THEN '["implementation_bug"]'
    WHEN 'Implementation self-fix' THEN '["implementation_bug"]'
    WHEN 'Edge Case' THEN '["missed_edge_case"]'
    WHEN 'Reasoning' THEN '["wrong_approach"]'
    WHEN 'Pattern Recognition' THEN '["wrong_approach"]'
    WHEN 'Reasoning/Implementation' THEN '["wrong_approach","implementation_bug"]'
  END FROM `import_records` r
  WHERE json_extract(r.`data`, '$.sourceKey') = json_extract(`attempts`.`data`, '$.sourceKey')
    AND json_extract(r.`data`, '$.tab') = 'Tutor Tracker')))
WHERE json_array_length(coalesce(json_extract(`data`, '$.mistakeLabels'), '[]')) = 0 AND EXISTS (
  SELECT 1 FROM `import_records` r
  WHERE json_extract(r.`data`, '$.sourceKey') = json_extract(`attempts`.`data`, '$.sourceKey')
    AND json_extract(r.`data`, '$.tab') = 'Tutor Tracker'
    AND json_extract(r.`data`, '$.raw.formatted[8]') IN ('Implementation', 'Implementation self-fix',
      'Edge Case', 'Reasoning', 'Pattern Recognition', 'Reasoning/Implementation'));
--> statement-breakpoint
-- Imported score movements belong to the attempt whose source row they came from
-- (movement key = attempt key + ":movement:N").
UPDATE `score_decisions` SET `attempt_id` = (
  SELECT a.`id` FROM `attempts` a
  WHERE json_extract(a.`data`, '$.sourceKey') =
    substr(json_extract(`score_decisions`.`data`, '$.sourceKey'), 1, instr(json_extract(`score_decisions`.`data`, '$.sourceKey'), ':movement:') - 1)
)
WHERE `attempt_id` IS NULL AND instr(coalesce(json_extract(`data`, '$.sourceKey'), ''), ':movement:') > 0;
--> statement-breakpoint
UPDATE `score_decisions` SET `data` = json_set(`data`, '$.attemptId', `attempt_id`)
WHERE `attempt_id` IS NOT NULL AND json_extract(`data`, '$.attemptId') IS NULL;
--> statement-breakpoint
-- An attempt counts toward every topic its score movements changed.
INSERT OR IGNORE INTO `attempt_topics` (`id`, `data`, `topic_id`, `attempt_id`)
SELECT DISTINCT `attempt_id` || ':' || `topic_id`,
  json_object('id', `attempt_id` || ':' || `topic_id`, 'attemptId', `attempt_id`, 'topicId', `topic_id`),
  `topic_id`, `attempt_id`
FROM `score_decisions` WHERE `attempt_id` IS NOT NULL;
--> statement-breakpoint
-- Missing LeetCode difficulty, from the NeetCode manifests and leetcode.com.
WITH v(slug, d) AS (VALUES
  ('binary-tree-zigzag-level-order-traversal', 'Medium'),
  ('can-place-flowers', 'Easy'),
  ('coin-change-2', 'Medium'),
  ('contiguous-array', 'Medium'),
  ('continuous-subarray-sum', 'Medium'),
  ('employee-importance', 'Medium'),
  ('find-all-anagrams-in-a-string', 'Medium'),
  ('find-peak-element', 'Medium'),
  ('find-the-smallest-divisor-given-a-threshold', 'Medium'),
  ('frequency-of-the-most-frequent-element', 'Medium'),
  ('furthest-building-you-can-reach', 'Medium'),
  ('intersection-of-two-linked-lists', 'Easy'),
  ('lowest-common-ancestor-of-a-binary-tree', 'Medium'),
  ('magnetic-force-between-two-balls', 'Medium'),
  ('max-consecutive-ones-iii', 'Medium'),
  ('maximum-candies-allocated-to-k-children', 'Medium'),
  ('maximum-erasure-value', 'Medium'),
  ('minimum-limit-of-balls-in-a-bag', 'Medium'),
  ('minimum-number-of-arrows-to-burst-balloons', 'Medium'),
  ('next-greater-element-ii', 'Medium'),
  ('populating-next-right-pointers-in-each-node', 'Medium'),
  ('remove-covered-intervals', 'Medium'),
  ('remove-k-digits', 'Medium'),
  ('reorder-routes-to-make-all-paths-lead-to-the-city-zero', 'Medium'),
  ('search-a-2d-matrix-ii', 'Medium'),
  ('string-to-integer-atoi', 'Medium'),
  ('subarray-product-less-than-k', 'Medium'),
  ('subarray-sums-divisible-by-k', 'Medium'),
  ('successful-pairs-of-spells-and-potions', 'Medium'),
  ('sum-of-subarray-minimums', 'Medium'),
  ('trim-a-binary-search-tree', 'Medium'))
UPDATE `problems` SET `data` = json_set(`data`, '$.difficulty',
  (SELECT d FROM v WHERE v.slug = json_extract(`problems`.`data`, '$.slug')))
WHERE json_extract(`data`, '$.difficulty') IS NULL
  AND json_extract(`data`, '$.slug') IN (SELECT slug FROM v);
