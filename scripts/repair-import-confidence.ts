import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { chmodSync } from 'node:fs';
import { parseConfidence, leetcodeSlug } from '../src/integrations/sheet.js';

const [file, mode] = process.argv.slice(2);
if (!file || !['--dry-run', '--apply'].includes(mode ?? '')) throw Error('Usage: tsx scripts/repair-import-confidence.ts DATABASE --dry-run|--apply');
const db = new Database(resolve(file), { readonly: mode !== '--apply', fileMustExist: true });
const read = (table: string): Record<string, any>[] => db.prepare(`SELECT data FROM ${table}`).all().map((row: any) => JSON.parse(row.data));
let backup: string | undefined;
if (mode === '--apply') {
  backup = `${resolve(file)}.before-confidence-${randomUUID()}.sqlite`;
  await db.backup(backup);
  chmodSync(backup, 0o600);
}
const run = () => {
  const records = read('import_records').filter(r => r.tab === 'Tutor Tracker');
  const problems = new Map(read('problems').map(p => [p.id, p]));
  const changes: { attemptId: string; sourceKey: string; confidence: number }[] = [];
  const skipped: { attemptId: string; reason: string }[] = [];
  for (const attempt of read('attempts').filter(a => a.importId && a.confidence == null)) {
    const matches = records.filter(r => r.importId === attempt.importId && r.sourceKey === attempt.sourceKey);
    const headers = records.filter(r => r.importId === attempt.importId && r.reason === 'Header row.');
    if (matches.length !== 1 || headers.length !== 1) { skipped.push({attemptId:attempt.id,reason:'Missing or ambiguous source row'}); continue; }
    const header: string[] = headers[0]!.raw.formatted;
    const cells = matches[0]!.raw.formatted;
    const get = (name: string) => cells[header.indexOf(name)] ?? '';
    if (get('Date') !== attempt.studyDate || leetcodeSlug(get('Link')) !== leetcodeSlug(problems.get(attempt.problemId)?.url ?? '')) {
      skipped.push({attemptId:attempt.id,reason:'Source identity/date mismatch'}); continue;
    }
    const raw = get('Post Confidence') || get('Confidence');
    const confidence = parseConfidence(raw);
    if (confidence === null) { skipped.push({attemptId:attempt.id,reason:raw ? 'Invalid source confidence' : 'No source rating'}); continue; }
    changes.push({attemptId:attempt.id,sourceKey:attempt.sourceKey,confidence});
    if (mode === '--apply') {
      db.prepare('UPDATE attempts SET data=? WHERE id=?').run(JSON.stringify({...attempt,confidence,version:attempt.version+1}),attempt.id);
    }
  }
  if (mode === '--apply' && changes.length) {
    const id = randomUUID();
    db.prepare('INSERT INTO audit_events (id,data) VALUES (?,?)').run(id,JSON.stringify({id,action:'repair_import_confidence',recordedAt:new Date().toISOString(),backup,changes}));
  }
  return {mode,backup,updated:changes.length,changes,skipped};
};
try { console.log(JSON.stringify(mode === '--apply' ? db.transaction(run).immediate() : run(),null,2)); }
finally { db.close(); }
