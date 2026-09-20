import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 1440, height: 900 } });

test('compact queue exposes all six claims and blocks an overclaim', async ({ page }, testInfo) => {
  await page.goto('/business-demo?preview=1');
  await expect(page.getByRole('tab', { name: /^Needs review\s*4$/ })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: /^All\s*6$/ }).click();
  const rows = page.getByRole('region', { name: 'Reimbursement claims', exact: true }).locator('tbody > tr');
  await expect(rows).toHaveCount(6);
  const firstRow = await rows.first().boundingBox();
  expect(firstRow).not.toBeNull();
  expect(firstRow!.y).toBeLessThanOrEqual(300);
  for (const row of await rows.all()) await expect(row).toBeInViewport({ ratio: 1 });
  await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('desktop-queue.png') });

  const opener = page.getByRole('button', { name: "Open Jordan Lee's claim" });
  await opener.focus();
  await opener.press('Enter');
  const review = page.getByRole('dialog', { name: 'Jordan Lee', exact: true });
  await expect(review.getByText('Claim exceeds receipt by $12.00', { exact: true })).toBeVisible();
  await expect(review.getByRole('button', { name: 'Approve', exact: true })).toBeDisabled();
  await expect(review.getByText('Amount must pass before approval.', { exact: true })).toBeVisible();
  await expect(review.getByRole('img', { name: 'Original receipt for Jordan Lee' })).toBeVisible();
  await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('desktop-overclaim.png') });
  await page.keyboard.press('Escape');
  await expect(review).toBeHidden();
  await expect(opener).toBeFocused();
});

test('approval requires a reason and survives a selected-claim recheck', async ({ page }) => {
  await page.goto('/business-demo?preview=1');
  await page.getByRole('button', { name: "Open Maya Chen's claim" }).click();
  const review = page.getByRole('dialog', { name: 'Maya Chen', exact: true });
  await review.getByRole('button', { name: 'Approve', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'Approve reimbursement', exact: true });
  const confirm = confirmation.getByRole('button', { name: 'Confirm approval', exact: true });
  await expect(confirm).toBeDisabled();
  await confirmation.getByLabel('Decision reason').fill('   ');
  await expect(confirm).toBeDisabled();
  const reason = 'Verified the original rail receipt, traveler, and amount.';
  await confirmation.getByLabel('Decision reason').fill(reason);
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(confirmation).toBeHidden();
  await expect(review).toBeVisible();
  await expect(review.getByRole('button', { name: 'Approved', exact: true })).toBeDisabled();
  await review.getByRole('button', { name: 'Close review' }).click();

  await page.getByRole('tab', { name: /^Approved\s*2$/ }).click();
  const row = page.getByRole('region', { name: 'Reimbursement claims', exact: true }).getByRole('row').filter({ hasText: 'Maya Chen' });
  await row.getByRole('checkbox', { name: 'Select Maya Chen', exact: true }).check();
  await page.getByRole('button', { name: 'Recheck selected', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('1 claim rechecked. Human decisions were preserved.');
  await expect(row.getByText('Approved', { exact: true })).toBeVisible();
  await expect(row.getByText('Matched', { exact: true })).toBeVisible();
  await row.getByRole('button', { name: "Open Maya Chen's claim" }).click();
  await expect(review.getByText(reason, { exact: true })).toBeVisible();
});

test('a tested draft can be activated and rechecked without approving related claims', async ({ page }) => {
  await page.goto('/business-demo?preview=1');
  const navigation = page.getByRole('navigation', { name: 'Workspace', exact: true });
  await navigation.getByRole('button', { name: 'Learned rules', exact: true }).click();
  const rule = page.getByRole('article', { name: 'Harbor Reservations rule', exact: true });
  await expect(rule.getByRole('button', { name: 'Activate', exact: true })).toBeDisabled();
  await rule.getByRole('button', { name: 'Test rule', exact: true }).click();
  await expect(rule.getByText('Simulated test', { exact: true })).toBeVisible();
  await expect(rule.getByText('Passed', { exact: true })).toBeVisible();
  const correct = rule.getByRole('row').filter({ hasText: 'Correct outcomes' });
  await expect(correct.getByRole('cell').nth(1)).toHaveText('8');
  await expect(correct.getByRole('cell').nth(2)).toHaveText('10');
  await expect(rule.getByRole('button', { name: 'Activate', exact: true })).toBeEnabled();
  await rule.getByRole('button', { name: 'Activate', exact: true }).click();
  await expect(rule.getByText('active', { exact: true })).toBeVisible();
  await rule.getByRole('button', { name: 'Recheck related claims (2)', exact: true }).click();
  await expect(rule.getByRole('button', { name: 'Recheck related claims (0)', exact: true })).toBeDisabled();

  await navigation.getByRole('button', { name: 'Reimbursements', exact: true }).click();
  const queue = page.getByRole('region', { name: 'Reimbursement claims', exact: true });
  const sam = queue.getByRole('row').filter({ hasText: 'Sam Example' });
  await expect(sam.getByText('Matched', { exact: true })).toBeVisible();
  await expect(sam.getByText('Pending', { exact: true })).toBeVisible();
  const jordan = queue.getByRole('row').filter({ hasText: 'Jordan Lee' });
  await expect(jordan.getByText('Flagged', { exact: true })).toBeVisible();
  await expect(jordan.getByText('Pending', { exact: true })).toBeVisible();
});

test('mobile navigation and receipt tabs keep review actions within the viewport', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/business-demo?preview=1');
  await expect(page.getByRole('button', { name: "Open Maya Chen's claim" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('mobile-queue.png') });

  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  const menu = page.getByRole('dialog', { name: 'Workspace navigation', exact: true });
  await menu.getByRole('button', { name: 'Learned rules', exact: true }).click();
  await expect(menu).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Learned rules', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await menu.getByRole('button', { name: 'Reimbursements', exact: true }).click();
  await expect(menu).toBeHidden();

  await page.getByRole('button', { name: "Open Maya Chen's claim" }).click();
  const review = page.getByRole('dialog', { name: 'Maya Chen', exact: true });
  await review.getByRole('tab', { name: 'Document', exact: true }).click();
  await expect(review.getByRole('tab', { name: 'Document', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(review.getByRole('img', { name: 'Original receipt for Maya Chen' })).toBeVisible();
  await expect(review.getByRole('link', { name: 'Open original', exact: true })).toBeVisible();
  await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('mobile-document.png') });
  await review.getByRole('tab', { name: 'Details', exact: true }).click();
  await expect(review.getByRole('tab', { name: 'Details', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(review.getByRole('heading', { name: 'Claim and receipt', exact: true })).toBeVisible();
  for (const name of ['Recheck', 'Reject', 'Approve']) {
    await expect(review.getByRole('button', { name, exact: true })).toBeInViewport({ ratio: 1 });
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('mobile-details.png') });
  await review.getByRole('button', { name: 'Close review' }).click();
  await expect(review).toBeHidden();
});
