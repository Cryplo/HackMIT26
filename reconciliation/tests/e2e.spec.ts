import { expect, test } from '@playwright/test';

test('real intake saves evidence and the existing backend detects a duplicate upload', async ({ page, request, baseURL }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const sample = await request.get('/api/demo/receipt/train');
  expect(sample.status()).toBe(200);
  const pdf = await sample.body();

  for (const expected of ['approved', 'flagged']) {
    await page.goto('/submit');
    await page.getByLabel('Attendee name').fill('Alex Demo');
    await page.getByLabel('Email address').fill('upload@example.invalid');
    await page.getByLabel('Requested amount').fill('123.45');
    await page.getByLabel('Travel category').selectOption('train');
    await page.getByLabel('Traveling from').fill('New York');
    await page.getByLabel('Attach one synthetic receipt').setInputFiles({
      name: 'train.pdf', mimeType: 'application/pdf', buffer: pdf,
    });
    const saved = page.waitForResponse(response =>
      response.url().endsWith('/api/submissions') && response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Submit for review' }).click();
    const response = await saved;
    expect(response.status()).toBe(201);
    const { submission_id, receipt_id, extraction_status } = await response.json();
    expect(extraction_status).toBe('succeeded');
    await expect(page.getByRole('status')).toContainText('Claim saved');

    const original = await request.get(`/api/receipts/${receipt_id}`);
    expect(original.status()).toBe(200);
    expect(original.headers()['content-type']).toContain('application/pdf');
    expect(await original.body()).toEqual(pdf);

    // Preserve the existing financial regression while the separate platform
    // agent implements v2. The new reviewer UI never interprets v1 approval.
    const reconciled = await request.post('/api/reconcile', {
      headers: { Origin: new URL(baseURL!).origin },
      data: { submission_ids: [submission_id] },
    });
    expect(reconciled.status()).toBe(200);
    const reviews = await (await request.get('/api/reviews')).json();
    const row = reviews.submissions.find((item: { id: string }) => item.id === submission_id);
    expect(row.status).toBe(expected);
    expect(row.receipt.parsed_fields_json.amount_minor).toBe(12345);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
