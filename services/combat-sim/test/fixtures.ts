/** Programmatic test fighters — independent of shipped content. */
import type { Ability, ArenaDef, CombatDNA, TeamSetup, WildcardContract } from '@arena/contracts';

export function ability(partial: Partial<Ability> & { id: string }): Ability {
  return {
    name: partial.id,
    kind: 'ranged',
    targeting: 'enemy',
    range: 12,
    power: 12,
    damageType: 'kinetic',
    cost: { resource: 'stamina', amount: 4 },
    cooldownTicks: 8,
    windupTicks: 0,
    tags: ['test'],
    animationIntent: 'test',
    description: 'test ability',
    ...partial,
  };
}

export function makeDna(fighterId: string, overrides: Partial<CombatDNA> = {}): CombatDNA {
  const base: CombatDNA = {
    schemaVersion: '0.1.0',
    identity: {
      fighterId,
      contractVersion: '1.0.0',
      combatVersion: '1.0.0',
      division: 'enhanced',
      role: 'bruiser',
      chassis: 'humanoid',
      scale: 1,
    },
    attributes: {
      forceOutput: 6, durability: 6, combatSpeed: 6, reactionSpeed: 6, travelSpeed: 6,
      precision: 6, mobility: 6, recovery: 6, perception: 6, combatSkill: 6,
      tacticalIntelligence: 6, teamwork: 6, resolve: 6,
    },
    resources: { vitality: 300, stability: 90, stamina: 100, staminaRegenPerTick: 1.5 },
    movementModes: ['ground'],
    capabilities: {
      foundational: [ability({ id: `${fighterId}-jab`, kind: 'melee', range: 3, power: 10, cooldownTicks: 4 })],
      signature: [
        ability({ id: `${fighterId}-s1`, power: 24, cooldownTicks: 24 }),
        ability({ id: `${fighterId}-s2`, kind: 'melee', range: 3, power: 26, cooldownTicks: 28 }),
        ability({ id: `${fighterId}-s3`, kind: 'area', range: 10, radius: 5, power: 18, cooldownTicks: 36 }),
        ability({ id: `${fighterId}-s4`, kind: 'support', targeting: 'self', range: 0, power: 0, cooldownTicks: 40, effects: [{ kind: 'shield', magnitude: 30, durationTicks: 30 }] }),
      ],
      contextual: [],
      escalation: ability({ id: `${fighterId}-ult`, power: 50, cooldownTicks: 200, windupTicks: 4 }),
      passives: [],
    },
    defenses: { resistances: [], immunities: [] },
    weaknesses: [
      {
        id: `${fighterId}-w1`,
        description: 'weak to thermal',
        severity: 2,
        trigger: { damageTypes: ['thermal'] },
        effect: {},
        evidence: 'test',
      },
      {
        id: `${fighterId}-w2`,
        description: 'weak to sonic tags',
        severity: 1,
        trigger: { abilityTags: ['sonic'] },
        effect: {},
        evidence: 'test',
      },
    ],
    behavior: {
      personality: 'test',
      riskTolerance: 0.5,
      allyProtection: 0.5,
      targetPreference: 'nearest',
      commandCompliance: 1,
      constraints: [],
      repetitionAvoidance: 0.5,
    },
    interactions: { environmental: [], synergies: [], powerTags: ['test'] },
    balance: {
      capabilityScore: 50, versatilityScore: 50, reliabilityScore: 70, counterabilityScore: 40,
      draftPrice: 20_000_000, priceVersion: 'S0', priceRationale: 'test',
    },
    presentation: {
      primaryColor: '#888888', secondaryColor: '#aaaaaa', energyColor: '#ffffff',
      silhouette: 'test', animationIntents: [],
    },
    validation: { eligibility: 'experimental', passedSuites: [], knownIssues: [] },
  };
  return deepMerge(base, overrides);
}

export function testArena(): ArenaDef {
  return {
    arenaId: 'test-arena',
    version: '1.0.0',
    name: 'Test Arena',
    description: 'flat test box',
    sizeX: 60,
    sizeZ: 40,
    contextTags: ['daylight'],
    features: [
      { id: 'pillar-1', type: 'pillar', x: 0, z: 8, radius: 2, destructible: true, hp: 50, description: 'test pillar' },
    ],
    disclosures: ['test'],
  };
}

export function testWildcard(overrides: Partial<WildcardContract> = {}): WildcardContract {
  return {
    schemaVersion: '0.1.0',
    wildcardId: 'test-field',
    version: '1.0.0',
    creator: 'test',
    inputDescription: 'test damage field',
    normalizedName: 'Test Field',
    class: 'field',
    radius: 8,
    durationTicks: 100,
    objectHp: 0,
    deployment: 'placed',
    effects: [{ kind: 'dot', magnitude: 1, damageType: 'energy', affects: 'enemies' }],
    environmentalInteractions: [],
    sideEffects: [],
    counterplay: ['leave the radius'],
    visualManifestation: 'a glowing test circle',
    audioManifestation: 'hum',
    confidence: 'high',
    provenance: 'test',
    moderation: 'approved',
    eligibility: 'experimental',
    ...overrides,
  };
}

export function makeTeam(playerId: string, fighterIds: string[], overrides: Partial<TeamSetup> = {}): TeamSetup {
  return {
    playerId,
    displayName: playerId,
    roster: fighterIds.map((fighterId) => ({ fighterId, pricePaid: 20_000_000 })),
    activeFighterIds: fighterIds.slice(0, 3),
    reserveOrder: fighterIds.slice(3),
    captainId: fighterIds[0],
    formation: 'balanced',
    reinforcementPlan: { trigger: 'ally_ko', description: 'relay on defeat' },
    wildcardId: null,
    ...overrides,
  };
}

function deepMerge<T>(base: T, overrides: Partial<T>): T {
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(overrides as Record<string, unknown>)) {
    const cur = out[k];
    if (v && cur && typeof v === 'object' && typeof cur === 'object' && !Array.isArray(v) && !Array.isArray(cur)) {
      out[k] = deepMerge(cur, v as Partial<typeof cur>);
    } else {
      out[k] = v;
    }
  }
  return out as T;
}
