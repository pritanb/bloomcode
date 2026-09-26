import type { Settings } from '../../shared/contracts.js';
import { type Db, one, update } from './db.js';

interface SettingsRow {
  timezone: string;
  budgetMinutes: number;
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
  const recommendations = r.recommendations ? JSON.parse(r.recommendations) : null;
  return {
    timezone: r.timezone,
    budgetMinutes: r.budgetMinutes,
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
