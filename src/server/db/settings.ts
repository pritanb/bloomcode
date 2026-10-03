import type { Settings } from '../../shared/contracts.js';
import { type Db, one, update } from './db.js';
import { recommendationSchema } from '../../shared/recommendations.js';

interface SettingsRow {
  timezone: string;
  primaryCount: number;
  optionalCount: number;
  questionsPerDay: number | null;
  onboardingComplete: number | null;
  autoScore: number | null;
  recommendations: string | null;
  lastBackupAt: string | null;
}
/** The singleton settings row. Settings older installations never set stay absent. */
export function readSettings(db: Db): Settings {
  const r = one<SettingsRow>(db, 'SELECT * FROM settings WHERE id = 1');
  // Older list-based recommendation settings are ignored; only the target carries over.
  const parsed = recommendationSchema.safeParse(
    r.recommendations ? JSON.parse(r.recommendations) : null,
  );
  const recommendations = parsed.success ? parsed.data : null;
  return {
    timezone: r.timezone,
    primaryCount: r.primaryCount,
    optionalCount: r.optionalCount,
    lastBackupAt: r.lastBackupAt,
    ...(r.questionsPerDay !== null ? { questionsPerDay: r.questionsPerDay } : {}),
    ...(r.onboardingComplete !== null ? { onboardingComplete: !!r.onboardingComplete } : {}),
    ...(r.autoScore !== null ? { autoScore: !!r.autoScore } : {}),
    ...(recommendations ? { recommendations } : {}),
  };
}
export function writeSettings(db: Db, fields: Partial<Settings>) {
  update(db, 'settings', 1, fields);
}
/** Whether learning-insights analysis is switched on; kept out of the Settings API. */
export const insightsEnabled = (db: Db) =>
  !!one<{ enabled: number }>(db, 'SELECT insightsEnabled AS enabled FROM settings WHERE id = 1')
    .enabled;
export function setInsightsEnabled(db: Db, enabled: boolean) {
  update(db, 'settings', 1, { insightsEnabled: enabled });
}
