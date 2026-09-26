CREATE TABLE IF NOT EXISTS idempotency (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, response TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS review_targets (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)), problem_id TEXT NOT NULL REFERENCES problems(id));
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS target_problem ON review_targets(problem_id,COALESCE(json_extract(data,'$.constraint'),''));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS answer_versions (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)), attempt_id TEXT NOT NULL REFERENCES attempts(id));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS audit_events (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS topics (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)));
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS topic_name ON topics(lower(json_extract(data,'$.name')));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS score_decisions (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)), topic_id TEXT NOT NULL REFERENCES topics(id), attempt_id TEXT REFERENCES attempts(id));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS attempt_topics (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)), topic_id TEXT NOT NULL REFERENCES topics(id), attempt_id TEXT NOT NULL REFERENCES attempts(id), UNIQUE(topic_id,attempt_id));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS import_batches (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS import_records (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)), import_id TEXT NOT NULL REFERENCES import_batches(id));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS import_plans (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)), import_id TEXT NOT NULL REFERENCES import_batches(id), problem_id TEXT REFERENCES problems(id));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS daily_plans (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)));
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS plan_day ON daily_plans(json_extract(data,'$.date'),json_extract(data,'$.timezone'));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS plan_items (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)), plan_id TEXT NOT NULL REFERENCES daily_plans(id), problem_id TEXT REFERENCES problems(id), attempt_id TEXT REFERENCES attempts(id));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS settings (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS attempts (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)), problem_id TEXT NOT NULL REFERENCES problems(id));
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS one_active_attempt ON attempts((1)) WHERE json_extract(data,'$.status') IN ('active','paused');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS problems (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)));
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS problem_slug ON problems(json_extract(data,'$.slug'));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS tags (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)));
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS tag_name ON tags(lower(json_extract(data,'$.name')));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS lists (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)));
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS list_name ON lists(lower(json_extract(data,'$.name')));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS problem_tags (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)), problem_id TEXT NOT NULL REFERENCES problems(id), tag_id TEXT NOT NULL REFERENCES tags(id), UNIQUE(problem_id,tag_id));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS list_memberships (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)), problem_id TEXT NOT NULL REFERENCES problems(id), list_id TEXT NOT NULL REFERENCES lists(id), UNIQUE(problem_id,list_id));

