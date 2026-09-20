import { test, expect } from '@playwright/test';

test('source previews show a sheet, an email chain, and original PDFs and images', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/import');
  const sheet = page.getByRole('region', { name: 'Form response spreadsheet' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('columnheader', { name: 'Requested amount', exact: true })).toHaveCount(1);
  await expect(sheet.getByRole('cell', { name: '190.00', exact: true })).toHaveCount(1);
  await expect(sheet.getByRole('rowheader', { name: '2', exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('forms-spreadsheet.png'), fullPage: true });
  const tabs = page.getByRole('group', { name: 'Sample source' });
  await tabs.getByRole('button', { name: 'Gmail' }).click();
  const thread = page.getByRole('region', { name: 'Email conversation' });
  await expect(thread.getByRole('article')).toHaveCount(2);
  await expect(thread.getByRole('heading')).toContainText('Hotel reimbursement');
  await expect(thread.getByLabel('Referenced attachments')).toContainText('scan-017.pdf');
  await page.screenshot({ path: test.info().outputPath('gmail-thread.png'), fullPage: true });
  await page.getByRole('button', { name: 'Fwd-bus-receipt.eml Text export', exact: true }).click();
  await expect(thread.getByRole('article')).toHaveCount(2);
  await expect(thread).toContainText('Please reimburse USD 42.00');
  await tabs.getByRole('button', { name: 'Dropbox' }).click();
  await expect(page.getByLabel('PDF preview: scan-017.pdf', { exact: true })).toHaveAttribute('data', /name=scan-017.pdf/);
  await expect.poll(() => page.locator('object[type="application/pdf"]').evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThan(250);
  await page.waitForLoadState('networkidle');
  // The native PDF plugin paints after its separate viewer finishes loading.
  await page.waitForTimeout(1500);
  await page.screenshot({ path: test.info().outputPath('dropbox-pdf.png'), fullPage: true });
  await page.getByRole('button', { name: 'IMG_2048.png Image', exact: true }).click();
  await expect.poll(() => page.getByRole('img', { name: 'Original receipt IMG_2048.png', exact: true }).evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const name of ['Dropbox', 'Gmail', 'Google Forms']) {
    await tabs.getByRole('button', { name, exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await expect(sheet).toBeVisible();
  await sheet.evaluate(element => { element.scrollLeft = element.scrollWidth; });
  await expect(sheet.getByRole('cell', { name: '190.00', exact: true })).toBeInViewport();
  await page.screenshot({ path: test.info().outputPath('spreadsheet-mobile.png'), fullPage: true });
  expect(errors).toEqual([]);
});
