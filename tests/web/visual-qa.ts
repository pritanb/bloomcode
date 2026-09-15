import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true});
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.QA_URL??'http://127.0.0.1:4317');
  const title=page.getByRole('heading',{name:'Your study desk'});await title.waitFor();
  assert.ok((await title.boundingBox())!.y<90,'Dashboard should start near the top, not be vertically centred');
  for(const width of [1440,768,390]){
    await page.setViewportSize({width,height:1000});
    for(const path of ['/','/library','/topics','/settings']){
      await page.goto(`${process.env.QA_URL??'http://127.0.0.1:4317'}${path}`);await page.locator('h1').waitFor();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`No horizontal overflow at ${width} on ${path}`);
    }
  }
  assert.deepEqual(errors,[]);console.log('Visual QA: top alignment, 12 responsive route layouts and zero browser exceptions verified.');
}finally{await browser.close();}
