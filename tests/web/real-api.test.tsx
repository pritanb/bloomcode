// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { mkdtempSync, rmSync } from 'node:fs';
import { fork } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { App } from '../../src/web/App';
afterEach(()=>{cleanup();vi.restoreAllMocks();});
it('completes the actual browser flow against authenticated Fastify and durable SQLite',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'lc-web-'));
  const child=fork(join(process.cwd(),'tests/web/api-server.ts'),[dir],{execArgv:['--import','tsx'],stdio:['ignore','ignore','pipe','ipc']});
  const address=await new Promise<string>((resolve,reject)=>{child.once('message',(message)=>resolve((message as {address:string}).address));child.once('error',reject);child.once('exit',code=>reject(new Error(`Test server exited ${code}`)));child.stderr?.on('data',data=>process.stderr.write(data));});
  const fetchReal=globalThis.fetch;
  try{
    const created=await fetchReal(`${address}/api/problems`,{method:'POST',headers:{authorization:'Bearer isolated-test-token','Content-Type':'application/json'},body:JSON.stringify({title:'Two Sum',url:'https://leetcode.com/problems/two-sum/'})});
    expect(created.status).toBe(200);const problem=await created.json();let cookie='';
    vi.spyOn(globalThis,'fetch').mockImplementation(async(url,init)=>{
      const headers=Object.fromEntries(new Headers(init?.headers).entries());
      const result=await fetchReal(`${address}${url}`,{...init,headers:{...headers,...(cookie?{cookie}:{})}});
      if(result.headers.get('set-cookie'))cookie=result.headers.get('set-cookie')!.split(';')[0];
      return result;
    });
    render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter initialEntries={[`/library/${problem.id}`]}><App/></MemoryRouter></QueryClientProvider>);
    fireEvent.click(await screen.findByRole('button',{name:'Start targeted practice'}));
    await screen.findByLabelText('Attempt notes');
    fireEvent.change(screen.getByLabelText('Attempt notes'),{target:{value:'Durable browser reasoning'}});
    await waitFor(()=>expect(screen.getByText('Draft saved')).toBeVisible(),{timeout:3000});
    fireEvent.click(screen.getByRole('button',{name:'Finish attempt'}));
    fireEvent.change(await screen.findByLabelText('Next review'),{target:{value:'manual'}});
    fireEvent.change(screen.getByLabelText('Review date'),{target:{value:'2026-10-01'}});
    fireEvent.click(screen.getByRole('button',{name:'Save attempt'}));
    expect(await screen.findByText('Awaiting tutor review')).toBeVisible();
    const history=await (await fetchReal(`${address}/api/problems/${problem.id}`,{headers:{authorization:'Bearer isolated-test-token'}})).json();
    expect(history.attempts).toHaveLength(1);
    expect(history.attempts[0]).toMatchObject({status:'completed',notes:'Durable browser reasoning',nextReviewDate:'2026-10-01'});
    expect(history.reviews[0]).toMatchObject({action:'manual',effectiveDate:'2026-10-01'});
  }finally{cleanup();child.send('close');await new Promise<void>(resolve=>child.once('exit',()=>resolve()));rmSync(dir,{recursive:true,force:true});}
},15000);
