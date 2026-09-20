import {test,expect} from '@playwright/test';
test('business page loads stored claims and displays integrated search matches',async({page})=>{
 await page.goto('/business-demo');await expect(page.getByRole('button',{name:/Alex Demo/}).first()).toBeVisible();
 const response=await page.request.get('/api/workspace/reviews');const snapshot=await response.json();
 await page.route('**/api/search',async route=>{
 const input=route.request().postDataJSON();expect(input.query).toBe('hotel claims');
 await route.fulfill({json:{snapshot_token:snapshot.snapshot_token,evaluated_count:snapshot.submissions.length,matches:[snapshot.submissions[2]],possible_matches:[snapshot.submissions[3]],mode:'live',model:'test-model',latency_ms:250}});
 });
 await page.getByRole('searchbox', { name: 'Semantic search' }).fill('hotel claims');await page.getByRole('button',{name:'Search',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Matches 1',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'Possible matches 1'})).toBeVisible();
 await expect(page.getByRole('link',{name:'Search stored claims'})).toHaveCount(0);
});
test('old extra pages redirect to the business workspace',async({page})=>{
 for(const path of ['/search','/demo']){await page.goto(path);await expect(page).toHaveURL(/\/business-demo$/)}
});

test('semantic search preserves scope and only submits explicitly', async ({ page }) => {
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
 const search = page.getByRole('searchbox', { name: 'Semantic search' });
 await search.fill('Hotel claims');
 expect(searches).toBe(0);
 await search.press('Enter');
 await expect(page.getByText('Results for “Hotel claims”')).toBeVisible();
 expect(searches).toBe(1);
 await expect(search).toHaveValue('Hotel claims');
 await page.getByRole('button', { name: 'Clear semantic search', exact: true }).click();
 await expect(search).toHaveValue('');
 await expect(search).toBeFocused();
 await expect(page.getByText('Results for “Hotel claims”')).toHaveCount(0);
});
