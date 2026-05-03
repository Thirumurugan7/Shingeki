import { test, expect } from '@playwright/test';

const hasRouter = !!process.env.ROUTER_API_KEY?.trim();
/** Full browser+Router test can take several minutes; run only with PLAYWRIGHT_LIVE=1 (see package.json). */
const live = process.env.PLAYWRIGHT_LIVE === '1';
const stepPollMs = 2_500;
const fullRunTimeout = Number(process.env.PLAYWRIGHT_LIVE_TIMEOUT_MS ?? 300_000);

test.describe('Shingeki hub viewer', () => {
  test('smoke: loads, tabs switch, follow-up panel present', async ({ page }) => {
    await page.goto('/viewer');
    await expect(page.getByRole('tab', { name: 'Genome lineage' })).toHaveClass(/active/);
    await expect(page.getByRole('tab', { name: 'Run task' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Task results' })).toBeVisible();

    await page.getByRole('tab', { name: 'Run task' }).click();
    await expect(page.locator('#run-form')).toBeVisible();
    await expect(page.locator('#run-task-text')).toBeVisible();

    await page.getByRole('tab', { name: 'Task results' }).click();
    await expect(page.locator('#task-select')).toBeVisible();
    // Form is always in the page; visibility depends on whether a checkpoint is loaded.
    await expect(page.locator('#followup-form')).toBeAttached();
  });

  test('e2e: start run from UI, then follow-up (live Router)', async ({ page }) => {
    test.skip(!live, 'Set PLAYWRIGHT_LIVE=1 to run the long live test (or use npm run test:e2e:live).');
    test.skip(!hasRouter, 'Set ROUTER_API_KEY in .env (repo root or shingeki) for this test.');

    const taskLine = 'Reply with exactly the word PONG and nothing else.';
    const followLine = 'Reply with exactly the word PONG2 and nothing else.';

    await page.goto('/viewer');

    await page.getByRole('tab', { name: 'Run task' }).click();
    await page.locator('#run-task-text').fill(taskLine);
    await page.locator('#run-submit').click();

    // Success switches to Task results; #run-feedback stays in the hidden Run panel but is updated.
    await expect(page.locator('#run-feedback')).toContainText(/task id|Run started/i, { timeout: 30_000 });

    await page.getByRole('tab', { name: 'Task results' }).click();
    const followup = page.locator('#task-followup');
    await expect(followup).toBeVisible({ timeout: fullRunTimeout });
    await expect(page.locator('#task-body')).toContainText('Final summary', { timeout: fullRunTimeout });

    await page.locator('#followup-text').fill(followLine);
    await page.locator('#followup-submit').click();
    await expect(page.locator('#followup-feedback')).toContainText(/Follow-up started/i, { timeout: 30_000 });

    const started = Date.now();
    let sawPong2 = false;
    while (Date.now() - started < fullRunTimeout) {
      const body = await page.locator('#task-body').innerText();
      if (body.includes('PONG2')) {
        sawPong2 = true;
        break;
      }
      await page.waitForTimeout(stepPollMs);
    }
    expect(sawPong2, 'task results should show PONG2 after follow-up run completes').toBe(true);
  });
});
