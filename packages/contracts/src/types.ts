/**
 * Infinite Arena — shared schemas.
 *
 * Everything the simulation, client, tools, and content pipeline agree on lives here.
 * Versioning rule: any breaking change to these shapes bumps the relevant
 * *_SCHEMA_VERSION constant and gets a migration note in docs/adr/.
 */

export const CONTRACT_SCHEMA_VERSION = '0.1.0';
export const COMBAT_DNA_SCHEMA_VERSION = '0.1.0';
export const WILDCARD_SCHEMA_VERSION = '0.1.0';
export const MATCH_SCHEMA_VERSION = '0.1.0';

// ---------------------------------------------------------------------------
// Core enums
// ---------------------------------------------------------------------------

export type Division = 'street' | 'enhanced' | 'global' | 'cosmic' | 'open';

export type Role =
  | 'vanguard'
  | 'defender'
  | 'bruiser'
  | 'skirmisher'
  | 'artillery'
  | 'controller'
  | 'support'
  | 'tactician';

export type Chassis = 'humanoid' | 'heavy' | 'quadruped' | 'floating';

export type DamageType =
  | 'kinetic'
  | 'energy'
  | 'thermal'
  | 'psychic'
  | 'magic'
  | 'toxic'
  | 'sonic';

export type MovementMode = 'ground' | 'flight' | 'hover' | 'leap' | 'blink' | 'sprint';

export type Eligibility =
  | 'experimental'
  | 'community_verified'
  | 'ranked_eligible'
  | 'tournament_frozen';

/** 1 (minimal) … 10 (division ceiling). */
export type Tier = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

// ---------------------------------------------------------------------------
// Conditions — the closed vocabulary of runtime status effects (safe rules DSL).
// The engine only executes these; generated content cannot introduce new kinds.
// ---------------------------------------------------------------------------

export type ConditionKind =
  | 'stagger'        // cannot act
  | 'stun'           // cannot act or move
  | 'root'           // cannot move
  | 'slow'           // speed * (1 - magnitude)
  | 'haste'          // speed * (1 + magnitude)
  | 'burn'           // magnitude vitality damage per tick (thermal)
  | 'corrode'        // magnitude vitality damage per tick (toxic)
  | 'regen'          // magnitude vitality healing per tick
  | 'shield'         // pool of magnitude absorbed before vitality
  | 'vulnerable'     // damage taken * (1 + magnitude)
  | 'fortified'      // damage taken * (1 - magnitude)
  | 'blind'          // outgoing hit chance - magnitude
  | 'empower'        // outgoing damage * (1 + magnitude)
  | 'suppress'       // abilities/passives with any of `tags` disabled
  | 'grounded'       // flight/hover forced to ground, no air movement
  | 'stealth'        // harder to hit, broken by acting
  | 'drain'          // primary resource -magnitude per tick
  | 'contained';     // removed from combat (non-lethal defeat progress)

export interface ConditionSpec {
  kind: ConditionKind;
  magnitude: number;
  durationTicks: number;
  /** Only for kind === 'suppress': ability/passive tags disabled. */
  tags?: string[];
}

// ---------------------------------------------------------------------------
// Abilities
// ---------------------------------------------------------------------------

export type AbilityKind =
  | 'melee'
  | 'ranged'
  | 'area'
  | 'support'
  | 'control'
  | 'movement'
  | 'summon';

export type TargetingMode = 'enemy' | 'ally' | 'self' | 'point';

export interface AbilityCost {
  /** 'stamina' or the fighter's primary custom resource name. */
  resource: string;
  amount: number;
}

export interface Ability {
  id: string;
  name: string;
  kind: AbilityKind;
  targeting: TargetingMode;
  /** Meters. Melee ≈ 2–3. Arena is ~60 × 40 m. */
  range: number;
  /** Base magnitude: damage for attacks, healing/shield for support. */
  power: number;
  damageType?: DamageType;
  cost: AbilityCost;
  cooldownTicks: number;
  /** Ticks of windup before resolution; interruptible while winding up. */
  windupTicks: number;
  /** Radius in meters for kind === 'area'. */
  radius?: number;
  /** Conditions applied to the target(s) on hit. */
  effects?: ConditionSpec[];
  /** Conditions applied to self on use (stances, overcharges). */
  selfEffects?: ConditionSpec[];
  /**
   * Power/flavor tags. Used by suppression fields, weakness triggers,
   * environment rules, and wildcard interactions. Examples:
   * 'solar', 'tech', 'magic', 'hydro', 'projectile', 'fire', 'shadow'.
   */
  tags: string[];
  /** Context tags that must be present (env or match) for the ability to be usable. */
  requiresContext?: string[];
  /** Renderer hint from the authored animation grammar. */
  animationIntent: string;
  description: string;
}

export type PassiveKind =
  | 'regen'            // vitality per tick
  | 'resist'           // pct reduction vs damageType
  | 'ally_aura_shield' // shield/tick to allies in radius
  | 'ally_aura_empower'// damage bonus to allies in radius
  | 'stealth_field'    // begins encounters stealthed; re-stealths out of combat
  | 'evasive_flier'    // bonus evasion while airborne
  | 'guard_mastery'    // improved guard reduction
  | 'counter_attack';  // chance to strike back on being hit in melee

export interface Passive {
  id: string;
  name: string;
  kind: PassiveKind;
  magnitude: number;
  damageType?: DamageType;
  radius?: number;
  tags: string[];
  description: string;
}

// ---------------------------------------------------------------------------
// Weaknesses (mechanical form — every ranked fighter needs counterplay)
// ---------------------------------------------------------------------------

export interface WeaknessTrigger {
  damageTypes?: DamageType[];
  abilityTags?: string[];
  envTags?: string[];
}

export interface Weakness {
  id: string;
  description: string;
  /** 1 = exploitable, 2 = serious, 3 = defining. */
  severity: 1 | 2 | 3;
  trigger: WeaknessTrigger;
  effect: {
    damageTakenMult?: number;
    applyCondition?: ConditionSpec;
    suppressTags?: string[];
  };
  evidence: string;
}

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------

export interface CustomResource {
  name: string;
  max: number;
  start: number;
  regenPerTick: number;
  /** If set, regen only happens while ALL of these env/match tags are present. */
  regenRequiresContext?: string[];
  /** If set, resource drains this much per tick while ANY of these tags are present. */
  drainInContext?: { tags: string[]; amount: number };
  /** What happens at 0: these ability/passive tags stop working. */
  onDepletedSuppressTags?: string[];
}

// ---------------------------------------------------------------------------
// Behavior
// ---------------------------------------------------------------------------

export type TargetPreference =
  | 'nearest'
  | 'lowest_vitality'
  | 'highest_threat'
  | 'support_first'
  | 'isolated';

/** Closed vocabulary of behavioral constraints a Character Contract can impose. */
export type BehaviorConstraint =
  | 'never_abandons_allies'   // rejects 'disengage'/'regroup' while an ally is below 35 %
  | 'never_retreats'          // rejects 'disengage'
  | 'protects_captain'        // biases toward guarding the captain
  | 'avoids_lethal_force'     // prefers containment finishes when available
  | 'hunts_strongest'         // rejects focus commands pointing at the weakest enemy
  | 'reckless';               // ignores own low vitality when scoring aggression

export interface BehaviorSpec {
  personality: string;
  /** 0 (cautious) … 1 (fearless). */
  riskTolerance: number;
  /** 0 (selfish) … 1 (bodyguard). */
  allyProtection: number;
  targetPreference: TargetPreference;
  /** 0 … 1 — probability-weight of honoring a tactical command that conflicts with instinct. */
  commandCompliance: number;
  constraints: BehaviorConstraint[];
  /** 0 … 1 — how strongly recent-action repetition is penalized in ability selection. */
  repetitionAvoidance: number;
}

// ---------------------------------------------------------------------------
// Environment interaction rules
// ---------------------------------------------------------------------------

export interface EnvRule {
  /** Matches arena/match context tags, e.g. 'daylight', 'darkness', 'water_present', 'emp_field'. */
  contextTag: string;
  effect: {
    speedMult?: number;
    damageMult?: number;
    damageTakenMult?: number;
    resourceRegenMult?: number;
    suppressTags?: string[];
    unlockContext?: string;
  };
  description: string;
}

// ---------------------------------------------------------------------------
// Character Contract (narrative + provenance; the DNA is compiled from this)
// ---------------------------------------------------------------------------

export interface SourceReference {
  id: string;
  kind: 'creator_lore' | 'design_document' | 'reference_image' | 'external';
  note: string;
}

export interface CharacterClaim {
  path: string;
  selectedValue: string;
  portrayalType: 'repeatable' | 'conditional' | 'peak_feat';
  conditions: string[];
  evidence: string[];
  conflicts: string[];
  confidence: 'high' | 'medium' | 'low';
}

export interface CharacterContract {
  schemaVersion: string;
  identity: {
    fighterId: string;
    displayName: string;
    version: string;
    continuity: string;
    era: string;
    creator: string;
    ownership: 'studio_original' | 'creator_owned' | 'licensed' | 'public_domain';
    visibility: 'private' | 'published';
    remixPolicy: 'allowed_with_attribution' | 'prohibited';
    division: Division;
    chassis: Chassis;
  };
  canon: {
    summary: string;
    primarySources: SourceReference[];
    selectedInterpretation: string;
    disputedClaims: string[];
    assumptions: string[];
  };
  powerSources: {
    name: string;
    origin: string;
    dependencies: string[];
    interruptionConditions: string[];
  }[];
  capabilitySummary: {
    core: string[];
    conditional: string[];
    defensive: string[];
    movement: string[];
    signature: string[];
  };
  limitations: {
    description: string;
    severity: 'minor' | 'serious' | 'defining';
    condition: string;
    evidence: string;
  }[];
  weaknessSummary: {
    description: string;
    severity: 'minor' | 'serious' | 'defining';
    exposureMethod: string;
    evidence: string;
  }[];
  behaviorSummary: {
    combatIntelligence: string;
    tacticalStyle: string;
    riskTolerance: string;
    allyProtection: string;
    moralConstraints: string[];
    commandConstraints: string[];
  };
  provenance: {
    claims: CharacterClaim[];
    conflicts: string[];
    confidence: 'high' | 'medium' | 'low';
    creatorFacts: string[];
    aiAssumptions: string[];
    mechanicalNormalizations: string[];
  };
  approval: {
    creatorApproved: boolean;
    semanticRevisionCount: number;
    visualRevisionCount: number;
    eligibility: Eligibility;
  };
}

// ---------------------------------------------------------------------------
// Combat DNA (mechanical, engine-executable)
// ---------------------------------------------------------------------------

export interface CombatAttributes {
  forceOutput: Tier;
  durability: Tier;
  combatSpeed: Tier;
  reactionSpeed: Tier;
  travelSpeed: Tier;
  precision: Tier;
  mobility: Tier;
  recovery: Tier;
  perception: Tier;
  combatSkill: Tier;
  tacticalIntelligence: Tier;
  teamwork: Tier;
  resolve: Tier;
}

export interface SynergyRule {
  /** Fires when an ally on the team carries this power tag. */
  allyTag: string;
  effect: { damageMult?: number; resourceRegenMult?: number };
  description: string;
}

export interface CombatDNA {
  schemaVersion: string;
  identity: {
    fighterId: string;
    contractVersion: string;
    combatVersion: string;
    division: Division;
    role: Role;
    chassis: Chassis;
    /** Visual scale multiplier: 1 = standard humanoid. */
    scale: number;
  };
  attributes: CombatAttributes;
  resources: {
    vitality: number;
    stability: number;
    stamina: number;
    staminaRegenPerTick: number;
    primary?: CustomResource;
  };
  movementModes: MovementMode[];
  capabilities: {
    foundational: Ability[];
    signature: Ability[];   // exactly 4 for ranked fighters
    contextual: Ability[];  // up to 2, gated by requiresContext
    escalation: Ability;    // one finisher
    passives: Passive[];
  };
  defenses: {
    resistances: { damageType: DamageType; pct: number }[];
    immunities: ConditionKind[];
  };
  weaknesses: Weakness[];
  behavior: BehaviorSpec;
  interactions: {
    environmental: EnvRule[];
    synergies: SynergyRule[];
    /** Every tag this fighter's kit carries — union of ability/passive/resource tags. */
    powerTags: string[];
  };
  balance: {
    capabilityScore: number;
    versatilityScore: number;
    reliabilityScore: number;
    counterabilityScore: number;
    draftPrice: number;
    priceVersion: string;
    priceRationale: string;
  };
  presentation: {
    primaryColor: string;
    secondaryColor: string;
    energyColor: string;
    silhouette: string;
    animationIntents: string[];
  };
  validation: {
    eligibility: Eligibility;
    passedSuites: string[];
    knownIssues: string[];
  };
}

/** A fighter content file bundles narrative contract + mechanical DNA. */
export interface FighterFile {
  contract: CharacterContract;
  dna: CombatDNA;
}

// ---------------------------------------------------------------------------
// Wildcards
// ---------------------------------------------------------------------------

export type WildcardClass = 'object' | 'field' | 'condition' | 'terrain';

export type WildcardEffectKind =
  | 'suppress_tags'     // abilities/passives/resources with tags disabled in area
  | 'dot'               // damage per tick in area
  | 'hot'               // healing per tick in area
  | 'speed_mult'
  | 'accuracy_delta'    // +/- to hit chance in area
  | 'ground_flight'     // flight/hover forced down in area
  | 'stealth_bonus'
  | 'add_context_tags'  // adds match context tags (global) or area context
  | 'remove_context_tags';

export interface WildcardEffect {
  kind: WildcardEffectKind;
  magnitude?: number;
  tags?: string[];
  damageType?: DamageType;
  /** 'both' effects hit both teams — the honesty price of broad power. */
  affects: 'enemies' | 'allies' | 'both';
}

export interface WildcardContract {
  schemaVersion: string;
  wildcardId: string;
  version: string;
  creator: string;
  inputDescription: string;
  normalizedName: string;
  class: WildcardClass;
  /** Radius in meters for object/field; ignored for global conditions. */
  radius: number;
  /** 0 = permanent for the match (terrain). */
  durationTicks: number;
  /** Object HP; destroying it is counterplay. 0 for non-objects. */
  objectHp: number;
  deployment: 'placed' | 'global';
  effects: WildcardEffect[];
  environmentalInteractions: string[];
  sideEffects: string[];
  counterplay: string[];
  visualManifestation: string;
  audioManifestation: string;
  confidence: 'high' | 'medium' | 'low';
  provenance: string;
  moderation: 'approved' | 'pending' | 'rejected';
  eligibility: Eligibility;
}

// ---------------------------------------------------------------------------
// Arena
// ---------------------------------------------------------------------------

export type ArenaFeatureType = 'cover' | 'pillar' | 'water' | 'elevation' | 'hazard';

export interface ArenaFeature {
  id: string;
  type: ArenaFeatureType;
  x: number;
  z: number;
  radius: number;
  destructible: boolean;
  hp: number;
  /** Context tag granted while within the feature (e.g. 'water_present'). */
  grantsContext?: string;
  description: string;
}

export interface ArenaDef {
  arenaId: string;
  version: string;
  name: string;
  description: string;
  sizeX: number;
  sizeZ: number;
  /** Match-wide context tags: 'daylight', 'urban', 'open_sky', … */
  contextTags: string[];
  features: ArenaFeature[];
  /** Player-facing pre-draft disclosure of every major mechanical property. */
  disclosures: string[];
}

// ---------------------------------------------------------------------------
// Ruleset, teams, match manifest, events
// ---------------------------------------------------------------------------

export interface Ruleset {
  rulesetId: string;
  version: string;
  tickMs: number;
  salaryCap: number;
  rosterMin: number;
  rosterMax: number;
  activeCount: number;
  draftOrder: 'abba';
  tacticalTokens: number;
  wildcardsPerPlayer: number;
  /** Escalation begins here (stalemate breaker). */
  softLimitTicks: number;
  /** Match ends by decision here at the latest. */
  hardLimitTicks: number;
  escalationIntervalTicks: number;
  escalationDamageBonus: number;
  /**
   * Escalation-vs-sustain damp, mirroring escalationDamageBonus. After N
   * escalation stages, damage dealt is multiplied by (1 + N * escalationDamageBonus)
   * and healing received is multiplied by 1 / (1 + N * escalationHealingDamp).
   * 0 = damp off (healing unaffected by escalation).
   */
  escalationHealingDamp: number;
  /**
   * Approach guard (melee approach-tax counterweight). While a fighter is in
   * approach movement AND the attacker is beyond the fighter's own maximum
   * offensive ability range (out-gunned while closing), incoming ranged/area
   * damage is multiplied by (1 - approachGuardReduction).
   * 0 = guard off (pre-0.3.0 behavior).
   */
  approachGuardReduction: number;
  /**
   * Companion lever to approachGuardReduction, same trigger condition:
   * while out-gunned and approaching, movement speed is multiplied by
   * (1 + approachSpeedSurge) — the closer crosses dead ground faster.
   * 0 = surge off (pre-0.3.0 behavior).
   */
  approachSpeedSurge: number;
  /**
   * Air-superiority counterweights (ruleset 0.3.0 — with permanent altitude,
   * melee fighters could never contest fliers at all):
   * flightStaminaUpkeep drains stamina per airborne tick; a drained flier is
   * forced into a grounded recovery window (existing `grounded` condition).
   * 0 = flight is free (pre-0.3.0 behavior).
   */
  flightStaminaUpkeep: number;
  /**
   * When true, `hover` movement keeps a fighter at ground altitude (a
   * hand's-breadth float — melee-reachable); only true `flight` climbs.
   * False = pre-0.3.0 behavior (hover counted as full flight).
   */
  hoverStaysLow: boolean;
  /**
   * Ambush payoff for stealth archetypes (ruleset 0.3.0): hits on the
   * resolution that breaks a `stealth_field` fighter's stealth deal
   * (1 + stealthAmbushBonus)× damage. 0 = stealth is defense-only.
   */
  stealthAmbushBonus: number;
  division: Division;
}

export type ReinforcementTrigger =
  | 'ally_ko'
  | 'ally_below_35'
  | 'enemy_wildcard_deployed'
  | 'one_enemy_remains'
  | 'never_hold_reserve';

export interface ReinforcementPlan {
  trigger: ReinforcementTrigger;
  description: string;
}

export type FormationId = 'balanced' | 'protect_captain' | 'spread' | 'ambush';

export interface TeamSetup {
  playerId: string;
  displayName: string;
  /** fighterIds in draft order; cost recorded per pick. */
  roster: { fighterId: string; pricePaid: number }[];
  activeFighterIds: string[]; // exactly activeCount
  reserveOrder: string[];
  captainId: string;
  formation: FormationId;
  reinforcementPlan: ReinforcementPlan;
  wildcardId: string | null;
}

export type TacticalCommandKind =
  | 'focus_target'
  | 'protect_ally'
  | 'press_attack'
  | 'disengage'
  | 'regroup'
  | 'spread_out';

export interface TacticalCommand {
  kind: TacticalCommandKind;
  playerId: string;
  targetFighterId?: string;
  issuedTick: number;
}

export interface WildcardDeployment {
  playerId: string;
  wildcardId: string;
  x: number;
  z: number;
  issuedTick: number;
}

/** Everything needed to reproduce a match exactly. */
export interface MatchManifest {
  schemaVersion: string;
  matchId: string;
  roomId: string;
  createdAt: string;
  rulesetVersion: string;
  arenaId: string;
  arenaVersion: string;
  randomSeed: number;
  teams: TeamSetup[];
  fighterContractVersions: Record<string, string>;
  combatDnaVersions: Record<string, string>;
  priceVersions: Record<string, string>;
  wildcardVersions: Record<string, string>;
  commandTimeline: TacticalCommand[];
  wildcardTimeline: WildcardDeployment[];
}

export type MatchEventType =
  | 'MATCH_STARTED'
  | 'ABILITY_STARTED'
  | 'ABILITY_RESOLVED'
  | 'ABILITY_INTERRUPTED'
  | 'ATTACK_EVADED'
  | 'DAMAGE_APPLIED'
  | 'HEALING_APPLIED'
  | 'CONDITION_APPLIED'
  | 'CONDITION_EXPIRED'
  | 'STABILITY_BROKEN'
  | 'WEAKNESS_TRIGGERED'
  | 'WILDCARD_DEPLOYED'
  | 'WILDCARD_DESTROYED'
  | 'WILDCARD_EXPIRED'
  | 'TACTICAL_COMMAND_ISSUED'
  | 'TACTICAL_COMMAND_REJECTED'
  | 'ALLY_PROTECTED'
  | 'RESERVE_ENTERED'
  | 'FEATURE_DESTROYED'
  | 'RESOURCE_DEPLETED'
  | 'ESCALATION'
  | 'FIGHTER_CONTAINED'
  | 'FIGHTER_KNOCKED_OUT'
  | 'TURNING_POINT'
  | 'MATCH_ENDED';

export interface MatchEvent {
  seq: number;
  tick: number;
  type: MatchEventType;
  /** Fighter/team/wildcard ids and magnitudes; shape depends on type. */
  data: Record<string, string | number | boolean | string[] | undefined>;
}

export type MatchEndReason = 'elimination' | 'decision' | 'forfeit';

export interface MatchOutcome {
  winnerPlayerId: string;
  reason: MatchEndReason;
  finalTick: number;
  teamVitalityPct: Record<string, number>;
  survivors: string[];
}

export interface CausalFactor {
  kind:
    | 'draft_value'
    | 'arena_interaction'
    | 'weakness_exploited'
    | 'wildcard_impact'
    | 'tactical_command'
    | 'reserve_entry'
    | 'decisive_swing';
  headline: string;
  detail: string;
  magnitude: number;
}

export interface CausalBreakdown {
  winnerPlayerId: string;
  summary: string;
  turningPoint: { tick: number; description: string };
  factors: CausalFactor[];
  perFighter: {
    fighterId: string;
    teamId: string;
    damageDealt: number;
    damageTaken: number;
    healingDone: number;
    weaknessesTriggeredAgainst: number;
    koTick: number | null;
    survived: boolean;
  }[];
}

export interface ChampionRecord {
  championId: string;
  createdAt: string;
  playerName: string;
  team: TeamSetup;
  matchId: string;
  arenaId: string;
  rulesetVersion: string;
  winStreak: number;
  defended: number;
}

// ---------------------------------------------------------------------------
// Team Readout (own-team analysis; never a win probability)
// ---------------------------------------------------------------------------

export interface TeamReadout {
  archetype: string;
  tagline: string;
  axes: {
    offense: number;
    endurance: number;
    mobility: number;
    range: number;
    control: number;
    support: number;
    recovery: number;
    environmentFit: number;
    synergy: number;
    reliability: number;
    reserveDepth: number;
    counterCoverage: number;
  };
  notes: string[];
}
