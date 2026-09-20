import { expect, test } from '@playwright/test';
import { createPreviewClient } from '../../src/lib/dashboard/preview';
import { fixtureId } from '../../src/lib/dashboard/fixtures';
import type { DecisionRequest } from '../../src/lib/review-contracts';

test('internal review reasons stay separate from applicant notices', async ({ page }) => {
  const client = createPreviewClient();
  const requests: DecisionRequest[] = [];
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/workspace/reviews') {
      const data = await client.getReviews();
      Object.assign(data.capabilities!, { supporting_documents: false, investigations: false, resolution_procedures: false });
      return route.fulfill({ json: data });
    }
    if (url.pathname === '/api/workspace/decisions') {
      const input = route.request().postDataJSON() as DecisionRequest;
      requests.push(input);
      return route.fulfill({ json: await client.decide(input) });
    }
    const messages = url.pathname.match(/^\/api\/submissions\/([^/]+)\/messages$/);
    if (messages) return route.fulfill({ json: await client.getMessages!(messages[1]) });
    return route.fulfill({ status: 404, json: { error: { code: 'TEST_FIXTURE', message: 'No fixture for this resource.' } } });
  });
  await page.goto(`/business-demo?claim=${fixtureId(3)}`);
  await page.getByRole('button', { name: 'Reject & notify', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Reject reimbursement', exact: true });
  await dialog.getByLabel('Internal review reason').fill('PRIVATE finance discussion: supporting evidence remains uncertain.');
  await expect(dialog.getByLabel('Message to the applicant')).toBeHidden();
  await dialog.getByText('Applicant message (optional)', { exact: true }).click();
  await expect(dialog.getByLabel('Message to the applicant')).not.toHaveValue(/PRIVATE/);
  await dialog.getByLabel('Message to the applicant').fill('Please provide the original booking confirmation.');
  await dialog.getByRole('button', { name: 'Reject & notify', exact: true }).click();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0].human_note).toContain('PRIVATE');
  expect(requests[0].applicant_reason).toBe('Please provide the original booking confirmation.');
  const notices = await client.getMessages!(fixtureId(3));
  expect(JSON.stringify(notices)).not.toContain('PRIVATE');
  expect((await client.getReviews()).submissions.find(row => row.id === fixtureId(3))?.learning?.status).toBe('not_applicable');
  await page.goto(`/business-demo?claim=${fixtureId(1)}`);
  await page.getByRole('button', { name: 'Approve & notify', exact: true }).click();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1].applicant_reason).toBeUndefined();
});

test('failed learning retries with the current revision and refreshes without blocking review', async ({ page }) => {
  const client = createPreviewClient();
  const data = await client.getReviews();
  Object.assign(data.capabilities!, { supporting_documents: false, investigations: false, resolution_procedures: false });
  const row = data.submissions[2];
  row.learning = { status: 'failed', summary: 'The learning check was interrupted.', updated_at: new Date().toISOString() };
  let retries = 0;
  await page.route(`**/api/submissions/${row.id}/feedback-learning/retry`, route => {
    retries++;
    expect(route.request().postDataJSON()).toEqual({ expected_review_revision: row.review_revision });
    row.learning = { status: 'queued', summary: 'Checking the saved evidence.', updated_at: new Date().toISOString() };
    return route.fulfill({ json: { row } });
  });
  await page.route('**/api/workspace/reviews', route => route.fulfill({ json: data }));
  await page.route('**/api/submissions/*/messages', route => route.fulfill({ json: { messages: [] } }));
  await page.goto(`/business-demo?claim=${row.id}`);
  await expect(page.getByRole('button', { name: 'Retry learning', exact: true })).toBeHidden();
  await page.getByText('Learning could not finish', { exact: true }).click();
  await page.getByRole('button', { name: 'Retry learning', exact: true }).click();
  await expect(page.getByText('Checking what can be learned', { exact: true })).toBeVisible();
  expect(retries).toBe(1);
  await expect(page.getByRole('button', { name: 'Reject & notify', exact: true })).toBeEnabled();
  row.learning = { status: 'testing', summary: 'Running the saved check safety tests.', updated_at: new Date().toISOString() };
  await expect(page.getByText('Testing saved check', { exact: true })).toBeVisible({ timeout: 8000 });
  row.learning = { status: 'active', summary: 'Supported check saved.', updated_at: new Date().toISOString() };
  await expect(page.getByText('Saved for similar claims', { exact: true })).toBeVisible({ timeout: 8000 });
});
