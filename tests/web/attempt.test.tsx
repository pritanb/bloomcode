// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Attempt } from '../../src/shared/contracts';
import { App } from '../../src/web/App';
const initial:Attempt={id:'a1',problemId:'p1',problem:{id:'p1',title:'A hidden question',url:'https://leetcode.com/problems/two-sum/',difficulty:'Easy'},planItemId:null,status:'active',version:1,language:'python',code:'',notes:'',activeSeconds:42,startedAt:new Date().toISOString(),finishedAt:null,studyDate:'2026-09-16',runningSince:new Date().toISOString(),lastHeartbeatAt:new Date().toISOString(),needsGapDecision:false,outcome:null,help:'unknown',evidence:'unseen',confidence:null,feedback:null,reviewedAt:null,nextReviewDate:null};
function mount() { return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter initialEntries={['/attempts/a1']}><App/></MemoryRouter></QueryClientProvider>); }
afterEach(()=>{cleanup();vi.restoreAllMocks();});
it('uses a hidden-safe editor, saves notes then finishes unknown time without fetching topic context',async()=>{
  let a={...initial};const writes:{path:string;body:Record<string,unknown>;key:string|null}[]=[];
  const fetcher=vi.spyOn(globalThis,'fetch').mockImplementation(async(url,init)=>{
    const path=String(url);if(path==='/api/session')return Response.json({csrfToken:'csrf'});
    if(init?.method==='GET')return Response.json(a);
    const body=JSON.parse(String(init?.body));writes.push({path,body,key:new Headers(init?.headers).get('Idempotency-Key')});
    expect(body.version).toBe(a.version);
    a={...a,...(path.endsWith('/draft')?body:{}),version:a.version+1,...(path.endsWith('/finish')?{status:'completed' as const,outcome:body.outcome,help:body.help,activeSeconds:body.activeSeconds,notes:body.notes,finishedAt:new Date().toISOString()}:{}),...(body.action==='pause'?{status:'paused' as const}: {})};return Response.json(a);
  });
  const view=mount();
  expect(await screen.findByRole('heading',{name:'A hidden question'})).toBeVisible();
  expect(view.container.querySelector('.cm-editor')).not.toBeNull();
  expect(screen.queryByText('Topic progress')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Attempt notes'),{target:{value:'My reasoning'}});
  await waitFor(()=>expect(writes.some(w=>w.path.endsWith('/draft')&&w.body.notes==='My reasoning')).toBe(true),{timeout:2500});
  fireEvent.click(screen.getByRole('button',{name:'Finish attempt'}));
  fireEvent.change(await screen.findByLabelText('Outcome'),{target:{value:'not_solved'}});
  fireEvent.click(screen.getByLabelText('Time unknown'));
  fireEvent.change(screen.getByLabelText('Next review'),{target:{value:'none'}});
  fireEvent.click(screen.getByRole('button',{name:'Save attempt'}));
  expect(await screen.findByText('Awaiting tutor review')).toBeVisible();
  const finish=writes.find(w=>w.path.endsWith('/finish'));
  expect(finish?.body).toMatchObject({notes:'My reasoning',outcome:'not_solved',activeSeconds:null,reviewAction:'none',help:'unknown'});
  expect(finish?.key).toBeTruthy();
  expect(fetcher.mock.calls.every(([u])=>!String(u).includes('/context')&&!String(u).includes('/topics')&&!String(u).includes('/problems'))).toBe(true);
});

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
