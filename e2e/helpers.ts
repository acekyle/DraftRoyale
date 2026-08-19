import { expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export const BASE_URL = 'http://localhost:5199';

/**
 * Season-0 market, mid-priced first. The battle sim and the AI drafter are
 * seeded-random per run, so tests never rely on one exact fighter being free —
 * they walk a priority list and take the first card that is neither taken nor
 * unaffordable.
 *
 * Deliberately NOT cheapest-first: sweeping whisper (16.5M) + cinder-wisp (21M)
 * starves the AI — after two expensive AI picks (~77M) no remaining fighter fits
 * its budget, it passes with an illegal 2-fighter roster, and the legality gate
 * soft-locks the lobby (real bug, reported separately). Leaving the two cheapest
 * on the board guarantees the AI can always complete a legal roster.
 */
export const CHEAP_FIRST = [
  'riptide', 'orrin', 'vex', 'sable-howl', 'solaria', 'aegis-9', 'whisper', 'cinder-wisp',
];

/** Most expensive first — used to exhaust the cap for the legality-UI spec. */
export const EXPENSIVE_FIRST = [
  'grimspike', 'captain-meridian', 'ember-ronin', 'razorback', 'aegis-9', 'solaria',
  'sable-howl', 'vex', 'orrin', 'riptide', 'cinder-wisp', 'whisper',
];

export function guestStatePath(browserName: string): string {
  const dir = join(__dirname, '.artifacts');
  mkdirSync(dir, { recursive: true });
  return join(dir, `guest-state-${browserName}.json`);
}

/** Home → name entry → Solo Gauntlet → arena reveal (asserts disclosures) → market draft. */
export async function enterSoloDraft(page: Page, playerName: string) {
  await page.goto('/');
  await page.locator('#p1name').fill(playerName);
  await page.locator('#mode-solo').click();

  // Arena reveal: every mechanical property is disclosed before the draft.
  await expect(page.locator('.disclosure-list li').first()).toBeVisible();
  expect(await page.locator('.disclosure-list li').count()).toBeGreaterThan(0);

  await page.locator('#btn-draft').click();
  await expect(page.locator('.turn-banner')).toContainText('(pick 1)', { timeout: 30_000 });
}

/** Wait until the human is on the clock for pick N (AI turns take ~900ms each). */
export async function waitForMyPick(page: Page, pickNo: number) {
  await expect(page.locator('.turn-banner')).toContainText(`(pick ${pickNo})`, { timeout: 30_000 });
}

/**
 * Draft the first fighter from the priority list whose card is neither taken
 * nor unaffordable: click the card, then confirm in the inspect drawer.
 */
export async function draftFirstAvailable(page: Page, priority: string[]): Promise<string> {
  for (const id of priority) {
    const card = page.locator(`.fighter-card[data-id="${id}"]`);
    const cls = (await card.getAttribute('class')) ?? '';
    if (cls.includes('taken') || cls.includes('unaffordable')) continue;
    await card.click();
    const pick = page.locator('#btn-pick');
    await expect(pick).toBeEnabled();
    await pick.click();
    return id;
  }
  throw new Error(`No fighter from priority list is draftable: ${priority.join(', ')}`);
}

/**
 * From the market draft, run the whole solo loop to the post-match breakdown:
 * draft 3 cheap fighters → lock roster → prep (defaults) → wildcard → battle
 * (fast-forwarded) → breakdown. Never asserts who wins — sims are seeded random.
 */
export async function draftThreeAndBattleToBreakdown(page: Page) {
  // Any alert() here means a legality gate fired — capture it so a failure is
  // self-explanatory instead of a silent timeout.
  const dialogs: string[] = [];
  page.on('dialog', async (d) => {
    dialogs.push(d.message());
    await d.dismiss();
  });

  for (let pickNo = 1; pickNo <= 3; pickNo++) {
    await waitForMyPick(page, pickNo);
    await draftFirstAvailable(page, CHEAP_FIRST);
  }

  // Our next turn offers a roster lock. If the AI's remaining turns end the
  // draft on their own (auto-pass path), the prep screen appears instead.
  const lockRoster = page.locator('#btn-pass');
  const prepContinue = page.locator('#btn-continue');
  await expect(lockRoster.or(prepContinue)).toBeVisible({ timeout: 30_000 });
  if (await lockRoster.isVisible()) await lockRoster.click();

  // Prep: defaults are valid (3-fighter roster ⇒ all active, captain preset).
  await expect(prepContinue).toBeVisible({ timeout: 30_000 });
  await prepContinue.click();

  // Wildcard: pick the first card, lock it.
  await expect(page.locator('.wildcard-card').first()).toBeVisible();
  await page.locator('.wildcard-card').first().click();
  const lock = page.locator('#btn-lock');
  await expect(lock).toBeEnabled();
  await lock.click();

  // Wildcards revealed → begin the battle.
  const battle = page.locator('#btn-battle');
  try {
    await expect(battle).toBeVisible({ timeout: 15_000 });
  } catch {
    throw new Error(
      `Wildcard reveal never appeared.${dialogs.length ? ` App dialogs seen: ${JSON.stringify(dialogs)}` : ' No app dialogs fired.'}`,
    );
  }
  await battle.click();

  // Battle: fast-forward, then wait (generously) for the breakdown screen.
  await page.getByRole('button', { name: 'Skip to result' }).click({ timeout: 30_000 });
  await expect(page.locator('.verdict h1')).toBeVisible({ timeout: 120_000 });
}
