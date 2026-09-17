import { expect, it } from 'vitest';
import { openDb } from '../../src/server/db.js';
import { Store } from '../../src/server/store.js';
import { alignTopics } from '../../scripts/align-topics.js';
import { randomUUID } from 'node:crypto';
import type { ScoreDecision, Tag, Topic } from '../../src/shared/contracts.js';
function fixture(){
 const {sqlite}=openDb(':memory:');
 const s=new Store(sqlite);
 const topic=(name:string,score:number)=>s.put('topics',{id:randomUUID(),name,score,version:1,notes:'',lastReviewed:null,provisional:true,lastMovement:null} satisfies Topic);
 const tag=(name:string)=>s.put('tags',{id:randomUUID(),name,description:'',archived:false} as Tag);
 const decision=(topicId:string,topicName:string,newScore:number)=>s.put('score_decisions',{id:randomUUID(),topicId,topicName,attemptId:null,oldScore:3,newScore,rationale:'Historic',evidence:'retention',date:'2026-08-01',recordedAt:'2026-08-01T00:00:00Z'} satisfies ScoreDecision);
 return {s,sqlite,topic,tag,decision};
}
it('renames topics onto NeetCode category names and carries decision history with them',()=>{
 const {s,sqlite,topic,decision}=fixture();
 const graphs=topic('Graphs / BFS / DFS',3.9);
 decision(graphs.id,'Graphs / BFS / DFS',3.9);
 const report=alignTopics(s,true);
 expect(s.all<Topic>('topics').map(t=>t.name)).toEqual(['Graphs']);
 expect(s.all<Topic>('topics')[0]!.score).toBe(3.9);
 // The denormalised name shown in history must follow the rename.
 expect(s.all<ScoreDecision>('score_decisions')[0]!.topicName).toBe('Graphs');
 expect(report.topicsRenamed).toEqual([{from:'Graphs / BFS / DFS',to:'Graphs'}]);
 sqlite.close();
});
it('merges non-NeetCode topics into their category, keeping the survivor score and all history',()=>{
 const {s,sqlite,topic,decision}=fixture();
 const arrays=topic('Arrays / Hashing',3.8),prefix=topic('Prefix Sum',3.8);
 const greedy=topic('Greedy',3.1),state=topic('Greedy / State Compression',3.05);
 decision(prefix.id,'Prefix Sum',3.8);decision(state.id,'Greedy / State Compression',3.05);
 const problem=s.put('problems',{id:randomUUID(),title:'x',url:'https://leetcode.com/problems/x/',slug:'x',difficulty:null,notes:'',tags:[],lists:[],legacyCompleted:false,exposed:false,lastAttemptAt:null,lastSolveSeconds:null,lastSolveHelp:null,lastOutcome:null,nextReviewDate:null,attemptCount:0});
 const attempt=s.put('attempts',{id:randomUUID(),problemId:problem.id,problem:{id:problem.id,title:'x',url:problem.url,difficulty:null},planItemId:null,status:'completed',version:1,language:'python',code:'',notes:'',activeSeconds:1,startedAt:'2026-08-01T00:00:00Z',finishedAt:'2026-08-01T00:00:00Z',studyDate:'2026-08-01',runningSince:null,lastHeartbeatAt:null,needsGapDecision:false,outcome:'solved',help:'none',evidence:'retention',confidence:null,feedback:null,reviewedAt:null,nextReviewDate:null});
 s.put('attempt_topics',{id:`${attempt.id}:${state.id}`,attemptId:attempt.id,topicId:state.id});
 const report=alignTopics(s,true);
 const names=s.all<Topic>('topics').map(t=>t.name).sort();
 expect(names).toEqual(['Arrays & Hashing','Greedy']);
 expect(s.all<Topic>('topics').find(t=>t.name==='Greedy')!.score).toBe(3.1);
 // No score decision is ever deleted; it is repointed at the survivor.
 expect(s.all<ScoreDecision>('score_decisions')).toHaveLength(2);
 expect(s.all<ScoreDecision>('score_decisions').map(d=>d.topicName).sort()).toEqual(['Arrays & Hashing','Greedy']);
 expect(s.all<{id:string;topicId:string}>('attempt_topics')[0]!.topicId).toBe(greedy.id);
 expect(report.topicsMerged.find(m=>m.from==='Prefix Sum')).toMatchObject({into:'Arrays & Hashing',keptScore:3.8});
 expect(report.topicsMerged.find(m=>m.from==='Greedy / State Compression')).toMatchObject({into:'Greedy',keptScore:3.1,droppedScore:3.05,movedDecisions:1,movedAttempts:1});
 expect(arrays.id).toBeDefined();
 sqlite.close();
});
it('restores tag names so tags stay the user\u2019s own vocabulary',()=>{
 const {s,sqlite,topic,tag}=fixture();
 topic('Graphs / BFS / DFS',3.9);
 tag('Graphs / BFS / DFS');tag('BFS');
 const report=alignTopics(s,true);
 expect(s.all<Tag>('tags').map(t=>t.name).sort()).toEqual(['BFS','Graphs']);
 expect(report.tagsRenamed).toEqual([{from:'Graphs / BFS / DFS',to:'Graphs'}]);
 sqlite.close();
});
it('changes nothing on a dry run and is idempotent when applied twice',()=>{
 const {s,sqlite,topic}=fixture();
 topic('Arrays / Hashing',3.8);topic('Prefix Sum',3.8);
 const dry=alignTopics(s,false);
 expect(dry.applied).toBe(false);
 expect(s.all<Topic>('topics')).toHaveLength(2);
 alignTopics(s,true);
 const after=s.all<Topic>('topics').map(t=>[t.name,t.score]);
 const second=alignTopics(s,true);
 expect(second.topicsRenamed).toHaveLength(0);
 expect(second.topicsMerged).toHaveLength(0);
 expect(s.all<Topic>('topics').map(t=>[t.name,t.score])).toEqual(after);
 expect(after).toEqual([['Arrays & Hashing',3.8]]);
 sqlite.close();
});
it('reports topics that are not NeetCode categories instead of guessing',()=>{
 const {s,sqlite,topic}=fixture();
 topic('Trees',4);topic('My Custom Topic',3);
 const report=alignTopics(s,true);
 expect(s.all<Topic>('topics').map(t=>t.name).sort()).toEqual(['My Custom Topic','Trees']);
 expect(report.topicsNotInNeetcode).toEqual(['My Custom Topic']);
 expect(report.neetcodeCategoriesWithoutTopic).toContain('Sliding Window');
 sqlite.close();
});
