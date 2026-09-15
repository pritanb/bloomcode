import { test,expect } from 'vitest';
import { mkdtemp,mkdir,copyFile,writeFile,readFile,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:net';
const exec=promisify(execFile);
test('launcher starts the bundled loopback app, authenticates readiness and reuses it without opening browser in test mode',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'lc-launch-'));const data=join(dir,'data');let pid:number|undefined;
  const reservation=createServer();await new Promise<void>(r=>reservation.listen(0,'127.0.0.1',r));const a=reservation.address();if(!a||typeof a==='string')throw Error('address');const port=a.port;await new Promise<void>(r=>reservation.close(()=>r()));
  try{
    await mkdir(join(dir,'scripts'));await mkdir(join(dir,'dist/server'),{recursive:true});
    await copyFile('scripts/start-local.sh',join(dir,'scripts/start-local.sh'));await copyFile('scripts/launch-local.mjs',join(dir,'scripts/launch-local.mjs'));
    await writeFile(join(dir,'dist/server/index.js'),`const http=require('http'),fs=require('fs'),path=require('path');fs.writeFileSync(path.join(process.env.DATA_DIR,'api-token'),'launcher-test');http.createServer((req,res)=>{res.setHeader('content-type','application/json');if(req.url==='/health')res.end(JSON.stringify({ok:true}));else if(req.headers.authorization==='Bearer launcher-test')res.end(JSON.stringify({timezone:'Australia/Sydney'}));else{res.statusCode=401;res.end('{}');}}).listen(Number(process.env.PORT),'127.0.0.1');`);
    const env={...process.env,DATA_DIR:data,PORT:String(port),NO_OPEN:'1',NODE_BINARY:process.execPath};
    const first=await exec('/bin/sh',[join(dir,'scripts/start-local.sh')],{env,timeout:15000});expect(first.stdout).toContain('Ready');pid=Number(await readFile(join(data,'server.pid'),'utf8'));
    const second=await exec('/bin/sh',[join(dir,'scripts/start-local.sh')],{env,timeout:15000});expect(second.stdout).toContain('already running');expect(Number(await readFile(join(data,'server.pid'),'utf8'))).toBe(pid);
    expect((await fetch(`http://127.0.0.1:${port}/health`)).ok).toBe(true);
  }finally{if(pid)process.kill(pid,'SIGTERM');await rm(dir,{recursive:true,force:true});}
});
