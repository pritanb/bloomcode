CREATE TABLE learning_insights (id TEXT PRIMARY KEY NOT NULL, data TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE insight_embeddings (id TEXT PRIMARY KEY NOT NULL, fingerprint TEXT NOT NULL, model TEXT NOT NULL, vector TEXT NOT NULL);
