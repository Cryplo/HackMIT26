import { expect, test } from '@playwright/test';
import { createPreviewClient } from '../../src/lib/dashboard/preview';

test('main search submits semantics without local text filtering or a separate ask panel', async ({ page }) => {
  const client = createPreviewClient();
  let searches = 0;
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const data = await client.getReviews();
    if (path === '/api/workspace/reviews') return route.fulfill({ json: data });
    if (path === '/api/search') {
      searches++;
      expect(route.request().postDataJSON().query).toBe('hotel claims over $200');
      return route.fulfill({ json: { snapshot_token: data.snapshot_token, evaluated_count: data.submissions.length, matches: data.submissions.slice(0, 1), possible_matches: [], mode: 'live', model: 'mock-jev', latency_ms: 1 } });
    }
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto('/business-demo');
  await expect(page.getByRole('button', { name: 'Ask about claims' })).toHaveCount(0);
  const search = page.getByRole('searchbox', { name: 'Semantic search' });
  await search.fill('hotel claims over $200');
  expect(searches).toBe(0);
  await search.press('Enter');
  await expect(page.getByText('Results for “hotel claims over $200”')).toBeVisible();
  expect(searches).toBe(1);
  await expect(page.getByRole('table', { name: 'Search matches' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Possible matches' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Clear semantic search', exact: true }).click();
  await expect(search).toHaveValue('');
  await expect(page.getByText('Results for “hotel claims over $200”')).toHaveCount(0);
});

test('audit stage and summary headers open accessible expanded details', async ({ page }) => {
  await page.goto('/overview?preview=1');
  const waiting = page.getByRole('button', { name: 'Expand Waiting', exact: true });
  await waiting.click();
  const dialog = page.getByRole('dialog', { name: 'Waiting', exact: true });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(waiting).toBeFocused();
  await page.getByRole('button', { name: 'Expand Needs review', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Needs review', exact: true });
  await expect(review).toBeVisible();
  await expect(review.getByText('Merchant', { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: '/tmp/sift-expanded-audit.png', animations: 'disabled' });
  await review.getByRole('button', { name: 'View claim', exact: true }).first().click();
  await expect(page.getByRole('dialog', { name: 'Maya Chen', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Expand Approved summary', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Approved', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Expand Investigation agents', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Investigation agents', exact: true })).toBeVisible();
});

test('expanded audit details fit a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/overview?preview=1');
  await page.getByRole('button', { name: 'Expand Needs review', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Needs review', exact: true });
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box!.width).toBeLessThanOrEqual(390);
  expect(box!.x).toBeGreaterThanOrEqual(0);
  await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeInViewport();
});
