export type Help = 'none' | 'small' | 'major' | 'solution' | 'unknown';
export const MISTAKE_LABELS = ['missed_edge_case', 'wrong_approach', 'implementation_bug'] as const;
export type MistakeLabel = (typeof MISTAKE_LABELS)[number];
export type Outcome = 'solved' | 'not_solved' | 'stopped';
export interface Tag {
  kind?: 'topic' | 'pattern';
  recognitionCues?: string;
  pitfalls?: string;
  patternNotes?: string;
  notebookVersion?: number;
  notebookUpdatedAt?: string;
  hue?: number;
  id: string;
  name: string;
  description: string;
  archived: boolean;
}
export interface ProblemList {
  id: string;
  name: string;
  sourceUrl: string | null;
  sourceVersion: string | null;
}
export type SubmissionSummary = Pick<
  Attempt,
  | 'id'
  | 'outcome'
  | 'help'
  | 'language'
  | 'activeSeconds'
  | 'confidence'
  | 'notes'
  | 'finishedAt'
  | 'nextReviewDate'
>;
export interface Problem {
  leetcodeTopics?: string[];
  latestSubmission?: SubmissionSummary | null;
  latestConfidence?: number | null;
  reviewAction?: ReviewTarget['action'] | null;
  id: string;
  title: string;
  url: string;
  slug: string;
  difficulty: string | null;
  notes: string;
  tags: (Tag & { difficulty: number | null })[];
  lists: ProblemList[];
  legacyCompleted: boolean;
  exposed: boolean;
  lastAttemptAt: string | null;
  lastSolveSeconds: number | null;
  lastSolveHelp: Help | null;
  lastOutcome: Outcome | null;
  nextReviewDate: string | null;
  attemptCount: number;
}
/** Progress of the tutor report written automatically after a web submission. */
export interface AutoReviewStatus {
  status: 'none' | 'pending' | 'generating' | 'failed' | 'done';
  error: string | null;
  tutorConnected: boolean;
}
export interface Attempt {
  scoreDecisions?: ScoreDecision[];
  mistakeLabels?: MistakeLabel[];
  takeaway?: string;
  id: string;
  problemId: string;
  problem: { id: string; title: string; url: string; difficulty: string | null };
  planItemId: string | null;
  status: 'active' | 'paused' | 'completed';
  version: number;
  language: string;
  code: string;
  notes: string;
  activeSeconds: number | null;
  startedAt: string;
  finishedAt: string | null;
  studyDate: string;
  runningSince: string | null;
  lastHeartbeatAt: string | null;
  needsGapDecision: boolean;
  outcome: Outcome | null;
  help: Help;
  evidence: string;
  confidence: number | null;
  feedback: string | null;
  reviewedAt: string | null;
  nextReviewDate: string | null;
}
export interface Topic {
  id: string;
  name: string;
  score: number | null;
  version: number;
  notes: string;
  lastReviewed: string | null;
  provisional: boolean;
  lastMovement: ScoreDecision | null;
}
export interface ScoreDecision {
  id: string;
  topicId: string;
  topicName: string;
  attemptId: string | null;
  oldScore: number;
  newScore: number;
  rationale: string;
  evidence: string;
  date: string;
  recordedAt: string;
}
export interface ReviewTarget {
  id: string;
  problemId: string;
  problemTitle: string;
  constraint: string | null;
  recommendedDate: string | null;
  effectiveDate: string | null;
  action: 'recommended' | 'manual' | 'snooze' | 'none';
  version: number;
  stage: string;
}
export interface PlanItem {
  recommendationKind?: 'topic' | 'refresher' | 'balanced';
  id: string;
  problemId: string | null;
  title: string;
  url: string | null;
  status: 'active' | 'queued' | 'optional' | 'completed' | 'skipped';
  reason: string;
  suggestedMinutes: number;
  attemptId: string | null;
}
export interface DailyPlan {
  id: string;
  date: string;
  timezone: string;
  items: PlanItem[];
  version: number;
}
export interface Settings {
  onboardingComplete?: boolean;
  autoScore?: boolean;
  recommendations?: import('./recommendations.js').RecommendationSettings;
  questionsPerDay?: number;
  timezone: string;
  budgetMinutes: number;
  primaryCount: number;
  optionalCount: number;
  lastBackupAt: string | null;
}
export interface Dashboard {
  plan: DailyPlan | null;
  topics: Topic[];
  movements: ScoreDecision[];
  recentAttempts: Attempt[];
  activeAttempt: Attempt | null;
  settings: Settings;
  activity: ActivityDay[];
  latestReflection: { attemptId: string; takeaway: string } | null;
}
export interface ProblemPage {
  items: Problem[];
  total: number;
  page: number;
  pageSize: number;
}
export interface TopicDetail {
  topic: Topic;
  decisions: ScoreDecision[];
  attempts: Attempt[];
  problems: Problem[];
  stats: { attemptCount: number; knownTimeCount: number; medianSeconds: number | null };
}
export interface Snapshot {
  schemaVersion: 1 | 2 | 3 | 4;
  exportedAt: string;
  tables: Record<string, Record<string, unknown>[]>;
}
export interface ImportProblem {
  key: string;
  title: string;
  url: string;
  difficulty?: string | null;
  notes?: string;
  legacyCompleted?: boolean;
  exposed?: boolean;
  tags?: string[];
  lists?: string[];
}
export interface ImportAttempt {
  confidence?: number | null;
  sourceKey: string;
  problemKey: string;
  date: string;
  outcome: Outcome;
  help: Help;
  activeSeconds: number | null;
  notes: string;
  code?: string;
  evidence: string;
  nextReviewDate?: string | null;
  topicNames?: string[];
}
export interface ImportTopic {
  name: string;
  score: number | null;
  notes: string;
  lastReviewed?: string | null;
  provisional: boolean;
}
export interface ImportMovement {
  sourceKey: string;
  topicName: string;
  problemKey?: string;
  date: string;
  oldScore: number;
  newScore: number;
  rationale: string;
  evidence: string;
}
export interface ImportRecord {
  sourceKey: string;
  tab: string;
  row: number;
  raw: unknown;
  status: 'imported' | 'metadata' | 'duplicate' | 'unresolved';
  reason?: string;
}
export interface ImportPayload {
  importId: string;
  dryRun: boolean;
  source: { retrievedAt: string };
  problems: ImportProblem[];
  attempts: ImportAttempt[];
  topics: ImportTopic[];
  movements: ImportMovement[];
  records: ImportRecord[];
}
export interface ImportReport {
  dryRun: boolean;
  counts: Record<string, number>;
  warnings: string[];
  unresolved: ImportRecord[];
}

export type TopicScorePoint = Pick<
  ScoreDecision,
  'id' | 'date' | 'recordedAt' | 'oldScore' | 'newScore'
>;
export interface TopicScoreHistory {
  topic: Pick<Topic, 'id' | 'name' | 'score'>;
  decisions: TopicScorePoint[];
}

export interface PatternEntry {
  id: string;
  title: string;
  description: string;
  archived: boolean;
  recognitionCues: string;
  pitfalls: string;
  notes: string;
  version: number;
  updatedAt: string | null;
}
export type PatternSummary = Pick<
  PatternEntry,
  'id' | 'title' | 'archived' | 'version' | 'updatedAt'
>;
export interface PatternDetail extends PatternEntry {
  examples: (Pick<Problem, 'id' | 'title' | 'url' | 'difficulty'> & {
    patternDifficulty: number | null;
  })[];
}
export interface ActivityDay {
  date: string;
  completedAttempts: number;
}
export type RecapAttempt = Pick<
  Attempt,
  'id' | 'problemId' | 'problem' | 'studyDate' | 'outcome' | 'help' | 'activeSeconds' | 'evidence'
> & { scheduledReview: boolean };
export interface WeeklyRecap {
  weekStart: string;
  weekEnd: string;
  timezone: string;
  detailsHidden: boolean;
  distinctQuestions: number;
  completedAttempts: number;
  independentSolves: number;
  scheduledReviews: number;
  attempts: RecapAttempt[];
  movements: ScoreDecision[];
}
