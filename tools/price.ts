/**
 * Stamps season prices into every fighter file using the transparent pricing
 * formula (services/combat-sim/src/pricing.ts). Prices are then LOCKED for the
 * season; this tool is only rerun for documented emergency corrections or a new
 * season, per docs/PROJECT_CONSTITUTION.md.
 */
import { writeFileSync } from 'node:fs';
import { computePrice } from '@arena/combat-sim';
import { loadContent } from './load-content';

/**
 * Bounded reviewer overrides (constitution §19.8–19.9): applied on top of the
 * formula with written rationale, recorded in the Decision Ledger. Bound: an
 * override may move a price at most ±25% from the formula value.
 */
const REVIEWER_OVERRIDES: Record<string, { price: number; rationale: string }> = {
  grimspike: {
    price: 45_000_000,
    rationale:
      'Reviewer override +$7.5M (D-027): stat-bulk endurance (420 vitality, shield, 16-range answer to every ' +
      'approach) is undervalued by pricing formula v1; the only fighter to hold >62% in every schedule of every ' +
      'battery ever run (66.9% baseline, 69.1% after the 0.3.0 approach/flight rebalance). Price-integrated ' +
      'evidence: the win rates that flagged him already include his old price in team construction.',
  },
  orrin: {
    price: 31_000_000,
    rationale:
      'Reviewer override +$5.5M (D-013): suppression, containment, and shielding utility is systematically ' +
      'undervalued by pricing formula v1 (which scores damage-shaped capability); cross-schedule simulations ' +
      'show top-tier win contribution at a bottom-third formula price.',
  },
};

const content = loadContent();
for (const { file, data } of content.fighterFiles) {
  const result = computePrice(data.dna);
  const override = REVIEWER_OVERRIDES[data.dna.identity.fighterId];
  if (override) {
    const bound = 0.25 * result.draftPrice;
    if (Math.abs(override.price - result.draftPrice) > bound)
      throw new Error(`override for ${data.dna.identity.fighterId} exceeds the ±25% reviewer bound`);
    result.draftPrice = override.price;
    result.priceRationale = `${override.rationale} Formula baseline: ${result.priceRationale}`;
  }
  data.dna.balance = { ...result };
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
  console.log(
    `${data.dna.identity.fighterId.padEnd(18)} $${(result.draftPrice / 1e6).toFixed(1)}M  ` +
      `cap ${result.capabilityScore} vers ${result.versatilityScore} rel ${result.reliabilityScore} ctr ${result.counterabilityScore}`,
  );
}
console.log('\nPrices stamped. Remember: locked for the season (see Decision Ledger).');
