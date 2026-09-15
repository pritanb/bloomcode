import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import type { Snapshot, Settings } from '../shared/contracts.js';
import { durableTables, type Table } from './db.js';
import { Store } from './store.js';
import { ApiError, conflict } from './errors.js';
import { date, name, problemUrl } from './catalogue.js';
import { score, importSchema } from './import.js';
import { outcome, help, seconds } from './closeout.js';
const id=z.string().min(1).max(1000),text=z.string(),nullable=text.nullable(),v=z.number().int().min(1);
const identity=z.object({id,title:name,url:problemUrl,difficulty:nullable}).strict();
const schemas:Record<Table,z.ZodType>={
 settings:z.object({id:z.literal('singleton'),timezone:text.refine(t=>{try{new Intl.DateTimeFormat('en',{timeZone:t});return true;}catch{return false;}}),budgetMinutes:z.number().int().min(5).max(240),primaryCount:z.number().int().min(1).max(10),optionalCount:z.number().int().min(0).max(10),dataMode:text,lastBackupAt:nullable}).strict(),
 problems:z.object({id,title:name,url:problemUrl,slug:text.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),difficulty:nullable,notes:text,tags:z.array(z.unknown()),lists:z.array(z.unknown()),legacyCompleted:z.boolean(),exposed:z.boolean(),lastAttemptAt:nullable,lastSolveSeconds:seconds,lastSolveHelp:help.nullable(),lastOutcome:outcome.nullable(),nextReviewDate:date.nullable(),attemptCount:z.number().int().min(0)}).strict(),
 tags:z.object({id,name,description:text,archived:z.boolean()}).strict(),lists:z.object({id,name,sourceUrl:nullable,sourceVersion:nullable}).strict(),
 problem_tags:z.object({id,problemId:id,tagId:id,difficulty:z.number().int().min(1).max(10).nullable()}).strict(),list_memberships:z.object({id,problemId:id,listId:id}).strict(),
 attempts:z.object({id,problemId:id,problem:identity,planItemId:id.nullable(),status:z.enum(['active','paused','completed']),version:v,language:text,code:text,notes:text,activeSeconds:seconds,startedAt:text,finishedAt:nullable,studyDate:date,runningSince:nullable,lastHeartbeatAt:nullable,needsGapDecision:z.boolean(),outcome:outcome.nullable(),help,evidence:text,confidence:z.number().min(1).max(5).nullable(),feedback:nullable,reviewedAt:nullable,nextReviewDate:date.nullable(),context:z.enum(['mixed','targeted','review']),gapSeconds:z.number().int().min(0),sourceKey:id.optional(),importId:id.optional()}).strict(),
 review_targets:z.object({id,problemId:id,problemTitle:name,constraint:nullable,recommendedDate:date.nullable(),effectiveDate:date.nullable(),action:z.enum(['recommended','manual','snooze','none']),version:v,stage:text}).strict(),
 answer_versions:z.object({id,attemptId:id,code:text,notes:text,language:text,version:v,recordedAt:text}).strict(),
 audit_events:z.object({id,action:text,problemId:id.optional(),attemptId:id.optional(),decisionIds:z.array(id).optional(),recordedAt:text}).strict(),
 topics:z.object({id,name,score:score.nullable(),version:v,notes:text,lastReviewed:nullable,provisional:z.boolean(),lastMovement:z.null()}).strict(),
 score_decisions:z.object({id,topicId:id,topicName:name,attemptId:id.nullable(),oldScore:score,newScore:score,rationale:text,evidence:text,date,recordedAt:text,sourceKey:id.optional(),importId:id.optional(),supersedesId:id.nullable().optional()}).strict(),
 attempt_topics:z.object({id,topicId:id,attemptId:id}).strict(),
 import_batches:z.object({id,fingerprint:text.regex(/^[a-f0-9]{64}$/),source:z.object({spreadsheetId:text.optional(),retrievedAt:text}).strict(),appliedAt:text,evidence:importSchema.pick({problems:true,attempts:true,movements:true}).optional()}).strict(),
 import_records:z.object({id,importId:id,sourceKey:id,tab:text,row:z.number().int().min(0),raw:z.unknown(),status:z.enum(['imported','metadata','duplicate','unresolved']),reason:text.optional()}).strict(),
 import_plans:z.object({id,importId:id,sourceKey:id,problemId:id.nullable(),problemKey:id.optional(),date,status:text,notes:text}).strict(),
 daily_plans:z.object({id,date,timezone:text,version:v}).strict(),
 plan_items:z.object({id,planId:id,position:z.number().int().min(0),problemId:id.nullable(),title:name,url:nullable,status:z.enum(['active','queued','optional','completed','skipped']),reason:text,suggestedMinutes:z.number().int().min(1),attemptId:id.nullable()}).strict(),
};
export function exportSnapshot(s:Store,clock:()=>Date):Snapshot {return s.transaction(()=>({schemaVersion:1,exportedAt:clock().toISOString(),tables:Object.fromEntries(durableTables.map(t=>[t,(s.sql.prepare(`SELECT id,data FROM "${t}" ORDER BY rowid`).all() as {id:string;data:string}[]).map(r=>({...JSON.parse(r.data),id:r.id}))]))}));}
export function registerTransfer(app:FastifyInstance,s:Store,clock:()=>Date,dbPath:string){
 app.get('/api/export',()=>exportSnapshot(s,clock));
 app.post('/api/restore',{bodyLimit:50*1024*1024},req=>{
  const b=z.object({confirmEmpty:z.literal(true),snapshot:z.object({schemaVersion:z.literal(1),exportedAt:z.iso.datetime(),tables:z.record(z.string(),z.array(z.record(z.string(),z.unknown())))}).strict()}).strict().parse(req.body);
  const keys=Object.keys(b.snapshot.tables);if(keys.length!==durableTables.length||keys.some(k=>!durableTables.includes(k as Table)))throw new ApiError(400,'SNAPSHOT_SCHEMA','Snapshot table allowlist does not match schema version 1');
  for(const table of durableTables){const rows=b.snapshot.tables[table]!,ids=new Set();for(const row of rows){schemas[table].parse(row);if(ids.has(row.id))throw new ApiError(400,'SNAPSHOT_SCHEMA','Duplicate record ID');ids.add(row.id);}if(table==='settings'&&(rows.length!==1||rows[0]!.id!=='singleton'))throw new ApiError(400,'SNAPSHOT_SCHEMA','Exactly one settings record is required');}
  try{return s.transaction(()=>{
   if(durableTables.some(t=>t!=='settings'&&(s.sql.prepare(`SELECT count(*) AS n FROM "${t}"`).get() as {n:number}).n>0))throw conflict('Restore requires an empty database');
   s.sql.pragma('defer_foreign_keys = ON');const counts:Record<string,number>={};
   for(const table of durableTables){const rows=b.snapshot.tables[table]!;for(const row of rows){if(table==='settings'){const {id:_id,...data}=row;s.sql.prepare('UPDATE settings SET data=? WHERE id=?').run(JSON.stringify(data),'singleton');}else s.put(table,row as {id:string});}counts[table]=rows.length;}
   if((s.sql.pragma('foreign_key_check') as unknown[]).length)throw new ApiError(400,'SNAPSHOT_REFERENCE','Snapshot contains missing references');
   // DTO-only references are checked as well as the physical foreign keys.
   for(const row of b.snapshot.tables.attempts!){if(row.planItemId)s.get('plan_items',String(row.planItemId));const p=s.get<{id:string;slug:string}>('problems',String(row.problemId));if((row.problem as {id:string}).id!==p.id)throw new ApiError(400,'SNAPSHOT_REFERENCE','Attempt identity mismatch');}
   for(const row of b.snapshot.tables.problems!)if(new URL(String(row.url)).pathname.split('/')[2]!==row.slug)throw new ApiError(400,'SNAPSHOT_SCHEMA','Problem slug does not match original URL');
   return {restored:true,counts};
  });}catch(error){if(error instanceof ApiError&&error.status!==404)throw error;if(error instanceof Error&&(error as Error&{code?:string}).code?.startsWith('SQLITE_CONSTRAINT')||error instanceof ApiError)throw new ApiError(400,'SNAPSHOT_REFERENCE','Snapshot contains invalid or conflicting records');throw error;}
 });
 app.post('/api/backup',async req=>{
  z.object({}).strict().parse(req.body??{});
  const folder=join(dirname(dbPath),'backups');mkdirSync(folder,{recursive:true,mode:0o700});chmodSync(folder,0o700);
  const createdAt=clock().toISOString(),path=join(folder,`leetcode-${createdAt.replaceAll(':','-')}-${randomUUID()}.sqlite`);
  await s.sql.backup(path);chmodSync(path,0o600);
  const settings=s.get<Settings&{id:string}>('settings','singleton');s.sql.prepare('UPDATE settings SET data=? WHERE id=?').run(JSON.stringify({...settings,lastBackupAt:createdAt}),'singleton');
  return {path,createdAt};
 });
}
