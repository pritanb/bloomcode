import { it, expect } from 'vitest';
import { request as httpRequest } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../src/server/app.js';



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
