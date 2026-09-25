import { expect, it } from 'vitest';
import { openDb } from '../../src/server/db.js';
import { Store } from '../../src/server/store.js';
import { TopicAnalysis } from '../../src/server/topic-analysis.js';
import { Insights } from '../../src/server/insights/service.js';
import { learningRecordSchema } from '../../src/shared/insights.js';
import { restoreLearningReferences } from '../../src/server/insights/restore.js';
import type { Topic } from '../../src/shared/contracts.js';

it('generates topics without attempts, embeddings or Learning Insights, preserving scores and independent refresh',()=>{
  const db=openDb(':memory:'),s=new Store(db.sqlite),clock=()=>new Date(now);
  let now=Date.parse('2026-09-25T00:00:00Z');
  const topics=new TopicAnalysis(s,clock),learning=new Insights(s,clock,async()=>{throw Error('Topic analysis must not need embeddings');});
  try{
    const topic:Topic={id:'arrays',name:'Arrays',score:2,version:1,notes:'',lastReviewed:null,provisional:true,lastMovement:null};
    s.put('topics',topic);
    const originalLearningFingerprint=learning.corpusFingerprint();
    topics.enable(true);
    expect(learning.enabled()).toBe(false);
    const work=topics.claim()!;expect(work.topics).toHaveLength(1);
    expect(topics.claim()).toBeNull();
    expect(()=>topics.complete(work.job.claimId!,[])).toThrow('three distinct supplied topics');
    const priority='arrays';
    topics.complete(work.job.claimId!,[priority]);
    expect(topics.status()).toMatchObject({status:'done',stale:false,report:{topicIds:[priority]}});
    expect(s.get('topics','arrays')).toEqual(topic);
    expect(learning.latestReport()).toBeNull();
    learning.put({id:'state',kind:'state',enabled:true});
    learning.put({id:'report-job',kind:'job',attemptId:null,fingerprint:learning.corpusFingerprint(),status:'failed',claimId:null,claimedAt:0,error:'Learning failure',model:null,durationMs:0,limitation:'',evidenceIds:[],questionIds:[]});
    expect(topics.status().status).toBe('done');
    s.put('topics',{...topic,score:3});
    expect(learning.corpusFingerprint()).toBe(originalLearningFingerprint);
    expect(topics.status()).toMatchObject({status:'done',stale:false});
    expect(topics.claim()).toBeNull();
    now+=7*24*60*60*1000;
    expect(topics.status()).toMatchObject({status:'pending',stale:true,report:{topicIds:[priority]}});
    const next=topics.claim()!;topics.fail(next.job.claimId!,'Topic failure');
    expect(learning.jobs()[0].error).toBe('Learning failure');
    expect(topics.claim()).toBeNull();
    topics.retry();expect(learning.jobs()[0].status).toBe('failed');
    const running=topics.claim()!;
    expect(learningRecordSchema.parse(topics.record()).kind).toBe('topic_analysis');
    restoreLearningReferences(s);
    expect(topics.record()).toMatchObject({status:'pending',claimId:null});
    expect(topics.claim()!.job.claimId).not.toBe(running.job.claimId);
  }finally{learning.stop();db.sqlite.close();}
});

it('includes recent completed attempts and their score movements without changing saved evidence',()=>{
  const db=openDb(':memory:'),s=new Store(db.sqlite);
  try{
    s.put('topics',{id:'graphs',name:'Graphs',score:2,provisional:false,lastReviewed:null});
    s.put('problems',{id:'p'});
    const attempt={id:'a',problemId:'p',problem:{difficulty:'Medium'},status:'completed',context:'targeted',studyDate:'2026-09-24',outcome:'not_solved',help:'small',evidence:'needed a hint',confidence:2,activeSeconds:900};
    s.put('attempts',attempt);
    s.put('attempt_topics',{id:'link',topicId:'graphs',attemptId:'a'});
    s.put('score_decisions',{id:'movement',topicId:'graphs',attemptId:'a',date:'2026-09-24',recordedAt:'2026-09-24T12:00:00Z',oldScore:3,newScore:2});
    s.put('attempts',{...attempt,id:'old',studyDate:'2026-07-01'});
    s.put('attempt_topics',{id:'old-link',topicId:'graphs',attemptId:'old'});
    const analysis=new TopicAnalysis(s,()=>new Date('2026-09-25T00:00:00Z'));
    analysis.enable(true);
    expect(analysis.claim()!.topics[0]).toMatchObject({id:'graphs',recentAttempts:[{outcome:'not_solved',help:'small',date:'2026-09-24'}],scoreMovements:[{oldScore:3,newScore:2,attemptId:'a'}]});
    expect(s.get('attempts','a')).toEqual(attempt);
  }finally{db.sqlite.close();}
});
