import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Topic, ScoreDecision, Problem } from '../shared/contracts.js';
import { Store } from './store.js';
import { newestAttempt, attemptView, type AttemptRecord } from './attempts.js';
import { problemView, assertMetadataVisible } from './catalogue.js';
export interface AttemptTopic {id:string;attemptId:string;topicId:string}
export function decisionView(d:ScoreDecision & {sourceKey?:string;importId?:string;supersedesId?:string|null}):ScoreDecision {const {sourceKey:_source,importId:_import,supersedesId:_supersedes,...publicDecision}=d;return publicDecision;}
export function topicView(s:Store,t:Topic):Topic {const decisions=s.all<ScoreDecision>('score_decisions').filter(d=>d.topicId===t.id).reverse().sort((a,b)=>b.date.localeCompare(a.date)||b.recordedAt.localeCompare(a.recordedAt));return {...t,lastMovement:decisions[0]?decisionView(decisions[0]):null};}
export function registerTopics(app:FastifyInstance,s:Store){
 app.get('/api/topics',()=>s.all<Topic>('topics').map(t=>topicView(s,t)));
 app.get<{Params:{id:string}}>('/api/topics/:id',req=>{
  assertMetadataVisible(s);
  const topic=topicView(s,s.get<Topic>('topics',req.params.id)),q=z.object({evidence:z.string().optional(),help:z.string().optional(),difficulty:z.enum(['Easy','Medium','Hard']).optional()}).strict().parse(req.query);
  const ids=new Set(s.all<AttemptTopic>('attempt_topics').filter(l=>l.topicId===topic.id).map(l=>l.attemptId));
  const attempts=s.all<AttemptRecord>('attempts').filter(a=>ids.has(a.id)&&(!q.evidence||a.evidence===q.evidence)&&(!q.help||a.help===q.help)&&(!q.difficulty||a.problem.difficulty===q.difficulty)).sort(newestAttempt).map(attemptView);
  const problemIds=new Set(attempts.map(a=>a.problemId)),known=attempts.filter(a=>a.outcome==='solved'&&a.activeSeconds!==null).map(a=>a.activeSeconds!).sort((a,b)=>a-b),mid=Math.floor(known.length/2);
  return {topic,decisions:s.all<ScoreDecision>('score_decisions').filter(d=>d.topicId===topic.id).reverse().map(decisionView),attempts,problems:s.all<Problem>('problems').filter(p=>problemIds.has(p.id)).map(p=>problemView(s,p)),stats:{attemptCount:attempts.length,knownTimeCount:known.length,medianSeconds:known.length?(known.length%2?known[mid]!:(known[mid-1]!+known[mid]!)/2):null}};
 });
}
