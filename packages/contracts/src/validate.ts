import type {
  Ability,
  ArenaDef,
  CombatDNA,
  FighterFile,
  Ruleset,
  TeamSetup,
  WildcardContract,
} from './types';

export interface ValidationIssue {
  severity: 'error' | 'warning';
  path: string;
  message: string;
}

const push = (
  issues: ValidationIssue[],
  severity: 'error' | 'warning',
  path: string,
  message: string,
) => issues.push({ severity, path, message });

function validateAbility(a: Ability, path: string, issues: ValidationIssue[]) {
  if (!a.id) push(issues, 'error', path, 'ability missing id');
  if (a.power < 0) push(issues, 'error', `${path}.power`, 'power must be >= 0');
  if (a.range < 0 || a.range > 80) push(issues, 'error', `${path}.range`, 'range out of bounds (0–80 m)');
  if (a.cooldownTicks < 0 || a.cooldownTicks > 400)
    push(issues, 'error', `${path}.cooldownTicks`, 'cooldown out of bounds (0–400 ticks)');
  if (a.windupTicks < 0 || a.windupTicks > 16)
    push(issues, 'error', `${path}.windupTicks`, 'windup out of bounds (0–16 ticks)');
  if (a.kind === 'area' && !a.radius)
    push(issues, 'error', `${path}.radius`, 'area ability requires radius');
  if ((a.radius ?? 0) > 20) push(issues, 'error', `${path}.radius`, 'radius too large (max 20 m)');
  if (!a.tags || a.tags.length === 0)
    push(issues, 'warning', `${path}.tags`, 'ability has no power tags — suppression/weakness systems cannot interact with it');
  for (const e of a.effects ?? []) {
    if (e.durationTicks > 240)
      push(issues, 'error', `${path}.effects`, `condition ${e.kind} duration ${e.durationTicks} exceeds 240-tick bound`);
    if (e.kind === 'suppress' && (!e.tags || e.tags.length === 0))
      push(issues, 'error', `${path}.effects`, 'suppress condition requires tags');
  }
}

/** Structural + bounds validation of a fighter file (schema half of the eligibility gates). */
export function validateFighter(f: FighterFile): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const id = f?.dna?.identity?.fighterId ?? 'unknown';
  const p = `fighter:${id}`;

  if (!f.contract) push(issues, 'error', p, 'missing contract');
  if (!f.dna) {
    push(issues, 'error', p, 'missing dna');
    return issues;
  }
  if (f.contract && f.contract.identity.fighterId !== f.dna.identity.fighterId)
    push(issues, 'error', p, 'contract/dna fighterId mismatch');
  if (f.contract && f.contract.identity.version !== f.dna.identity.contractVersion)
    push(issues, 'error', p, 'dna.contractVersion does not match contract.identity.version');

  const attrs = Object.entries(f.dna.attributes);
  if (attrs.length !== 13) push(issues, 'error', `${p}.attributes`, 'expected 13 attributes');
  for (const [k, v] of attrs)
    if (typeof v !== 'number' || v < 1 || v > 10)
      push(issues, 'error', `${p}.attributes.${k}`, `tier ${v} out of 1–10`);

  const r = f.dna.resources;
  if (r.vitality < 100 || r.vitality > 600)
    push(issues, 'error', `${p}.resources.vitality`, `vitality ${r.vitality} out of 100–600`);
  if (r.stability < 20 || r.stability > 200)
    push(issues, 'error', `${p}.resources.stability`, `stability ${r.stability} out of 20–200`);

  const caps = f.dna.capabilities;
  if (caps.signature.length !== 4)
    push(issues, 'error', `${p}.capabilities.signature`, `ranked fighters need exactly 4 signature abilities, found ${caps.signature.length}`);
  if (caps.contextual.length > 2)
    push(issues, 'error', `${p}.capabilities.contextual`, 'at most 2 contextual abilities');
  if (caps.foundational.length < 1)
    push(issues, 'error', `${p}.capabilities.foundational`, 'at least 1 foundational ability required');
  if (!caps.escalation) push(issues, 'error', `${p}.capabilities.escalation`, 'escalation ability required');

  const seen = new Set<string>();
  const all = [...caps.foundational, ...caps.signature, ...caps.contextual, caps.escalation].filter(Boolean);
  for (const [i, a] of all.entries()) {
    if (seen.has(a.id)) push(issues, 'error', `${p}.abilities[${i}]`, `duplicate ability id ${a.id}`);
    seen.add(a.id);
    validateAbility(a, `${p}.ability:${a.id}`, issues);
  }
  for (const c of caps.contextual)
    if (!c.requiresContext || c.requiresContext.length === 0)
      push(issues, 'error', `${p}.ability:${c.id}`, 'contextual ability must declare requiresContext');

  if (f.dna.weaknesses.length < 2)
    push(issues, 'error', `${p}.weaknesses`, 'ranked fighters require at least 2 meaningful weaknesses/limitations');
  for (const w of f.dna.weaknesses) {
    const t = w.trigger;
    if (!t.damageTypes?.length && !t.abilityTags?.length && !t.envTags?.length)
      push(issues, 'error', `${p}.weakness:${w.id}`, 'weakness trigger must specify at least one trigger vector');
    if (!w.evidence) push(issues, 'warning', `${p}.weakness:${w.id}`, 'weakness missing evidence reference');
  }

  const b = f.dna.behavior;
  for (const [k, v] of [
    ['riskTolerance', b.riskTolerance],
    ['allyProtection', b.allyProtection],
    ['commandCompliance', b.commandCompliance],
    ['repetitionAvoidance', b.repetitionAvoidance],
  ] as const)
    if (v < 0 || v > 1) push(issues, 'error', `${p}.behavior.${k}`, `${v} out of 0–1`);

  for (const res of f.dna.defenses.resistances)
    if (res.pct < 0 || res.pct > 0.75)
      push(issues, 'error', `${p}.defenses`, `resistance ${res.damageType} ${res.pct} out of 0–0.75 (no immunity via resistance)`);

  if (f.dna.balance.draftPrice < 8_000_000 || f.dna.balance.draftPrice > 50_000_000)
    push(issues, 'error', `${p}.balance.draftPrice`, `price ${f.dna.balance.draftPrice} outside 8M–50M`);

  return issues;
}

export function validateWildcard(w: WildcardContract): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const p = `wildcard:${w.wildcardId ?? 'unknown'}`;
  if (!w.wildcardId) push(issues, 'error', p, 'missing wildcardId');
  if (!w.counterplay || w.counterplay.length === 0)
    push(issues, 'error', `${p}.counterplay`, 'every wildcard must have at least one counterplay path');
  if (w.class === 'object' && w.objectHp <= 0)
    push(issues, 'error', `${p}.objectHp`, 'object wildcards must be destructible (hp > 0)');
  if (w.class !== 'object' && w.class !== 'terrain' && w.durationTicks <= 0)
    push(issues, 'error', `${p}.durationTicks`, 'field/condition wildcards need a finite duration');
  if (w.durationTicks > 720)
    push(issues, 'error', `${p}.durationTicks`, 'duration exceeds 720-tick bound');
  if (w.deployment === 'placed' && w.class !== 'condition' && w.radius <= 0)
    push(issues, 'error', `${p}.radius`, 'placed wildcard needs a radius');
  if (w.radius > 25) push(issues, 'error', `${p}.radius`, 'radius exceeds 25 m bound');
  if (!w.visualManifestation)
    push(issues, 'error', `${p}.visualManifestation`, 'wildcards must manifest visibly');
  const broad = w.effects.filter((e) => e.affects === 'both').length;
  if (w.effects.length === 0) push(issues, 'error', `${p}.effects`, 'wildcard has no effects');
  for (const e of w.effects) {
    if (e.kind === 'suppress_tags' && (!e.tags || e.tags.length === 0))
      push(issues, 'error', `${p}.effects`, 'suppress_tags effect requires tags');
    if ((e.kind === 'dot' || e.kind === 'hot') && !(e.magnitude! > 0))
      push(issues, 'error', `${p}.effects`, `${e.kind} requires positive magnitude`);
  }
  // Broadness check: global conditions must affect both teams or be weak.
  if (w.class === 'condition' && broad === 0)
    push(issues, 'warning', `${p}`, 'global condition affecting only one team — verify normalization tradeoffs');
  return issues;
}

export function validateArena(a: ArenaDef): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const p = `arena:${a.arenaId ?? 'unknown'}`;
  if (a.sizeX < 20 || a.sizeX > 120 || a.sizeZ < 20 || a.sizeZ > 120)
    push(issues, 'error', `${p}.size`, 'arena size out of 20–120 m bounds');
  if (!a.disclosures || a.disclosures.length === 0)
    push(issues, 'error', `${p}.disclosures`, 'all major mechanical properties must be disclosed pre-draft');
  for (const f of a.features) {
    if (f.destructible && f.hp <= 0)
      push(issues, 'error', `${p}.feature:${f.id}`, 'destructible feature needs hp');
    if (Math.abs(f.x) > a.sizeX / 2 || Math.abs(f.z) > a.sizeZ / 2)
      push(issues, 'error', `${p}.feature:${f.id}`, 'feature outside arena bounds');
  }
  return issues;
}

/** Server-side draft legality — the client is never trusted with these. */
export function validateTeamSetup(
  team: TeamSetup,
  ruleset: Ruleset,
  dnaById: Map<string, CombatDNA>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const p = `team:${team.playerId}`;
  const n = team.roster.length;
  if (n < ruleset.rosterMin || n > ruleset.rosterMax)
    push(issues, 'error', `${p}.roster`, `roster size ${n} outside ${ruleset.rosterMin}–${ruleset.rosterMax}`);
  const spent = team.roster.reduce((s, r) => s + r.pricePaid, 0);
  if (spent > ruleset.salaryCap)
    push(issues, 'error', `${p}.cap`, `spent ${spent} exceeds cap ${ruleset.salaryCap}`);
  const ids = new Set<string>();
  for (const pick of team.roster) {
    if (ids.has(pick.fighterId))
      push(issues, 'error', `${p}.roster`, `duplicate exact version ${pick.fighterId} in one draft`);
    ids.add(pick.fighterId);
    const dna = dnaById.get(pick.fighterId);
    if (!dna) {
      push(issues, 'error', `${p}.roster`, `unknown fighter ${pick.fighterId}`);
      continue;
    }
    if (pick.pricePaid !== dna.balance.draftPrice)
      push(issues, 'error', `${p}.roster`, `price paid for ${pick.fighterId} (${pick.pricePaid}) does not match locked price (${dna.balance.draftPrice})`);
    if (ruleset.division !== 'open' && dna.identity.division !== ruleset.division)
      push(issues, 'error', `${p}.roster`, `${pick.fighterId} not eligible for ${ruleset.division} division`);
  }
  if (team.activeFighterIds.length !== ruleset.activeCount)
    push(issues, 'error', `${p}.active`, `exactly ${ruleset.activeCount} starting fighters required`);
  for (const id of team.activeFighterIds)
    if (!ids.has(id)) push(issues, 'error', `${p}.active`, `active fighter ${id} not in roster`);
  if (!ids.has(team.captainId)) push(issues, 'error', `${p}.captain`, 'captain not in roster');
  const reserves = team.roster.map((r) => r.fighterId).filter((id) => !team.activeFighterIds.includes(id));
  if (team.reserveOrder.length !== reserves.length || !reserves.every((id) => team.reserveOrder.includes(id)))
    push(issues, 'error', `${p}.reserves`, 'reserveOrder must contain exactly the non-active roster members');
  return issues;
}

export const hasErrors = (issues: ValidationIssue[]) => issues.some((i) => i.severity === 'error');

/**
 * Cap-lock guard for drafts: the budget a player must keep in reserve to be
 * GUARANTEED able to finish a minimum-legal roster from what the market can
 * still offer.
 *
 * A price floor (PRICE_MIN) is not enough — the opponent can drain the cheap
 * end of a finite market (this soft-locked a live draft on 2026-08-20). Under
 * ABBA the opponent takes at most 2 fighters between any two of your turns
 * (and never more than their own remaining roster capacity), so at most
 * min(2×need, opponentCapacity) of the remaining fighters can disappear before
 * you finish your minimum. Reserve = the sum of the `need` cheapest prices
 * after discarding that many cheapest as potentially sniped. Returns Infinity
 * when the market cannot guarantee covering the need.
 *
 * @param availablePrices prices of fighters still draftable by this player,
 *   excluding the candidate pick being evaluated
 * @param need picks still required AFTER the candidate to reach rosterMin
 * @param opponentCapacity picks the opponent can still make (0 if passed/full)
 */
export function minRosterReserve(availablePrices: number[], need: number, opponentCapacity: number): number {
  if (need <= 0) return 0;
  const sorted = [...availablePrices].sort((a, b) => a - b);
  const snipes = Math.min(2 * need, Math.max(0, opponentCapacity));
  const survivors = sorted.slice(snipes);
  if (survivors.length < need) return Infinity;
  return survivors.slice(0, need).reduce((s, v) => s + v, 0);
}
