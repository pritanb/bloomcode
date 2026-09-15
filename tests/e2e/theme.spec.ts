import { test, expect, capture } from './helpers';

test('system dark preference updates readable study surfaces', async ({ page, api }, info) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Settings & data' })).toBeVisible();
  await api.read('/settings');
  const light = await page.locator('.panel').first().evaluate(el=>getComputedStyle(el).backgroundColor);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveCSS('color-scheme','dark');
  expect(await page.locator('.panel').first().evaluate(el=>getComputedStyle(el).backgroundColor)).not.toBe(light);
  for (const selector of ['h1','.panel h2','input']) {
    const ratio = await page.locator(selector).first().evaluate(el=>{
      const rgb=(s:string)=>s.match(/[\d.]+/g)!.slice(0,3).map(Number);
      const luminance=(c:number[])=>c.map(x=>x/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((sum,x,i)=>sum+x*[.2126,.7152,.0722][i],0);
      let ancestor:Element|null=el;let bg='rgba(0, 0, 0, 0)';
      while(ancestor){bg=getComputedStyle(ancestor).backgroundColor;if(bg!=='rgba(0, 0, 0, 0)')break;ancestor=ancestor.parentElement;}
      const foreground=luminance(rgb(getComputedStyle(el).color)),background=luminance(rgb(bg));
      return (Math.max(foreground,background)+.05)/(Math.min(foreground,background)+.05);
    });
    expect(ratio, `${selector} dark contrast`).toBeGreaterThanOrEqual(4.5);
  }
  await capture(page, info, 'dark-settings');
  const problem = await api.send<{id:string}>('/problems',{url:'https://leetcode.com/problems/two-sum/',title:'Theme check'});
  const attempt = await api.send<{id:string}>('/attempts',{problemId:problem.id,context:'targeted'});
  await page.goto(`/attempts/${attempt.id}`);
  await expect(page.locator('.cm-editor')).toBeVisible();
  const darkEditor = await page.locator('.cm-editor').evaluate(el=>getComputedStyle(el).backgroundColor);
  await capture(page, info, 'dark-editor');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect.poll(()=>page.locator('.cm-editor').evaluate(el=>getComputedStyle(el).backgroundColor)).not.toBe(darkEditor);
  await expect(page.locator('html')).toHaveCSS('color-scheme','light');
});
