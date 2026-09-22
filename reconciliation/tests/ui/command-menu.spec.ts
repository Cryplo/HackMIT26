import { test, expect } from '@playwright/test';

test('command palette filters, handles empty results, and restores keyboard focus', async ({ page }) => {
  await page.goto('/overview?preview=1');
  const trigger = page.getByRole('button', { name: 'Jump to section', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Jump to section', exact: true });
  const input = dialog.getByRole('combobox', { name: 'Search sections' });
  await expect(input).toBeFocused();
  await expect(dialog.getByRole('option')).toHaveCount(7);
  await input.fill('nothingmatches');
  await expect(dialog.getByRole('status')).toContainText('No matching sections');
  await input.press('Enter');
  await expect(dialog).toBeVisible();
  await input.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('both shortcuts navigate sections including views on the same page', async ({ page }) => {
  await page.goto('/overview?preview=1');
  await page.keyboard.press('Meta+k');
  let input = page.getByRole('combobox', { name: 'Search sections' });
  await input.fill('reimbursements');
  await input.press('Enter');
  await expect(page).toHaveURL(/view=reviews&preview=1/);
  await page.keyboard.press('Control+k');
  input = page.getByRole('combobox', { name: 'Search sections' });
  await input.fill('checks');
  await input.press('ArrowDown');
  await input.press('ArrowUp');
  await input.press('Enter');
  await expect(page).toHaveURL(/view=checks&preview=1/);
  await expect(page.getByRole('button', { name: 'Checks', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.keyboard.press('Meta+k');
  await page.getByRole('combobox', { name: 'Search sections' }).fill('learned');
  await page.getByRole('option', { name: /Learned rules/ }).click();
  await expect(page).toHaveURL(/view=rules&preview=1/);
  await expect(page.getByRole('button', { name: 'Learned rules', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.keyboard.press('Meta+k');
  await page.getByRole('combobox', { name: 'Search sections' }).fill('submit');
  await page.getByRole('option', { name: /Submit a claim/ }).click();
  await expect(page).toHaveURL(/\/submit$/);
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('dialog', { name: 'Jump to section' })).toBeVisible();
});

test('palette fits mobile and can be opened from the navigation drawer', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/overview?preview=1');
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Jump to section' }).click();
  const dialog = page.getByRole('dialog', { name: 'Jump to section', exact: true });
  await expect(dialog.getByRole('combobox')).toBeFocused();
  const box = await dialog.boundingBox();
  expect(box!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: '/tmp/sift-command-menu-mobile.png', animations: 'disabled' });
});
