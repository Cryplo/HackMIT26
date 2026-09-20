import { test, expect } from '@playwright/test';
import { textPdf } from '../../src/lib/demo/samples';
import type { InboxDocument } from '../../src/lib/inbox/schema';

// Explicit paid opt-in. Run only against scripts/inbox-demo.ts --live-extraction.
test('live mixed originals become grounded cases', async ({ page, request }) => {
  test.skip(process.env.INBOX_LIVE_SMOKE !== '1', 'Paid live extraction requires INBOX_LIVE_SMOKE=1');
  test.setTimeout(180000);
  const readings: Promise<InboxDocument>[] = [];
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {
    if (response.url().endsWith('/api/inbox') && response.request().method() === 'POST') readings.push(response.json());
  });
  await page.goto('/import');
  await expect(page.getByText('Live AI reading · simulated review sandbox')).toBeVisible();
  const start = Date.now();
  await page.getByRole('button', { name: 'Try sample paperwork' }).click();
  await expect(page.getByRole('status').first()).toContainText('9 unique documents', { timeout: 120000 });
  await expect(page.getByRole('status').first()).toContainText('1 repeated copy counted once');
  const documents = await Promise.all(readings);
  console.log('Live sample batch', JSON.stringify({ elapsed_ms: Date.now() - start, documents: documents.map(d => ({ filename: d.filename, provenance: d.provenance, latency_ms: d.latency_ms, kind: d.evidence?.document_kind, error: d.error })) }));
  expect(documents).toHaveLength(9);
  for (const doc of documents) { expect(doc.error).toBeNull(); expect(doc.provenance).not.toMatch(/simulated/i); }
  const ava = page.getByRole('article', { name: 'Case for Ava Demo: scan-017.pdf', exact: true });
  const maya = page.getByRole('article', { name: 'Case for Maya Demo: IMG_2048.png', exact: true });
  await expect(ava.getByText('Amount differs', { exact: true })).toBeVisible();
  await expect(maya.getByText('Ready to confirm', { exact: true })).toBeVisible();
  const ambiguous = page.getByRole('article').filter({ has: page.getByRole('link', { name: 'Re-train-tickets.pdf', exact: true }) }).first();
  await expect(ambiguous.getByLabel('Attach to receipt')).toHaveValue('');
  await ava.locator('summary').first().click();
  await expect(ava.getByText('$190.00', { exact: true })).toBeVisible();
  await expect(ava.getByText('$180.00', { exact: true })).toBeVisible();
  await ava.getByRole('checkbox').check();
  const saved = page.waitForResponse(r => r.url().endsWith('/api/inbox/confirm'));
  await ava.getByRole('button', { name: 'Confirm & send for review' }).click();
  const save = await saved; expect(save.status()).toBe(201);
  const result = await save.json();
  await expect.poll(async () => {
    const data = await (await request.get('/api/workspace/reviews')).json();
    return data.submissions.find((s: { id: string }) => s.id === result.submission_id)?.assessment_status;
  }, { timeout: 20000 }).toBe('flagged');
  await maya.locator('summary').first().click();
  await expect.poll(() => maya.getByRole('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  await maya.getByRole('checkbox').check();
  const cleanSaved = page.waitForResponse(r => r.url().endsWith('/api/inbox/confirm'));
  await maya.getByRole('button', { name: 'Confirm & send for review' }).click();
  expect((await cleanSaved).status()).toBe(201);

  await page.screenshot({ path: test.info().outputPath('live-mixed-results.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('unseen live documents preserve discrepancy', async ({ page }) => {
  test.skip(process.env.INBOX_LIVE_SMOKE !== '1', 'Paid live extraction requires INBOX_LIVE_SMOKE=1');
  test.setTimeout(60000);
  const readings: Promise<InboxDocument>[] = [];
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {
    if (response.url().endsWith('/api/inbox') && response.request().method() === 'POST') readings.push(response.json());
  });
  await page.goto('/import');
  await expect(page.getByText('Live AI reading · simulated review sandbox')).toBeVisible();
  await page.getByLabel('Upload receipts, bookings, or email PDFs').setInputFiles([
    { name: 'random-scan-731.pdf', mimeType: 'application/pdf', buffer: textPdf(['SYNTHETIC DEMO RECEIPT - FICTIONAL', 'Juniper Rail', 'Traveler: Nora Trial', 'Date: 2026-09-19', 'Receipt: JNR-731; booking: NORA-731', 'Train from Portland. Total paid: USD 55.00']) },
    { name: 'forwarded-note.pdf', mimeType: 'application/pdf', buffer: textPdf(['SYNTHETIC DEMO EMAIL - FICTIONAL', 'From: Nora Trial <nora@example.invalid>', 'To: event organizer', 'Subject: Reimbursement for Juniper Rail booking NORA-731', 'Please reimburse USD 57.00 for my train from Portland.', 'Travel date: 2026-09-19. Receipt JNR-731 attached.', 'Thanks, Nora Trial']) },
  ]);
  const nora = page.getByRole('article', { name: 'Case for Nora Trial: random-scan-731.pdf', exact: true });
  await expect(nora.getByText('Amount differs', { exact: true })).toBeVisible({ timeout: 60000 });
  await nora.locator('summary').first().click();
  await expect(nora.getByText('$57.00', { exact: true })).toBeVisible();
  await expect(nora.getByText('$55.00', { exact: true })).toBeVisible();
  const all = await Promise.all(readings);
  expect(all).toHaveLength(2);
  for (const doc of all) expect(doc.error).toBeNull();
  console.log('Unseen live documents', JSON.stringify(all.map(d => ({ filename: d.filename, provenance: d.provenance, latency_ms: d.latency_ms, kind: d.evidence?.document_kind }))));
  await page.screenshot({ path: test.info().outputPath('live-unseen-evidence.png'), fullPage: true });
  expect(errors).toEqual([]);
});
