-- Retire what only the old Google Sheet import used. openDb saves a copy of the
-- database to backups/ before any pending migration runs.
DROP TABLE IF EXISTS `patterns`;
--> statement-breakpoint
DROP TABLE IF EXISTS `import_plans`;
--> statement-breakpoint
DELETE FROM `list_memberships` WHERE `list_id` IN (SELECT `id` FROM `lists` WHERE lower(json_extract(`data`, '$.name')) IN ('sheet: neetcode list', 'sheet: neetcode 250 additions', 'sheet: neetcode250 additions', 'sheet: tutor tracker', 'sheet: current plan', 'sheet: topic ratings', 'sheet: others'));
--> statement-breakpoint
DELETE FROM `lists` WHERE lower(json_extract(`data`, '$.name')) IN ('sheet: neetcode list', 'sheet: neetcode 250 additions', 'sheet: neetcode250 additions', 'sheet: tutor tracker', 'sheet: current plan', 'sheet: topic ratings', 'sheet: others');
--> statement-breakpoint
UPDATE `lists` SET `data` = json_set(`data`, '$.name', trim(substr(json_extract(`data`, '$.name'), 7))) WHERE json_extract(`data`, '$.name') LIKE 'Sheet:%' AND NOT EXISTS (SELECT 1 FROM `lists` AS `other` WHERE lower(json_extract(`other`.`data`, '$.name')) = lower(trim(substr(json_extract(`lists`.`data`, '$.name'), 7))));
--> statement-breakpoint
UPDATE `settings` SET `data` = json_remove(`data`, '$.dataMode');
