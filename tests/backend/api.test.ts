import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ImportPayload } from '../../src/shared/contracts.js';
import { createApp } from '../../src/server/app.js';

let app: Awaited<ReturnType<typeof createApp>>;
let dir: string;
let now: Date;
const headers = { authorization: 'Bearer test-token' };
const request = (method: 'GET'|'POST'|'PATCH', url: string, payload?: unknown, extra = {}) => app.inject({method,url,headers:{...headers,...extra},...(payload === undefined ? {} : {payload: payload as object})});
beforeEach(async () => { dir=mkdtempSync(join(tmpdir(),'lc-backend-')); now=new Date('2026-09-16T01:00:00Z'); app=await createApp({dbPath:join(dir,'test.sqlite'),token:'test-token',clock:()=>now}); });
afterEach(async()=> { await app?.close(); rmSync(dir,{recursive:true,force:true}); });

it('persists a deduplicated editable catalogue with tags and lists, validating original URLs',async()=> {
 const tag=(await request('POST','/api/tags',{name:'Arrays',description:'Indexed collections'})).json();
 const list=(await request('POST','/api/lists',{name:'Personal',sourceVersion:'1'})).json();
 expect(tag.id).toBeTypeOf('string'); expect(list.id).toBeTypeOf('string');
 const body={title:'Two Sum',url:'https://leetcode.com/problems/two-sum/description/',tags:[{tagId:tag.id,difficulty:4}],listIds:[list.id]};
 const added=await request('POST','/api/problems',body); expect(added.statusCode).toBe(200);
 const p=added.json(); expect(p.tags[0].difficulty).toBe(4); expect(p.lists[0].id).toBe(list.id);
 expect((await request('POST','/api/problems',{...body,url:'https://leetcode.com/problems/two-sum/'})).json().id).toBe(p.id);
 for(const url of [' https://leetcode.com/problems/bad/','https://evil.test/problems/a/','https://leetcode.com@evil.test/problems/a/','https://leetcode.com/problems/a/../b/','https://leetcode.com/problems/%61/']) expect((await request('POST','/api/problems',{title:'bad',url})).statusCode).toBe(400);
 expect((await request('PATCH',`/api/problems/${p.id}`,{notes:'Saved',tags:[{tagId:tag.id,difficulty:10}]})).json().notes).toBe('Saved');
 expect((await request('PATCH',`/api/problems/${p.id}`,{tags:[{tagId:tag.id,difficulty:11}]})).statusCode).toBe(400);
 expect((await request('PATCH',`/api/tags/${tag.id}`,{name:'Array',archived:true})).json().archived).toBe(true);
 expect((await request('GET',`/api/problems?tags=${tag.id}&listId=${list.id}&search=two`)).json().total).toBe(1);
 await app.close(); app=await createApp({dbPath:join(dir,'test.sqlite'),token:'test-token',clock:()=>now});
 expect((await request('GET',`/api/problems/${p.id}`)).json().problem.notes).toBe('Saved');
 expect((await request('GET','/api/problems?status=completed')).json().total).toBe(0);
 expect((await request('GET','/api/problems/missing')).statusCode).toBe(404);
});

it('resumes private drafts and timer segments with optimistic versions and explicit sleep-gap decisions',async()=> {
 const p=(await request('POST','/api/problems',{title:'Sum',url:'https://leetcode.com/problems/sum/'})).json();
 let a=(await request('POST','/api/attempts',{problemId:p.id,context:'mixed'})).json();
 expect(a.status).toBe('active'); expect(a.language).toBe('python');expect(a.problem).not.toHaveProperty('tags');
 expect((await request('GET',`/api/attempts/${a.id}/context`)).statusCode).toBe(403);
 expect((await request('POST','/api/attempts',{problemId:p.id,context:'mixed'})).statusCode).toBe(409);
 const saved=await request('PATCH',`/api/attempts/${a.id}/draft`,{version:a.version,code:'return 1',notes:'Own answer'}); expect(saved.statusCode).toBe(200);a=saved.json();
 expect((await request('PATCH',`/api/attempts/${a.id}/draft`,{version:1,code:'overwrite'})).statusCode).toBe(409);
 now=new Date('2026-09-16T01:00:30Z');a=(await request('POST',`/api/attempts/${a.id}/timer`,{version:a.version,action:'heartbeat'})).json();expect(a.activeSeconds).toBe(30);
 now=new Date('2026-09-16T01:10:30Z');a=(await request('POST',`/api/attempts/${a.id}/timer`,{version:a.version,action:'heartbeat'})).json();expect(a.activeSeconds).toBe(30);expect(a.needsGapDecision).toBe(true);expect(a.status).toBe('paused');
 expect((await request('POST',`/api/attempts/${a.id}/timer`,{version:a.version,action:'resume'})).statusCode).toBe(400);
 a=(await request('POST',`/api/attempts/${a.id}/timer`,{version:a.version,action:'resume',includeGap:false})).json();
 now=new Date('2026-09-16T01:10:40Z');a=(await request('POST',`/api/attempts/${a.id}/timer`,{version:a.version,action:'pause'})).json();expect(a.activeSeconds).toBe(40);
 await app.close();app=await createApp({dbPath:join(dir,'test.sqlite'),token:'test-token',clock:()=>now});
 a=(await request('GET',`/api/attempts/${a.id}`)).json();expect(a.code).toBe('return 1');expect(a.activeSeconds).toBe(40);
});

it('atomically finishes answers with durable idempotency, unknown time and manual review precedence',async()=>{
 const p=(await request('POST','/api/problems',{title:'Finish',url:'https://leetcode.com/problems/finish/'})).json();
 const a=(await request('POST','/api/attempts',{problemId:p.id,context:'mixed'})).json();
 const body={version:a.version,outcome:'solved',help:'major',activeSeconds:null,code:'answer',reviewAction:'manual',reviewDate:'2026-10-01'};
 expect((await request('POST',`/api/attempts/${a.id}/finish`,body)).statusCode).toBe(400);
 const finish=await request('POST',`/api/attempts/${a.id}/finish`,body,{'idempotency-key':'finish-1'});expect(finish.statusCode).toBe(200);expect(finish.json().status).toBe('completed');expect(finish.json().activeSeconds).toBeNull();
 expect((await request('POST',`/api/attempts/${a.id}/finish`,body,{'idempotency-key':'finish-1'})).json()).toEqual(finish.json());
 expect((await request('POST',`/api/attempts/${a.id}/finish`,{...body,code:'different'},{'idempotency-key':'finish-1'})).statusCode).toBe(409);
 const detail=(await request('GET',`/api/problems/${p.id}`)).json();expect(detail.attempts).toHaveLength(1);expect(detail.problem.attemptCount).toBe(1);expect(detail.problem.lastSolveSeconds).toBeNull();
 let target=(await request('GET','/api/reviews')).json()[0];expect(target.recommendedDate).toBe('2026-09-17');expect(target.effectiveDate).toBe('2026-10-01');
 const repeat=(await request('POST','/api/attempts',{problemId:p.id,context:'mixed'})).json();expect(repeat.evidence).toBe('retention');
 await request('POST',`/api/attempts/${repeat.id}/finish`,{version:repeat.version,outcome:'not_solved',help:'none',activeSeconds:20},{'idempotency-key':'finish-2'});
 target=(await request('GET','/api/reviews')).json()[0];expect(target.effectiveDate).toBe('2026-10-01');
 const noReview=await request('PATCH',`/api/reviews/${target.id}`,{version:target.version,action:'none'});expect(noReview.json().effectiveDate).toBeNull();
 expect((await request('PATCH',`/api/reviews/${target.id}`,{version:target.version,action:'manual',date:'2026-11-01'})).statusCode).toBe(409);
 expect((await request('GET',`/api/attempts/${a.id}/context`)).statusCode).toBe(200);
 await app.close();app=await createApp({dbPath:join(dir,'test.sqlite'),token:'test-token',clock:()=>now});
 expect((await request('POST',`/api/attempts/${a.id}/finish`,body,{'idempotency-key':'finish-1'})).json()).toEqual(finish.json());
});

const imported = ():ImportPayload => ({importId:'sheet-1',dryRun:false,source:{spreadsheetId:'test-sheet',retrievedAt:'2026-09-16T00:00:00Z'},problems:[{key:'p1',title:'Legacy',url:'https://leetcode.com/problems/legacy/',legacyCompleted:true,exposed:true,tags:['Arrays'],lists:['Archive']}],attempts:[{sourceKey:'a1',problemKey:'p1',date:'2026-09-01',outcome:'solved',help:'unknown',activeSeconds:null,notes:'Original note',code:'legacy answer',evidence:'retention',nextReviewDate:'2026-09-12',topicNames:['Arrays']}],topics:[{name:'Arrays',score:3.75,notes:'Historical',provisional:true}],movements:[{sourceKey:'m1',topicName:'Arrays',problemKey:'p1',date:'2026-08-01',oldScore:3.1,newScore:3.2,rationale:'Original movement',evidence:'legacy'}],planned:[{sourceKey:'plan1',problemKey:'p1',date:'2026-08-01',status:'planned',notes:'Old candidate'}],records:[{sourceKey:'raw1',tab:'LC',row:2,raw:{unknown:'2:xx',formula:'=A1'},status:'unresolved',reason:'Ambiguous time'}]});

it('imports canonical history without inventing timing or overwriting current legacy scores and makes repeat import a no-op',async()=>{
 const payload=imported();
 const dry=await request('POST','/api/import',{...payload,dryRun:true});expect(dry.statusCode).toBe(200);expect(dry.json().counts.attempts).toBe(1);expect(dry.json().unresolved[0].raw.unknown).toBe('2:xx');
 expect((await request('GET','/api/problems')).json().total).toBe(0);
 const apply=await request('POST','/api/import',payload);expect(apply.statusCode).toBe(200);
 expect((await request('POST','/api/import',payload)).json().counts.attempts).toBe(0);
 expect((await request('POST','/api/import',{...payload,topics:[]})).statusCode).toBe(409);
 const problems=(await request('GET','/api/problems')).json().items;expect(problems).toHaveLength(1);expect(problems[0].legacyCompleted).toBe(true);expect(problems[0].lastSolveSeconds).toBeNull();expect(problems[0].tags[0].name).toBe('Arrays');
 const detail=(await request('GET',`/api/problems/${problems[0].id}`)).json();expect(detail.attempts[0].code).toBe('legacy answer');expect(detail.attempts[0].activeSeconds).toBeNull();
 const topics=(await request('GET','/api/topics')).json();expect(topics[0].score).toBe(3.75);expect(topics[0].lastMovement.newScore).toBe(3.2);
 expect((await request('GET',`/api/topics/${topics[0].id}`)).json().stats).toEqual({attemptCount:1,knownTimeCount:0,medianSeconds:null});
});

it('commits tutor feedback and absolute scores together, rejects unsupported repeat increases and rolls back stale multi-topic reviews',async()=>{
 await request('POST','/api/import',imported());
 const topics=(await request('GET','/api/topics')).json(),t=topics[0];
 const p=(await request('GET','/api/problems')).json().items[0];
 const a=(await request('POST','/api/attempts',{problemId:p.id,context:'review'})).json();
 const done=(await request('POST',`/api/attempts/${a.id}/finish`,{version:a.version,outcome:'solved',help:'none',activeSeconds:600,reviewAction:'manual',reviewDate:'2026-12-01'},{'idempotency-key':'score-finish'})).json();
 const decision={topicId:t.id,expectedVersion:t.version,oldScore:3.75,newScore:3.9,rationale:'Exact repeat',evidence:'retention'};
 expect((await request('POST',`/api/attempts/${a.id}/reviews`,{version:done.version,feedback:'No justified increase',decisions:[decision]},{'idempotency-key':'bad-score'})).statusCode).toBe(400);
 expect((await request('POST',`/api/attempts/${a.id}/reviews`,{version:done.version,feedback:'Mislabelled',decisions:[{...decision,evidence:'unseen'}]},{'idempotency-key':'bad-evidence'})).statusCode).toBe(400);
 expect((await request('GET',`/api/attempts/${a.id}`)).json().feedback).toBeNull();
 const reviewBody={version:done.version,feedback:'Retention confirmed; legacy score unchanged',decisions:[{...decision,newScore:3.75}],followUp:{action:'recommended',date:'2026-09-23'}};
 const result=await request('POST',`/api/attempts/${a.id}/reviews`,reviewBody,{'idempotency-key':'review-1'});expect(result.statusCode).toBe(200);expect(result.json().decisions[0].newScore).toBe(3.75);
 expect((await request('POST',`/api/attempts/${a.id}/reviews`,reviewBody,{'idempotency-key':'review-1'})).json()).toEqual(result.json());
 expect((await request('GET','/api/reviews')).json()[0].effectiveDate).toBe('2026-12-01');
 const changed=(await request('GET','/api/topics')).json()[0];expect(changed.version).toBe(t.version+1);expect(changed.provisional).toBe(true);
 const fresh=(await request('POST','/api/problems',{title:'Fresh',url:'https://leetcode.com/problems/fresh/'})).json();
 const b=(await request('POST','/api/attempts',{problemId:fresh.id,context:'mixed'})).json();
 const finished=(await request('POST',`/api/attempts/${b.id}/finish`,{version:b.version,outcome:'solved',help:'none',activeSeconds:1200},{'idempotency-key':'fresh-finish'})).json();
 const promoted=await request('POST',`/api/attempts/${b.id}/reviews`,{version:finished.version,feedback:'Independent unseen',decisions:[{...decision,expectedVersion:changed.version,newScore:4.1,evidence:'unseen'}]},{'idempotency-key':'promotion'});expect(promoted.statusCode).toBe(200);
 expect((await request('GET','/api/topics')).json()[0].score).toBe(4.1);
 const bad=await request('POST',`/api/attempts/${b.id}/reviews`,{version:promoted.json().attempt.version,feedback:'Must not save',decisions:[{...decision,expectedVersion:1,oldScore:4.1,newScore:4.2,evidence:'unseen'}]},{'idempotency-key':'stale'});expect(bad.statusCode).toBe(409);
 expect((await request('GET',`/api/attempts/${b.id}`)).json().feedback).toBe('Independent unseen');
 expect((await request('GET',`/api/topics/${t.id}`)).json().stats).toEqual({attemptCount:3,knownTimeCount:2,medianSeconds:900});
});

it('builds a stable budgeted day, resumes work across midnight and transitions assignments without fabricated attempts',async()=>{
 expect((await request('GET','/api/dashboard')).json().plan).toBeNull();
 await request('POST','/api/import',imported());
 for(const slug of ['new-a','new-b','new-c'])await request('POST','/api/problems',{title:slug,url:`https://leetcode.com/problems/${slug}/`});
 const plan=await request('POST','/api/daily-plan/ensure',{});expect(plan.statusCode).toBe(200);const day=plan.json();expect(day.items).toHaveLength(2);expect(day.items[0].title).toBe('Legacy');expect(day.items[0].reason).not.toContain('Arrays');
 expect(day.items.reduce((sum:number,i:{suggestedMinutes:number})=>sum+i.suggestedMinutes,0)).toBeLessThanOrEqual(40);
 expect((await request('POST','/api/daily-plan/ensure',{})).json()).toEqual(day);
 const a=(await request('POST','/api/attempts',{problemId:day.items[0].problemId,planItemId:day.items[0].id,context:'review'})).json();
 now=new Date('2026-09-17T01:00:00Z');expect((await request('POST','/api/daily-plan/ensure',{})).json().id).toBe(day.id);
 expect((await request('POST',`/api/plan-items/${day.items[0].id}/disposition`,{action:'skip'})).statusCode).toBe(409);
 const done=await request('POST',`/api/attempts/${a.id}/finish`,{version:a.version,outcome:'not_solved',help:'none',activeSeconds:50},{'idempotency-key':'plan-finish'});expect(done.statusCode).toBe(200);
 const previous=(await request('GET','/api/dashboard?date=2026-09-16')).json();expect(previous.plan.items.find((i:{id:string})=>i.id===day.items[0].id).status).toBe('completed');expect(previous.plan.items[0].status).toBe('active');expect(previous.activeAttempt).toBeNull();expect(previous.topics[0].score).toBe(3.6); // retention miss auto-lowers 3.75 by 0.15
 const swapped=(await request('POST',`/api/plan-items/${day.items[1].id}/disposition`,{action:'swap',reason:'Prefer another'})).json();expect(swapped.items.find((i:{id:string})=>i.id===day.items[1].id).status).toBe('skipped');expect(swapped.items).toHaveLength(3);
 const replacement=swapped.items.find((i:{id:string})=>!day.items.some((old:{id:string})=>old.id===i.id));const activated=(await request('POST',`/api/plan-items/${replacement.id}/activate`,{})).json();expect(activated.items[0].id).toBe(replacement.id);expect(activated.items[0].status).toBe('active');
 const snoozed=(await request('POST',`/api/plan-items/${replacement.id}/disposition`,{action:'snooze',until:'2026-09-25'})).json();expect(snoozed.items.find((i:{id:string})=>i.id===replacement.id).status).toBe('skipped');
 expect((await request('GET',`/api/problems/${replacement.problemId}`)).json().attempts).toHaveLength(0);
 expect((await request('GET','/api/reviews')).json().find((r:{problemId:string})=>r.problemId===replacement.problemId).effectiveDate).toBe('2026-09-25');
});

it('exports all durable data, restores only to an empty database and produces a consistent private SQLite backup',async()=>{
 await request('POST','/api/import',imported());
 const snapshotResponse=await request('GET','/api/export');expect(snapshotResponse.statusCode).toBe(200);const snapshot=snapshotResponse.json();expect(snapshot.schemaVersion).toBe(4);expect(snapshot.tables.import_records[0].raw).toEqual({unknown:'2:xx',formula:'=A1'});expect(snapshot.tables).not.toHaveProperty('idempotency');expect(JSON.stringify(snapshot)).not.toContain('test-token');
 expect((await request('POST','/api/restore',{snapshot,confirmEmpty:true})).statusCode).toBe(409);
 const second=await createApp({dbPath:join(dir,'restore.sqlite'),token:'test-token',clock:()=>now});
 try {
  const restore=await second.inject({method:'POST',url:'/api/restore',headers,payload:{snapshot,confirmEmpty:true}});expect(restore.statusCode).toBe(200);expect(restore.json().counts.attempts).toBe(1);
  expect((await second.inject({url:'/api/export',headers})).json().tables).toEqual(snapshot.tables);
 }finally{await second.close();}
 const empty=await createApp({dbPath:join(dir,'invalid.sqlite'),token:'test-token',clock:()=>now});
 try {
  const bad=structuredClone(snapshot);bad.tables.attempts[0].problemId='missing';
  expect((await empty.inject({method:'POST',url:'/api/restore',headers,payload:{snapshot:bad,confirmEmpty:true}})).statusCode).toBe(400);
  expect((await empty.inject({url:'/api/problems',headers})).json().total).toBe(0);
  expect((await empty.inject({method:'POST',url:'/api/restore',headers,payload:{snapshot:{...snapshot,tables:{...snapshot.tables,'sqlite_master':[]}},confirmEmpty:true}})).statusCode).toBe(400);
 }finally{await empty.close();}
 const backup=await request('POST','/api/backup',{});expect(backup.statusCode).toBe(200);expect(backup.json().path.startsWith(join(dir,'backups')+'/')).toBe(true);
 const recovered=await createApp({dbPath:backup.json().path,token:'test-token',clock:()=>now});try{expect((await recovered.inject({url:'/api/problems',headers})).json().total).toBe(1);}finally{await recovered.close();}
 expect((await request('GET','/api/settings')).json().lastBackupAt).toBe(now.toISOString());
 const session=await app.inject('/api/session'),cookie=session.headers['set-cookie']!.toString().split(';')[0];
 expect((await app.inject({method:'POST',url:'/api/backup',headers:{cookie,'x-csrf-token':session.json().csrfToken},payload:{}})).statusCode).toBe(403);
 expect((await request('POST','/api/backup',{path:'/tmp/not-allowed'})).statusCode).toBe(400);
});

it('rolls back every earlier score write when a later decision is stale',async()=>{
 const payload=imported();payload.topics.push({name:'Trees',score:2,notes:'',provisional:false});await request('POST','/api/import',payload);
 const p=(await request('GET','/api/problems')).json().items[0],topics=(await request('GET','/api/topics')).json(),a=(await request('POST','/api/attempts',{problemId:p.id,context:'review'})).json();
 const done=(await request('POST',`/api/attempts/${a.id}/finish`,{version:a.version,outcome:'solved',help:'none',activeSeconds:10},{'idempotency-key':'atomic-finish'})).json();
 const before=(await request('GET','/api/export')).json().tables;
 const response=await request('POST',`/api/attempts/${a.id}/reviews`,{version:done.version,feedback:'Must roll back',decisions:topics.map((t:{id:string;version:number;score:number},i:number)=>({topicId:t.id,expectedVersion:i===0?t.version:99,oldScore:t.score,newScore:t.score-0.1,rationale:'Evidence',evidence:'retention'}))},{'idempotency-key':'atomic-review'});
 expect(response.statusCode).toBe(409);expect((await request('GET','/api/export')).json().tables).toEqual(before);
});

describe('loopback authentication',()=> {
  it('serves public health but protects private API with bearer or CSRF session',async()=> {
    expect((await app.inject('/health')).json()).toEqual({ok:true,buildId:'development'});
    expect((await app.inject('/api/settings')).statusCode).toBe(401);
    expect((await request('GET','/api/settings')).statusCode).toBe(200);
    expect((await app.inject({url:'/api/session',headers:{host:'evil.test'}})).statusCode).toBe(403);
    expect((await app.inject({url:'/api/session',headers:{origin:'https://evil.test'}})).statusCode).toBe(403);
    const session=await app.inject('/api/session');
    expect(session.json().csrfToken).toBeTypeOf('string');
    expect(JSON.stringify(session.json())).not.toContain('test-token');
    const cookie=session.headers['set-cookie']!.toString().split(';')[0];
    expect((await app.inject({method:'PATCH',url:'/api/settings',headers:{cookie},payload:{budgetMinutes:60}})).statusCode).toBe(403);
    expect((await app.inject({method:'PATCH',url:'/api/settings',headers:{cookie,'x-csrf-token':session.json().csrfToken},payload:{budgetMinutes:60}})).statusCode).toBe(200);
  });
});

it('filters by the latest recorded confidence and retains it after an unrated attempt', async () => {
 const p=(await request('POST','/api/problems',{title:'Confidence',url:'https://leetcode.com/problems/confidence/'})).json();
 await request('POST','/api/problems',{title:'Unrated',url:'https://leetcode.com/problems/unrated/'});
 for(const confidence of [1,2,2.5,3,3.5,4,4.5,5,null]){
  now=new Date(now.getTime()+1000);
  const a=(await request('POST','/api/attempts',{problemId:p.id,context:'targeted'})).json();
  const finished=await request('POST',`/api/attempts/${a.id}/finish`,{version:a.version,outcome:'solved',help:'none',activeSeconds:null,confidence},{'idempotency-key':`confidence-${confidence}`});
  expect(finished.statusCode).toBe(200);
  const expected=confidence===null?'high':confidence<3?'low':confidence<4?'medium':'high';
  for(const bucket of ['low','medium','high','unknown']){
   const result=await request('GET',`/api/problems?search=confidence&confidence=${bucket}&timeBucket=unknown`);
   expect(result.statusCode).toBe(200);
   expect(result.json().total).toBe(bucket===expected?1:0);
  }
 }
 expect((await request('GET','/api/problems?confidence=unknown')).json().total).toBe(1);
 expect((await request('GET','/api/problems?confidence=invalid')).statusCode).toBe(400);
});


it('returns only score history during mixed practice while keeping topic metadata protected', async () => {
  expect((await request('POST', '/api/import', imported())).statusCode).toBe(200);
  const topics = (await request('GET', '/api/topics')).json();
  const topic = topics.find((t: {name: string}) => t.name === 'Arrays');
  const problem = (await request('POST', '/api/problems', {title: 'New question', url: 'https://leetcode.com/problems/new-question/'})).json();
  const attempt = (await request('POST', '/api/attempts', {problemId: problem.id, context: 'mixed'})).json();
  expect((await request('GET', `/api/topics/${topic.id}`)).statusCode).toBe(403);
  const history = await request('GET', `/api/topics/${topic.id}/history`);
  expect(history.statusCode).toBe(200);
  expect(history.json().topic).toEqual({id: topic.id, name: 'Arrays', score: topic.score});
  expect(history.json().decisions).toHaveLength(1);
  expect(Object.keys(history.json().decisions[0]).sort()).toEqual(['date', 'id', 'newScore', 'oldScore', 'recordedAt']);
  expect((await request('GET', `/api/attempts/${attempt.id}`)).json().version).toBe(attempt.version);
  expect((await request('GET', '/api/topics/missing/history')).statusCode).toBe(404);
});


it('honors the daily question target without a budget cap and preserves existing plans', async () => {
 for (const slug of ['count-a','count-b','count-c','count-d']) await request('POST','/api/problems',{title:slug,url:`https://leetcode.com/problems/${slug}/`});
 expect((await request('PATCH','/api/settings',{questionsPerDay:3,budgetMinutes:5})).statusCode).toBe(200);
 const day=(await request('POST','/api/daily-plan/ensure',{})).json();
 expect(day.items).toHaveLength(3);
 expect(day.items.map((item:{status:string})=>item.status)).toEqual(['active','queued','queued']);
 await request('PATCH','/api/settings',{questionsPerDay:20});
 expect((await request('POST','/api/daily-plan/ensure',{})).json()).toEqual(day);
 now=new Date('2026-09-17T01:00:00Z');
 expect((await request('POST','/api/daily-plan/ensure',{})).json().items).toHaveLength(4);
 for(const questionsPerDay of [0,21,1.5]) expect((await request('PATCH','/api/settings',{questionsPerDay})).statusCode).toBe(400);
 await app.close(); app=await createApp({dbPath:join(dir,'test.sqlite'),token:'test-token',clock:()=>now});
 expect((await request('GET','/api/settings')).json().questionsPerDay).toBe(20);
});


it('imports explicit decimal confidence without inventing missing ratings', async () => {
 const payload=imported();
 payload.attempts[0]!.confidence=4.5;
 expect((await request('POST','/api/import',payload)).statusCode).toBe(200);
 const found=(await request('GET','/api/problems?confidence=high')).json();
 expect(found.total).toBe(1);
 const detail=(await request('GET',`/api/problems/${found.items[0].id}`)).json();
 expect(detail.attempts[0].confidence).toBe(4.5);
});


it('shows submission fields without code and retains the latest recorded confidence', async () => {
 const p=(await request('POST','/api/problems',{title:'Summary',url:'https://leetcode.com/problems/summary/'})).json();
 for (const confidence of [4.5,null]) {
  now=new Date(now.getTime()+1000);
  const a=(await request('POST','/api/attempts',{problemId:p.id,context:'targeted',language:'java'})).json();
  await request('POST',`/api/attempts/${a.id}/finish`,{version:a.version,outcome:'not_solved',help:'small',activeSeconds:90,confidence,notes:'Submission notes',code:'private code',reviewAction:'manual',reviewDate:'2026-10-01'},{'idempotency-key':`summary-${confidence}`});
 }
 const row=(await request('GET','/api/problems?search=summary')).json().items[0];
 expect(row.latestConfidence).toBe(4.5);
 expect(row.latestSubmission).toMatchObject({outcome:'not_solved',help:'small',language:'java',activeSeconds:90,confidence:null,notes:'Submission notes',nextReviewDate:'2026-10-01'});
 expect(row.latestSubmission).not.toHaveProperty('code');
 expect(row.nextReviewDate).toBe('2026-10-01');
});

it('cancels an active attempt without recording a result and permits a fresh start', async () => {
 const p=(await request('POST','/api/problems',{title:'Cancel fixture',url:'https://leetcode.com/problems/cancel-fixture/'})).json();
 const plan=(await request('POST','/api/daily-plan/ensure',{})).json();
 const item=plan.items.find((i:{problemId:string})=>i.problemId===p.id);
 const a=(await request('POST','/api/attempts',{problemId:p.id,planItemId:item.id,context:'mixed'})).json();
 const before=(await request('GET','/api/reviews')).json();
 const payload={version:a.version};
 expect((await request('POST',`/api/attempts/${a.id}/cancel`,{version:a.version+1},{'idempotency-key':'cancel-stale'})).statusCode).toBe(409);
 for(let i=0;i<2;i++)expect((await request('POST',`/api/attempts/${a.id}/cancel`,payload,{'idempotency-key':'cancel-once'})).json()).toEqual({cancelled:true});
 const dashboard=(await request('GET','/api/dashboard')).json();
 expect(dashboard.activeAttempt).toBeNull();expect(dashboard.recentAttempts).toEqual([]);
 expect(dashboard.plan.items.find((i:{id:string})=>i.id===item.id).attemptId).toBeNull();
 expect((await request('GET','/api/reviews')).json()).toEqual(before);
 const problem=(await request('GET',`/api/problems/${p.id}`)).json().problem;
 expect(problem.attemptCount).toBe(0);expect(problem.latestSubmission).toBeNull();
 const restarted=await request('POST','/api/attempts',{problemId:p.id,planItemId:item.id,context:'mixed'});
 expect(restarted.statusCode).toBe(200);expect(restarted.json().id).not.toBe(a.id);
});

it('persists plan order while rejecting stale or incomplete reorders', async () => {
 await request('PATCH','/api/settings',{questionsPerDay:3});
 for(const slug of ['order-a','order-b','order-c'])await request('POST','/api/problems',{title:slug,url:`https://leetcode.com/problems/${slug}/`});
 const plan=(await request('POST','/api/daily-plan/ensure',{})).json();
 const ids=plan.items.map((i:{id:string})=>i.id).reverse();
 expect((await request('POST',`/api/daily-plans/${plan.id}/reorder`,{version:plan.version,itemIds:[ids[0],ids[0],ids[2]]})).statusCode).toBe(400);
 const reordered=(await request('POST',`/api/daily-plans/${plan.id}/reorder`,{version:plan.version,itemIds:ids})).json();
 expect(reordered.items.map((i:{id:string})=>i.id)).toEqual(ids);
 expect(reordered.items[0].status).toBe('active');
 expect((await request('POST',`/api/daily-plans/${plan.id}/reorder`,{version:plan.version,itemIds:ids})).statusCode).toBe(409);
 expect((await request('POST','/api/daily-plan/ensure',{})).json().items.map((i:{id:string})=>i.id)).toEqual(ids);
 const attempt=(await request('POST','/api/attempts',{problemId:reordered.items[0].problemId,planItemId:ids[0],context:'mixed'})).json();
 const current=(await request('GET','/api/dashboard')).json().plan;
 const moved=(await request('POST',`/api/daily-plans/${plan.id}/reorder`,{version:current.version,itemIds:[ids[1],ids[2],ids[0]]})).json();
 expect(moved.items.find((i:{id:string})=>i.id===ids[0]).attemptId).toBe(attempt.id);
 expect(moved.items.find((i:{id:string})=>i.id===ids[0]).status).toBe('active');
 expect(moved.items[0].id).toBe(ids[0]);
 expect((await request('GET','/api/dashboard')).json().recentAttempts).toEqual([]);
});

it('follows the system timezone for the study day when the local app asks it to', async () => {
 const system = Intl.DateTimeFormat().resolvedOptions().timeZone;
 const other = system === 'Pacific/Kiritimati' ? 'Pacific/Pago_Pago' : 'Pacific/Kiritimati';
 expect((await request('PATCH', '/api/settings', { timezone: other })).json().timezone).toBe(other);
 await app.close(); app = await createApp({ dbPath: join(dir, 'test.sqlite'), token: 'test-token', clock: () => now });
 expect((await request('GET', '/api/settings')).json().timezone).toBe(other);
 await app.close(); app = await createApp({ dbPath: join(dir, 'test.sqlite'), token: 'test-token', clock: () => now, followSystemTimezone: true });
 expect((await request('GET', '/api/settings')).json().timezone).toBe(system);
});
