import { expect, test } from '@playwright/test';

test('real API workflow: policy checks, scoped correction, sample upload and duplicate', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/business-demo');
  await expect(page.getByText('SIMULATED API DEMO · SYNTHETIC DATA ONLY')).toBeVisible();
  const select = page.getByRole('checkbox');
  await expect(select).toHaveCount(5);
  for (const box of await select.all()) await box.check();
  await page.getByRole('button', { name: /Reconcile selected/ }).click();
  const row = (name: string) => page.getByRole('row').filter({ hasText: name });
  await expect(row('Sam Example')).toContainText(/Needs review/i);
  await expect(row('Alex Demo').first()).toContainText(/Approved/i);
  await expect(row('Alex Demo').nth(1)).toContainText(/Flagged/i);
  await row('Sam Example').getByRole('button', { name: /Evidence/ }).click();
  await page.getByRole('button', { name: 'Correct & teach' }).click();
  await page.getByLabel('Correction type').selectOption('vendor_alias');
  await page.getByLabel('Canonical merchant').fill('Synthetic Harbor Hotel');
  await page.getByLabel('Review note').fill('Confirmed synthetic hotel billing descriptor. Applies to hotel / USD only.');
  await page.getByRole('button', { name: 'Save correction' }).click();
  await expect(row('Sam Example')).toContainText(/Approved/i);
  await page.getByRole('checkbox', { name: 'Select Taylor Example' }).check();
  await page.getByRole('checkbox', { name: 'Select Jordan Example' }).check();
  await page.getByRole('button', { name: /Reconcile selected/ }).click();
  await expect(row('Taylor Example')).toContainText(/Approved/i);
  await expect(row('Jordan Example')).toContainText(/Needs review/i);
  await page.reload();
  await expect(row('Taylor Example')).toContainText(/Approved/i);
  const reviews = await (await request.get('/api/reviews')).json();
  expect(reviews.summary.approved_amount_minor).toBe(61500);
  expect(reviews.summary.flag_rate).toBe(.4);
  for (const claim of reviews.submissions) {
    const receipt = await request.get(`/api/receipts/${claim.receipt.id}`);
    expect(receipt.status()).toBe(200);
    expect(receipt.headers()['content-type']).toBe('application/pdf');
  }
  await page.screenshot({ path: '/tmp/reconciliation-dashboard.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/reconciliation-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });

  const sample = await request.get('/api/demo/receipt/train');
  const pdf = await sample.body();
  for (const expected of ['Approved', 'Flagged']) {
    await page.goto('/submit');
    await page.getByLabel('Attendee name').fill('Alex Demo');
    await page.getByLabel('Email address').fill('upload@example.invalid');
    await page.getByLabel('Requested amount').fill('123.45');
    await page.getByLabel('Travel category').selectOption('train');
    await page.getByLabel('Traveling from').fill('New York');
    await page.getByLabel('Attach one synthetic receipt').setInputFiles({ name: 'train.pdf', mimeType: 'application/pdf', buffer: pdf });
    const saved = page.waitForResponse(r => r.url().endsWith('/api/submissions') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Submit for review' }).click();
    const response = await saved;
    expect(response.status()).toBe(201);
    const { submission_id } = await response.json();
    await expect(page.getByRole('status')).toContainText('Claim saved');
    await page.getByRole('link', { name: /Open organizer dashboard/ }).click();
    const uploaded = page.getByRole('row').filter({ hasText: 'upload@example.invalid' }).last();
    await expect(uploaded).toContainText('Synthetic Rail');
    await uploaded.getByRole('checkbox').check();
    await page.getByRole('button', { name: /Reconcile selected/ }).click();
    await expect(uploaded).toContainText(new RegExp(expected, 'i'));
    const persisted = await (await request.get('/api/reviews')).json();
    expect(persisted.submissions.find((s: {id:string}) => s.id === submission_id).status).toBe(expected.toLowerCase());
  }
  expect(errors).toEqual([]);
});
