import { expect, test } from '@playwright/test';
import {
  BASE_URL, draftThreeAndBattleToBreakdown, enterSoloDraft, guestStatePath,
} from './helpers';

const PLAYER = 'QA Tester';

test.describe.serial('solo gauntlet', () => {
  test('full solo loop: draft → prep → wildcard → battle → breakdown → runback', async ({ page, browserName }) => {
    await enterSoloDraft(page, PLAYER);
    await draftThreeAndBattleToBreakdown(page);

    // Verdict names a winner (either side may win — sims are seeded random).
    await expect(page.locator('.verdict h1')).not.toBeEmpty();

    // Causal breakdown: at least one factor explains why the winner won.
    expect(await page.locator('.factor').count()).toBeGreaterThanOrEqual(1);

    // Fighter performance table: header + at least 6 fighters (3v3 minimum).
    expect(await page.locator('.stats-table tr').count()).toBeGreaterThanOrEqual(7);

    // A champion is crowned after the first match, whoever won.
    await expect(page.locator('.champion-banner')).toBeVisible();

    // Guest-local persistence recorded exactly one match.
    const historyLen = await page.evaluate(
      () => JSON.parse(localStorage.getItem('ia_history') ?? '[]').length,
    );
    expect(historyLen).toBe(1);

    // Hand the storage to the persistence spec below.
    await page.context().storageState({ path: guestStatePath(browserName) });

    // Run it back → straight to a fresh arena reveal.
    await page.locator('#btn-runback').click();
    await expect(page.locator('.disclosure-list li').first()).toBeVisible();
    await expect(page.locator('#btn-draft')).toBeVisible();
  });

  test('guest persistence: name prefilled and history shown after reload', async ({ browser, browserName }) => {
    const context = await browser.newContext({
      storageState: guestStatePath(browserName),
      baseURL: BASE_URL,
    });
    const page = await context.newPage();
    await page.goto('/');

    await expect(page.locator('#p1name')).toHaveValue(PLAYER);
    await expect(
      page.locator('.pick-log div').filter({ hasText: 'won by' }).first(),
    ).toBeVisible();

    await context.close();
  });
});
