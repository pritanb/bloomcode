import { expect, it, vi } from 'vitest';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ApiError, type LocalApi } from '../../src/integrations/local-api.js';
import { selectFocusTopics } from '../../src/integrations/topic-analysis.js';
import { analyzeNext } from '../../src/integrations/learning-insights.js';
import { conciseReportResult, reportResult } from '../../src/shared/insights.js';
const finding={title:'Check your search bounds',kind:'focus',action:'Explain why both bounds contain the answer before searching.',explanation:'Two notes describe difficulty choosing the upper bound.',evidenceIds:['e1'],caveat:'Self-reported evidence.',suggestions:[]};
const valid={findings:[finding],limitation:'Retrieved evidence only.'};
function harness(outputs:unknown[], failure?:ApiError) {
  const request=vi.fn(async(_method:string,path:string)=>{
    if(path.endsWith('/claim'))return {work:{job:{id:'report-job',attemptId:null,claimId:'claim'},context:{evidence:[{id:'e1'}]}}};
    if(path.endsWith('/complete')&&failure)throw failure;
    return {ok:true};
  });
  const createMessage=vi.fn(async()=>({model:'test',content:{type:'text',text:JSON.stringify(outputs.shift())}}));
  return {request,createMessage,run:()=>analyzeNext({request} as unknown as LocalApi,{createMessage} as unknown as Server)};
}
it('enforces writing limits without breaking legacy saved reports',()=>{
  for(const [field,words] of [['title',7],['action',26],['explanation',36]] as const){
    const long={...valid,findings:[{...finding,[field]:Array(words).fill('word').join(' ')}]};
    expect(conciseReportResult.safeParse(long).success).toBe(false);
    expect(reportResult.safeParse(long).success).toBe(true);
  }
  expect(conciseReportResult.safeParse(valid).success).toBe(true);
});
it('corrects invalid output once and sends specific errors back to the tutor',async()=>{
  const h=harness([{...valid,findings:[{...finding,title:'one two three four five six seven'}]},valid]);
  await h.run();expect(h.createMessage).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(h.createMessage.mock.calls[1])).toContain('Habit must contain at most 6 words');
  expect(h.request.mock.calls.filter(c=>c[1].endsWith('/complete'))).toHaveLength(1);
});
it('stops after one failed correction and does not save invalid reports',async()=>{
  const h=harness([{},{}]);await h.run();expect(h.createMessage).toHaveBeenCalledTimes(2);
  expect(h.request.mock.calls.some(c=>c[1].endsWith('/complete'))).toBe(false);
  expect(h.request.mock.calls.some(c=>c[1].endsWith('/fail'))).toBe(true);
});
it('corrects invalid citations but does not retry stale claims',async()=>{
  const evidence=harness([valid,valid],new ApiError('EVIDENCE','Unknown evidence ID',400));await evidence.run();expect(evidence.createMessage).toHaveBeenCalledTimes(2);
  const stale=harness([valid],new ApiError('CONFLICT','Evidence changed',409));await stale.run();expect(stale.createMessage).toHaveBeenCalledTimes(1);
});

it('selects exactly three topics from all 18 in one request, preserving AI order',async()=>{
  const topics=Array.from({length:18},(_,i)=>({id:`t${i}`,name:`Topic ${i}`,score:2,provisional:true,lastReviewed:null,recentAttempts:[],scoreMovements:[]}));
  const createMessage=vi.fn(async()=>({content:{type:'text',text:'{"topicNumbers":[8,2,15]}'}}));
  expect(await selectFocusTopics({createMessage} as unknown as Server,topics)).toEqual(['t7','t1','t14']);
  expect(createMessage).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(createMessage.mock.calls)).toContain('Topic 17');
});
it('rejects incomplete, duplicate or unknown selections without additional AI requests',async()=>{
  const topics=Array.from({length:4},(_,i)=>({id:`t${i}`,name:`Topic ${i}`,score:null,provisional:true,lastReviewed:null,recentAttempts:[],scoreMovements:[]}));
  for(const topicNumbers of [[1],[1,1,2],[1,2,5]]){
    const createMessage=vi.fn(async()=>({content:{type:'text',text:JSON.stringify({topicNumbers})}}));
    await expect(selectFocusTopics({createMessage} as unknown as Server,topics)).rejects.toThrow();
    expect(createMessage).toHaveBeenCalledTimes(1);
  }
});
