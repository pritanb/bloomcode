// Self-contained real-browser flow. Always uses a disposable SQLite database.
import { chromium, expect } from '@playwright/test';
import { fork } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dir=mkdtempSync(join(tmpdir(),'lc-browser-'));
const child=fork(join(process.cwd(),'tests/web/api-server.ts'),[dir,'--static'],{execArgv:['--import','tsx'],stdio:['ignore','ignore','inherit','ipc']});
const address=await new Promise<string>((resolve,reject)=>{child.once('message',m=>resolve((m as {address:string}).address));child.once('error',reject);});
const browser=await chromium.launch({headless:true});
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  page.on('response',async r=>{if(r.status()>=400)console.log('HTTP ERROR',r.status(),await r.text());});
  await page.goto(`${address}/library/manage`);
  await page.getByLabel('New tag name').fill('QA pattern');await page.getByRole('button',{name:'Create tag',exact:true}).click();await page.getByLabel('Name for QA pattern').waitFor();
  await page.getByLabel('New list name').fill('QA list');await page.getByRole('button',{name:'Create list',exact:true}).click();await page.getByRole('link',{name:'QA list',exact:true}).waitFor();
  await page.getByRole('link',{name:'Back to library'}).click();await page.getByRole('button',{name:'Add question',exact:true}).click();
  await page.getByLabel('Question title').fill('Two Sum');await page.getByLabel('LeetCode URL').fill('https://leetcode.com/problems/two-sum/');
  const form=page.getByRole('region',{name:'Add question'});await form.getByLabel('QA pattern',{exact:true}).check();await form.getByLabel('QA pattern difficulty (1–10)').fill('4');await form.getByLabel('QA list',{exact:true}).check();await page.getByRole('button',{name:'Save question'}).click();
  await page.getByRole('button',{name:'Start targeted practice'}).click();await page.locator('.cm-content').fill('def two_sum(nums, target):\n    return []');await page.getByLabel('Attempt notes').fill('Browser QA: preserved after reload');
  await expect(page.getByText('Draft saved',{exact:true})).toBeVisible();await page.reload();await expect(page.locator('.cm-content')).toContainText('def two_sum');await expect(page.getByLabel('Attempt notes')).toHaveValue('Browser QA: preserved after reload');
  await expect(page.getByText('Topic progress',{exact:true})).toHaveCount(0);
  await page.screenshot({path:'/tmp/leetcode-attempt.png',fullPage:true});
  await page.getByRole('button',{name:'Finish attempt',exact:true}).click();await page.getByLabel('Outcome',{exact:true}).selectOption('not_solved');await page.getByLabel('Help used').selectOption('small');await page.getByLabel('Next review').selectOption('none');await page.getByRole('button',{name:'Save attempt',exact:true}).click();
  await expect(page.getByText('Awaiting tutor review',{exact:true})).toBeVisible();await page.reload();await expect(page.getByText('Awaiting tutor review',{exact:true})).toBeVisible();await expect(page.locator('.cm-content')).toContainText('def two_sum');
  await expect(page.getByText('Next review: Not scheduled')).toBeVisible();await page.getByRole('link',{name:'Done for now'}).click();await page.getByRole('heading',{name:'Your study desk'}).waitFor();
  expect(errors).toEqual([]);console.log('Real browser flow passed: tags/list, question, CodeMirror draft + restart recovery, hidden workspace, finish + no-review persistence.');
}finally{await browser.close();child.send('close');await new Promise<void>(resolve=>child.once('exit',()=>resolve()));rmSync(dir,{recursive:true,force:true});}
