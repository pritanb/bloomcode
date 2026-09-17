import { randomUUID } from 'node:crypto';
import type { Problem, ScoreDecision, Topic } from '../shared/contracts.js';
import type { AttemptRecord } from './attempts.js';
import { problemView } from './catalogue.js';
import type { Store } from './store.js';

// Conservative automatic movements applied when an attempt finishes.
// Increases above 3 stay reserved for independent unseen solves, matching
// the manual review guard in scoring.ts. Manual reviews can still override.
export function autoScoreDelta(a:AttemptRecord):number {
  if(a.outcome==='solved'){
    if(a.help==='none')return 0.2;
    if(a.help==='small')return 0.1;
    if(a.help==='unknown')return 0.05;
    return 0; // major/solution help is acquisition, not independent evidence
  }
  if(a.outcome==='not_solved')return a.evidence==='retention'?-0.15:a.evidence==='near_transfer'?-0.1:0;
  return a.evidence==='retention'?-0.1:a.evidence==='near_transfer'?-0.05:0; // stopped
}
function rationale(a:AttemptRecord):string {
  const what=a.outcome==='solved'?a.help==='none'?'solved independently':a.help==='small'?'solved with a small hint':'solved with unrecorded help':a.outcome==='not_solved'?'did not solve':'stopped early';
  return `Auto: ${what} · ${a.evidence} evidence`;
}
export function applyAutoScore(s:Store,a:AttemptRecord,clock:()=>Date):ScoreDecision[] {
  if(s.get<{id:string;autoScore?:boolean}>('settings','singleton').autoScore===false)return [];
  const delta=autoScoreDelta(a);
  if(!delta)return [];
  // Tag kind is unreliable for topic-ness after notebook consolidation; match
  // tag names against tracked topic names, as plan weakness and imports do.
  const tags=new Set(problemView(s,s.get<Problem>('problems',a.problemId)).tags.filter(t=>!t.archived).map(t=>t.name.toLowerCase()));
  const cap=a.evidence==='unseen'&&a.outcome==='solved'&&a.help==='none'?5:3;
  const decisions:ScoreDecision[]=[];
  for(const t of s.all<Topic>('topics').filter(t=>t.score!==null&&tags.has(t.name.toLowerCase()))){
    // The cap withholds further increases; it must never pull an existing
    // higher score down, so a solve can only ever raise or leave a score.
    const next=delta>0?(t.score!>=cap?t.score!:Math.round(Math.min(cap,t.score!+delta)*100)/100):Math.round(Math.max(1,t.score!+delta)*100)/100;
    if(next===t.score)continue;
    const decision:ScoreDecision={id:randomUUID(),topicId:t.id,topicName:t.name,attemptId:a.id,oldScore:t.score!,newScore:next,rationale:rationale(a),evidence:a.evidence,date:a.studyDate,recordedAt:clock().toISOString()};
    const previous=s.all<ScoreDecision>('score_decisions').filter(x=>x.attemptId===a.id&&x.topicId===t.id).at(-1);
    s.put('score_decisions',{...decision,supersedesId:previous?.id??null});
    s.put('topics',{...t,score:next,version:t.version+1,lastReviewed:a.studyDate,provisional:a.evidence!=='unseen',lastMovement:null});
    s.put('attempt_topics',{id:`${a.id}:${t.id}`,attemptId:a.id,topicId:t.id});
    decisions.push(decision);
  }
  return decisions;
}
