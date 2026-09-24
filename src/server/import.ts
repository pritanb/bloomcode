import type { FastifyInstance } from 'fastify';
import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import type { ImportPayload, ImportReport, ImportRecord, Problem, Tag, ProblemList, Topic, ScoreDecision } from '../shared/contracts.js';
import { Store } from './store.js';
import { date, name, addProblem, assignLinks, problemUrl } from './catalogue.js';
import { outcome, help, seconds, updateTarget } from './closeout.js';
import { canonical } from './idempotency.js';
import { conflict } from './errors.js';
import type { AttemptRecord } from './attempts.js';
export const score=z.number().min(1).max(5).refine(n=>Math.abs(n*100-Math.round(n*100))<0.000001,'Scores support two decimal places');
const key=z.string().min(1).max(500);
export const importSchema=z.object({importId:key,dryRun:z.boolean(),source:z.object({spreadsheetId:z.string().optional(),retrievedAt:z.iso.datetime({offset:true})}).strict(),problems:z.array(z.object({key,title:name,url:z.string(),difficulty:z.string().nullable().optional(),notes:z.string().optional(),legacyCompleted:z.boolean().optional(),exposed:z.boolean().optional(),tags:z.array(name).optional(),lists:z.array(name).optional()}).strict()),attempts:z.array(z.object({sourceKey:key,problemKey:key,date,outcome,help,activeSeconds:seconds,confidence:z.number().min(1).max(5).nullable().optional(),notes:z.string(),code:z.string().optional(),evidence:z.string(),nextReviewDate:date.nullable().optional(),topicNames:z.array(name).optional()}).strict()),topics:z.array(z.object({name,score:score.nullable(),notes:z.string(),lastReviewed:date.nullable().optional(),provisional:z.boolean()}).strict()),movements:z.array(z.object({sourceKey:key,topicName:name,problemKey:key.optional(),date,oldScore:score,newScore:score,rationale:z.string(),evidence:z.string()}).strict()),planned:z.array(z.object({sourceKey:key,problemKey:key.optional(),date,status:z.string(),notes:z.string()}).strict()),records:z.array(z.object({sourceKey:key,tab:z.string(),row:z.number().int().min(0),raw:z.unknown(),status:z.enum(['imported','metadata','duplicate','unresolved']),reason:z.string().optional()}).strict())}).strict();
interface Batch {id:string;fingerprint:string;source:ImportPayload['source'];appliedAt:string;evidence?:Pick<ImportPayload,'attempts'|'movements'|'problems'>}
function importedEvidenceExists(s:Store,b:ImportPayload,kind:'attempts'|'movements',input:ImportPayload['attempts'][number]|ImportPayload['movements'][number]):boolean {
 if(!b.source.spreadsheetId)return false;
 const batches=s.all<Batch>('import_batches').filter(prior=>prior.id!==b.importId&&prior.source.spreadsheetId===b.source.spreadsheetId);
 const rows=s.all<{id:string;sourceKey?:string;importId?:string}>(kind==='attempts'?'attempts':'score_decisions');
 let exists=false;
 for(const prior of batches){
  if(!rows.some(row=>row.importId===prior.id&&row.sourceKey===input.sourceKey))continue;
  const original=prior.evidence?.[kind].find(row=>row.sourceKey===input.sourceKey);
  if(!original)throw conflict(`Source row ${input.sourceKey} overlaps legacy evidence without a comparable source snapshot`);
  if(canonical(original)!==canonical(input)||input.problemKey&&prior.evidence?.problems.find(p=>p.key===input.problemKey)?.url!==b.problems.find(p=>p.key===input.problemKey)?.url)throw conflict(`Source row ${input.sourceKey} changed; existing evidence was not overwritten`);
  exists=true;
 }
 return exists;
}
export function applyImport(s:Store,b:ImportPayload,clock:()=>Date):ImportReport {
 const counts:Record<string,number>={problems:0,attempts:0,topics:0,movements:0,planned:0,records:0},warnings:string[]=[],unresolved:ImportRecord[]=b.records.filter(r=>r.status==='unresolved');
 const fingerprint=createHash('sha256').update(canonical({...b,dryRun:false})).digest('hex'),prior=s.all<Batch>('import_batches').find(x=>x.id===b.importId);
 if(prior){if(prior.fingerprint!==fingerprint)throw conflict('Import ID already used for different source data');return {dryRun:b.dryRun,counts,warnings:['Import already applied; no records changed'],unresolved};}
 const duplicateAttempts=new Set(b.attempts.filter(input=>importedEvidenceExists(s,b,'attempts',input)).map(input=>input.sourceKey));
 const duplicateMovements=new Set(b.movements.filter(input=>importedEvidenceExists(s,b,'movements',input)).map(input=>input.sourceKey));
 s.put('import_batches',{id:b.importId,fingerprint,source:b.source,appliedAt:clock().toISOString(),evidence:{problems:b.problems,attempts:b.attempts,movements:b.movements}});
 const problems=new Map<string,string>();
 const unresolvedRow=(sourceKey:string,raw:unknown,reason:string)=>{const record:ImportRecord={sourceKey,tab:'canonical',row:0,raw,status:'unresolved',reason};unresolved.push(record);warnings.push(`${sourceKey}: ${reason}`);};
 const seen=new Set<string>();
 for(const input of b.problems){if(seen.has(input.key)){unresolvedRow(input.key,input,'Duplicate problem key');continue;}seen.add(input.key);if(!problemUrl.safeParse(input.url).success){unresolvedRow(input.key,input,'Unrecognised original LeetCode URL');continue;}
  const before=s.all<Problem>('problems').length;let p=addProblem(s,input);p=s.put('problems',{...p,difficulty:p.difficulty??input.difficulty??null,notes:input.notes?.trim()&&!p.notes.includes(input.notes)?[p.notes,input.notes].filter(Boolean).join('\n\n'):p.notes,legacyCompleted:p.legacyCompleted||!!input.legacyCompleted,exposed:p.exposed||!!input.exposed||!!input.legacyCompleted});problems.set(input.key,p.id);counts.problems!+=s.all<Problem>('problems').length-before;
  const tags=(input.tags??[]).map(n=>{let t=s.all<Tag>('tags').find(t=>t.name.toLowerCase()===n.toLowerCase());if(!t)t=s.put<Tag>('tags',{id:randomUUID(),name:n,description:'',archived:false,kind:'pattern'});return {tagId:t.id,difficulty:null};});
  const listIds=(input.lists??[]).map(n=>{let l=s.all<ProblemList>('lists').find(l=>l.name.toLowerCase()===n.toLowerCase());if(!l)l=s.put('lists',{id:randomUUID(),name:n,sourceUrl:null,sourceVersion:null});return l.id;});
  const oldTags=s.all<{id:string;problemId:string;tagId:string;difficulty:number|null}>('problem_tags').filter(t=>t.problemId===p.id),oldLists=s.all<{id:string;problemId:string;listId:string}>('list_memberships').filter(l=>l.problemId===p.id).map(l=>l.listId);
  assignLinks(s,p.id,{tags:[...tags,...oldTags],listIds:[...listIds,...oldLists]});
 }
 const topics=new Map<string,string>();
 for(const input of b.topics){let t=s.all<Topic>('topics').find(t=>t.name.toLowerCase()===input.name.toLowerCase());if(!t){t=s.put('topics',{id:randomUUID(),name:input.name,score:input.score,version:1,notes:input.notes,lastReviewed:input.lastReviewed??null,provisional:input.provisional,lastMovement:null} satisfies Topic);counts.topics!++;}else warnings.push(`Existing topic ${input.name} retained; no score overwrite`);topics.set(input.name.toLowerCase(),t.id);}
 const attemptKeys=new Set<string>();
 for(const input of [...b.attempts].sort((a,b)=>a.date.localeCompare(b.date))){const problemId=problems.get(input.problemKey);if(!problemId||attemptKeys.has(input.sourceKey)){unresolvedRow(input.sourceKey,input,!problemId?'Unresolved problem reference':'Duplicate attempt source key');continue;}attemptKeys.add(input.sourceKey);if(duplicateAttempts.has(input.sourceKey))continue;const p=s.get<Problem>('problems',problemId);
  const a:AttemptRecord={id:randomUUID(),problemId,problem:{id:p.id,title:p.title,url:p.url,difficulty:p.difficulty},planItemId:null,status:'completed',version:1,language:'python',code:input.code??'',notes:input.notes,activeSeconds:input.activeSeconds,startedAt:input.date,finishedAt:input.date,studyDate:input.date,runningSince:null,lastHeartbeatAt:null,needsGapDecision:false,outcome:input.outcome,help:input.help,evidence:input.evidence,confidence:input.confidence??null,feedback:null,reviewedAt:null,nextReviewDate:input.nextReviewDate??null,context:'review',gapSeconds:0};
  s.put('attempts',{...a,sourceKey:input.sourceKey,importId:b.importId});s.put('answer_versions',{id:randomUUID(),attemptId:a.id,code:a.code,notes:a.notes,language:a.language,version:1,recordedAt:b.source.retrievedAt});
  const latest=!p.lastAttemptAt||input.date>=p.lastAttemptAt.slice(0,10),accepted=s.all<AttemptRecord>('attempts').filter(x=>x.problemId===p.id&&x.outcome==='solved').sort((a,b)=>(a.finishedAt??'').localeCompare(b.finishedAt??'')).at(-1);s.put('problems',{...p,exposed:true,attemptCount:p.attemptCount+1,...(latest?{lastAttemptAt:input.date,lastOutcome:input.outcome}:{}),...(accepted?{lastSolveSeconds:accepted.activeSeconds,lastSolveHelp:accepted.help}:{})});
  if(input.nextReviewDate&&latest)updateTarget(s,p.id,input.nextReviewDate,'legacy-candidate');
  for(const n of input.topicNames??[]){const topicId=topics.get(n.toLowerCase());if(topicId)s.put('attempt_topics',{id:`${a.id}:${topicId}`,attemptId:a.id,topicId});else warnings.push(`Unknown topic ${n} for ${input.sourceKey}`);}
  counts.attempts!++;
 }
 const movementKeys=new Set<string>();
 for(const input of b.movements){const topicId=topics.get(input.topicName.toLowerCase());if(!topicId||movementKeys.has(input.sourceKey)){unresolvedRow(input.sourceKey,input,'Unresolved topic or duplicate movement');continue;}movementKeys.add(input.sourceKey);if(duplicateMovements.has(input.sourceKey))continue;s.put('score_decisions',{id:randomUUID(),topicId,topicName:input.topicName,attemptId:null,oldScore:input.oldScore,newScore:input.newScore,rationale:input.rationale,evidence:input.evidence,date:input.date,recordedAt:b.source.retrievedAt,sourceKey:input.sourceKey,importId:b.importId} satisfies ScoreDecision & {sourceKey:string;importId:string});counts.movements!++;}
 for(const input of b.planned){const problemId=input.problemKey?problems.get(input.problemKey)??null:null;s.put('import_plans',{id:randomUUID(),...input,problemId,importId:b.importId});counts.planned!++;}
 for(const r of [...b.records,...unresolved.filter(r=>r.tab==='canonical')]){s.put('import_records',{id:randomUUID(),...r,importId:b.importId});counts.records!++;}
 return {dryRun:b.dryRun,counts,warnings,unresolved};
}
export function registerImport(app:FastifyInstance,s:Store,clock:()=>Date){app.post('/api/import',req=>{
 const b=importSchema.parse(req.body);let report:ImportReport|undefined;const rollback=Symbol('dry-run');
 try {return s.transaction(()=>{report=applyImport(s,b,clock);if(b.dryRun)throw rollback;return report;});}catch(error){if(error===rollback)return report;throw error;}
});}
