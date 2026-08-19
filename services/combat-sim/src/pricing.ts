/**
 * Fighter pricing — transparent, formula-driven, never invented by a language model.
 * Scores are 0–100. Price = weighted blend mapped into the 8M–50M season band,
 * rounded to 0.5M, locked for the season (PRICE_VERSION).
 */
import type { CombatDNA } from '@arena/contracts';
import { PRICE_MAX, PRICE_MIN, PRICE_VERSION } from '@arena/contracts';

export interface PriceResult {
  capabilityScore: number;
  versatilityScore: number;
  reliabilityScore: number;
  counterabilityScore: number;
  draftPrice: number;
  priceVersion: string;
  priceRationale: string;
}

const clamp100 = (v: number) => Math.max(0, Math.min(100, Math.round(v)));

export function computePrice(dna: CombatDNA): PriceResult {
  const a = dna.attributes;
  const caps = dna.capabilities;
  const all = [...caps.foundational, ...caps.signature, ...caps.contextual, caps.escalation];

  // Capability: raw combat weight — attributes, durability pool, ability power.
  const attrScore =
    a.forceOutput * 1.2 + a.durability * 1.1 + a.combatSpeed + a.precision + a.combatSkill +
    a.reactionSpeed * 0.6 + a.travelSpeed * 0.6 + a.mobility * 0.8;
  const poolScore = dna.resources.vitality / 6 + dna.resources.stability / 4;
  const powerScore = caps.signature.reduce((s, x) => s + x.power, 0) / 4 + caps.escalation.power / 3;
  const capabilityScore = clamp100((attrScore / 80) * 45 + (poolScore / 120) * 25 + (powerScore / 45) * 30);

  // Versatility: distinct ability kinds, damage types, movement modes, contextual options.
  const kinds = new Set(all.map((x) => x.kind)).size;
  const dmgTypes = new Set(all.map((x) => x.damageType).filter(Boolean)).size;
  const ranges = all.map((x) => x.range);
  const rangeSpread = Math.max(...ranges) - Math.min(...ranges);
  const versatilityScore = clamp100(
    kinds * 10 + dmgTypes * 8 + dna.movementModes.length * 8 + caps.contextual.length * 6 + Math.min(20, rangeSpread),
  );

  // Reliability: independence from fragile conditions.
  let reliability = 85;
  const primary = dna.resources.primary;
  if (primary) {
    reliability -= 10; // any custom power source is a dependency
    if (primary.regenRequiresContext?.length) reliability -= 10;
    if (primary.drainInContext) reliability -= 5;
    if (primary.onDepletedSuppressTags?.length) reliability -= 8;
  }
  reliability -= dna.weaknesses.reduce((s, w) => s + w.severity * 4, 0);
  reliability -= caps.contextual.length * 3; // context-gated value doesn't always show up
  reliability += a.resolve * 1.5;
  const reliabilityScore = clamp100(reliability);

  // Counterability: how much surface area opponents can attack (higher = easier to counter = cheaper).
  const triggerBreadth = dna.weaknesses.reduce(
    (s, w) => s + (w.trigger.damageTypes?.length ?? 0) + (w.trigger.abilityTags?.length ?? 0) + (w.trigger.envTags?.length ?? 0),
    0,
  );
  const severitySum = dna.weaknesses.reduce((s, w) => s + w.severity, 0);
  const counterabilityScore = clamp100(triggerBreadth * 6 + severitySum * 8 - dna.defenses.immunities.length * 5);

  const blended =
    (capabilityScore / 100) * 0.42 +
    (versatilityScore / 100) * 0.25 +
    (reliabilityScore / 100) * 0.18 +
    ((100 - counterabilityScore) / 100) * 0.15;

  // Brief-compliant kits structurally land in a narrow blended band (~0.45–0.80):
  // stretch that band across the full season price range so real differences
  // become real price differences (Decision Ledger D-008 revision 2).
  const stretched = Math.max(0, Math.min(1, (blended - 0.42) / 0.42));

  const rawPrice = PRICE_MIN + stretched * (PRICE_MAX - PRICE_MIN);
  const draftPrice = Math.round(rawPrice / 500_000) * 500_000;

  const ups: string[] = [];
  const downs: string[] = [];
  if (capabilityScore >= 65) ups.push('elite raw combat output');
  if (versatilityScore >= 65) ups.push('broad kit versatility');
  if (dna.movementModes.includes('flight')) ups.push('air superiority');
  if (reliabilityScore >= 70) ups.push('dependable in any conditions');
  if (reliabilityScore < 55) downs.push('conditional power source');
  if (counterabilityScore >= 55) downs.push('wide counterplay surface');
  if (severitySum >= 4) downs.push('serious exploitable weaknesses');
  const priceRationale =
    `${ups.length ? ups.join(', ') + ' increased the price' : 'Balanced profile'}` +
    `${downs.length ? '; ' + downs.join(', ') + ' reduced it' : ''}.` +
    ` Scores — capability ${capabilityScore}, versatility ${versatilityScore}, reliability ${reliabilityScore}, counterability ${counterabilityScore}.`;

  return {
    capabilityScore,
    versatilityScore,
    reliabilityScore,
    counterabilityScore,
    draftPrice,
    priceVersion: PRICE_VERSION,
    priceRationale,
  };
}
