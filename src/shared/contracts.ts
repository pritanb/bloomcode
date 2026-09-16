export type Help = 'none' | 'small' | 'major' | 'solution' | 'unknown';
export type Outcome = 'solved' | 'not_solved' | 'stopped';
export interface Tag { id: string; name: string; description: string; archived: boolean }
export interface ProblemList { id: string; name: string; sourceUrl: string | null; sourceVersion: string | null }
export interface Problem {
  id: string; title: string; url: string; slug: string; difficulty: string | null; notes: string;
  tags: (Tag & { difficulty: number | null })[]; lists: ProblemList[];
  legacyCompleted: boolean; exposed: boolean;
  lastAttemptAt: string | null; lastSolveSeconds: number | null; lastSolveHelp: Help | null;
  lastOutcome: Outcome | null; nextReviewDate: string | null; attemptCount: number;
}
export interface Attempt {
  id: string; problemId: string; problem: { id: string; title: string; url: string; difficulty: string | null };
  planItemId: string | null; status: 'active' | 'paused' | 'completed'; version: number;
  language: string; code: string; notes: string; activeSeconds: number | null;
  startedAt: string; finishedAt: string | null; studyDate: string;
  runningSince: string | null; lastHeartbeatAt: string | null; needsGapDecision: boolean;
  outcome: Outcome | null; help: Help; evidence: string; confidence: number | null;
  feedback: string | null; reviewedAt: string | null; nextReviewDate: string | null;
}
export interface Topic {
  id: string; name: string; score: number | null; version: number; notes: string;
  lastReviewed: string | null; provisional: boolean; lastMovement: ScoreDecision | null;
}
export interface ScoreDecision {
  id: string; topicId: string; topicName: string; attemptId: string | null;
  oldScore: number; newScore: number; rationale: string; evidence: string; date: string; recordedAt: string;
}
export interface ReviewTarget {
  id: string; problemId: string; problemTitle: string; constraint: string | null;
  recommendedDate: string | null; effectiveDate: string | null;
  action: 'recommended' | 'manual' | 'snooze' | 'none'; version: number; stage: string;
}
export interface PlanItem {
  id: string; problemId: string | null; title: string; url: string | null;
  status: 'active' | 'queued' | 'optional' | 'completed' | 'skipped';
  reason: string; suggestedMinutes: number; attemptId: string | null;
}
export interface DailyPlan { id: string; date: string; timezone: string; items: PlanItem[]; version: number }
export interface Settings { timezone: string; budgetMinutes: number; primaryCount: number; optionalCount: number; dataMode: string; lastBackupAt: string | null }
export interface Dashboard { plan: DailyPlan | null; topics: Topic[]; movements: ScoreDecision[]; recentAttempts: Attempt[]; activeAttempt: Attempt | null; settings: Settings }
export interface ProblemPage { items: Problem[]; total: number; page: number; pageSize: number }
export interface TopicDetail { topic: Topic; decisions: ScoreDecision[]; attempts: Attempt[]; problems: Problem[]; stats: { attemptCount: number; knownTimeCount: number; medianSeconds: number | null } }
export interface Snapshot { schemaVersion: 1; exportedAt: string; tables: Record<string, Record<string, unknown>[]> }
export interface ImportProblem { key: string; title: string; url: string; difficulty?: string | null; notes?: string; legacyCompleted?: boolean; exposed?: boolean; tags?: string[]; lists?: string[] }
export interface ImportAttempt { sourceKey: string; problemKey: string; date: string; outcome: Outcome; help: Help; activeSeconds: number | null; notes: string; code?: string; evidence: string; nextReviewDate?: string | null; topicNames?: string[] }
export interface ImportTopic { name: string; score: number | null; notes: string; lastReviewed?: string | null; provisional: boolean }
export interface ImportMovement { sourceKey: string; topicName: string; problemKey?: string; date: string; oldScore: number; newScore: number; rationale: string; evidence: string }
export interface ImportPlan { sourceKey: string; problemKey?: string; date: string; status: string; notes: string }
export interface ImportRecord { sourceKey: string; tab: string; row: number; raw: unknown; status: 'imported' | 'metadata' | 'duplicate' | 'unresolved'; reason?: string }
export interface ImportPayload { importId: string; dryRun: boolean; source: { spreadsheetId?: string; retrievedAt: string }; problems: ImportProblem[]; attempts: ImportAttempt[]; topics: ImportTopic[]; movements: ImportMovement[]; planned: ImportPlan[]; records: ImportRecord[] }
export interface ImportReport { dryRun: boolean; counts: Record<string, number>; warnings: string[]; unresolved: ImportRecord[] }

export type TopicScorePoint = Pick<ScoreDecision, 'id' | 'date' | 'recordedAt' | 'oldScore' | 'newScore'>;
export interface TopicScoreHistory { topic: Pick<Topic, 'id' | 'name' | 'score'>; decisions: TopicScorePoint[] }
