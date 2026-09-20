import { expect, test } from '@playwright/test';
import { fixtureReviews } from '../../src/lib/dashboard/fixtures';

test('motion follows real pending work and reduced motion preserves review focus', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    const motion = { dialogs: [] as string[], unavailableDuringClose: false };
    Object.assign(window, { reviewMotion: motion });
    document.addEventListener('animationstart', (event) => {
      if (event.target instanceof HTMLElement && event.target.getAttribute('role') === 'dialog') motion.dialogs.push(event.animationName);
    });
  });
  await page.route('**/api/workspace/reviews', (route) => route.fulfill({ json: fixtureReviews }));
  await page.route('**/api/receipts/*', (route) => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><text x="10" y="30">Synthetic receipt</text></svg>' }));

  for (const reducedMotion of ['no-preference', 'reduce'] as const) {
    await page.emulateMedia({ reducedMotion });
    let release!: () => void;
    const responseReady = new Promise<void>((resolve) => { release = resolve; });
    await page.route('**/api/workspace/reconcile', async (route) => {
      await responseReady;
      const row = fixtureReviews.submissions[0];
      await route.fulfill({ json: { results: [{ submission_id: row.id, run_id: row.latest_run_id, assessment_status: row.assessment_status, decision_status: row.decision_status, review_revision: row.review_revision }] } });
    });
    await page.goto('/business-demo');
    const opener = page.getByRole('button', { name: "Open Maya Chen's claim", exact: true });
    await opener.focus();
    await opener.press('Enter');
    const review = page.getByRole('dialog', { name: 'Maya Chen', exact: true });
    await expect(review).toBeVisible();
    const duration = await review.evaluate((element) => parseFloat(getComputedStyle(element).animationDuration));
    if (reducedMotion === 'no-preference') {
      expect(duration).toBeGreaterThan(0.1);
      expect(duration).toBeLessThanOrEqual(0.3);
      await expect.poll(() => page.evaluate(() => (window as unknown as { reviewMotion: { dialogs: string[] } }).reviewMotion.dialogs.length)).toBeGreaterThan(0);
    } else {
      expect(duration).toBeLessThanOrEqual(0.00001);
      const underlineDuration = await review.getByRole('tab', { name: 'Details', includeHidden: true }).evaluate((element) => parseFloat(getComputedStyle(element, '::after').transitionDuration));
      expect(underlineDuration).toBeLessThanOrEqual(0.00001);
    }

    await review.getByRole('button', { name: 'Recheck', exact: true }).click();
    const pending = review.getByRole('button', { name: 'Rechecking…', exact: true });
    try {
      await expect(pending).toBeDisabled();
      await expect(pending).toHaveAttribute('aria-busy', 'true');
      const spinning = await pending.locator('svg').evaluate((element) => element.getAnimations().some((animation) => animation.effect?.getTiming().iterations === Infinity));
      expect(spinning).toBe(reducedMotion === 'no-preference');
    } finally { release(); }
    await expect(review.getByRole('button', { name: 'Recheck', exact: true })).toBeEnabled();

    const approve = review.getByRole('button', { name: 'Approve', exact: true });
    await approve.click();
    const confirmation = page.getByRole('dialog', { name: 'Approve reimbursement', exact: true });
    await expect(confirmation).toBeVisible();
    const confirmationDuration = await confirmation.evaluate((element) => parseFloat(getComputedStyle(element).animationDuration));
    expect(confirmationDuration).toBeLessThanOrEqual(reducedMotion === 'reduce' ? 0.00001 : 0.22);
    if (reducedMotion === 'no-preference') expect(confirmationDuration).toBeGreaterThan(0.1);
    await confirmation.getByLabel('Decision reason').fill('Verified the original receipt.');
    await page.keyboard.press('Escape');
    await expect(confirmation).toBeHidden();
    await expect(approve).toBeFocused();

    await review.evaluate((element) => {
      const motion = (window as unknown as { reviewMotion: { unavailableDuringClose: boolean } }).reviewMotion;
      new MutationObserver(() => { if (element.textContent?.includes('Claim unavailable')) motion.unavailableDuringClose = true; }).observe(element, { childList: true, subtree: true, characterData: true });
    });
    await page.keyboard.press('Escape');
    await expect(review).toBeHidden();
    await expect(opener).toBeFocused();
    expect(await page.evaluate(() => (window as unknown as { reviewMotion: { unavailableDuringClose: boolean } }).reviewMotion.unavailableDuringClose)).toBe(false);

    await page.getByRole('button', { name: "Open Jordan Lee's claim", exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Jordan Lee', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Maya Chen', exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.unroute('**/api/workspace/reconcile');
  }
});
