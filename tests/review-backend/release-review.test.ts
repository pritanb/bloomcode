import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../src/server/app.js';

let app: Awaited<ReturnType<typeof createApp>>;
let dir: string;
const headers = { authorization: 'Bearer review-test-only' };
const request = (method: 'GET'|'POST'|'PATCH', url: string, payload?: object, extra = {}) => app.inject({method,url,headers:{...headers,...extra},...(payload === undefined ? {} : {payload})});
const batch = () => ({importId:'review-batch',dryRun:false,source:{spreadsheetId:'review-sheet',retrievedAt:'2026-09-16T00:00:00Z'},problems:[{key:'p',title:'Review problem',url:'https://leetcode.com/problems/review-problem/'}],attempts:[] as object[],topics:[{name:'Arrays',score:3,notes:'',provisional:false}],movements:[] as object[],planned:[],records:[]});
beforeEach(async()=>{dir=mkdtempSync(join(tmpdir(),'lc-independent-review-'));app=await createApp({dbPath:join(dir,'db.sqlite'),token:'review-test-only',clock:()=>new Date('2026-09-16T01:00:00Z')});});
afterEach(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});

it('does not retain unseen scoring eligibility after revealing a selected pattern',async()=>{
 await request('POST','/api/import',batch());
 const tag=(await request('POST','/api/tags',{name:'Arrays'})).json();
 const p=(await request('GET','/api/problems')).json().items[0];
 await request('PATCH',`/api/problems/${p.id}`,{tags:[{tagId:tag.id,difficulty:4}]});
 const exposed=await request('GET',`/api/problems?tags=${tag.id}`);
 expect(exposed.json().items[0].tags[0].name).toBe('Arrays');
 const a=(await request('POST','/api/attempts',{problemId:p.id,context:'mixed'})).json();
 const done=(await request('POST',`/api/attempts/${a.id}/finish`,{version:a.version,outcome:'solved',help:'none',activeSeconds:600},{'idempotency-key':'exposure-finish'})).json();
 const t=(await request('GET','/api/topics')).json()[0];
 const review=await request('POST',`/api/attempts/${a.id}/reviews`,{version:done.version,feedback:'Pattern was already revealed',decisions:[{topicId:t.id,expectedVersion:t.version,oldScore:3,newScore:4,rationale:'Claimed unseen despite tag disclosure',evidence:'unseen'}]},{'idempotency-key':'exposure-review'});
 console.log('EXPOSURE_PROBE',JSON.stringify({attemptEvidence:a.evidence,reviewStatus:review.statusCode,savedScore:(await request('GET','/api/topics')).json()[0].score}));
 expect(review.statusCode).toBe(400);
});

it('does not duplicate identical source attempts and movements in a refreshed import batch',async()=>{
 const b=batch();b.attempts=[{sourceKey:'LC:2',problemKey:'p',date:'2026-09-01',outcome:'solved',help:'none',activeSeconds:600,notes:'Original source',evidence:'retention'}];b.movements=[{sourceKey:'Ratings:2',topicName:'Arrays',date:'2026-09-01',oldScore:2.9,newScore:3,rationale:'Original movement',evidence:'legacy'}];
 expect((await request('POST','/api/import',b)).statusCode).toBe(200);
 expect((await request('POST','/api/import',{...b,importId:'refreshed-batch',source:{...b.source,retrievedAt:'2026-09-16T01:00:00Z'}})).statusCode).toBe(200);
 const tables=(await request('GET','/api/export')).json().tables;
 console.log('REIMPORT_PROBE',JSON.stringify({attempts:tables.attempts.length,movements:tables.score_decisions.length,attemptCount:tables.problems[0].attemptCount}));
 expect(tables.attempts).toHaveLength(1);expect(tables.score_decisions).toHaveLength(1);
});

it('rejects cross-origin access, absent CSRF, and browser admin writes',async()=>{
 const session=await app.inject('/api/session');const cookie=String(session.headers['set-cookie']).split(';')[0]!;
 const browser={cookie,'x-csrf-token':session.json().csrfToken};
 expect((await app.inject({url:'/api/export',headers:{...browser,origin:'https://evil.example'}})).statusCode).toBe(403);
 expect((await app.inject({method:'PATCH',url:'/api/settings',headers:{cookie},payload:{budgetMinutes:60}})).statusCode).toBe(403);
 for(const url of ['/api/import','/api/restore','/api/backup'])expect((await app.inject({method:'POST',url,headers:browser,payload:{}})).statusCode).toBe(403);
 expect((await app.inject({url:'/api/export',headers:{host:'evil.example'}})).statusCode).toBe(403);
 expect((await app.inject({url:'/api/export',remoteAddress:'192.0.2.1',headers})).statusCode).toBe(403);
});

it('does not expose active mixed-assessment tags via the catalogue route',async()=>{
 const tag=(await request('POST','/api/tags',{name:'Hidden pattern'})).json();
 const p=(await request('POST','/api/problems',{title:'Hidden',url:'https://leetcode.com/problems/hidden/',tags:[{tagId:tag.id}]})).json();
 const a=(await request('POST','/api/attempts',{problemId:p.id,context:'mixed'})).json();
 expect((await request('GET',`/api/attempts/${a.id}/context`)).statusCode).toBe(403);
 const bypass=await request('GET',`/api/problems?search=Hidden`);
 console.log('HIDDEN_PROBE',JSON.stringify({contextStatus:403,catalogueStatus:bypass.statusCode,disclosedTag:bypass.json().items[0]?.tags[0]?.name}));
 expect(bypass.statusCode===403 || !bypass.json().items?.some((item:{id:string;tags:unknown[]})=>item.id===p.id&&item.tags.length)).toBe(true);
});

it('preserves manual review overrides and skips without inventing completed work',async()=>{
 await request('POST','/api/import',batch());
 const plan=(await request('POST','/api/daily-plan/ensure',{})).json();
 const skipped=await request('POST',`/api/plan-items/${plan.items[0].id}/disposition`,{action:'skip'});
 expect(skipped.json().items[0].status).toBe('skipped');
 expect((await request('GET','/api/export')).json().tables.attempts).toHaveLength(0);
 const a=(await request('POST','/api/attempts',{problemId:plan.items[0].problemId,context:'mixed'})).json();
 const done=(await request('POST',`/api/attempts/${a.id}/finish`,{version:a.version,outcome:'not_solved',help:'none',activeSeconds:500,reviewAction:'manual',reviewDate:'2026-12-01'},{'idempotency-key':'manual-finish'})).json();
 expect((await request('POST',`/api/attempts/${a.id}/reviews`,{version:done.version,feedback:'Retry',decisions:[],followUp:{action:'recommended',date:'2026-09-17'}},{'idempotency-key':'manual-review'})).statusCode).toBe(200);
 expect((await request('GET','/api/reviews')).json()[0].effectiveDate).toBe('2026-12-01');
 expect((await request('GET','/api/problems?status=completed')).json().total).toBe(0);
});

it('round-trips active drafts and linked plans and rejects unknown restore columns atomically',async()=>{
 await request('POST','/api/import',batch());
 const plan=(await request('POST','/api/daily-plan/ensure',{})).json();
 const a=(await request('POST','/api/attempts',{problemId:plan.items[0].problemId,planItemId:plan.items[0].id,context:'mixed'})).json();
 await request('PATCH',`/api/attempts/${a.id}/draft`,{version:a.version,code:'print("my answer")'});
 const snapshot=(await request('GET','/api/export')).json();
 const restored=await createApp({dbPath:join(dir,'restored.sqlite'),token:'review-test-only'});
 try{
  const bad=structuredClone(snapshot);bad.tables.attempts[0].arbitraryColumn=true;
  expect((await restored.inject({method:'POST',url:'/api/restore',headers,payload:{confirmEmpty:true,snapshot:bad}})).statusCode).toBe(400);
  expect((await restored.inject({url:'/api/problems',headers})).json().total).toBe(0);
  expect((await restored.inject({method:'POST',url:'/api/restore',headers,payload:{confirmEmpty:true,snapshot}})).statusCode).toBe(200);
  expect((await restored.inject({url:'/api/export',headers})).json().tables).toEqual(snapshot.tables);
 }finally{await restored.close();}
});
