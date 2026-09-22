import { expect, test } from '@playwright/test';
import { fixtureReviews } from '../../src/lib/dashboard/fixtures';

test('preview reset reloads the local fixtures without a server reset', async ({ page }) => {
  let resets = 0;
  await page.route('**/api/**', route => { resets++; return route.abort(); });
  await page.goto('/overview?preview=1');
  const reset = page.getByRole('button', { name: 'Reset demo', exact: true });
  await expect(reset).toBeEnabled();
  await expect(reset).toHaveAttribute('title', 'Restore the original synthetic preview claims');
  await Promise.all([page.waitForEvent('load'), reset.click()]);
  await expect(reset).toBeEnabled();
  await expect(page).toHaveURL(/overview\?preview=1$/);
  expect(resets).toBe(0);
});

for (const demo of [true, false]) {
  test(`${demo ? 'simulated' : 'live'} reset preserves the snapshot and confirmation guard`, async ({ page }) => {
    const data = structuredClone(fixtureReviews);
    data.demo_mode = demo;
    data.capabilities!.demo_reset = true;
    let payload: unknown;
    await page.route('**/api/**', route => route.fulfill({ json: { mode: 'preview', messages: [] } }));
    await page.route('**/api/workspace/reviews', route => route.fulfill({ json: data }));
    await page.route('**/api/workspace/demo-reset', route => {
      payload = route.request().postDataJSON();
      return route.fulfill({ status: 409, json: { error: { message: 'Workspace changed. Refresh before resetting.' } } });
    });
    await page.goto('/overview');
    await page.getByRole('button', { name: 'Reset demo', exact: true }).click();
    if (!demo) {
      expect(payload).toBeUndefined();
      const dialog = page.getByRole('dialog', { name: 'Reset the live demo?' });
      await expect(dialog).toContainText('Restore the saved demo');
      await dialog.getByRole('button', { name: 'Archive and reset live demo', exact: true }).click();
    }
    await expect(page.getByRole('alert').filter({ hasText: 'Workspace changed. Refresh before resetting.' })).toBeVisible();
    expect(payload).toEqual({ snapshot_token: data.snapshot_token, ...(demo ? {} : { confirmation: 'reset-live-demo' }) });
  });
}

test('server reset stays visible but disabled without capability or during active work', async ({ page }) => {
  const data = structuredClone(fixtureReviews);
  await page.route('**/api/**', route => route.fulfill({ json: { mode: 'preview', messages: [] } }));
  await page.route('**/api/workspace/reviews', route => route.fulfill({ json: data }));
  await page.goto('/overview');
  await expect(page.getByRole('heading', { name: 'Follow the audit' })).toBeVisible();
  const reset = page.getByRole('button', { name: 'Reset demo', exact: true });
  await expect(reset).toBeVisible();
  await expect(reset).toBeDisabled();
  await expect(reset).toHaveAttribute('title', 'Demo reset is not enabled for this workspace.');
  data.capabilities!.demo_reset = true;
  data.submissions[0].processing_status = 'running';
  await page.reload();
  await expect(reset).toBeDisabled();
  await expect(reset).toHaveAttribute('title', 'Finish active work before resetting.');
});


test('reset stays visible when the source integration is enabled', async ({ page }) => {
  const data = structuredClone(fixtureReviews);
  data.capabilities!.demo_reset = true;
  await page.route('**/api/**', route => route.fulfill({ json: { mode: 'preview', messages: [] } }));
  await page.route('**/api/workspace/reviews', route => route.fulfill({ json: data }));
  let sourceReads = 0;
  await page.route('**/api/inbox/audit', route => {
    sourceReads++;
    return route.fulfill({ json: { enabled: true, phase: 'idle', total: 10, cursor: 0, current: null, documents: [], imports: [], held: [], duplicates: 0, error: '' } });
  });
  await page.goto('/overview');
  await expect.poll(() => sourceReads).toBeGreaterThan(0);
  await expect(page.getByRole('button', { name: 'Reset demo', exact: true })).toBeEnabled();
});
