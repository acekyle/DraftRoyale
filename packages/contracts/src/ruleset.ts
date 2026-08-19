import type { Ruleset } from './types';

/**
 * Season 0 ruleset. Tick = 250 ms (4 ticks/sec).
 * Soft limit 3:00 → escalation every 20 s; hard decision at 4:30.
 */
export const RULESET_S0: Ruleset = {
  rulesetId: 'season-0',
  version: '0.1.0',
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
  division: 'enhanced',
};

export const PRICE_VERSION = 'S0';
export const PRICE_MIN = 8_000_000;
export const PRICE_MAX = 50_000_000;
