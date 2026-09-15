import { access, mkdir, open, readFile, writeFile, unlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const dataDir=process.env.DATA_DIR||join(homedir(),'Library/Application Support/LeetcodeTutor-dev');
const port=process.env.PORT||'4317';
const base=`http://127.0.0.1:${port}`;
async function ready() {
  try {
    const health=await fetch(`${base}/health`,{redirect:'error',signal:AbortSignal.timeout(800)});
    if(!health.ok||(await health.json()).ok!==true)return false;
    const token=(await readFile(join(dataDir,'api-token'),'utf8')).trim();
    if(!token||/[\r\n]/.test(token))return false;
    const settings=await fetch(`${base}/api/settings`,{redirect:'error',signal:AbortSignal.timeout(800),headers:{Authorization:`Bearer ${token}`}});
    return settings.ok&&typeof (await settings.json()).timezone==='string';
  }catch{return false;}
}
async function showBrowser() {
  if(process.env.NO_OPEN==='1')return;
  const command=process.platform==='darwin'?'open':process.platform==='linux'?'xdg-open':null;
  if(!command){process.stderr.write(`Open ${base} in your browser.\n`);return;}
  const child=spawn(command,[base],{stdio:'ignore'});
  await new Promise(resolve=>{child.once('error',()=>{process.stderr.write(`Could not open browser; open ${base} manually.\n`);resolve();});child.once('exit',resolve);});
}
async function main() {
  if(Number(process.versions.node.split('.')[0])<22)throw Error('Node.js 22 or newer is required.');
  if(!/^\d+$/.test(port)||Number(port)<1||Number(port)>65535)throw Error('PORT must be an integer from 1 to 65535.');
  if(await ready()){process.stdout.write(`LeetCode Tutor already running: ${base}\n`);await showBrowser();return;}
  const entry=join(root,'dist/server/index.js');
  try{await access(entry);}catch{throw Error('Built server missing. Run npm ci and npm run build in the repository first.');}
  await mkdir(dataDir,{recursive:true,mode:0o700});
  let lock;
  try{lock=await open(join(dataDir,'launcher.lock'),'wx',0o600);}catch{throw Error('Another launch may be in progress. If no launcher remains, remove DATA_DIR/launcher.lock and retry.');}
  let child;
  try{
    await lock.writeFile(String(process.pid));
    const log=await open(join(dataDir,'server.log'),'a',0o600);
    try{child=spawn(process.execPath,[entry],{cwd:root,env:{...process.env,DATA_DIR:dataDir,PORT:port},detached:true,stdio:['ignore',log.fd,log.fd]});}finally{await log.close();}
    let exited=false;child.once('exit',()=>{exited=true;});child.once('error',()=>{exited=true;});
    if(!child.pid)throw Error('Could not start the Node server.');
    child.unref();await writeFile(join(dataDir,'server.pid'),String(child.pid),{mode:0o600});
    const deadline=Date.now()+15000;
    while(Date.now()<deadline){
      if(exited)throw Error(`Server exited before readiness. Check ${join(dataDir,'server.log')}; the port may already be in use.`);
      if(await ready()){process.stdout.write(`Ready: ${base}\nLog: ${join(dataDir,'server.log')}\n`);await showBrowser();return;}
      await delay(200);
    }
    throw Error(`Server failed its authenticated readiness check. Check ${join(dataDir,'server.log')}.`);
  }catch(error){if(child?.pid)try{child.kill('SIGTERM');}catch{/* It may already have exited. */}throw error;}
  finally{await lock.close();await unlink(join(dataDir,'launcher.lock'));}
}
main().catch(error=>{process.stderr.write(`${error.message}\n`);process.exitCode=1;});
