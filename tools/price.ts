/**
 * Stamps season prices into every fighter file using the transparent pricing
 * formula (services/combat-sim/src/pricing.ts). Prices are then LOCKED for the
 * season; this tool is only rerun for documented emergency corrections or a new
 * season, per docs/PROJECT_CONSTITUTION.md.
 */
import { writeFileSync } from 'node:fs';
import { computePrice } from '@arena/combat-sim';
import { loadContent } from './load-content';

const content = loadContent();
for (const { file, data } of content.fighterFiles) {
  const result = computePrice(data.dna);
  data.dna.balance = { ...result };
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
  console.log(
    `${data.dna.identity.fighterId.padEnd(18)} $${(result.draftPrice / 1e6).toFixed(1)}M  ` +
      `cap ${result.capabilityScore} vers ${result.versatilityScore} rel ${result.reliabilityScore} ctr ${result.counterabilityScore}`,
  );
}
console.log('\nPrices stamped. Remember: locked for the season (see Decision Ledger).');
