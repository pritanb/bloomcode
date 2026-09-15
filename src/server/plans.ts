import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { DailyPlan, PlanItem, Problem, ReviewTarget, Settings, Topic, ScoreDecision } from '../shared/contracts.js';
import { Store } from './store.js';
import { date, problemView } from './catalogue.js';
import { type AttemptRecord, attemptView, newestAttempt, studyDate } from './attempts.js';
import { ApiError, conflict } from './errors.js';
import { topicView, decisionView } from './topics.js';
import { updateTarget } from './closeout.js';
export interface PlanRecord extends Omit<DailyPlan,'items'> {id:string}
export interface ItemRecord extends PlanItem {planId:string;position:number}
export function planView(s:Store,p:PlanRecord):DailyPlan{return {...p,items:s.all<ItemRecord>('plan_items').filter(i=>i.planId===p.id).sort((a,b)=>a.position-b.position).map(({planId:_plan,position:_pos,...i})=>i)};}
export function bumpPlan(s:Store,id:string){const p=s.get<PlanRecord>('daily_plans',id);s.put('daily_plans',{...p,version:p.version+1});}
function candidates(s:Store,day:string,exclude=new Set<string>()):Problem[]{
 const reviews=s.all<ReviewTarget>('review_targets'),topics=s.all<Topic>('topics');
 const planned=new Set(s.all<{id:string;problemId:string|null;date:string;status:string}>('import_plans').filter(p=>p.date<=day&&!/(complete|done|skip|cancel)/i.test(p.status)).map(p=>p.problemId));
 const due=(p:Problem)=>reviews.find(t=>t.problemId===p.id&&t.effectiveDate&&t.effectiveDate<=day);
 const weakness=(p:Problem)=>Math.min(5,...problemView(s,p).tags.map(tag=>topics.find(t=>t.name.toLowerCase()===tag.name.toLowerCase())?.score??5));
 return s.all<Problem>('problems').filter(p=>!exclude.has(p.id)&&!reviews.some(t=>t.problemId===p.id&&(t.action==='none'||(t.effectiveDate!==null&&t.effectiveDate>day)))).sort((a,b)=>Number(!!due(b))-Number(!!due(a))||(due(a)?.effectiveDate??'').localeCompare(due(b)?.effectiveDate??'')||weakness(a)-weakness(b)||Number(planned.has(b.id))-Number(planned.has(a.id))||(a.lastAttemptAt??'').localeCompare(b.lastAttemptAt??'')||a.id.localeCompare(b.id));
}
function newItem(s:Store,plan:PlanRecord,p:Problem,status:PlanItem['status'],minutes:number,position:number){return s.put('plan_items',{id:randomUUID(),planId:plan.id,position,problemId:p.id,title:p.title,url:p.url,status,reason:p.nextReviewDate&&p.nextReviewDate<=plan.date?'Scheduled review':'Balanced practice',suggestedMinutes:minutes,attemptId:null} satisfies ItemRecord);}
export function linkAttempt(s:Store,attempt:AttemptRecord){
 if(!attempt.planItemId)return;
 const item=s.get<ItemRecord>('plan_items',attempt.planItemId);
 if(item.problemId!==attempt.problemId||['completed','skipped'].includes(item.status)||item.attemptId)throw conflict('Assignment does not match this attempt');
 for(const other of s.all<ItemRecord>('plan_items').filter(i=>i.planId===item.planId&&i.status==='active'&&i.id!==item.id))s.put('plan_items',{...other,status:'queued'});
 s.put('plan_items',{...item,status:'active',attemptId:attempt.id});bumpPlan(s,item.planId);
}
export function completeAssignment(s:Store,a:AttemptRecord){if(!a.planItemId)return;const item=s.get<ItemRecord>('plan_items',a.planItemId);s.put('plan_items',{...item,status:'completed',attemptId:a.id});const next=s.all<ItemRecord>('plan_items').find(i=>i.planId===item.planId&&i.status==='queued');if(next)s.put('plan_items',{...next,status:'active'});bumpPlan(s,item.planId);}
export function registerPlans(app:FastifyInstance,s:Store,clock:()=>Date){
 app.post('/api/daily-plan/ensure',req=>{
  const b=z.object({date:date.optional()}).strict().parse(req.body??{});
  return s.transaction(()=>{
   const settings=s.get<Settings&{id:string}>('settings','singleton'),day=b.date??studyDate(clock(),settings.timezone),active=s.all<AttemptRecord>('attempts').find(a=>a.status!=='completed');
   if(active?.planItemId)return planView(s,s.get('daily_plans',s.get<ItemRecord>('plan_items',active.planItemId).planId));
   let plan=s.all<PlanRecord>('daily_plans').find(p=>p.date===day&&p.timezone===settings.timezone);
   // Plans are generated here; version 1 with no items is the untouched empty state.
   if(plan&&(plan.version!==1||s.all<ItemRecord>('plan_items').some(i=>i.planId===plan!.id)))return planView(s,plan);
   const refilling=!!plan;
   plan??=s.put('daily_plans',{id:randomUUID(),date:day,timezone:settings.timezone,version:1});
   const slots=Math.min(settings.primaryCount+settings.optionalCount,Math.max(1,Math.floor(settings.budgetMinutes/10))),minutes=Math.floor(settings.budgetMinutes/slots);
   const available=candidates(s,day);if(active){const p=s.get<Problem>('problems',active.problemId);available.splice(0,available.length,p,...available.filter(x=>x.id!==p.id));}
   if(refilling&&available.length)plan=s.put('daily_plans',{...plan,version:plan.version+1});
   for(const [i,p] of available.slice(0,slots).entries()){const item=newItem(s,plan,p,i===0?'active':i<settings.primaryCount?'queued':'optional',minutes,i);if(i===0&&active){active.planItemId=item.id;s.put('attempts',active);s.put('plan_items',{...item,attemptId:active.id});}}
   return planView(s,plan);
  });
 });
 app.get('/api/dashboard',req=>s.transaction(()=>{
  const q=z.object({date:date.optional()}).strict().parse(req.query),settings=s.get<Settings&{id:string}>('settings','singleton'),day=q.date??studyDate(clock(),settings.timezone),active=s.all<AttemptRecord>('attempts').find(a=>a.status!=='completed');
  let plan=s.all<PlanRecord>('daily_plans').find(p=>p.date===day&&p.timezone===settings.timezone);if(!q.date&&active?.planItemId)plan=s.get('daily_plans',s.get<ItemRecord>('plan_items',active.planItemId).planId);
  return {plan:plan?planView(s,plan):null,topics:s.all<Topic>('topics').map(t=>topicView(s,t)),movements:s.all<ScoreDecision>('score_decisions').filter(d=>d.oldScore!==d.newScore).reverse().slice(0,20).map(decisionView),recentAttempts:s.all<AttemptRecord>('attempts').filter(a=>a.status==='completed').sort(newestAttempt).slice(0,20).map(attemptView),activeAttempt:active?attemptView(active):null,settings};
 }));
 app.post<{Params:{id:string}}>('/api/plan-items/:id/disposition',req=>{
  const b=z.object({action:z.enum(['swap','snooze','skip']),until:date.optional(),reason:z.string().max(2000).optional()}).strict().parse(req.body);
  return s.transaction(()=>{
   const item=s.get<ItemRecord>('plan_items',req.params.id),plan=s.get<PlanRecord>('daily_plans',item.planId);
   if(item.attemptId||['completed','skipped'].includes(item.status))throw conflict('Only unstarted assignments may be changed');
   if(b.action==='snooze'){if(!b.until||b.until<=studyDate(clock(),plan.timezone))throw new ApiError(400,'VALIDATION','Snooze requires a future date');if(item.problemId)updateTarget(s,item.problemId,null,'snoozed',{action:'snooze',date:b.until});}
   if(b.action==='swap'){const items=s.all<ItemRecord>('plan_items').filter(i=>i.planId===plan.id),replacement=candidates(s,plan.date,new Set(items.map(i=>i.problemId).filter((id):id is string=>!!id)))[0];if(!replacement)throw conflict('No alternative candidate available');newItem(s,plan,replacement,item.status,item.suggestedMinutes,items.length);}
   s.put('plan_items',{...item,status:'skipped',reason:b.reason??b.action});bumpPlan(s,plan.id);return planView(s,s.get('daily_plans',plan.id));
  });
 });
 app.post<{Params:{id:string}}>('/api/plan-items/:id/activate',req=>{
  z.object({}).strict().parse(req.body??{});return s.transaction(()=>{const item=s.get<ItemRecord>('plan_items',req.params.id);if(['completed','skipped'].includes(item.status))throw conflict('Assignment is no longer available');if(s.all<AttemptRecord>('attempts').some(a=>a.status!=='completed'&&a.planItemId!==item.id))throw conflict('Finish the active attempt first');for(const other of s.all<ItemRecord>('plan_items').filter(i=>i.planId===item.planId&&i.status==='active'&&i.id!==item.id))s.put('plan_items',{...other,status:'queued'});s.put('plan_items',{...item,status:'active'});bumpPlan(s,item.planId);return planView(s,s.get('daily_plans',item.planId));});
 });
}
