import { test, expect } from '@playwright/test';
test('stored claim search exposes real ledger, matches and uncertain results',async({page})=>{
 await page.goto('/search');
 await expect(page.getByRole('heading',{name:'Stored claims'})).toBeVisible();
 const response=await page.request.get('/api/claim-search');const snapshot=await response.json();
 await page.route('**/api/claim-search',async route=>{
  if(route.request().method()!=='POST')return route.continue();
  const input=route.request().postDataJSON();expect(input.query).toBe('hotel claims');
  await route.fulfill({json:{snapshot_token:snapshot.snapshot_token,evaluated_count:snapshot.rows.length,matches:[snapshot.rows[0]],possible_matches:[snapshot.rows[1]],judgments:[],mode:'live',model:'test-model',latency_ms:250}});
 });
 await page.getByLabel('What are you looking for?').fill('hotel claims');
 await page.getByRole('button',{name:'Search claims'}).click();
 await expect(page.getByRole('heading',{name:'Matches 1',exact:true})).toBeVisible();
 await expect(page.getByRole('heading',{name:'Possible matches — review evidence 1'})).toBeVisible();
 await page.setViewportSize({width:390,height:844});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();
});
test('offline search returns an explicit error without fabricated results',async({page})=>{
 await page.goto('/search');await expect(page.getByRole('heading',{name:'Stored claims'})).toBeVisible();
 await page.getByLabel('What are you looking for?').fill('hotels');await page.getByRole('button',{name:'Search claims'}).click();
 await expect(page.getByRole('alert').filter({hasText:'requires live Jev'})).toContainText('requires live Jev');
 await expect(page.getByRole('heading',{name:'Matches',exact:true})).toHaveCount(0);
});
