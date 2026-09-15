import Database from 'better-sqlite3';
import { test, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
const exec=promisify(execFile);
const run=(script:string,args:string[],env:NodeJS.ProcessEnv)=>exec(process.execPath,['--import','tsx',resolve('scripts',script),...args],{env:{...process.env,...env},timeout:15000});
test('export/restore CLI round trip preserves complete table content, confirms empty-only and verifies read-back',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'lc-roundtrip-'));await writeFile(join(dir,'api-token'),'cli-secret');
  const snapshot={schemaVersion:1,exportedAt:'2026-09-16T00:00:00Z',tables:{problems:[{id:'p1',notes:'private answer'}],attempts:[{id:'a1',problem_id:'p1',code:'print(1)'}]}};
  let restored=false;const calls:string[]=[];
  const server=createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;calls.push(`${req.method} ${req.url}`);expect(req.headers.authorization).toBe('Bearer cli-secret');res.setHeader('content-type','application/json');if(req.url==='/api/restore'){expect(JSON.parse(raw)).toEqual({snapshot,confirmEmpty:true});restored=true;res.end(JSON.stringify({restored:true,counts:{problems:1,attempts:1}}));}else res.end(JSON.stringify(snapshot));});
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const a=server.address();if(!a||typeof a==='string')throw Error('address');
  const env={DATA_DIR:dir,PORT:String(a.port)};
  try {const output=join(dir,'backup.json');await run('export.ts',['--output',output],env);expect(JSON.parse(await readFile(output,'utf8'))).toEqual(snapshot);
    await expect(run('restore.ts',['--input',output],env)).rejects.toThrow();expect(restored).toBe(false);
    const result=await run('restore.ts',['--input',output,'--confirm-empty'],env);expect(JSON.parse(result.stdout).verified).toBe(true);
    expect(calls).toEqual(['GET /api/export','POST /api/restore','GET /api/export']);
  } finally {await new Promise<void>(r=>server.close(()=>r()));await rm(dir,{recursive:true,force:true});}
});
test('backup CLI requests a consistent backup and validates the returned local SQLite file',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'lc-backup-'));await writeFile(join(dir,'api-token'),'cli-secret');
  const server=createServer(async(req,res)=>{expect(req.url).toBe('/api/backup');expect(req.method).toBe('POST');await mkdir(join(dir,'backups'));const path=join(dir,'backups','safe.sqlite');const db=new Database(path);db.exec('CREATE TABLE evidence(id TEXT); INSERT INTO evidence VALUES (\'a1\')');db.close();res.setHeader('content-type','application/json');res.end(JSON.stringify({path,createdAt:'2026-09-16T00:00:00Z'}));});
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const a=server.address();if(!a||typeof a==='string')throw Error('address');
  try {const result=await run('backup.ts',[],{DATA_DIR:dir,PORT:String(a.port)});expect(JSON.parse(result.stdout).verified).toBe(true);}finally{await new Promise<void>(r=>server.close(()=>r()));await rm(dir,{recursive:true,force:true});}
});
test('Sheet CLI applies only explicitly and reads back every source record from the export',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'lc-apply-'));await writeFile(join(dir,'api-token'),'cli-secret');
  const input=join(dir,'source.json');await writeFile(input,JSON.stringify({retrievedAt:'2026-09-16T00:00:00Z',sheets:[]}));
  let payload:{importId:string;records:Record<string,unknown>[]} | undefined;const calls:string[]=[];
  const server=createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;calls.push(req.url!);res.setHeader('content-type','application/json');if(req.url==='/api/import'){const body=JSON.parse(raw);expect(body.dryRun).toBe(false);payload=body;res.end(JSON.stringify({dryRun:false,counts:{records:body.records.length},warnings:[],unresolved:[]}));}else res.end(JSON.stringify({schemaVersion:1,exportedAt:'2026-09-16T00:00:00Z',tables:{import_batches:[{id:payload!.importId}],import_records:payload!.records.map(r=>({...r,importId:payload!.importId}))}}));});
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const a=server.address();if(!a||typeof a==='string')throw Error('address');
  try{const result=await run('import-sheet.ts',['--input',input,'--apply'],{DATA_DIR:dir,PORT:String(a.port)});expect(JSON.parse(result.stdout).verified).toBe(true);expect(calls).toEqual(['/api/import','/api/export']);}finally{await new Promise<void>(r=>server.close(()=>r()));await rm(dir,{recursive:true,force:true});}
});
test('list CLI imports the pinned manifest with source metadata and verifies canonical source records',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'lc-lists-'));await writeFile(join(dir,'api-token'),'cli-secret');
  const lists:Record<string,unknown>[]=[];let payload:{importId:string;records:Record<string,unknown>[]} | undefined;
  const server=createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;res.setHeader('content-type','application/json');if(req.url==='/api/lists'){if(req.method==='POST'){const list={id:`l${lists.length+1}`,...JSON.parse(raw)};lists.push(list);res.end(JSON.stringify(list));}else res.end(JSON.stringify(lists));}else if(req.url==='/api/import'){payload=JSON.parse(raw);res.end(JSON.stringify({dryRun:false,counts:{problems:250},warnings:[],unresolved:[]}));}else res.end(JSON.stringify({schemaVersion:1,exportedAt:'2026-09-16T00:00:00Z',tables:{import_batches:[{id:payload!.importId}],import_records:payload!.records.map(r=>({...r,importId:payload!.importId}))}}));});
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const a=server.address();if(!a||typeof a==='string')throw Error('address');
  try{const result=await run('import-lists.ts',['--apply'],{DATA_DIR:dir,PORT:String(a.port)});expect(JSON.parse(result.stdout).verified).toBe(true);expect(lists).toHaveLength(3);expect(lists.every(l=>typeof l.sourceVersion==='string'&&(l.name==='NeetCode 250'?String(l.sourceUrl).startsWith('https://neetcode.io/main.'):String(l.sourceUrl).startsWith('https://raw.githubusercontent.com/neetcode-gh/')))).toBe(true);}finally{await new Promise<void>(r=>server.close(()=>r()));await rm(dir,{recursive:true,force:true});}
});
test('Sheet CLI dry-run creates private full mapping/report without reading a token or connecting to a server',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'lc-cli-'));
  try {
    const input=join(dir,'source.json'), output=join(dir,'mapping.json');
    await writeFile(input,JSON.stringify({retrievedAt:'2026-09-16T00:00:00Z',sheets:[{title:'Topic Ratings',values:[['Topic','Rating (1-5)'],['Trees',3.85]]}]}));
    const result=await run('import-sheet.ts',['--input',input,'--dry-run','--output',output],{DATA_DIR:join(dir,'missing'),PORT:'1'});
    expect(JSON.parse(result.stdout).counts.topics).toBe(1);
    const mapped=JSON.parse(await readFile(output,'utf8'));expect(mapped.payload.topics[0].score).toBe(3.85);expect(mapped.payload.dryRun).toBe(true);expect((await stat(output)).mode&0o777).toBe(0o600);
    await expect(run('import-sheet.ts',['--input',input,'--dry-run','--output',input],{DATA_DIR:dir})).rejects.toThrow();
  } finally {await rm(dir,{recursive:true,force:true});}
});
