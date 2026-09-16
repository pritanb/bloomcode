import { idempotent } from './idempotency.js';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Attempt, Problem, Settings } from '../shared/contracts.js';
import { bumpPlan, type ItemRecord, linkAttempt } from './plans.js';
import { topicView } from './topics.js';
import type { Topic } from '../shared/contracts.js';
import { Store } from './store.js';
import { ApiError, conflict } from './errors.js';
export interface AttemptRecord extends Attempt {context:'mixed'|'targeted'|'review';gapSeconds:number;sourceKey?:string;importId?:string}
export const version=z.number().int().min(1);
export function studyDate(now:Date,timezone:string):string {const parts=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);return ['year','month','day'].map(k=>parts.find(p=>p.type===k)!.value).join('-');}
export function attemptView(a:AttemptRecord):Attempt {const {context:_context,gapSeconds:_gap,sourceKey:_source,importId:_import,...publicAttempt}=a;return publicAttempt;}
export function newestAttempt(a:Attempt,b:Attempt):number {return (b.finishedAt??b.startedAt).localeCompare(a.finishedAt??a.startedAt)||b.id.localeCompare(a.id);}
export function checkVersion(a:{version:number},v:number){if(a.version!==v)throw conflict();}
export function registerAttempts(app:FastifyInstance,s:Store,clock:()=>Date){
 app.post('/api/attempts',req=>{
  const b=z.object({problemId:z.string(),planItemId:z.string().optional(),context:z.enum(['mixed','targeted','review']),language:z.string().min(1).max(80).optional()}).strict().parse(req.body);
  return s.transaction(()=>{
   if(s.all<AttemptRecord>('attempts').some(a=>a.status!=='completed'))throw conflict('Finish the existing active attempt first');
   const p=s.get<Problem>('problems',b.problemId),now=clock().toISOString();
   const a:AttemptRecord={id:randomUUID(),problemId:p.id,problem:{id:p.id,title:p.title,url:p.url,difficulty:p.difficulty},planItemId:b.planItemId??null,status:'active',version:1,language:b.language??'python',code:'',notes:'',activeSeconds:0,startedAt:now,finishedAt:null,studyDate:studyDate(clock(),s.get<Settings & {id:string}>('settings','singleton').timezone),runningSince:now,lastHeartbeatAt:now,needsGapDecision:false,outcome:null,help:'unknown',evidence:p.exposed||p.legacyCompleted||p.attemptCount>0||b.context==='review'?'retention':b.context==='mixed'?'unseen':'near_transfer',confidence:null,feedback:null,reviewedAt:null,nextReviewDate:null,context:b.context,gapSeconds:0};
   s.put('problems',{...p,exposed:true});s.put('attempts',a);linkAttempt(s,a);return attemptView(a);
  });
 });
 app.post<{Params:{id:string}}>('/api/attempts/:id/cancel',req=>{
  const b=z.object({version}).strict().parse(req.body);
  return idempotent(s,`cancel:${req.params.id}`,req.headers['idempotency-key'],b,()=>{
   const a=s.get<AttemptRecord>('attempts',req.params.id);checkVersion(a,b.version);
   if(a.status==='completed')throw conflict('Submitted attempts cannot be cancelled');
   if(a.planItemId){const item=s.get<ItemRecord>('plan_items',a.planItemId);s.put('plan_items',{...item,attemptId:null});bumpPlan(s,item.planId);}
   for(const table of ['answer_versions','attempt_topics'] as const)for(const row of s.all<{id:string;attemptId:string}>(table))if(row.attemptId===a.id)s.remove(table,row.id);
   s.remove('attempts',a.id);
   s.put('audit_events',{id:randomUUID(),action:'cancel_attempt',attemptId:a.id,problemId:a.problemId,recordedAt:clock().toISOString()});
   return {cancelled:true};
  });
 });
 app.get<{Params:{id:string}}>('/api/attempts/:id',req=>attemptView(s.get<AttemptRecord>('attempts',req.params.id)));
 app.get<{Params:{id:string}}>('/api/attempts/:id/context',req=>{
  const a=s.get<AttemptRecord>('attempts',req.params.id);
  if(a.context==='mixed'&&a.status!=='completed')throw new ApiError(403,'HIDDEN_ASSESSMENT','Complete the mixed assessment before requesting history');
  return {attempt:attemptView(a),history:s.all<AttemptRecord>('attempts').filter(x=>x.problemId===a.problemId&&x.id!==a.id).map(attemptView),topics:s.all<Topic>('topics').map(t=>topicView(s,t))};
 });
 app.patch<{Params:{id:string}}>('/api/attempts/:id/draft',req=>{
  const b=z.object({version,code:z.string().max(1000000).optional(),notes:z.string().max(100000).optional(),language:z.string().min(1).max(80).optional()}).strict().parse(req.body);
  return s.transaction(()=>{const a=s.get<AttemptRecord>('attempts',req.params.id);checkVersion(a,b.version);if(a.status==='completed')throw conflict('Completed answers are immutable');return attemptView(s.put('attempts',{...a,...b,version:a.version+1}));});
 });
 app.post<{Params:{id:string}}>('/api/attempts/:id/timer',req=>{
  const b=z.object({version,action:z.enum(['pause','resume','heartbeat']),includeGap:z.boolean().optional()}).strict().parse(req.body);
  return s.transaction(()=>{
   const a=s.get<AttemptRecord>('attempts',req.params.id);checkVersion(a,b.version);if(a.status==='completed')throw conflict('Attempt already completed');
   const now=clock().toISOString();
   if(a.status==='active'&&a.lastHeartbeatAt){const delta=Math.max(0,Math.floor((clock().getTime()-Date.parse(a.lastHeartbeatAt))/1000));if(delta>120){a.status='paused';a.runningSince=null;a.needsGapDecision=true;a.gapSeconds=delta;}else{a.activeSeconds=(a.activeSeconds??0)+delta;a.lastHeartbeatAt=now;}}
   if(b.action==='resume'){
    if(a.needsGapDecision&&b.includeGap===undefined)throw new ApiError(400,'GAP_DECISION','Choose whether to include the disconnected interval');
    if(a.needsGapDecision&&b.includeGap)a.activeSeconds=(a.activeSeconds??0)+Math.max(a.gapSeconds,Math.floor((clock().getTime()-Date.parse(a.lastHeartbeatAt!))/1000));
    a.needsGapDecision=false;a.gapSeconds=0;a.status='active';a.runningSince=now;a.lastHeartbeatAt=now;
   }else if(b.action==='pause'){a.status='paused';a.runningSince=null;}
   a.version++;return attemptView(s.put('attempts',a));
  });
 });
}
