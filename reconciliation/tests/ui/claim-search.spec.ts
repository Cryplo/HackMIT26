import {test,expect} from '@playwright/test';
test('business page loads stored claims and displays integrated search matches',async({page})=>{
 await page.goto('/business-demo');await expect(page.getByRole('button',{name:/Alex Demo/}).first()).toBeVisible();
 const response=await page.request.get('/api/workspace/reviews');const snapshot=await response.json();
 await page.route('**/api/search',async route=>{
 const input=route.request().postDataJSON();expect(input.query).toBe('hotel claims');
 await route.fulfill({json:{snapshot_token:snapshot.snapshot_token,evaluated_count:snapshot.submissions.length,matches:[snapshot.submissions[2]],possible_matches:[snapshot.submissions[3]],mode:'live',model:'test-model',latency_ms:250}});
 });
 await page.getByRole('button',{name:'Ask about claims',exact:true}).click();
 await page.getByLabel('What are you looking for?').fill('hotel claims');await page.getByRole('button',{name:'Search claims',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Matches 1',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'Possible matches 1'})).toBeVisible();
 await expect(page.getByRole('link',{name:'Search stored claims'})).toHaveCount(0);
});
test('old extra pages redirect to the business workspace',async({page})=>{
 for(const path of ['/search','/demo']){await page.goto(path);await expect(page).toHaveURL(/\/business-demo$/)}
});

test('text filtering and example questions only search on explicit question submission', async ({ page }) => {
 let searches = 0;
 await page.route('**/api/search', async route => {
  searches++;
  const input = route.request().postDataJSON();
  expect(input.query).toBe('Hotel claims');
  expect(input.filters).toEqual({ decision_status: 'pending' });
  expect(input.snapshot_token).toBeTruthy();
  await route.fulfill({ json: { snapshot_token: input.snapshot_token, evaluated_count: 0, matches: [], possible_matches: [], mode: 'live', model: 'test-model', latency_ms: 1 } });
 });
 await page.goto('/business-demo');
 await expect(page.getByRole('button', { name: /Alex Demo/ }).first()).toBeVisible();
 const textSearch = page.getByRole('searchbox', { name: 'Search names or merchants' });
 await textSearch.fill('Alex');
 await textSearch.press('Enter');
 expect(searches).toBe(0);
 const toggle = page.getByRole('button', { name: 'Ask about claims', exact: true });
 await toggle.click();
 await expect(toggle).toHaveAttribute('aria-expanded', 'true');
 await page.getByRole('button', { name: 'Hotel claims', exact: true }).click();
 const question = page.getByLabel('What are you looking for?');
 await expect(question).toHaveValue('Hotel claims');
 await expect(page.getByRole('button', { name: /Alex Demo/ }).first()).toBeVisible();
 expect(searches).toBe(0);
 await question.press('Enter');
 await expect(page.getByText('Results for “Hotel claims”')).toBeVisible();
 expect(searches).toBe(1);
 await expect(textSearch).toHaveValue('');
 await page.getByRole('button', { name: 'Close claim search' }).click();
 await expect(toggle).toHaveAttribute('aria-expanded', 'false');
 await expect(toggle).toBeFocused();
 await expect(page.getByText('Results for “Hotel claims”')).toHaveCount(0);
});
