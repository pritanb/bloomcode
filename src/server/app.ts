import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import cookie from '@fastify/cookie';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { z, ZodError } from 'zod';
import { openDb } from './db.js';
import { settings } from './schema.js';
export interface AppOptions { dbPath:string; token?:string; serveStatic?:boolean|string; clock?:()=>Date }
import { ApiError } from './errors.js';
import { Store } from './store.js';
import { dirname } from 'node:path';
import { loadToken } from './auth.js';
import { registerTransfer } from './transfer.js';
import { registerPlans } from './plans.js';
import { registerScoring } from './scoring.js';
import { registerImport } from './import.js';
import { registerTopics } from './topics.js';
import { registerCloseout } from './closeout.js';
import { registerAttempts } from './attempts.js';
import { registerCatalogue } from './catalogue.js';
const equal=(a:string,b:string)=>{const left=Buffer.from(a),right=Buffer.from(b);return left.length===right.length&&timingSafeEqual(left,right);};
export async function createApp(options:AppOptions) {
 const app=Fastify({bodyLimit:2*1024*1024,logger:false});
 const db=openDb(options.dbPath);
 const token=options.token ?? (options.dbPath===':memory:'?randomBytes(32).toString('hex'):loadToken(dirname(options.dbPath)));
 const sessions=new Map<string,{csrf:string,expires:number}>();
 const clock=options.clock ?? (()=>new Date());
 await app.register(cookie);
 app.addHook('onClose',async()=>{db.sqlite.close();});
 app.setErrorHandler((error,_req,reply)=>{
   const err=error as Error & {statusCode?:number;code?:string;status?:number};
   const status=err instanceof ZodError?400:err.status ?? (err.statusCode && err.statusCode<500?err.statusCode:500);
   reply.status(status).send({error:{code:err instanceof ZodError?'VALIDATION':status===500?'INTERNAL':err.code??'BAD_REQUEST',message:status===500?'Internal server error':err.message}});
 });
 const staticRoot=typeof options.serveStatic==='string'?options.serveStatic:fileURLToPath(new URL('../../dist/web/',import.meta.url));
 if(options.serveStatic&&existsSync(staticRoot))await app.register(fastifyStatic,{root:staticRoot});
 app.setNotFoundHandler((req,reply)=>{if(options.serveStatic&&existsSync(staticRoot)&&req.method==='GET'&&!req.url.startsWith('/api/')&&!req.url.split('?')[0]!.split('/').at(-1)!.includes('.'))return reply.sendFile('index.html');return reply.status(404).send({error:{code:'NOT_FOUND',message:'Route not found'}});});
 app.addHook('onSend',async(_req,reply,payload)=>{reply.header('X-Content-Type-Options','nosniff').header('Referrer-Policy','no-referrer').header('X-Frame-Options','DENY').header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'").header('Cache-Control','no-store');return payload;});
 app.addHook('onRequest',async(req)=>{
   const host=req.headers.host ?? '';
   if(!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)) throw new ApiError(403,'HOST','Loopback host required');
   if(req.raw.socket.localPort && Number(new URL(`http://${host}`).port||80)!==req.raw.socket.localPort)throw new ApiError(403,'HOST','Host port must match the listening port');
   if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.ip))throw new ApiError(403,'LOOPBACK','Loopback connections only');
   if(req.headers.origin && req.headers.origin!==`http://${host}`) throw new ApiError(403,'ORIGIN','Same origin required');
   if(req.url.split('?')[0]==='/health'||req.url.split('?')[0]==='/api/session'||(options.serveStatic&&!req.url.startsWith('/api/')&&['GET','HEAD'].includes(req.method))) return;
   if(req.headers.authorization?.startsWith('Bearer ') && equal(req.headers.authorization.slice(7),token)) return;
   if(['/api/import','/api/restore','/api/backup'].includes(req.url.split('?')[0]!))throw new ApiError(403,'BEARER_REQUIRED','This operation requires the local bearer credential');
   const session=sessions.get(req.cookies.lc_session ?? '');
   if(!session || session.expires<clock().getTime()) throw new ApiError(401,'UNAUTHENTICATED','Authentication required');
   if(!['GET','HEAD','OPTIONS'].includes(req.method) && !equal(String(req.headers['x-csrf-token']??''),session.csrf)) throw new ApiError(403,'CSRF','CSRF token required');
 });
 app.get('/health',()=>({ok:true}));
 app.get('/api/session',(_req,reply)=>{
   const id=randomBytes(32).toString('hex'),csrf=randomBytes(32).toString('hex');
   sessions.set(id,{csrf,expires:clock().getTime()+86400000});
   reply.setCookie('lc_session',id,{httpOnly:true,sameSite:'strict',path:'/',maxAge:86400});
   return {csrfToken:csrf};
 });
 app.get('/api/settings',()=>db.orm.select().from(settings).get()!.data);
 app.patch('/api/settings',(req)=>{
   const update=z.object({timezone:z.string().refine(v=>{try{new Intl.DateTimeFormat('en',{timeZone:v});return true;}catch{return false;}},'Invalid timezone').optional(),questionsPerDay:z.number().int().min(1).max(20).optional(),budgetMinutes:z.number().int().min(5).max(240).optional(),primaryCount:z.number().int().min(1).max(10).optional(),optionalCount:z.number().int().min(0).max(10).optional()}).strict().parse(req.body);
   const data={...db.orm.select().from(settings).get()!.data,...update};
   db.orm.update(settings).set({data}).run(); return data;
 });
 const store=new Store(db.sqlite);
 registerCatalogue(app,store,clock);
 registerAttempts(app,store,clock);
 registerCloseout(app,store,clock);
 registerImport(app,store,clock);
 registerTopics(app,store);
 registerScoring(app,store,clock);
 registerPlans(app,store,clock);
 registerTransfer(app,store,clock,options.dbPath);
 return app;
}
