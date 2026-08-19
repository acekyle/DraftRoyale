import { expect, test } from '@playwright/test';
import { EXPENSIVE_FIRST, draftFirstAvailable, enterSoloDraft, waitForMyPick } from './helpers';

/**
 * Draft legality UI: after two expensive picks (≥75.5M of the 100M cap) the
 * min-roster budget rule kicks in — remaining fighters priced above the leftover
 * budget must render as unaffordable, and AI-drafted fighters as taken.
 */
test('draft legality UI: unaffordable and taken card states', async ({ page }) => {
  await enterSoloDraft(page, 'Legality Bot');

  await waitForMyPick(page, 1);
  await draftFirstAvailable(page, EXPENSIVE_FIRST);
  await waitForMyPick(page, 2);
  await draftFirstAvailable(page, EXPENSIVE_FIRST);
  await waitForMyPick(page, 3);

  // The AI drafted twice between our picks — its fighters (and ours) show as taken.
  await expect(page.locator('.fighter-card.taken').first()).toBeVisible();

  // With ≤24.5M left and pick 3 pending, several fighters must be out of reach.
  const unaffordable = page.locator('.fighter-card.unaffordable');
  await expect(unaffordable.first()).toBeVisible();

  // The inspect drawer enforces the same rule on its draft button.
  await unaffordable.first().click();
  const pick = page.locator('#btn-pick');
  await expect(pick).toBeDisabled();
  await expect(pick).toContainText('Cannot afford');
});
