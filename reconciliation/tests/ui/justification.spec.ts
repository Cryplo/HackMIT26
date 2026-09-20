import { expect, test } from '@playwright/test';
import { fixtureCheck, fixtureReviews } from '../../src/lib/dashboard/fixtures';

test('recorded explanations preserve pending decisions and approval blocks', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const data = structuredClone(fixtureReviews);
  const summary = 'The recorded assessment is flagged.';
  const reason = 'The requested amount exceeds the receipt total.';
  const nextStep = 'Review the amount discrepancy before approving.';
  data.submissions[1].decisions.push({
    ...fixtureCheck(9001, 'overall_status', 'fail', 'Recorded assessment'),
    evidence_json: { justification: { summary, reasons: [reason, null, { invalid: true }], next_step: nextStep, model: 'unavailable-model', simulated: true, error: 'PROVIDER_TIMEOUT' } },
  });
  data.submissions[2].decisions.push({
    ...fixtureCheck(9002, 'overall_status', 'unknown', 'Recorded assessment'),
    evidence_json: { justification: { summary: 'Malformed narrative', reasons: 'not an array', next_step: nextStep } },
  });
  const mutations: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname.startsWith('/api/')) mutations.push(request.url());
  });
  await page.route('**/api/workspace/reviews', (route) => route.fulfill({ json: data }));
  await page.route('**/api/receipts/*', (route) => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><text x="10" y="30">Synthetic receipt</text></svg>' }));
  await page.goto('/business-demo');
  await page.getByRole('button', { name: "Open Jordan Lee's claim", exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Jordan Lee', exact: true });
  const explanation = review.getByRole('region', { name: 'Recorded explanation', exact: true });
  await expect(explanation).toBeVisible();
  await expect(explanation.getByText(summary, { exact: true })).toBeVisible();
  await expect(explanation.getByRole('listitem')).toHaveText([reason]);
  await expect(explanation.getByText(nextStep, { exact: true })).toBeVisible();
  await expect(explanation).toContainText('Deterministic summary · model unavailable (PROVIDER_TIMEOUT), outcome unchanged');
  await expect(review.getByText('Pending', { exact: true })).toBeVisible();
  await expect(review.getByText('Flagged', { exact: true })).toBeVisible();
  await expect(review.getByRole('button', { name: 'Approve', exact: true })).toBeDisabled();
  await expect(review.getByText('Amount must pass before approval.', { exact: true })).toBeVisible();
  await review.getByRole('button', { name: 'Close review', exact: true }).click();
  await expect(review).toBeHidden();

  for (const name of ['Maya Chen', 'Sam Example']) {
    await page.getByRole('button', { name: `Open ${name}'s claim`, exact: true }).click();
    const otherReview = page.getByRole('dialog', { name, exact: true });
    await expect(otherReview).toBeVisible();
    await expect(otherReview.getByRole('heading', { name: 'Recorded explanation', exact: true })).toHaveCount(0);
    await expect(otherReview.getByText('Pending', { exact: true })).toBeVisible();
    await expect(otherReview.getByRole('button', { name: 'Approve', exact: true })).toBeEnabled();
    await otherReview.getByRole('button', { name: 'Close review', exact: true }).click();
    await expect(otherReview).toBeHidden();
  }
  expect(mutations).toEqual([]);
});
