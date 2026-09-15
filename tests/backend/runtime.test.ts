import { it, expect } from 'vitest';
import { request as httpRequest } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../src/server/app.js';

import { writeFileSync, mkdirSync } from 'node:fs';

import Database from 'better-sqlite3';

it('applies a tracked Drizzle migration once with enforced SQLite foreign keys',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'lc-migrate-')),path=join(dir,'db.sqlite');
 try{for(let i=0;i<2;i++){const app=await createApp({dbPath:path,token:'test-token'});await app.close();}
 const db=new Database(path);try {const table=db.prepare("SELECT name FROM sqlite_master WHERE name='__drizzle_migrations'").get();expect(table).toBeDefined();expect((db.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get() as {n:number}).n).toBe(1);expect(db.pragma('foreign_key_list(plan_items)')).toHaveLength(3);}finally{db.close();}}
 finally{rmSync(dir,{recursive:true,force:true});}
});

it('serves the built same-origin browser shell without exposing private APIs',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'lc-static-'));mkdirSync(join(dir,'web'));writeFileSync(join(dir,'web','index.html'),'<!doctype html><main>Study app shell</main>');
 const app=await createApp({dbPath:join(dir,'db.sqlite'),token:'test-token',serveStatic:join(dir,'web')});
 try{expect((await app.inject('/')).body).toContain('Study app shell');expect((await app.inject('/library')).body).toContain('Study app shell');expect((await app.inject('/api/problems')).statusCode).toBe(401);expect((await app.inject('/')).headers['x-content-type-options']).toBe('nosniff');}finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});

it('runs on loopback with a stable private data-directory credential and rejects a mismatched listening port',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'lc-runtime-'));
 const child=spawn(process.execPath,['--import','tsx','src/server/index.ts'],{env:{...process.env,DATA_DIR:dir,PORT:'0'},stdio:['ignore','pipe','pipe']});
 let stderr='';child.stderr.on('data',chunk=>{stderr+=String(chunk);});
 try {
  const address=await new Promise<string>((resolve,reject)=>{let output='';const timeout=setTimeout(()=>reject(new Error(`Startup timed out: ${stderr}`)),10000);child.once('exit',()=>{clearTimeout(timeout);reject(new Error(stderr||'Server exited before readiness'));});child.stdout.on('data',chunk=>{output+=String(chunk);const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timeout);resolve(match[0]);}});});
  expect((await fetch(`${address}/health`)).status).toBe(200);
  const token=readFileSync(join(dir,'api-token'),'utf8').trim();expect(token.length).toBeGreaterThanOrEqual(32);expect(statSync(join(dir,'api-token')).mode&0o777).toBe(0o600);
  expect((await fetch(`${address}/api/settings`,{headers:{authorization:`Bearer ${token}`}})).status).toBe(200);
  const hostStatus=await new Promise<number|undefined>((resolve,reject)=>{const req=httpRequest(`${address}/health`,{headers:{host:'127.0.0.1:9999'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end();});expect(hostStatus).toBe(403);
  const app=await createApp({dbPath:join(dir,'leetcode.sqlite')});try {expect((await app.inject({url:'/api/settings',headers:{authorization:`Bearer ${token}`}})).statusCode).toBe(200);}finally{await app.close();}
 }finally{child.kill('SIGTERM');await new Promise<void>(resolve=>{if(child.exitCode!==null)resolve();else child.once('exit',()=>resolve());});rmSync(dir,{recursive:true,force:true});}
});
