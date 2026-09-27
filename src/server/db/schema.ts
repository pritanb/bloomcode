/** The whole schema, created once in a new, empty database. */
export const GOAL_SCHEMA = `
CREATE TABLE learning_goals (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('active', 'completed', 'abandoned')),
  version INTEGER NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  sourceConversation TEXT NOT NULL
);
CREATE UNIQUE INDEX active_goal_text ON learning_goals(lower(trim(text))) WHERE state = 'active';
`;
export const SCHEMA =
  GOAL_SCHEMA +
  `
CREATE TABLE settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  timezone TEXT NOT NULL,
  primaryCount INTEGER NOT NULL,
  optionalCount INTEGER NOT NULL,
  questionsPerDay INTEGER,
  onboardingComplete INTEGER,
  autoScore INTEGER,
  recommendations TEXT CHECK (recommendations IS NULL OR json_valid(recommendations)),
  lastBackupAt TEXT,
  insightsEnabled INTEGER NOT NULL DEFAULT 0
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

CREATE TABLE idempotency (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, response TEXT NOT NULL);
CREATE TABLE insight_embeddings (id TEXT PRIMARY KEY NOT NULL, fingerprint TEXT NOT NULL, model TEXT NOT NULL, vector TEXT NOT NULL);
CREATE TABLE insight_jobs (
  id TEXT PRIMARY KEY,
  attemptId TEXT REFERENCES attempts (id),
  fingerprint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'done', 'failed')),
  claimId TEXT,
  claimedAt INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  model TEXT,
  durationMs INTEGER NOT NULL DEFAULT 0,
  limitation TEXT NOT NULL DEFAULT '',
  evidenceIds TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(evidenceIds)),
  questionIds TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(questionIds)),
  CHECK ((attemptId IS NULL) = (id = 'report-job'))
);
CREATE TABLE insight_observations (
  id TEXT PRIMARY KEY,
  attemptId TEXT NOT NULL REFERENCES attempts (id),
  fingerprint TEXT NOT NULL,
  summary TEXT NOT NULL,
  polarity TEXT NOT NULL CHECK (polarity IN ('difficulty', 'strength')),
  evidenceType TEXT NOT NULL CHECK (evidenceType IN ('learner_reported', 'code_inferred', 'outcome_observed')),
  sourceField TEXT NOT NULL CHECK (sourceField IN ('code', 'notes', 'takeaway', 'mistakeLabels', 'outcome', 'help', 'confidence')),
  excerpt TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  analysisVersion TEXT NOT NULL,
  model TEXT
);
CREATE INDEX insight_observations_attempt ON insight_observations (attemptId, fingerprint);
CREATE TABLE insight_corrections (
  observationId TEXT PRIMARY KEY REFERENCES insight_observations (id),
  reason TEXT NOT NULL,
  createdAt TEXT NOT NULL
);
CREATE TABLE insight_reports (
  id TEXT PRIMARY KEY,
  findings TEXT NOT NULL CHECK (json_valid(findings)),
  topicPriorities TEXT CHECK (topicPriorities IS NULL OR json_valid(topicPriorities)),
  limitation TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  total INTEGER NOT NULL,
  analyzed INTEGER NOT NULL,
  evidenceIds TEXT NOT NULL CHECK (json_valid(evidenceIds)),
  model TEXT,
  analysisVersion TEXT NOT NULL,
  durationMs INTEGER NOT NULL
);
CREATE TABLE topic_analysis (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  enabled INTEGER NOT NULL,
  fingerprint TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('idle', 'pending', 'running', 'done', 'failed')),
  claimId TEXT,
  claimedAt INTEGER NOT NULL,
  error TEXT,
  report TEXT CHECK (report IS NULL OR json_valid(report))
);
`;
