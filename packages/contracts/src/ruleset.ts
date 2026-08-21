import type { Ruleset } from './types';

/**
 * Season 0 ruleset. Tick = 250 ms (4 ticks/sec).
 * Soft limit 3:00 → escalation every 20 s; hard decision at 4:30.
 */
export const RULESET_S0: Ruleset = {
  rulesetId: 'season-0',
  version: '0.3.0',
  tickMs: 250,
  salaryCap: 100_000_000,
  rosterMin: 3,
  rosterMax: 5,
  activeCount: 3,
  draftOrder: 'abba',
  tacticalTokens: 2,
  wildcardsPerPlayer: 1,
  softLimitTicks: 720,
  hardLimitTicks: 1080,
  escalationIntervalTicks: 80,
  escalationDamageBonus: 0.15,
  // Escalation-vs-sustain: healing received is divided by the same ramp damage
  // is multiplied by (damage ×(1+0.15N), healing ÷(1+0.15N) after N stages).
  escalationHealingDamp: 0.15,
  // Melee approach-tax counterweight: closing on the enemy while out-gunned
  // (attacker beyond your own max ability range) takes ×0.7 ranged/area damage.
  approachGuardReduction: 0.3,
  // …and cross it faster: approach speed ×1.25 under the same condition.
  approachSpeedSurge: 0.25,
  // Air is a resource, not a state: flight drains stamina; drained fliers
  // take forced grounded recovery windows. Hover floats a hand's breadth up
  // (melee-reachable) per canon — only true flight climbs.
  flightStaminaUpkeep: 0.6,
  hoverStaysLow: true,
  // Stealth archetypes get their ambush payoff: the strike that breaks
  // stealth lands ×1.35 (stealth was defense-only before 0.3.0).
  stealthAmbushBonus: 0.35,
  division: 'enhanced',
};

/**
 * Frozen archive: the ruleset every match recorded before the approach guard
 * landed. Never edit — history is immutable and 0.2.0 manifests must replay
 * to their original hashes forever.
 */
export const RULESET_S0_V020: Ruleset = {
  ...RULESET_S0,
  version: '0.2.0',
  approachGuardReduction: 0,
  approachSpeedSurge: 0,
  flightStaminaUpkeep: 0,
  hoverStaysLow: false,
  stealthAmbushBonus: 0,
};

/**
 * Frozen archive: the ruleset every match recorded before the escalation
 * healing damp landed. Never edit — history is immutable and 0.1.0 manifests
 * must replay to their original hashes forever.
 */
export const RULESET_S0_V010: Ruleset = {
  ...RULESET_S0_V020,
  version: '0.1.0',
  escalationHealingDamp: 0,
};

/** Version-keyed registry used by replay: a manifest names the ruleset it ran under. */
export const RULESETS_BY_VERSION: Record<string, Ruleset> = {
  [RULESET_S0_V010.version]: RULESET_S0_V010,
  [RULESET_S0_V020.version]: RULESET_S0_V020,
  [RULESET_S0.version]: RULESET_S0,
};

export const PRICE_VERSION = 'S0';
export const PRICE_MIN = 8_000_000;
export const PRICE_MAX = 50_000_000;
