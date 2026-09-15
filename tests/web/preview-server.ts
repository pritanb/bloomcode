// Empty, disposable database for visual QA. Never opens the user's pilot database.
import { createApp } from '../../src/server/app';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dir=mkdtempSync(join(tmpdir(),'leetcode-ui-preview-'));
const app=await createApp({dbPath:join(dir,'preview.sqlite'),serveStatic:true});
await app.listen({host:'127.0.0.1',port:4317});
console.log('Disposable preview API ready on 4317');
async function close(){await app.close();rmSync(dir,{recursive:true,force:true});process.exit(0);}
process.on('SIGTERM',()=>void close());process.on('SIGINT',()=>void close());
