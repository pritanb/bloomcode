// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Attempt } from '../../src/shared/contracts';
import { App } from '../../src/web/App';
const initial:Attempt={id:'a1',problemId:'p1',problem:{id:'p1',title:'A hidden question',url:'https://leetcode.com/problems/two-sum/',difficulty:'Easy'},planItemId:null,status:'active',version:1,language:'python',code:'',notes:'',activeSeconds:42,startedAt:new Date().toISOString(),finishedAt:null,studyDate:'2026-09-16',runningSince:new Date().toISOString(),lastHeartbeatAt:new Date().toISOString(),needsGapDecision:false,outcome:null,help:'unknown',evidence:'unseen',confidence:null,feedback:null,reviewedAt:null,nextReviewDate:null};
function mount() { return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter initialEntries={['/attempts/a1']}><App/></MemoryRouter></QueryClientProvider>); }
afterEach(()=>{cleanup();vi.restoreAllMocks();});

it('locks an uncertain finish and retries the identical idempotent payload after a lost response',async()=>{
  let a={...initial};const finishes:{body:string,key:string|null}[]=[];
  vi.spyOn(globalThis,'fetch').mockImplementation(async(url,init)=>{
    const path=String(url);if(path==='/api/session')return Response.json({csrfToken:'csrf'});if(init?.method==='GET')return Response.json(a);
    const body=JSON.parse(String(init?.body));
    if(path.endsWith('/finish')){finishes.push({body:String(init?.body),key:new Headers(init?.headers).get('Idempotency-Key')});if(finishes.length===1)throw new TypeError('Connection lost after send');a={...a,status:'completed',outcome:'solved'};return Response.json(a);}
    a={...a,version:a.version+1,...(body.action==='pause'?{status:'paused' as const}:{})};return Response.json(a);
  });mount();
  fireEvent.click(await screen.findByRole('button',{name:'Finish attempt'}));
  fireEvent.click(await screen.findByRole('button',{name:'Save attempt'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Connection lost');
  expect(screen.getByRole('button',{name:'Save attempt'})).toBeDisabled();
  fireEvent.click(screen.getByRole('button',{name:'Retry'}));
  expect(await screen.findByText('Awaiting tutor review')).toBeVisible();
  expect(finishes).toHaveLength(2);expect(finishes[0]).toEqual(finishes[1]);
});
