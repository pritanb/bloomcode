// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from '../../src/web/App';
const settings = { timezone: 'Australia/Sydney', budgetMinutes: 40, primaryCount: 1, optionalCount: 1, dataMode: 'pilot', lastBackupAt: null };
const problem = { id:'p1',title:'Two Sum',url:'https://leetcode.com/problems/two-sum/',slug:'two-sum',difficulty:'Easy',notes:'',tags:[],lists:[],legacyCompleted:false,exposed:false,lastAttemptAt:null,lastSolveSeconds:null,lastSolveHelp:null,lastOutcome:null,nextReviewDate:null,attemptCount:0 };
const plan = { id: 'd1', date: '2026-09-16', timezone: 'Australia/Sydney', items: [], version: 1 };
function serve(routes: Record<string, unknown>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    const path = String(url);
    if (path === '/api/session') return Response.json({csrfToken:'csrf'});
    const value = routes[`${init?.method ?? 'GET'} ${path}`] ?? routes[path];
    if (value === undefined) return Response.json({error:{code:'not_found',message:`Unexpected request ${path}`}}, {status:404});
    return Response.json(value);
  });
}
function mount(path = '/') { return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}})}><MemoryRouter initialEntries={[path]}><App /></MemoryRouter></QueryClientProvider>); }
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it('ensures the daily plan then displays real scores, no-change rationale and honest empty practice', async () => {
  const fetcher = serve({'/api/daily-plan/ensure':plan, '/api/dashboard':{plan, settings, activeAttempt:null, recentAttempts:[], topics:[{id:'t1',name:'Graphs',score:3.25,version:1,provisional:true,lastReviewed:'2026-09-15',notes:'',lastMovement:null}], movements:[{id:'m1',topicId:'t1',topicName:'Graphs',oldScore:3.25,newScore:3.25,rationale:'Repeat evidence only',date:'2026-09-15',evidence:'retention',attemptId:null}]}});
  mount();
  expect(await screen.findByText('3.25')).toBeVisible();
  expect(screen.getByText('Repeat evidence only')).toBeVisible();
  expect(screen.getByText('No change')).toBeVisible();
  expect(screen.getByText(/No practice recorded yet/)).toBeVisible();
  expect(screen.getByText('40 min')).toBeVisible();
  const paths = fetcher.mock.calls.map(([url])=>String(url));
  expect(paths.indexOf('/api/daily-plan/ensure')).toBeLessThan(paths.indexOf('/api/dashboard'));
});

it('keeps the study desk compact with a full history while leaving details available', async () => {
  const topics = Array.from({length:20}, (_,i)=>({id:`compact-${i}`,name:`Pattern ${i}`,score:3,version:1,provisional:true,lastReviewed:null,notes:'',lastMovement:null}));
  const movements = Array.from({length:12}, (_,i)=>({id:`m-${i}`,topicId:'compact-0',topicName:'History topic',oldScore:3,newScore:3.1,rationale:`Decision ${i}`,date:'2026-09-15',evidence:'unseen',attemptId:null}));
  const recentAttempts = Array.from({length:12}, (_,i)=>({id:`a-${i}`,problem:{...problem,title:`Practice ${i}`},status:'completed',outcome:'solved',activeSeconds:600,evidence:'retention',help:'none',finishedAt:'2026-09-15',reviewedAt:null}));
  serve({'/api/daily-plan/ensure':plan, '/api/dashboard':{plan,settings,activeAttempt:null,topics,movements,recentAttempts}});
  mount();
  await screen.findByText('Pattern 0');
  expect(screen.getAllByRole('link',{name:/^Pattern /})).toHaveLength(6);
  expect(screen.getByRole('link',{name:'View all 20 topics'})).toHaveAttribute('href','/topics');
  expect(screen.getByText('Decision 3')).not.toBeVisible();
  expect(screen.getByText('Practice 5')).not.toBeVisible();
  expect(screen.getByText('More score decisions')).toBeVisible();
  expect(screen.getByText('More recent practice')).toBeVisible();
});

it('adds a real question and preserves all library filters in its API query', async () => {
  const query = 'status=completed&tags=t1&tagMode=all&tagDifficultyMin=3&tagDifficultyMax=8&listId=l1&difficulty=Medium&timeBucket=10-20&sort=tagDifficulty&direction=desc&page=1&pageSize=25';
  const fetcher = serve({'/api/tags':[{id:'t1',name:'Arrays',description:'',archived:false}], '/api/lists':[{id:'l1',name:'My list',sourceUrl:null,sourceVersion:null}], [`/api/problems?${query}`]:{items:[problem],total:1,page:1,pageSize:25}, 'POST /api/problems':problem, '/api/problems/p1':{problem,attempts:[],reviews:[]}});
  mount(`/library?${query}`);
  expect(await screen.findByText('Two Sum')).toBeVisible();
  expect(screen.getByLabelText('Tag match')).toHaveValue('all');
  fireEvent.click(screen.getByRole('button',{name:'Add question'}));
  fireEvent.change(screen.getByLabelText('Question title'),{target:{value:'Two Sum'}});
  fireEvent.change(screen.getByLabelText('LeetCode URL'),{target:{value:problem.url}});
  fireEvent.click(screen.getByRole('button',{name:'Save question'}));
  await waitFor(()=>expect(fetcher.mock.calls.some(([url,init])=>url==='/api/problems'&&init?.method==='POST')).toBe(true));
  const request=fetcher.mock.calls.find(([url,init])=>url==='/api/problems'&&init?.method==='POST');
  expect(JSON.parse(String(request?.[1]?.body))).toMatchObject({title:'Two Sum',url:problem.url});
  expect(await screen.findByRole('heading',{name:'Two Sum'})).toBeVisible();
});

it('edits question metadata and turns off a scheduled review with its current version', async () => {
  const fetcher=serve({'/api/problems/p1':{problem,attempts:[],reviews:[{id:'r1',problemId:'p1',problemTitle:'Two Sum',constraint:null,recommendedDate:'2026-09-20',effectiveDate:'2026-09-20',action:'recommended',version:4,stage:'retention'}]}, '/api/tags':[], '/api/lists':[], 'PATCH /api/problems/p1':{...problem,notes:'Keep this note'}, 'PATCH /api/reviews/r1':{id:'r1'}});
  mount('/library/p1');
  fireEvent.click(await screen.findByRole('button',{name:'Edit question'}));
  fireEvent.change(screen.getByLabelText('Question notes'),{target:{value:'Keep this note'}});
  fireEvent.click(screen.getByRole('button',{name:'Save question'}));
  await waitFor(()=>expect(fetcher.mock.calls.some(([,i])=>i?.method==='PATCH'&&String(i.body).includes('Keep this note'))).toBe(true));
  fireEvent.change(screen.getByLabelText('Review scheduling'),{target:{value:'none'}});
  fireEvent.click(screen.getByRole('button',{name:'Save review date'}));
  await waitFor(()=>expect(fetcher.mock.calls.some(([u,i])=>u==='/api/reviews/r1'&&i?.body==='{"version":4,"action":"none","date":null}')).toBe(true));
});

it('creates and archives tags and creates source-labelled custom lists', async () => {
  const fetcher=serve({'/api/tags':[{id:'t1',name:'Arrays',description:'',archived:false}],'/api/lists':[], 'POST /api/tags':{id:'t2',name:'Pointers'},'PATCH /api/tags/t1':{id:'t1',name:'Arrays',archived:true},'POST /api/lists':{id:'l1',name:'Interview set'}});
  mount('/library/manage');
  fireEvent.change(await screen.findByLabelText('New tag name'),{target:{value:'Pointers'}});
  fireEvent.click(screen.getByRole('button',{name:'Create tag'}));
  await waitFor(()=>expect(fetcher.mock.calls.some(([u,i])=>u==='/api/tags'&&i?.method==='POST')).toBe(true));
  fireEvent.click(screen.getByRole('button',{name:'Archive Arrays'}));
  await waitFor(()=>expect(fetcher.mock.calls.some(([u,i])=>u==='/api/tags/t1'&&String(i?.body).includes('"archived":true'))).toBe(true));
  fireEvent.change(screen.getByLabelText('New list name'),{target:{value:'Interview set'}});
  fireEvent.click(screen.getByRole('button',{name:'Create list'}));
  await waitFor(()=>expect(fetcher.mock.calls.some(([u,i])=>u==='/api/lists'&&i?.method==='POST'&&String(i.body).includes('Interview set'))).toBe(true));
});

it('shows topic evidence with honest known-time sample size and filterable practice',async()=>{
  serve({'/api/topics/t1':{topic:{id:'t1',name:'Graph traversal',score:3.4,version:1,notes:'Needs transfer evidence',lastReviewed:null,provisional:true,lastMovement:null},decisions:[],attempts:[],problems:[problem],stats:{attemptCount:7,knownTimeCount:3,medianSeconds:600}}});
  mount('/topics/t1');
  expect(await screen.findByRole('heading',{name:'Graph traversal'})).toBeVisible();
  expect(screen.getByText('3.4')).toBeVisible();expect(screen.getByText('10:00')).toBeVisible();
  expect(screen.getByText(/3 of 7 attempts have known times/)).toBeVisible();
  expect(screen.getByLabelText('Evidence type')).toBeVisible();expect(screen.getByLabelText('Help filter')).toBeVisible();
  expect(screen.getByRole('link',{name:'Two Sum'})).toHaveAttribute('href','/library/p1');
});

it('saves the user workload and downloads a real portable export',async()=>{
  const fetcher=serve({'/api/settings':settings,'PATCH /api/settings':{...settings,budgetMinutes:60},'/api/export':{schemaVersion:1,exportedAt:'2026-09-16T00:00:00Z',tables:{problems:[problem]}}});
  const objectUrl=vi.fn(()=> 'blob:test');Object.defineProperty(URL,'createObjectURL',{value:objectUrl,configurable:true});Object.defineProperty(URL,'revokeObjectURL',{value:vi.fn(),configurable:true});
  const click=vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});
  mount('/settings');
  expect(await screen.findByLabelText('Daily budget (minutes)')).toHaveAttribute('max','240');
  fireEvent.change(screen.getByLabelText('Daily budget (minutes)'),{target:{value:'60'}});
  fireEvent.click(screen.getByRole('button',{name:'Save settings'}));
  expect(await screen.findByText('Settings saved.')).toBeVisible();
  expect(fetcher.mock.calls.some(([u,i])=>u==='/api/settings'&&i?.method==='PATCH'&&JSON.parse(String(i.body)).budgetMinutes===60)).toBe(true);
  fireEvent.click(screen.getByRole('button',{name:'Download export'}));
  await waitFor(()=>expect(objectUrl).toHaveBeenCalledWith(expect.any(Blob)));
  expect(click).toHaveBeenCalledOnce();
  expect(screen.getByText('No backup recorded')).toBeVisible();
});
