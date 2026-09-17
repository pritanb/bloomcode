import { z } from 'zod';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { pathToFileURL } from 'node:url';
import { LocalApi, ApiError } from './local-api.js';
const id = z.string().min(1).max(200).regex(/^[a-zA-Z0-9_-]+$/);
const version = z.number().int().nonnegative();
const key = z.string().min(1).max(200).regex(/^[a-zA-Z0-9_.:-]+$/);
const date = z.iso.date();
const action = z.enum(['recommended','manual','none']);
const schemas = {
  get_today: z.strictObject({date:date.optional()}),
  search_questions:z.strictObject({search:z.string().max(200).optional(),status:z.enum(['all','solved','not_solved','stopped','not_submitted','unsolved','completed','attempted']).optional(),tags:z.array(id).max(20).optional(),tagMode:z.enum(['any','all']).optional(),tagDifficultyMin:z.number().int().min(1).max(10).optional(),tagDifficultyMax:z.number().int().min(1).max(10).optional(),listId:id.optional(),difficulty:z.enum(['Easy','Medium','Hard']).optional(),timeBucket:z.enum(['0-10','10-20','20-30','30-45','45+','unknown']).optional(),sort:z.enum(['title','lastAttempt','solveTime','reviewDate','tagDifficulty']).optional(),direction:z.enum(['asc','desc']).optional(),page:z.number().int().min(1).max(10000).optional(),pageSize:z.number().int().min(1).max(100).optional()}),
  get_attempt_context:z.strictObject({attemptId:id}),
  finish_attempt: z.strictObject({attemptId:id,idempotencyKey:key,version,outcome:z.enum(['solved','not_solved','stopped']),help:z.enum(['none','small','major','solution','unknown']),activeSeconds:z.number().int().nonnegative().nullable(),code:z.string().max(200000).optional(),notes:z.string().max(50000).optional(),confidence:z.number().min(1).max(5).nullable().optional(),reviewDate:date.nullable().optional(),reviewAction:action.optional()}),
  save_review:z.strictObject({attemptId:id,idempotencyKey:key,version,feedback:z.string().min(1).max(50000),decisions:z.array(z.strictObject({topicId:id,expectedVersion:version,oldScore:z.number().min(1).max(5),newScore:z.number().min(1).max(5),rationale:z.string().min(1).max(10000),evidence:z.enum(['retention','near_transfer','unseen','mock'])})).max(50).optional(),followUp:z.strictObject({date:date.nullable(),action}).optional()}),
  set_review_date:z.strictObject({targetId:id,version,action:z.enum(['manual','snooze','none','recommended']),date:date.nullable().optional()})
};
const descriptions: Record<keyof typeof schemas,string> = {
  get_today:'Get or resume the stable daily plan; does not start an attempt. No hidden pattern context.',
  search_questions:'Search at most 100 questions. Metadata can reveal patterns: use only with consent, never to peek at an active mixed assessment.',
  get_attempt_context:'Read saved code, history and score versions for a requested review. Backend blocks active mixed assessment disclosure.',
  finish_attempt:'Finalise a reported attempt using its current version and a caller-chosen unique idempotency key. Retry with the SAME key and identical payload after uncertainty. Topic scores move automatically under conservative evidence rules; use save_review for manual decisions. Reads back the saved attempt.',
  save_review:'Record tutor feedback on a finished attempt, and optionally adjust topic scores. Scores already move automatically when an attempt is finished, so omit "decisions" to leave a note without changing any score; supply them only to override that judgement. Supply the current attempt/topic versions and a stable idempotency key. Repeat evidence cannot justify increases above 3. Reads back context.',
  set_review_date:'Set a manual, snoozed, recommended or no-review schedule using its current version; reads back the target. On conflict re-read, do not blindly overwrite.'
};
export const toolDefinitions = Object.entries(schemas).map(([name,schema]) => ({name,description:descriptions[name as keyof typeof schemas],inputSchema:z.toJSONSchema(schema) as {type:'object'},annotations:{readOnlyHint:name==='search_questions'||name==='get_attempt_context',destructiveHint:false,openWorldHint:false}}));
export async function callTool(api: LocalApi, name: string, args: unknown) {
  try {
    let result: unknown;
    if (name === 'get_today') result=await api.request('POST','/api/daily-plan/ensure',schemas.get_today.parse(args));
    else if(name==='search_questions') {
      const input=schemas.search_questions.parse(args); const params=new URLSearchParams();
      for(const [k,v] of Object.entries(input)) if(v!==undefined) params.set(k,Array.isArray(v)?v.join(','):String(v));
      result=await api.request('GET',`/api/problems?${params}`);
    } else if(name==='get_attempt_context') result=await api.request('GET',`/api/attempts/${schemas.get_attempt_context.parse(args).attemptId}/context`);
    else if (name === 'finish_attempt' || name==='save_review') {
      const {attemptId,idempotencyKey,...body}=(name==='finish_attempt'?schemas.finish_attempt:schemas.save_review).parse(args);
      const committed=await api.request('POST',`/api/attempts/${attemptId}/${name==='finish_attempt'?'finish':'reviews'}`,body,idempotencyKey);
      let current: unknown;
      try {current=await api.request('GET',`/api/attempts/${attemptId}${name==='save_review'?'/context':''}`);}
      catch {throw new ApiError('COMMITTED_READBACK_FAILED','Write committed but read-back failed. Do not create a new key; retry identical arguments with the SAME key.');}
      const identity=z.object({id:z.string(),version:z.number().int()});
      const saved=identity.safeParse(name==='save_review'?(committed as {attempt?:unknown})?.attempt:committed);
      const readback=identity.safeParse(name==='save_review'?(current as {attempt?:unknown})?.attempt:current);
      if(!saved.success||!readback.success||saved.data.id!==attemptId||readback.data.id!==attemptId||readback.data.version<saved.data.version)throw new ApiError('COMMITTED_READBACK_MISMATCH','Write returned but its attempt identity/version did not match read-back. Re-read before further edits; retain the original idempotency key.');
      result={committed,current,verified:true};
    } else if(name==='set_review_date') {
      const {targetId,...body}=schemas.set_review_date.parse(args);
      const committed=await api.request('PATCH',`/api/reviews/${targetId}`,body);
      const targets=await api.request('GET','/api/reviews');
      const current=Array.isArray(targets)?targets.find((t:{id?:string})=>t.id===targetId):undefined;
      if(!current) throw new ApiError('COMMITTED_READBACK_FAILED','Schedule write committed but target could not be read back. Read current targets before retrying.');
      result={committed,current,verified:true};
    } else throw new ApiError('UNKNOWN_TOOL','Unknown tool.');
    return {content:[{type:'text' as const,text:JSON.stringify(result)}]};
  } catch (error) {
    const data=error instanceof ApiError ? {code:error.code,message:error.message,status:error.status} : error instanceof z.ZodError ? {code:'INVALID_ARGUMENTS',message:'Arguments do not match the tool schema.'} : {code:'INTERNAL_ERROR',message:'Unexpected adapter error.'};
    return {isError:true,content:[{type:'text' as const,text:JSON.stringify({error:data})}]};
  }
}
export async function startMcp() {
  const api=new LocalApi();
  const server=new Server({name:'leetcode-tutor',version:'0.1.0'},{capabilities:{tools:{}}});
  server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:toolDefinitions}));
  server.setRequestHandler(CallToolRequestSchema,async request=>callTool(api,request.params.name,request.params.arguments??{}));
  await server.connect(new StdioServerTransport());
  return server;
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) startMcp().catch(()=>{process.stderr.write('LeetCode Tutor MCP failed to start. Check local runtime settings.\n');process.exitCode=1;});
