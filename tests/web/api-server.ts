import { createApp } from '../../src/server/app';
import { join } from 'node:path';
const app=await createApp({dbPath:join(process.argv[2],'test.sqlite'),token:'isolated-test-token',serveStatic:process.argv.includes('--static')});
const address=await app.listen({host:'127.0.0.1',port:0});
process.send?.({address});
process.on('message',async message=>{if(message==='close'){await app.close();process.exit(0);}});
