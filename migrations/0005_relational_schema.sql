-- Replace the JSON `data` columns with typed columns. Column names match the TypeScript
-- fields, so a row reads back as its API object. Copies of other records (an attempt's
-- problem, a decision's topic name, a problem's latest-attempt summary, ...) are dropped:
-- queries join or compute them instead. The runner switches foreign keys off while
-- migrating and checks them afterwards.

DROP INDEX IF EXISTS target_problem;
DROP INDEX IF EXISTS topic_name;
DROP INDEX IF EXISTS plan_day;
DROP INDEX IF EXISTS one_active_attempt;
DROP INDEX IF EXISTS problem_slug;
DROP INDEX IF EXISTS tag_name;
DROP INDEX IF EXISTS list_name;

-- Write-only history nobody reads: the audit log, and answer copies identical to their attempt.
DROP TABLE audit_events;
DROP TABLE answer_versions;

ALTER TABLE settings RENAME TO old_settings;
ALTER TABLE problems RENAME TO old_problems;
ALTER TABLE tags RENAME TO old_tags;
ALTER TABLE lists RENAME TO old_lists;
ALTER TABLE problem_tags RENAME TO old_problem_tags;
ALTER TABLE list_memberships RENAME TO old_list_memberships;
ALTER TABLE attempts RENAME TO old_attempts;
ALTER TABLE review_targets RENAME TO old_review_targets;
ALTER TABLE topics RENAME TO old_topics;
ALTER TABLE score_decisions RENAME TO old_score_decisions;
ALTER TABLE attempt_topics RENAME TO old_attempt_topics;
ALTER TABLE daily_plans RENAME TO old_daily_plans;
ALTER TABLE plan_items RENAME TO old_plan_items;
ALTER TABLE import_batches RENAME TO old_import_batches;
ALTER TABLE import_records RENAME TO old_import_records;

CREATE TABLE settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  timezone TEXT NOT NULL,
  budgetMinutes INTEGER NOT NULL,
  primaryCount INTEGER NOT NULL,
  optionalCount INTEGER NOT NULL,
  questionsPerDay INTEGER,
  onboardingComplete INTEGER,
  autoScore INTEGER,
  recommendations TEXT CHECK (recommendations IS NULL OR json_valid(recommendations)),
  lastBackupAt TEXT
);
CREATE TABLE problems (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  difficulty TEXT CHECK (difficulty IN ('Easy', 'Medium', 'Hard')),
  notes TEXT NOT NULL DEFAULT '',
  leetcodeTopics TEXT CHECK (leetcodeTopics IS NULL OR json_valid(leetcodeTopics)),
  legacyCompleted INTEGER NOT NULL DEFAULT 0,
  exposed INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  archived INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL DEFAULT 'pattern' CHECK (kind IN ('topic', 'pattern')),
  hue REAL,
  recognitionCues TEXT NOT NULL DEFAULT '',
  pitfalls TEXT NOT NULL DEFAULT '',
  patternNotes TEXT NOT NULL DEFAULT '',
  notebookVersion INTEGER NOT NULL DEFAULT 1,
  notebookUpdatedAt TEXT
);
CREATE UNIQUE INDEX tag_name ON tags (lower(name));
CREATE TABLE lists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sourceUrl TEXT,
  sourceVersion TEXT
);
CREATE UNIQUE INDEX list_name ON lists (lower(name));
CREATE TABLE problem_tags (
  problemId TEXT NOT NULL REFERENCES problems (id),
  tagId TEXT NOT NULL REFERENCES tags (id),
  PRIMARY KEY (problemId, tagId)
);
CREATE TABLE list_memberships (
  problemId TEXT NOT NULL REFERENCES problems (id),
  listId TEXT NOT NULL REFERENCES lists (id),
  PRIMARY KEY (problemId, listId)
);
CREATE TABLE daily_plans (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  timezone TEXT NOT NULL,
  version INTEGER NOT NULL,
  UNIQUE (date, timezone)
);
CREATE TABLE plan_items (
  id TEXT PRIMARY KEY,
  planId TEXT NOT NULL REFERENCES daily_plans (id),
  position INTEGER NOT NULL,
  problemId TEXT NOT NULL REFERENCES problems (id),
  attemptId TEXT REFERENCES attempts (id),
  status TEXT NOT NULL CHECK (status IN ('active', 'queued', 'optional', 'completed', 'skipped')),
  reason TEXT NOT NULL,
  suggestedMinutes INTEGER NOT NULL,
  recommendationKind TEXT CHECK (recommendationKind IN ('topic', 'refresher', 'balanced'))
);
CREATE INDEX plan_items_plan ON plan_items (planId);
CREATE TABLE attempts (
  id TEXT PRIMARY KEY,
  problemId TEXT NOT NULL REFERENCES problems (id),
  planItemId TEXT REFERENCES plan_items (id),
  context TEXT NOT NULL CHECK (context IN ('mixed', 'targeted', 'review')),
  status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'completed')),
  version INTEGER NOT NULL,
  language TEXT NOT NULL,
  code TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  takeaway TEXT,
  mistakeLabels TEXT CHECK (mistakeLabels IS NULL OR json_valid(mistakeLabels)),
  evidence TEXT NOT NULL CHECK (evidence IN ('retention', 'near_transfer', 'unseen', 'mock', 'legacy', 'immediate_repair')),
  help TEXT NOT NULL CHECK (help IN ('none', 'small', 'major', 'solution', 'unknown')),
  outcome TEXT CHECK (outcome IN ('solved', 'not_solved', 'stopped')),
  confidence REAL CHECK (confidence BETWEEN 1 AND 5),
  feedback TEXT,
  activeSeconds INTEGER,
  gapSeconds INTEGER NOT NULL DEFAULT 0,
  startedAt TEXT NOT NULL,
  finishedAt TEXT,
  studyDate TEXT NOT NULL,
  runningSince TEXT,
  lastHeartbeatAt TEXT,
  needsGapDecision INTEGER NOT NULL DEFAULT 0,
  reviewedAt TEXT,
  nextReviewDate TEXT,
  sourceKey TEXT,
  importId TEXT
);
CREATE INDEX attempts_problem ON attempts (problemId);
CREATE UNIQUE INDEX one_active_attempt ON attempts ((1)) WHERE status IN ('active', 'paused');
CREATE TABLE review_targets (
  id TEXT PRIMARY KEY,
  problemId TEXT NOT NULL UNIQUE REFERENCES problems (id),
  recommendedDate TEXT,
  effectiveDate TEXT,
  action TEXT NOT NULL CHECK (action IN ('recommended', 'manual', 'snooze', 'none')),
  stage TEXT NOT NULL,
  version INTEGER NOT NULL
);
CREATE TABLE topics (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  score REAL CHECK (score BETWEEN 1 AND 5),
  version INTEGER NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  lastReviewed TEXT,
  provisional INTEGER NOT NULL
);
CREATE UNIQUE INDEX topic_name ON topics (lower(name));
CREATE TABLE score_decisions (
  id TEXT PRIMARY KEY,
  topicId TEXT NOT NULL REFERENCES topics (id),
  attemptId TEXT REFERENCES attempts (id),
  oldScore REAL NOT NULL,
  newScore REAL NOT NULL,
  rationale TEXT NOT NULL,
  evidence TEXT NOT NULL,
  date TEXT NOT NULL,
  recordedAt TEXT NOT NULL,
  supersedesId TEXT REFERENCES score_decisions (id),
  sourceKey TEXT,
  importId TEXT
);
CREATE INDEX score_decisions_topic ON score_decisions (topicId);
CREATE INDEX score_decisions_attempt ON score_decisions (attemptId);
CREATE TABLE attempt_topics (
  attemptId TEXT NOT NULL REFERENCES attempts (id),
  topicId TEXT NOT NULL REFERENCES topics (id),
  PRIMARY KEY (attemptId, topicId)
);
CREATE TABLE import_batches (
  id TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL,
  source TEXT NOT NULL CHECK (json_valid(source)),
  appliedAt TEXT NOT NULL
);
-- Original source rows, kept as they came in.
CREATE TABLE import_records (
  id TEXT PRIMARY KEY,
  importId TEXT NOT NULL REFERENCES import_batches (id),
  sourceKey TEXT NOT NULL,
  tab TEXT NOT NULL,
  "row" INTEGER NOT NULL,
  raw TEXT CHECK (raw IS NULL OR json_valid(raw)),
  status TEXT NOT NULL,
  reason TEXT
);

-- Copy in rowid order: several lists are shown in the order rows were written.
-- Tags saved without a kind are the old curriculum categories; recommendations and
-- insights already treated them as topics.
INSERT INTO settings SELECT 1,
  json_extract(data, '$.timezone'), json_extract(data, '$.budgetMinutes'),
  json_extract(data, '$.primaryCount'), json_extract(data, '$.optionalCount'),
  json_extract(data, '$.questionsPerDay'), json_extract(data, '$.onboardingComplete'),
  json_extract(data, '$.autoScore'), data -> '$.recommendations',
  json_extract(data, '$.lastBackupAt')
FROM old_settings WHERE id = 'singleton';
INSERT INTO problems SELECT id,
  json_extract(data, '$.slug'), json_extract(data, '$.title'), json_extract(data, '$.url'),
  json_extract(data, '$.difficulty'), coalesce(json_extract(data, '$.notes'), ''),
  data -> '$.leetcodeTopics', coalesce(json_extract(data, '$.legacyCompleted'), 0),
  coalesce(json_extract(data, '$.exposed'), 0)
FROM old_problems ORDER BY rowid;
INSERT INTO tags SELECT id,
  json_extract(data, '$.name'), coalesce(json_extract(data, '$.description'), ''),
  coalesce(json_extract(data, '$.archived'), 0), coalesce(json_extract(data, '$.kind'), 'topic'),
  json_extract(data, '$.hue'), coalesce(json_extract(data, '$.recognitionCues'), ''),
  coalesce(json_extract(data, '$.pitfalls'), ''), coalesce(json_extract(data, '$.patternNotes'), ''),
  coalesce(json_extract(data, '$.notebookVersion'), 1), json_extract(data, '$.notebookUpdatedAt')
FROM old_tags ORDER BY rowid;
INSERT INTO lists SELECT id,
  json_extract(data, '$.name'), json_extract(data, '$.sourceUrl'), json_extract(data, '$.sourceVersion')
FROM old_lists ORDER BY rowid;
INSERT INTO problem_tags SELECT problem_id, tag_id FROM old_problem_tags ORDER BY rowid;
INSERT INTO list_memberships SELECT problem_id, list_id FROM old_list_memberships ORDER BY rowid;
INSERT INTO daily_plans SELECT id,
  json_extract(data, '$.date'), json_extract(data, '$.timezone'), json_extract(data, '$.version')
FROM old_daily_plans ORDER BY rowid;
INSERT INTO plan_items SELECT id, plan_id,
  json_extract(data, '$.position'), problem_id, attempt_id, json_extract(data, '$.status'),
  json_extract(data, '$.reason'), json_extract(data, '$.suggestedMinutes'),
  json_extract(data, '$.recommendationKind')
FROM old_plan_items ORDER BY rowid;
INSERT INTO attempts SELECT id, problem_id,
  json_extract(data, '$.planItemId'), json_extract(data, '$.context'), json_extract(data, '$.status'),
  json_extract(data, '$.version'), json_extract(data, '$.language'),
  coalesce(json_extract(data, '$.code'), ''), coalesce(json_extract(data, '$.notes'), ''),
  json_extract(data, '$.takeaway'), data -> '$.mistakeLabels',
  json_extract(data, '$.evidence'), json_extract(data, '$.help'), json_extract(data, '$.outcome'),
  json_extract(data, '$.confidence'), json_extract(data, '$.feedback'),
  json_extract(data, '$.activeSeconds'), coalesce(json_extract(data, '$.gapSeconds'), 0),
  json_extract(data, '$.startedAt'), json_extract(data, '$.finishedAt'),
  json_extract(data, '$.studyDate'), json_extract(data, '$.runningSince'),
  json_extract(data, '$.lastHeartbeatAt'), coalesce(json_extract(data, '$.needsGapDecision'), 0),
  json_extract(data, '$.reviewedAt'), json_extract(data, '$.nextReviewDate'),
  json_extract(data, '$.sourceKey'), json_extract(data, '$.importId')
FROM old_attempts ORDER BY rowid;
INSERT INTO review_targets SELECT id, problem_id,
  json_extract(data, '$.recommendedDate'), json_extract(data, '$.effectiveDate'),
  json_extract(data, '$.action'), json_extract(data, '$.stage'), json_extract(data, '$.version')
FROM old_review_targets ORDER BY rowid;
INSERT INTO topics SELECT id,
  json_extract(data, '$.name'), json_extract(data, '$.score'), json_extract(data, '$.version'),
  coalesce(json_extract(data, '$.notes'), ''), json_extract(data, '$.lastReviewed'),
  coalesce(json_extract(data, '$.provisional'), 0)
FROM old_topics ORDER BY rowid;
INSERT INTO score_decisions SELECT id, topic_id, attempt_id,
  json_extract(data, '$.oldScore'), json_extract(data, '$.newScore'),
  json_extract(data, '$.rationale'), json_extract(data, '$.evidence'), json_extract(data, '$.date'),
  json_extract(data, '$.recordedAt'), json_extract(data, '$.supersedesId'),
  json_extract(data, '$.sourceKey'), json_extract(data, '$.importId')
FROM old_score_decisions ORDER BY rowid;
INSERT INTO attempt_topics SELECT attempt_id, topic_id FROM old_attempt_topics ORDER BY rowid;
INSERT INTO import_batches SELECT id,
  json_extract(data, '$.fingerprint'), data -> '$.source', json_extract(data, '$.appliedAt')
FROM old_import_batches ORDER BY rowid;
INSERT INTO import_records SELECT id, import_id,
  json_extract(data, '$.sourceKey'), json_extract(data, '$.tab'), json_extract(data, '$.row'),
  data -> '$.raw', json_extract(data, '$.status'), json_extract(data, '$.reason')
FROM old_import_records ORDER BY rowid;

DROP TABLE old_import_records;
DROP TABLE old_import_batches;
DROP TABLE old_attempt_topics;
DROP TABLE old_score_decisions;
DROP TABLE old_topics;
DROP TABLE old_review_targets;
DROP TABLE old_plan_items;
DROP TABLE old_attempts;
DROP TABLE old_daily_plans;
DROP TABLE old_list_memberships;
DROP TABLE old_problem_tags;
DROP TABLE old_lists;
DROP TABLE old_tags;
DROP TABLE old_problems;
DROP TABLE old_settings;
