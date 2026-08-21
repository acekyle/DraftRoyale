/**
 * Infinite Arena — authoritative deterministic combat simulation.
 *
 * Renderer-independent: emits semantic MatchEvents; the client turns them into
 * animation/VFX/camera/commentary. Identical MatchManifest inputs (teams, arena,
 * ruleset, seed, command + wildcard timelines) reproduce identical outcomes.
 *
 * AI is the compiler, not the referee: nothing in here calls a model. All live
 * outcomes are decided by these rules over compiled Combat DNA.
 */

import type {
  Ability,
  ArenaDef,
  ArenaFeature,
  CombatDNA,
  ConditionSpec,
  MatchEvent,
  MatchEventType,
  MatchOutcome,
  Ruleset,
  TacticalCommand,
  TacticalCommandKind,
  TeamSetup,
  WildcardContract,
  WildcardDeployment,
} from '@arena/contracts';
import { createRng, type Rng } from './rng';

// ---------------------------------------------------------------------------
// Runtime state
// ---------------------------------------------------------------------------

export interface ActiveCondition extends ConditionSpec {
  remainingTicks: number;
  sourceFighterId: string;
}

export type FighterStatus = 'active' | 'reserve' | 'retired' | 'ko' | 'contained';

export interface FighterRt {
  fighterId: string;
  teamId: string; // playerId of owning team
  dna: CombatDNA;
  x: number;
  z: number;
  alt: number; // 0 = ground, 3 = airborne
  vitality: number;
  stability: number;
  stamina: number;
  primary: { name: string; value: number; max: number } | null;
  primaryDepletedAnnounced: boolean;
  conditions: ActiveCondition[];
  cooldowns: Record<string, number>; // abilityId -> ready tick
  nextDecisionTick: number;
  windup: { ability: Ability; targetId: string | null; x: number; z: number; resolveTick: number } | null;
  moveIntent:
    | { mode: 'approach'; targetId: string; desiredRange: number }
    | { mode: 'retreat' }
    | { mode: 'point'; x: number; z: number }
    | { mode: 'hold' };
  guarding: boolean;
  stealthed: boolean;
  /** Tick on which this fighter broke stealth by attacking (ambush window). */
  ambushTick: number | null;
  lastCombatTick: number;
  recentAbilities: string[];
  currentTargetId: string | null;
  status: FighterStatus;
  koTick: number | null;
  // per-match stats
  damageDealt: number;
  damageTaken: number;
  healingDone: number;
  weaknessesTriggeredAgainst: number;
  // cached per-tick modifiers
  envSpeedMult: number;
  envDamageMult: number;
  envDamageTakenMult: number;
  envRegenMult: number;
  envSuppress: string[];
  personalContext: string[];
  synergyDamageMult: number;
  synergyRegenMult: number;
}

export interface WildcardInstance {
  instanceId: string;
  contract: WildcardContract;
  ownerTeamId: string;
  x: number;
  z: number;
  hp: number;
  deployedTick: number;
  expiresTick: number | null; // null = permanent
  destroyed: boolean;
  expired: boolean;
  // impact tracking for the causal breakdown
  damageDone: number;
  healingDone: number;
  suppressionFighterTicks: number;
  groundedFighterTicks: number;
}

export interface DeployableInstance {
  instanceId: string;
  name: string;
  ownerFighterId: string;
  teamId: string;
  x: number;
  z: number;
  hp: number;
  radius: number;
  healPerTick: number;
  dpsPerTick: number;
  damageType: 'energy';
  expiresTick: number;
  destroyed: boolean;
}

interface ActiveCommand {
  kind: TacticalCommandKind;
  teamId: string;
  targetFighterId: string | null;
  compliantIds: string[];
  expiresTick: number;
  damageDuring: number;
}

export interface SimContent {
  fighters: Map<string, CombatDNA>;
  wildcards: Map<string, WildcardContract>;
  arena: ArenaDef;
}

export interface MatchInputs {
  matchId: string;
  seed: number;
  ruleset: Ruleset;
  teams: TeamSetup[]; // exactly 2 for the vertical slice
}

const SEV_MULT: Record<number, number> = { 1: 1.3, 2: 1.6, 3: 2.0 };
const COMMAND_DURATION = 40; // ticks (10 s)
const MELEE_RANGE = 3.2;
const SEPARATION = 1.4;

// ---------------------------------------------------------------------------

export class MatchSim {
  readonly ruleset: Ruleset;
  readonly arena: ArenaDef;
  readonly teams: TeamSetup[];
  readonly seed: number;
  readonly matchId: string;

  tick = 0;
  over = false;
  outcome: MatchOutcome | null = null;
  events: MatchEvent[] = [];

  fighters: FighterRt[] = [];
  features: (ArenaFeature & { currentHp: number; destroyed: boolean })[] = [];
  wildcardInstances: WildcardInstance[] = [];
  deployables: DeployableInstance[] = [];
  activeCommands: ActiveCommand[] = [];
  commandHistory: ActiveCommand[] = [];
  matchContext: Set<string> = new Set();

  private rng: Rng;
  private seq = 0;
  private escalationMult = 1;
  private escalationStages = 0;
  /** Healing received is multiplied by this during escalation (1 = no damp). */
  private escalationHealMult = 1;
  private nextEscalationTick: number;
  private tokensLeft: Record<string, number> = {};
  private wildcardUsed: Record<string, boolean> = {};
  private weaknessKnownBy: Record<string, Set<string>> = {}; // teamId -> fighterIds whose weakness was observed
  private momentum: { tick: number; diff: number }[] = []; // teamA - teamB vitality pct
  private instanceCounter = 0;
  private weaknessDamage: Record<string, number> = {}; // "fighterId:weaknessId" -> bonus damage attributed

  constructor(inputs: MatchInputs, private content: SimContent) {
    this.ruleset = inputs.ruleset;
    this.arena = content.arena;
    this.teams = inputs.teams;
    this.seed = inputs.seed;
    this.matchId = inputs.matchId;
    this.rng = createRng(inputs.seed);
    this.nextEscalationTick = this.ruleset.softLimitTicks;

    this.features = this.arena.features.map((f) => ({ ...f, currentHp: f.hp, destroyed: false }));

    for (const team of this.teams) {
      this.tokensLeft[team.playerId] = this.ruleset.tacticalTokens;
      this.wildcardUsed[team.playerId] = false;
      this.weaknessKnownBy[team.playerId] = new Set();
    }

    for (const [ti, team] of this.teams.entries()) {
      const sideX = ti === 0 ? -this.arena.sizeX / 2 + 7 : this.arena.sizeX / 2 - 7;
      const ordered = [...team.roster].sort((a, b) => a.fighterId.localeCompare(b.fighterId));
      for (const pick of ordered) {
        const dna = content.fighters.get(pick.fighterId);
        if (!dna) throw new Error(`unknown fighter ${pick.fighterId}`);
        const active = team.activeFighterIds.includes(pick.fighterId);
        const slot = active
          ? team.activeFighterIds.indexOf(pick.fighterId)
          : 0;
        const zSpread = this.formationZ(team.formation, slot, dna, team);
        const xOff = this.formationX(team.formation, pick.fighterId === team.captainId);
        const stealthy = dna.capabilities.passives.some((p) => p.kind === 'stealth_field');
        this.fighters.push({
          fighterId: pick.fighterId,
          teamId: team.playerId,
          dna,
          x: sideX + (ti === 0 ? xOff : -xOff),
          z: zSpread,
          alt: 0,
          vitality: dna.resources.vitality,
          stability: dna.resources.stability,
          stamina: dna.resources.stamina,
          primary: dna.resources.primary
            ? { name: dna.resources.primary.name, value: dna.resources.primary.start, max: dna.resources.primary.max }
            : null,
          primaryDepletedAnnounced: false,
          conditions: [],
          cooldowns: {},
          nextDecisionTick: 2 + slot,
          windup: null,
          moveIntent: { mode: 'hold' },
          guarding: false,
          stealthed: stealthy,
          ambushTick: null,
          lastCombatTick: 0,
          recentAbilities: [],
          currentTargetId: null,
          status: active ? 'active' : 'reserve',
          koTick: null,
          damageDealt: 0,
          damageTaken: 0,
          healingDone: 0,
          weaknessesTriggeredAgainst: 0,
          envSpeedMult: 1,
          envDamageMult: 1,
          envDamageTakenMult: 1,
          envRegenMult: 1,
          envSuppress: [],
          personalContext: [],
          synergyDamageMult: 1,
          synergyRegenMult: 1,
        });
      }
    }
    this.fighters.sort((a, b) => (a.teamId + a.fighterId).localeCompare(b.teamId + b.fighterId));

    // Precompute team synergies.
    for (const f of this.fighters) {
      const mates = this.fighters.filter((m) => m.teamId === f.teamId && m.fighterId !== f.fighterId);
      for (const rule of f.dna.interactions.synergies) {
        if (mates.some((m) => m.dna.interactions.powerTags.includes(rule.allyTag))) {
          if (rule.effect.damageMult) f.synergyDamageMult *= rule.effect.damageMult;
          if (rule.effect.resourceRegenMult) f.synergyRegenMult *= rule.effect.resourceRegenMult;
        }
      }
    }

    this.recomputeContext();
    this.emit('MATCH_STARTED', {
      matchId: this.matchId,
      arenaId: this.arena.arenaId,
      seed: this.seed,
      teamA: this.teams[0].playerId,
      teamB: this.teams[1].playerId,
    });
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** Issue a tactical command. Valid between steps; consumed a token. */
  applyCommand(cmd: TacticalCommand): { accepted: boolean; reason?: string } {
    if (this.over) return { accepted: false, reason: 'match over' };
    if ((this.tokensLeft[cmd.playerId] ?? 0) <= 0) return { accepted: false, reason: 'no tokens left' };
    const team = this.teams.find((t) => t.playerId === cmd.playerId);
    if (!team) return { accepted: false, reason: 'unknown player' };
    if ((cmd.kind === 'focus_target' || cmd.kind === 'protect_ally') && !cmd.targetFighterId)
      return { accepted: false, reason: 'target required' };

    this.tokensLeft[cmd.playerId] -= 1;
    this.emit('TACTICAL_COMMAND_ISSUED', {
      playerId: cmd.playerId,
      kind: cmd.kind,
      target: cmd.targetFighterId,
      tokensLeft: this.tokensLeft[cmd.playerId],
    });

    const compliant: string[] = [];
    for (const f of this.activeOf(cmd.playerId)) {
      const rejection = this.constraintRejection(f, cmd);
      if (rejection) {
        this.emit('TACTICAL_COMMAND_REJECTED', { fighterId: f.fighterId, kind: cmd.kind, reason: rejection });
        continue;
      }
      if (this.rng.chance(f.dna.behavior.commandCompliance)) compliant.push(f.fighterId);
      else this.emit('TACTICAL_COMMAND_REJECTED', { fighterId: f.fighterId, kind: cmd.kind, reason: 'instinct override' });
    }
    const entry: ActiveCommand = {
      kind: cmd.kind,
      teamId: cmd.playerId,
      targetFighterId: cmd.targetFighterId ?? null,
      compliantIds: compliant,
      expiresTick: this.tick + COMMAND_DURATION,
      damageDuring: 0,
    };
    this.activeCommands.push(entry);
    this.commandHistory.push(entry);
    return { accepted: true };
  }

  /** Deploy the player's locked wildcard at a position. */
  deployWildcard(dep: WildcardDeployment): { accepted: boolean; reason?: string } {
    if (this.over) return { accepted: false, reason: 'match over' };
    if (this.wildcardUsed[dep.playerId]) return { accepted: false, reason: 'wildcard already used' };
    const team = this.teams.find((t) => t.playerId === dep.playerId);
    if (!team || team.wildcardId !== dep.wildcardId) return { accepted: false, reason: 'wildcard not locked by player' };
    const contract = this.content.wildcards.get(dep.wildcardId);
    if (!contract) return { accepted: false, reason: 'unknown wildcard' };
    const x = clamp(dep.x, -this.arena.sizeX / 2, this.arena.sizeX / 2);
    const z = clamp(dep.z, -this.arena.sizeZ / 2, this.arena.sizeZ / 2);
    this.wildcardUsed[dep.playerId] = true;
    const inst: WildcardInstance = {
      instanceId: `wc_${this.instanceCounter++}`,
      contract,
      ownerTeamId: dep.playerId,
      x,
      z,
      hp: contract.objectHp,
      deployedTick: this.tick,
      expiresTick: contract.durationTicks > 0 ? this.tick + contract.durationTicks : null,
      destroyed: false,
      expired: false,
      damageDone: 0,
      healingDone: 0,
      suppressionFighterTicks: 0,
      groundedFighterTicks: 0,
    };
    this.wildcardInstances.push(inst);
    this.emit('WILDCARD_DEPLOYED', {
      playerId: dep.playerId,
      wildcardId: dep.wildcardId,
      name: contract.normalizedName,
      class: contract.class,
      x,
      z,
    });
    this.recomputeContext();
    // Reactive reinforcement plans.
    for (const t of this.teams) {
      if (t.playerId !== dep.playerId && t.reinforcementPlan.trigger === 'enemy_wildcard_deployed')
        this.trySwapLowest(t, 'reacting to enemy wildcard');
    }
    return { accepted: true };
  }

  /** Advance one tick. Returns the events emitted during this tick. */
  step(): MatchEvent[] {
    if (this.over) return [];
    const before = this.events.length;
    this.tick += 1;

    this.recomputeContext();
    this.tickWildcards();
    this.tickDeployables();
    this.tickConditions();
    this.tickResources();
    this.tickEscalation();
    this.tickReserves();
    this.expireCommands();

    for (const f of this.fighters) {
      if (f.status !== 'active') continue;
      this.actFighter(f);
      if (this.over) break;
    }
    if (!this.over) {
      for (const f of this.fighters) if (f.status === 'active') this.moveFighter(f);
      this.applySeparation();
    }

    if (this.tick % 4 === 0) {
      this.momentum.push({ tick: this.tick, diff: this.teamVitalityPct(this.teams[0].playerId) - this.teamVitalityPct(this.teams[1].playerId) });
    }

    if (!this.over) this.checkVictory();
    return this.events.slice(before);
  }

  /** Run to completion (headless). */
  runToEnd(maxTicks = 100_000): MatchOutcome {
    let guard = 0;
    while (!this.over && guard++ < maxTicks) this.step();
    if (!this.outcome) throw new Error('match did not reach a terminal state');
    return this.outcome;
  }

  tokensRemaining(playerId: string): number {
    return this.tokensLeft[playerId] ?? 0;
  }
  wildcardAvailable(playerId: string): boolean {
    return !this.wildcardUsed[playerId];
  }

  // -------------------------------------------------------------------------
  // Context & modifiers
  // -------------------------------------------------------------------------

  private recomputeContext() {
    this.matchContext = new Set(this.arena.contextTags);
    for (const inst of this.wildcardInstances) {
      if (inst.destroyed || inst.expired) continue;
      for (const e of inst.contract.effects) {
        if (inst.contract.deployment !== 'global') continue;
        if (e.kind === 'add_context_tags') for (const t of e.tags ?? []) this.matchContext.add(t);
        if (e.kind === 'remove_context_tags') for (const t of e.tags ?? []) this.matchContext.delete(t);
      }
    }
    for (const f of this.fighters) {
      if (f.status !== 'active') { f.personalContext = []; continue; }
      const personal: string[] = [];
      for (const feat of this.features) {
        if (feat.destroyed || !feat.grantsContext) continue;
        if (dist2(f.x, f.z, feat.x, feat.z) <= (feat.radius + 2) ** 2) personal.push(feat.grantsContext);
      }
      for (const inst of this.wildcardInstances) {
        if (inst.destroyed || inst.expired || inst.contract.deployment === 'global') continue;
        if (dist2(f.x, f.z, inst.x, inst.z) > inst.contract.radius ** 2) continue;
        for (const e of inst.contract.effects)
          if (e.kind === 'add_context_tags' && this.effectApplies(e.affects, inst.ownerTeamId, f.teamId))
            personal.push(...(e.tags ?? []));
      }
      f.personalContext = personal;

      // Environment rule aggregation.
      let speed = 1, dmg = 1, taken = 1, regen = 1;
      const suppress: string[] = [];
      const ctx = new Set([...this.matchContext, ...personal]);
      for (const rule of f.dna.interactions.environmental) {
        if (!ctx.has(rule.contextTag)) continue;
        const e = rule.effect;
        if (e.speedMult) speed *= e.speedMult;
        if (e.damageMult) dmg *= e.damageMult;
        if (e.damageTakenMult) taken *= e.damageTakenMult;
        if (e.resourceRegenMult) regen *= e.resourceRegenMult;
        if (e.suppressTags) suppress.push(...e.suppressTags);
        if (e.unlockContext) f.personalContext.push(e.unlockContext);
      }
      f.envSpeedMult = speed;
      f.envDamageMult = dmg;
      f.envDamageTakenMult = taken;
      f.envRegenMult = regen;
      f.envSuppress = suppress;
    }
  }

  private effectApplies(affects: 'enemies' | 'allies' | 'both', ownerTeamId: string, teamId: string): boolean {
    if (affects === 'both') return true;
    return affects === 'allies' ? teamId === ownerTeamId : teamId !== ownerTeamId;
  }

  suppressedTags(f: FighterRt): Set<string> {
    const tags = new Set<string>(f.envSuppress);
    for (const c of f.conditions) if (c.kind === 'suppress') for (const t of c.tags ?? []) tags.add(t);
    for (const inst of this.wildcardInstances) {
      if (inst.destroyed || inst.expired) continue;
      const inArea = inst.contract.deployment === 'global' || dist2(f.x, f.z, inst.x, inst.z) <= inst.contract.radius ** 2;
      if (!inArea) continue;
      for (const e of inst.contract.effects) {
        if (e.kind !== 'suppress_tags' || !this.effectApplies(e.affects, inst.ownerTeamId, f.teamId)) continue;
        for (const t of e.tags ?? []) tags.add(t);
        inst.suppressionFighterTicks += 1;
      }
    }
    if (f.primary && f.primary.value <= 0)
      for (const t of f.dna.resources.primary?.onDepletedSuppressTags ?? []) tags.add(t);
    return tags;
  }

  private wildcardMods(f: FighterRt): { speedMult: number; accuracyDelta: number; grounded: boolean; stealthBonus: number } {
    let speedMult = 1, accuracyDelta = 0, stealthBonus = 0, grounded = false;
    for (const inst of this.wildcardInstances) {
      if (inst.destroyed || inst.expired) continue;
      const inArea = inst.contract.deployment === 'global' || dist2(f.x, f.z, inst.x, inst.z) <= inst.contract.radius ** 2;
      if (!inArea) continue;
      for (const e of inst.contract.effects) {
        if (!this.effectApplies(e.affects, inst.ownerTeamId, f.teamId)) continue;
        if (e.kind === 'speed_mult') speedMult *= e.magnitude ?? 1;
        if (e.kind === 'accuracy_delta') accuracyDelta += e.magnitude ?? 0;
        if (e.kind === 'stealth_bonus') stealthBonus += e.magnitude ?? 0;
        if (e.kind === 'ground_flight') {
          grounded = true;
          if (f.alt > 0) inst.groundedFighterTicks += 1;
        }
      }
    }
    return { speedMult, accuracyDelta, grounded, stealthBonus };
  }

  // -------------------------------------------------------------------------
  // Per-tick systems
  // -------------------------------------------------------------------------

  private tickWildcards() {
    for (const inst of this.wildcardInstances) {
      if (inst.destroyed || inst.expired) continue;
      if (inst.expiresTick !== null && this.tick >= inst.expiresTick) {
        inst.expired = true;
        this.emit('WILDCARD_EXPIRED', { wildcardId: inst.contract.wildcardId, name: inst.contract.normalizedName });
        this.recomputeContext();
        continue;
      }
      for (const e of inst.contract.effects) {
        if (e.kind !== 'dot' && e.kind !== 'hot') continue;
        for (const f of this.fighters) {
          if (f.status !== 'active') continue;
          const inArea = inst.contract.deployment === 'global' || dist2(f.x, f.z, inst.x, inst.z) <= inst.contract.radius ** 2;
          if (!inArea || !this.effectApplies(e.affects, inst.ownerTeamId, f.teamId)) continue;
          if (e.kind === 'dot') {
            const dmg = (e.magnitude ?? 0) * f.envDamageTakenMult;
            this.dealRawDamage(f, dmg, e.damageType ?? 'energy', `wildcard:${inst.contract.wildcardId}`);
            inst.damageDone += dmg;
          } else {
            const heal = Math.min((e.magnitude ?? 0) * this.escalationHealMult, f.dna.resources.vitality - f.vitality);
            if (heal > 0) {
              f.vitality += heal;
              inst.healingDone += heal;
            }
          }
        }
      }
    }
  }

  private tickDeployables() {
    for (const d of this.deployables) {
      if (d.destroyed) continue;
      if (this.tick >= d.expiresTick) {
        d.destroyed = true;
        continue;
      }
      for (const f of this.fighters) {
        if (f.status !== 'active') continue;
        if (dist2(f.x, f.z, d.x, d.z) > d.radius ** 2) continue;
        if (d.healPerTick > 0 && f.teamId === d.teamId) {
          const heal = Math.min(d.healPerTick * this.escalationHealMult, f.dna.resources.vitality - f.vitality);
          if (heal > 0) {
            f.vitality += heal;
            const owner = this.byId(d.ownerFighterId);
            if (owner) owner.healingDone += heal;
          }
        }
        if (d.dpsPerTick > 0 && f.teamId !== d.teamId)
          this.dealRawDamage(f, d.dpsPerTick, d.damageType, `deployable:${d.name}`);
      }
    }
  }

  private tickConditions() {
    for (const f of this.fighters) {
      if (f.status !== 'active') continue;
      const keep: ActiveCondition[] = [];
      for (const c of f.conditions) {
        if (c.kind === 'burn' || c.kind === 'corrode')
          this.dealRawDamage(f, c.magnitude, c.kind === 'burn' ? 'thermal' : 'toxic', `condition:${c.kind}`);
        if (c.kind === 'regen') f.vitality = Math.min(f.dna.resources.vitality, f.vitality + c.magnitude * this.escalationHealMult);
        if (c.kind === 'drain' && f.primary) f.primary.value = Math.max(0, f.primary.value - c.magnitude);
        c.remainingTicks -= 1;
        if (c.remainingTicks > 0) keep.push(c);
        else this.emit('CONDITION_EXPIRED', { fighterId: f.fighterId, kind: c.kind });
      }
      f.conditions = keep;
      if (f.status === 'active' && f.vitality <= 0) this.knockOut(f, 'condition damage');
    }
  }

  private tickResources() {
    for (const f of this.fighters) {
      if (f.status !== 'active') continue;
      // Flight upkeep (ruleset 0.3.0): no catching your breath in the air —
      // airborne stamina drains instead of regenerating; a drained flier is
      // forced into a grounded recovery window (melee can finally answer).
      if (this.ruleset.flightStaminaUpkeep > 0 && f.alt > 0) {
        f.stamina -= this.ruleset.flightStaminaUpkeep;
        if (f.stamina <= 0) {
          f.stamina = 0;
          this.applyCondition(f, { kind: 'grounded', magnitude: 0, durationTicks: 24 }, 'flight-fatigue', false);
        }
      } else {
        f.stamina = Math.min(f.dna.resources.stamina, f.stamina + f.dna.resources.staminaRegenPerTick);
      }
      if (!this.hasCondition(f, 'stagger') && !this.hasCondition(f, 'stun'))
        f.stability = Math.min(f.dna.resources.stability, f.stability + f.dna.attributes.recovery * 0.12);
      const spec = f.dna.resources.primary;
      if (f.primary && spec) {
        const ctx = new Set([...this.matchContext, ...f.personalContext]);
        const regenOk = (spec.regenRequiresContext ?? []).every((t) => ctx.has(t));
        if (regenOk) f.primary.value = Math.min(f.primary.max, f.primary.value + spec.regenPerTick * f.envRegenMult * f.synergyRegenMult);
        if (spec.drainInContext && spec.drainInContext.tags.some((t) => ctx.has(t)))
          f.primary.value = Math.max(0, f.primary.value - spec.drainInContext.amount);
        if (f.primary.value <= 0 && !f.primaryDepletedAnnounced) {
          f.primaryDepletedAnnounced = true;
          this.emit('RESOURCE_DEPLETED', { fighterId: f.fighterId, resource: f.primary.name });
        }
        if (f.primary.value > f.primary.max * 0.2) f.primaryDepletedAnnounced = false;
      }
      // Passive regen + ally auras.
      for (const p of f.dna.capabilities.passives) {
        if (this.passiveSuppressed(f, p.tags)) continue;
        if (p.kind === 'regen') {
          f.vitality = Math.min(f.dna.resources.vitality, f.vitality + p.magnitude * this.escalationHealMult);
        } else if (p.kind === 'ally_aura_shield' || p.kind === 'ally_aura_empower') {
          const radius = p.radius ?? 8;
          for (const ally of this.activeOf(f.teamId)) {
            if (ally.fighterId === f.fighterId) continue;
            if (dist2(f.x, f.z, ally.x, ally.z) > radius * radius) continue;
            if (p.kind === 'ally_aura_empower') {
              this.refreshCondition(ally, { kind: 'empower', magnitude: p.magnitude, durationTicks: 4 }, f.fighterId);
            } else {
              const cap = p.magnitude * 12;
              const existing = ally.conditions.find((c) => c.kind === 'shield' && c.sourceFighterId === f.fighterId);
              if (existing) {
                existing.magnitude = Math.min(cap, existing.magnitude + p.magnitude);
                existing.remainingTicks = Math.max(existing.remainingTicks, 8);
              } else {
                ally.conditions.push({ kind: 'shield', magnitude: p.magnitude, durationTicks: 8, remainingTicks: 8, sourceFighterId: f.fighterId });
              }
            }
          }
        }
      }
      // Stealth re-entry.
      const stealthPassive = f.dna.capabilities.passives.find((p) => p.kind === 'stealth_field');
      if (stealthPassive && !f.stealthed && this.tick - f.lastCombatTick > 20 && !this.passiveSuppressed(f, stealthPassive.tags)) {
        f.stealthed = true;
        this.emit('CONDITION_APPLIED', { fighterId: f.fighterId, kind: 'stealth', duration: 0 });
      }
    }
  }

  private passiveSuppressed(f: FighterRt, tags: string[]): boolean {
    const sup = this.suppressedTags(f);
    return tags.some((t) => sup.has(t));
  }

  private tickEscalation() {
    if (this.tick >= this.nextEscalationTick && this.tick >= this.ruleset.softLimitTicks) {
      this.escalationStages += 1;
      this.escalationMult += this.ruleset.escalationDamageBonus;
      // Symmetric sustain damp: healing is divided by the same kind of ramp
      // damage is multiplied by, so escalation pressures sustain comps too.
      this.escalationHealMult = 1 / (1 + this.escalationStages * this.ruleset.escalationHealingDamp);
      this.nextEscalationTick = this.tick + this.ruleset.escalationIntervalTicks;
      // healingMult only exists when the damp is on — 0.1.0 manifests must
      // replay to byte-identical events (and therefore their original hashes).
      this.emit('ESCALATION', this.ruleset.escalationHealingDamp > 0
        ? { damageMult: round2(this.escalationMult), healingMult: round2(this.escalationHealMult) }
        : { damageMult: round2(this.escalationMult) });
    }
  }

  private tickReserves() {
    for (const team of this.teams) {
      const active = this.activeOf(team.playerId);
      const reserves = team.reserveOrder
        .map((id) => this.byId(id))
        .filter((f): f is FighterRt => !!f && f.status === 'reserve');
      if (reserves.length === 0) continue;

      if (active.length < this.ruleset.activeCount) {
        const plan = team.reinforcementPlan.trigger;
        const enemiesAlive = this.activeOf(this.opponentOf(team.playerId)).length +
          this.fighters.filter((f) => f.teamId !== team.playerId && f.status === 'reserve').length;
        const holdOk = plan === 'one_enemy_remains' && enemiesAlive > 1 && active.length > 0;
        if (!holdOk) this.enterReserve(team, reserves[0], 'relay after teammate defeated');
        continue;
      }
      if (team.reinforcementPlan.trigger === 'ally_below_35') {
        const weak = active.find((f) => f.vitality / f.dna.resources.vitality < 0.35);
        if (weak) this.swapOut(team, weak, reserves[0], 'tactical retreat at low vitality');
      }
    }
  }

  private trySwapLowest(team: TeamSetup, reason: string) {
    const active = this.activeOf(team.playerId);
    const reserves = team.reserveOrder.map((id) => this.byId(id)).filter((f): f is FighterRt => !!f && f.status === 'reserve');
    if (reserves.length === 0 || active.length === 0) return;
    const lowest = [...active].sort((a, b) => a.vitality / a.dna.resources.vitality - b.vitality / b.dna.resources.vitality)[0];
    this.swapOut(team, lowest, reserves[0], reason);
  }

  private swapOut(team: TeamSetup, out: FighterRt, entering: FighterRt, reason: string) {
    out.status = 'retired';
    out.conditions = [];
    this.enterReserve(team, entering, reason);
  }

  private enterReserve(team: TeamSetup, f: FighterRt, reason: string) {
    const ti = this.teams.indexOf(team);
    f.status = 'active';
    f.x = ti === 0 ? -this.arena.sizeX / 2 + 4 : this.arena.sizeX / 2 - 4;
    f.z = this.rng.range(-this.arena.sizeZ / 4, this.arena.sizeZ / 4);
    f.nextDecisionTick = this.tick + 2;
    this.emit('RESERVE_ENTERED', { fighterId: f.fighterId, teamId: team.playerId, reason });
  }

  private expireCommands() {
    this.activeCommands = this.activeCommands.filter((c) => c.expiresTick > this.tick);
  }

  private formationZ(formation: string, slot: number, _dna: CombatDNA, _team: TeamSetup): number {
    const spread = formation === 'spread' ? 14 : formation === 'ambush' ? 10 : 7;
    const base = (slot - 1) * spread;
    return formation === 'ambush' && slot === 2 ? base + 8 : base;
  }

  private formationX(formation: string, isCaptain: boolean): number {
    if (formation === 'protect_captain' && isCaptain) return -4; // captain behind the line
    return 0;
  }

  // -------------------------------------------------------------------------
  // Fighter decision-making
  // -------------------------------------------------------------------------

  private actFighter(f: FighterRt) {
    if (this.hasCondition(f, 'stun') || this.hasCondition(f, 'stagger')) {
      f.windup = null;
      return;
    }
    if (f.windup) {
      if (this.tick >= f.windup.resolveTick) {
        const w = f.windup;
        f.windup = null;
        this.resolveAbility(f, w.ability, w.targetId, w.x, w.z);
      }
      return;
    }
    if (this.tick < f.nextDecisionTick) return;

    f.guarding = false;
    const decision = this.decide(f);
    const cadence = Math.max(3, Math.round(10 - f.dna.attributes.combatSpeed * 0.7));
    f.nextDecisionTick = this.tick + cadence;

    switch (decision.action) {
      case 'ability': {
        const a = decision.ability!;
        this.payCost(f, a);
        f.cooldowns[a.id] = this.tick + a.cooldownTicks;
        f.recentAbilities.push(a.id);
        if (f.recentAbilities.length > 4) f.recentAbilities.shift();
        if (a.windupTicks > 0) {
          f.windup = { ability: a, targetId: decision.targetId ?? null, x: decision.x ?? f.x, z: decision.z ?? f.z, resolveTick: this.tick + a.windupTicks };
          this.emit('ABILITY_STARTED', { fighterId: f.fighterId, abilityId: a.id, name: a.name, target: decision.targetId, windup: a.windupTicks });
        } else {
          this.emit('ABILITY_STARTED', { fighterId: f.fighterId, abilityId: a.id, name: a.name, target: decision.targetId, windup: 0 });
          this.resolveAbility(f, a, decision.targetId ?? null, decision.x ?? f.x, decision.z ?? f.z);
        }
        break;
      }
      case 'guard':
        f.guarding = true;
        break;
      case 'protect': {
        const ally = this.byId(decision.targetId!);
        if (ally && ally.status === 'active') {
          f.moveIntent = { mode: 'point', x: ally.x, z: ally.z };
          this.applyCondition(ally, { kind: 'fortified', magnitude: 0.25, durationTicks: 12 }, f.fighterId, true);
          this.emit('ALLY_PROTECTED', { protector: f.fighterId, ally: ally.fighterId });
        }
        break;
      }
      case 'move':
        break; // moveIntent already set by decide()
    }
  }

  private decide(f: FighterRt): {
    action: 'ability' | 'guard' | 'move' | 'protect';
    ability?: Ability;
    targetId?: string;
    x?: number;
    z?: number;
  } {
    const enemies = this.activeOf(this.opponentOf(f.teamId));
    const allies = this.activeOf(f.teamId).filter((a) => a.fighterId !== f.fighterId);
    if (enemies.length === 0) return { action: 'guard' };

    const cmd = this.commandFor(f);
    const target = this.selectTarget(f, enemies, cmd);
    f.currentTargetId = target?.fighterId ?? null;
    const suppressed = this.suppressedTags(f);
    const mods = this.wildcardMods(f);

    interface Candidate {
      score: number;
      action: 'ability' | 'guard' | 'move' | 'protect';
      ability?: Ability;
      targetId?: string;
      x?: number;
      z?: number;
    }
    const candidates: Candidate[] = [];
    const vitPct = f.vitality / f.dna.resources.vitality;
    const risk = f.dna.behavior.constraints.includes('reckless') ? 1 : f.dna.behavior.riskTolerance;
    const aggression =
      (cmd?.kind === 'press_attack' ? 1.35 : 1) *
      (cmd?.kind === 'disengage' ? 0.4 : 1) *
      (0.75 + risk * 0.5) *
      (vitPct < 0.3 && risk < 0.5 ? 0.6 : 1);

    const abilities = this.usableAbilities(f, suppressed);
    for (const a of abilities) {
      if (a.kind === 'support' || (a.kind === 'summon' && a.targeting !== 'enemy')) {
        const allyTarget = this.bestSupportTarget(f, allies, a);
        if (!allyTarget && a.targeting === 'ally') continue;
        const missing = allyTarget ? 1 - allyTarget.vitality / allyTarget.dna.resources.vitality : 0.3;
        const inRange = !allyTarget || this.distTo(f, allyTarget) <= a.range;
        // Shields/buffs carry value beyond raw heal power — score their effects too,
        // so power-0 barrier abilities are actually used.
        const effectValue = (a.effects ?? []).reduce((s, e) => {
          if (e.kind === 'shield') return s + e.magnitude * 0.8;
          if (e.kind === 'regen') return s + e.magnitude * Math.min(e.durationTicks, 40) * 0.5;
          if (e.kind === 'fortified' || e.kind === 'empower' || e.kind === 'haste') return s + 14;
          return s;
        }, 0);
        const score =
          (a.power * (0.5 + missing * 2.2) + effectValue * (0.7 + missing)) *
          (inRange ? 1 : 0.35) * this.repPenalty(f, a) * this.jitter();
        candidates.push(
          inRange
            ? { score, action: 'ability', ability: a, targetId: allyTarget?.fighterId ?? f.fighterId }
            : { score, action: 'move', x: allyTarget!.x, z: allyTarget!.z },
        );
        continue;
      }
      if (a.kind === 'movement') {
        if (!target) continue;
        const d = this.distTo(f, target);
        const best = this.bestAttackRange(f, suppressed);
        const needGap = d > best + 6;
        const needEscape = vitPct < 0.35 && risk < 0.6 && d < 6;
        if (!needGap && !needEscape) continue;
        candidates.push({ score: 22 * this.repPenalty(f, a) * this.jitter(), action: 'ability', ability: a, targetId: target.fighterId });
        continue;
      }
      // Offensive
      if (!target) continue;
      if (!this.targetReachable(f, a, target, mods)) continue;
      const d = this.distTo(f, target);
      const inRange = d <= a.range + 0.5;
      const weaknessMult = this.knownWeaknessBonus(f, a, target);
      const hitEst = this.estimateHit(f, a, target, mods);
      const isEscalation = a.id === f.dna.capabilities.escalation.id;
      if (isEscalation) {
        const enemyPct = this.teamVitalityPct(this.opponentOf(f.teamId));
        const desperate = vitPct < 0.4 || enemyPct < 0.4 || this.escalationMult > 1.01;
        if (!desperate) continue;
      }
      const aoeBonus = a.kind === 'area' ? Math.min(3, this.enemiesNear(target, a.radius ?? 4).length) : 1;
      let score = a.power * hitEst * weaknessMult * aoeBonus * aggression * this.repPenalty(f, a) * this.jitter();
      if (isEscalation) score *= 1.6;
      if (!inRange) {
        candidates.push({ score: score * 0.55, action: 'move', targetId: target.fighterId, x: target.x, z: target.z });
      } else {
        candidates.push({ score, action: 'ability', ability: a, targetId: target.fighterId });
      }
    }

    // Counterplay: attack an enemy wildcard object or deployable hurting us.
    if (f.dna.attributes.tacticalIntelligence >= 5) {
      const obj = this.harmfulObjectNear(f);
      if (obj) {
        const basic = abilities.find((a) => (a.kind === 'ranged' || a.kind === 'melee') && this.objDist(f, obj) <= a.range + 0.5);
        if (basic)
          candidates.push({ score: 30 * (f.dna.attributes.tacticalIntelligence / 6) * this.jitter(), action: 'ability', ability: basic, targetId: `obj:${obj.id}` });
        else candidates.push({ score: 24 * this.jitter(), action: 'move', x: obj.x, z: obj.z });
      }
    }

    // Guard when pressured.
    const pressure = enemies.filter((e) => this.distTo(f, e) < 8).length;
    if (pressure >= 2 || f.stability < f.dna.resources.stability * 0.35)
      candidates.push({ score: 14 * (1.6 - risk) * (cmd?.kind === 'press_attack' ? 0.4 : 1) * this.jitter(), action: 'guard' });

    // Protect captain / commanded ally.
    const protectTargetId =
      cmd?.kind === 'protect_ally' ? cmd.targetFighterId :
      f.dna.behavior.constraints.includes('protects_captain') ? this.teamOf(f.teamId).captainId : null;
    if (protectTargetId && protectTargetId !== f.fighterId) {
      const ally = this.byId(protectTargetId);
      if (ally && ally.status === 'active' && ally.vitality / ally.dna.resources.vitality < 0.6) {
        const urgency = 1 - ally.vitality / ally.dna.resources.vitality;
        candidates.push({ score: 20 * urgency * (0.5 + f.dna.behavior.allyProtection) * this.jitter(), action: 'protect', targetId: protectTargetId });
      }
    }

    // Movement fallback / command movement.
    if (cmd?.kind === 'disengage') {
      f.moveIntent = { mode: 'retreat' };
      candidates.push({ score: 16 * this.jitter(), action: 'move' });
    } else if (cmd?.kind === 'regroup') {
      const cap = this.byId(this.teamOf(f.teamId).captainId);
      if (cap && cap.status === 'active') f.moveIntent = { mode: 'point', x: cap.x, z: cap.z };
      candidates.push({ score: 12 * this.jitter(), action: 'move' });
    } else if (target) {
      const best = this.bestAttackRange(f, suppressed);
      f.moveIntent = { mode: 'approach', targetId: target.fighterId, desiredRange: best };
      candidates.push({ score: 6 * this.jitter(), action: 'move' });
    }

    candidates.sort((a, b) => b.score - a.score);
    const chosen = candidates[0] ?? { score: 0, action: 'guard' as const };
    if (chosen.action === 'move' && chosen.x !== undefined && chosen.z !== undefined && !chosen.targetId)
      f.moveIntent = { mode: 'point', x: chosen.x, z: chosen.z };
    else if (chosen.action === 'move' && chosen.targetId) {
      const t = this.byId(chosen.targetId);
      if (t) f.moveIntent = { mode: 'approach', targetId: t.fighterId, desiredRange: this.bestAttackRange(f, suppressed) };
    }
    return chosen;
  }

  private usableAbilities(f: FighterRt, suppressed: Set<string>): Ability[] {
    const caps = f.dna.capabilities;
    const all = [...caps.foundational, ...caps.signature, ...caps.contextual, caps.escalation];
    const ctx = new Set([...this.matchContext, ...f.personalContext]);
    return all.filter((a) => {
      if ((f.cooldowns[a.id] ?? 0) > this.tick) return false;
      if (a.tags.some((t) => suppressed.has(t))) return false;
      if (a.requiresContext && !a.requiresContext.every((t) => ctx.has(t))) return false;
      const pool = a.cost.resource === 'stamina' ? f.stamina : f.primary?.name === a.cost.resource ? f.primary.value : 0;
      if (a.cost.amount > 0 && pool < a.cost.amount) return false;
      return true;
    });
  }

  /**
   * Static maximum offensive reach of a fighter's whole kit (cooldowns and
   * suppression ignored — deterministic and stable across a match). Drives
   * the approach guard: beyond this distance the fighter cannot answer back.
   */
  private kitRangeCache = new Map<string, number>();
  private kitMaxRange(f: FighterRt): number {
    let r = this.kitRangeCache.get(f.fighterId);
    if (r === undefined) {
      const caps = f.dna.capabilities;
      r = 0;
      for (const a of [...caps.foundational, ...caps.signature, ...caps.contextual, caps.escalation]) {
        if ((a.kind === 'melee' || a.kind === 'ranged' || a.kind === 'area') && a.range > r) r = a.range;
      }
      this.kitRangeCache.set(f.fighterId, r);
    }
    return r;
  }

  private bestAttackRange(f: FighterRt, suppressed: Set<string>): number {
    const offensive = this.usableAbilities(f, suppressed).filter((a) => a.kind === 'melee' || a.kind === 'ranged' || a.kind === 'area');
    if (offensive.length === 0) return MELEE_RANGE;
    return Math.max(...offensive.map((a) => a.range)) * 0.85;
  }

  private selectTarget(f: FighterRt, enemies: FighterRt[], cmd: ActiveCommand | null): FighterRt | null {
    if (enemies.length === 0) return null;
    if (cmd?.kind === 'focus_target' && cmd.targetFighterId) {
      const t = this.byId(cmd.targetFighterId);
      if (t && t.status === 'active') return t;
    }
    const current = f.currentTargetId ? this.byId(f.currentTargetId) : null;
    const score = (e: FighterRt) => {
      let s = 10;
      const d = this.distTo(f, e);
      s -= d * 0.25;
      if (e.stealthed) s -= 6;
      switch (f.dna.behavior.targetPreference) {
        case 'lowest_vitality': s += (1 - e.vitality / e.dna.resources.vitality) * 8; break;
        case 'highest_threat': s += e.dna.attributes.forceOutput * 0.8; break;
        case 'support_first': s += e.dna.identity.role === 'support' || e.dna.identity.role === 'controller' ? 7 : 0; break;
        case 'isolated': s += Math.min(...this.activeOf(e.teamId).filter((m) => m !== e).map((m) => this.distTo(e, m)), 30) * 0.3; break;
        case 'nearest': default: s += (20 - d) * 0.2; break;
      }
      return s;
    };
    const sorted = [...enemies].sort((a, b) => score(b) - score(a));
    if (current && current.status === 'active' && score(current) >= score(sorted[0]) - 2.5) return current;
    return sorted[0];
  }

  private bestSupportTarget(f: FighterRt, allies: FighterRt[], a: Ability): FighterRt | null {
    if (a.targeting === 'self') return f;
    const pool = [...allies, f].filter((x) => x.status === 'active');
    if (pool.length === 0) return null;
    return [...pool].sort(
      (x, y) => x.vitality / x.dna.resources.vitality - y.vitality / y.dna.resources.vitality,
    )[0];
  }

  private commandFor(f: FighterRt): ActiveCommand | null {
    for (let i = this.activeCommands.length - 1; i >= 0; i--) {
      const c = this.activeCommands[i];
      if (c.teamId === f.teamId && c.compliantIds.includes(f.fighterId)) return c;
    }
    return null;
  }

  private constraintRejection(f: FighterRt, cmd: TacticalCommand): string | null {
    const cons = f.dna.behavior.constraints;
    if (cmd.kind === 'disengage' && cons.includes('never_retreats')) return `${f.dna.identity.fighterId} never retreats`;
    if ((cmd.kind === 'disengage' || cmd.kind === 'regroup') && cons.includes('never_abandons_allies')) {
      const endangered = this.activeOf(f.teamId).some(
        (a) => a.fighterId !== f.fighterId && a.vitality / a.dna.resources.vitality < 0.35,
      );
      if (endangered) return 'refuses to abandon an endangered ally';
    }
    if (cmd.kind === 'focus_target' && cons.includes('hunts_strongest') && cmd.targetFighterId) {
      const enemies = this.activeOf(this.opponentOf(f.teamId));
      const weakest = [...enemies].sort((a, b) => a.vitality - b.vitality)[0];
      if (weakest && weakest.fighterId === cmd.targetFighterId) return 'refuses to gang up on the weakest opponent';
    }
    return null;
  }

  private repPenalty(f: FighterRt, a: Ability): number {
    const uses = f.recentAbilities.filter((id) => id === a.id).length;
    return 1 - Math.min(0.6, uses * 0.3 * f.dna.behavior.repetitionAvoidance);
  }

  private jitter(): number {
    return 0.9 + this.rng.next() * 0.2;
  }

  private knownWeaknessBonus(f: FighterRt, a: Ability, target: FighterRt): number {
    const knows = f.dna.attributes.tacticalIntelligence >= 6 || this.weaknessKnownBy[f.teamId].has(target.fighterId);
    if (!knows) return 1;
    for (const w of target.dna.weaknesses) {
      if (a.damageType && w.trigger.damageTypes?.includes(a.damageType)) return 1.35;
      if (w.trigger.abilityTags?.some((t) => a.tags.includes(t))) return 1.35;
    }
    return 1;
  }

  private targetReachable(f: FighterRt, a: Ability, target: FighterRt, mods: { grounded: boolean }): boolean {
    if (a.kind !== 'melee') return true;
    if (target.alt <= 0) return true;
    const airCapable = f.dna.movementModes.some((m) => m === 'flight' || m === 'hover' || m === 'leap');
    return airCapable && !mods.grounded && !this.hasCondition(f, 'grounded');
  }

  private estimateHit(f: FighterRt, a: Ability, target: FighterRt, mods: { accuracyDelta: number }): number {
    return this.hitChance(f, a, target, mods.accuracyDelta);
  }

  private hitChance(f: FighterRt, a: Ability, target: FighterRt, accuracyDelta: number): number {
    let mobility: number = target.dna.attributes.mobility;
    if (this.hasCondition(target, 'root') || this.hasCondition(target, 'stun') || this.hasCondition(target, 'stagger')) mobility = 0;
    else if (this.hasCondition(target, 'slow')) mobility = Math.max(0, mobility - 2);
    let p = 0.74 + (f.dna.attributes.precision - mobility) * 0.03 + accuracyDelta;
    for (const c of f.conditions) if (c.kind === 'blind') p -= c.magnitude;
    if (target.stealthed) p -= 0.35;
    const targetMods = this.wildcardMods(target);
    if (targetMods.stealthBonus > 0 && target.stealthed) p -= targetMods.stealthBonus;
    if (target.alt > 0) {
      const evasive = target.dna.capabilities.passives.find((x) => x.kind === 'evasive_flier');
      if (evasive && !this.passiveSuppressed(target, evasive.tags)) p -= evasive.magnitude;
    }
    if (this.hasCondition(target, 'stun') || this.hasCondition(target, 'stagger')) p += 0.25;
    return clamp(p, 0.15, 0.97);
  }

  // -------------------------------------------------------------------------
  // Ability resolution
  // -------------------------------------------------------------------------

  private payCost(f: FighterRt, a: Ability) {
    if (a.cost.amount <= 0) return;
    if (a.cost.resource === 'stamina') f.stamina = Math.max(0, f.stamina - a.cost.amount);
    else if (f.primary?.name === a.cost.resource) f.primary.value = Math.max(0, f.primary.value - a.cost.amount);
  }

  private resolveAbility(f: FighterRt, a: Ability, targetId: string | null, x: number, z: number) {
    if (f.status !== 'active') return;
    // Wildcard-object / deployable target
    if (targetId?.startsWith('obj:')) {
      this.resolveObjectAttack(f, a, targetId.slice(4));
      return;
    }
    if (f.stealthed && a.kind !== 'movement') {
      f.stealthed = false;
      // Strike from the dark (ruleset 0.3.0): this resolution's hits are an
      // ambush for stealth_field fighters (applyHit reads the tick marker).
      f.ambushTick = this.tick;
    }
    f.lastCombatTick = this.tick;

    for (const s of a.selfEffects ?? []) this.applyCondition(f, s, f.fighterId, true);

    if (a.kind === 'movement') {
      const target = targetId ? this.byId(targetId) : null;
      if (target) {
        const d = this.distTo(f, target);
        const dir = d > 0 ? { x: (target.x - f.x) / d, z: (target.z - f.z) / d } : { x: 1, z: 0 };
        const vitPct = f.vitality / f.dna.resources.vitality;
        const sign = vitPct < 0.35 && f.dna.behavior.riskTolerance < 0.6 ? -1 : 1;
        const hop = Math.min(a.range, sign > 0 ? Math.max(0, d - MELEE_RANGE + 1) : a.range);
        f.x = clamp(f.x + dir.x * hop * sign, -this.arena.sizeX / 2, this.arena.sizeX / 2);
        f.z = clamp(f.z + dir.z * hop * sign, -this.arena.sizeZ / 2, this.arena.sizeZ / 2);
      }
      this.emit('ABILITY_RESOLVED', { fighterId: f.fighterId, abilityId: a.id, name: a.name, kind: a.kind });
      return;
    }

    if (a.kind === 'summon') {
      const isHostile = a.targeting === 'enemy' || a.targeting === 'point';
      this.deployables.push({
        instanceId: `dep_${this.instanceCounter++}`,
        name: a.name,
        ownerFighterId: f.fighterId,
        teamId: f.teamId,
        x: f.x + this.rng.range(-2, 2),
        z: f.z + this.rng.range(-2, 2),
        hp: Math.max(20, a.power),
        radius: a.radius ?? 6,
        healPerTick: isHostile ? 0 : Math.max(1, Math.round(a.power / 25)),
        dpsPerTick: isHostile ? Math.max(1, Math.round(a.power / 25)) : 0,
        damageType: 'energy',
        expiresTick: this.tick + Math.max(...(a.effects ?? []).map((e) => e.durationTicks), 80),
        destroyed: false,
      });
      this.emit('ABILITY_RESOLVED', { fighterId: f.fighterId, abilityId: a.id, name: a.name, kind: a.kind });
      return;
    }

    if (a.kind === 'support') {
      const target = targetId ? this.byId(targetId) : f;
      if (!target || target.status !== 'active') return;
      let healed = 0;
      const shieldSpec = (a.effects ?? []).find((e) => e.kind === 'shield');
      if (!shieldSpec || a.power > 0) {
        healed = Math.min(a.power * this.escalationHealMult, target.dna.resources.vitality - target.vitality);
        target.vitality += healed;
        f.healingDone += healed;
      }
      for (const e of a.effects ?? []) this.applyCondition(target, e, f.fighterId, true);
      this.emit('HEALING_APPLIED', { source: f.fighterId, target: target.fighterId, abilityId: a.id, amount: Math.round(healed) });
      this.emit('ABILITY_RESOLVED', { fighterId: f.fighterId, abilityId: a.id, name: a.name, kind: a.kind });
      return;
    }

    // Offensive: melee / ranged / area / control
    const mods = this.wildcardMods(f);
    let victims: FighterRt[] = [];
    if (a.kind === 'area') {
      const cx = targetId ? this.byId(targetId)?.x ?? x : x;
      const cz = targetId ? this.byId(targetId)?.z ?? z : z;
      victims = this.activeOf(this.opponentOf(f.teamId)).filter((e) => dist2(e.x, e.z, cx, cz) <= (a.radius ?? 4) ** 2);
      this.damageFeaturesNear(cx, cz, a.radius ?? 4, a.power, f);
      this.damageObjectsNear(cx, cz, a.radius ?? 4, a.power);
    } else {
      const t = targetId ? this.byId(targetId) : null;
      if (!t || t.status !== 'active') {
        this.emit('ABILITY_INTERRUPTED', { fighterId: f.fighterId, abilityId: a.id, reason: 'target lost' });
        return;
      }
      if (this.distTo(f, t) > a.range * 1.25 + 1) {
        this.emit('ABILITY_INTERRUPTED', { fighterId: f.fighterId, abilityId: a.id, reason: 'out of range' });
        return;
      }
      victims = [t];
    }

    for (const v of victims) {
      const hc = this.hitChance(f, a, v, mods.accuracyDelta);
      if (!this.rng.chance(hc)) {
        this.emit('ATTACK_EVADED', { attacker: f.fighterId, target: v.fighterId, abilityId: a.id });
        continue;
      }
      this.applyHit(f, a, v);
    }
    this.emit('ABILITY_RESOLVED', { fighterId: f.fighterId, abilityId: a.id, name: a.name, kind: a.kind, victims: victims.length });
  }

  private applyHit(f: FighterRt, a: Ability, v: FighterRt) {
    let empower = 1;
    for (const c of f.conditions) if (c.kind === 'empower') empower *= 1 + c.magnitude;
    let raw = a.power * (0.7 + f.dna.attributes.forceOutput * 0.06) * empower * this.escalationMult * f.envDamageMult * f.synergyDamageMult;

    // Strike from the dark (ruleset 0.3.0): a stealth_field fighter's hits on
    // the resolution that broke stealth land as an ambush.
    const ambush =
      this.ruleset.stealthAmbushBonus > 0 &&
      f.ambushTick === this.tick &&
      f.dna.capabilities.passives.some((p) => p.kind === 'stealth_field' && !this.passiveSuppressed(f, p.tags));
    if (ambush) raw *= 1 + this.ruleset.stealthAmbushBonus;

    // resistances
    let resist = 1;
    if (a.damageType) {
      const r = v.dna.defenses.resistances.find((x) => x.damageType === a.damageType);
      if (r) resist *= 1 - r.pct;
    }
    // weaknesses
    let weaknessMult = 1;
    const victimCtx = new Set([...this.matchContext, ...v.personalContext]);
    for (const w of v.dna.weaknesses) {
      const hitByType = a.damageType && w.trigger.damageTypes?.includes(a.damageType);
      const hitByTag = w.trigger.abilityTags?.some((t) => a.tags.includes(t));
      const hitByEnv = w.trigger.envTags?.some((t) => victimCtx.has(t));
      if (!hitByType && !hitByTag && !hitByEnv) continue;
      weaknessMult = Math.max(weaknessMult, SEV_MULT[w.severity]);
      v.weaknessesTriggeredAgainst += 1;
      this.weaknessKnownBy[f.teamId].add(v.fighterId);
      this.emit('WEAKNESS_TRIGGERED', { fighterId: v.fighterId, weaknessId: w.id, by: f.fighterId, abilityId: a.id, severity: w.severity });
      const key = `${v.fighterId}:${w.id}`;
      this.weaknessDamage[key] = (this.weaknessDamage[key] ?? 0) + raw * (SEV_MULT[w.severity] - 1);
      if (w.effect.applyCondition) this.applyCondition(v, w.effect.applyCondition, f.fighterId, false);
      if (w.effect.suppressTags?.length)
        this.applyCondition(v, { kind: 'suppress', magnitude: 0, durationTicks: 24, tags: w.effect.suppressTags }, f.fighterId, false);
      if (w.effect.damageTakenMult) weaknessMult = Math.max(weaknessMult, w.effect.damageTakenMult);
    }

    let taken = 1;
    for (const c of v.conditions) {
      if (c.kind === 'vulnerable') taken *= 1 + c.magnitude;
      if (c.kind === 'fortified') taken *= 1 - c.magnitude;
    }
    taken *= v.envDamageTakenMult;

    // cover vs ranged
    if ((a.kind === 'ranged' || a.kind === 'area') && this.distTo(f, v) > 6 && this.nearIntactCover(v)) taken *= 0.75;

    // approach guard (ruleset 0.3.0): a fighter closing on the enemy while
    // out-gunned — attacker beyond the fighter's own maximum kit range —
    // takes reduced ranged/area fire (the melee approach-tax counterweight)
    let approachGuarded = false;
    if (
      this.ruleset.approachGuardReduction > 0 &&
      (a.kind === 'ranged' || a.kind === 'area') &&
      v.moveIntent.mode === 'approach' &&
      this.distTo(f, v) > this.kitMaxRange(v)
    ) {
      taken *= 1 - this.ruleset.approachGuardReduction;
      approachGuarded = true;
    }

    let final = raw * resist * weaknessMult * taken;
    let stabilityDmg = final * 0.5;
    if (v.guarding) {
      const mastery = v.dna.capabilities.passives.find((p) => p.kind === 'guard_mastery');
      const guardFactor = mastery ? 0.3 : 0.45;
      stabilityDmg = final * 0.85;
      final *= guardFactor;
    }

    // shields absorb
    for (const c of v.conditions) {
      if (c.kind !== 'shield' || final <= 0) continue;
      const absorbed = Math.min(c.magnitude, final);
      c.magnitude -= absorbed;
      final -= absorbed;
    }
    v.conditions = v.conditions.filter((c) => !(c.kind === 'shield' && c.magnitude <= 0));

    v.vitality -= final;
    v.stability -= stabilityDmg;
    v.lastCombatTick = this.tick;
    if (v.stealthed) v.stealthed = false;
    f.damageDealt += final;
    v.damageTaken += final;
    const cmd = this.commandFor(f);
    if (cmd) cmd.damageDuring += final;

    // approachGuarded only exists when the guard fired — pre-0.3.0 manifests
    // (guard reduction 0) must replay to byte-identical events and hashes.
    this.emit('DAMAGE_APPLIED', {
      attacker: f.fighterId,
      target: v.fighterId,
      abilityId: a.id,
      amount: Math.round(final),
      damageType: a.damageType,
      guarded: v.guarding,
      ...(approachGuarded ? { approachGuarded: true } : {}),
      ...(ambush ? { ambush: true } : {}),
    });

    for (const e of a.effects ?? []) this.applyCondition(v, e, f.fighterId, false);

    if (v.stability <= 0 && v.status === 'active') {
      v.stability = v.dna.resources.stability * 0.4;
      this.applyCondition(v, { kind: 'stagger', magnitude: 0, durationTicks: 3 }, f.fighterId, false);
      this.emit('STABILITY_BROKEN', { fighterId: v.fighterId, by: f.fighterId });
    }

    // counter-attack passive
    const counter = v.dna.capabilities.passives.find((p) => p.kind === 'counter_attack');
    if (counter && a.kind === 'melee' && v.status === 'active' && !this.hasCondition(v, 'stagger') &&
        !this.passiveSuppressed(v, counter.tags) && this.rng.chance(counter.magnitude)) {
      const cdmg = 6 * (0.7 + v.dna.attributes.forceOutput * 0.06);
      f.vitality -= cdmg;
      v.damageDealt += cdmg;
      f.damageTaken += cdmg;
      this.emit('DAMAGE_APPLIED', { attacker: v.fighterId, target: f.fighterId, abilityId: counter.id, amount: Math.round(cdmg), damageType: 'kinetic', guarded: false, counter: true });
      if (f.vitality <= 0) this.knockOut(f, `countered by ${v.fighterId}`);
    }

    if (v.vitality <= 0) this.knockOut(v, `defeated by ${f.fighterId}`);
  }

  /** Silent refresh (no event spam) for aura-style conditions. */
  private refreshCondition(target: FighterRt, spec: ConditionSpec, sourceId: string) {
    const existing = target.conditions.find((c) => c.kind === spec.kind && c.sourceFighterId === sourceId);
    if (existing) {
      existing.remainingTicks = Math.max(existing.remainingTicks, spec.durationTicks);
      existing.magnitude = Math.max(existing.magnitude, spec.magnitude);
    } else {
      target.conditions.push({ ...spec, remainingTicks: spec.durationTicks, sourceFighterId: sourceId });
    }
  }

  private applyCondition(target: FighterRt, spec: ConditionSpec, sourceId: string, friendly: boolean) {
    if (target.status !== 'active') return;
    if (target.dna.defenses.immunities.includes(spec.kind)) return;
    if (spec.kind === 'contained') {
      if (target.vitality / target.dna.resources.vitality <= 0.35) {
        target.status = 'contained';
        target.koTick = this.tick;
        target.conditions = [];
        this.emit('FIGHTER_CONTAINED', { fighterId: target.fighterId, by: sourceId });
        return;
      }
      // Not weak enough to contain — becomes a root instead.
      spec = { kind: 'root', magnitude: 0, durationTicks: Math.min(spec.durationTicks, 12) };
    }
    const existing = target.conditions.find((c) => c.kind === spec.kind && (spec.kind !== 'suppress' || sameTags(c.tags, spec.tags)));
    if (existing) {
      existing.remainingTicks = Math.max(existing.remainingTicks, spec.durationTicks);
      existing.magnitude = Math.max(existing.magnitude, spec.magnitude);
    } else {
      target.conditions.push({ ...spec, remainingTicks: spec.durationTicks, sourceFighterId: sourceId });
    }
    this.emit('CONDITION_APPLIED', { fighterId: target.fighterId, kind: spec.kind, magnitude: spec.magnitude, duration: spec.durationTicks, by: sourceId, friendly });
  }

  private dealRawDamage(f: FighterRt, amount: number, damageType: string, source: string) {
    if (f.status !== 'active' || amount <= 0) return;
    const r = f.dna.defenses.resistances.find((x) => x.damageType === damageType);
    const final = amount * (r ? 1 - r.pct : 1);
    f.vitality -= final;
    f.damageTaken += final;
    this.emit('DAMAGE_APPLIED', { attacker: source, target: f.fighterId, abilityId: source, amount: Math.round(final), damageType, guarded: false });
    if (f.vitality <= 0) this.knockOut(f, source);
  }

  private resolveObjectAttack(f: FighterRt, a: Ability, objId: string) {
    f.lastCombatTick = this.tick;
    if (f.stealthed) f.stealthed = false;
    const dmg = a.power * (0.7 + f.dna.attributes.forceOutput * 0.06);
    const inst = this.wildcardInstances.find((w) => w.instanceId === objId && !w.destroyed && !w.expired);
    if (inst && inst.hp > 0) {
      inst.hp -= dmg;
      this.emit('ABILITY_RESOLVED', { fighterId: f.fighterId, abilityId: a.id, name: a.name, kind: a.kind, objectTarget: inst.contract.normalizedName });
      if (inst.hp <= 0) {
        inst.destroyed = true;
        this.emit('WILDCARD_DESTROYED', { wildcardId: inst.contract.wildcardId, name: inst.contract.normalizedName, by: f.fighterId });
        this.recomputeContext();
      }
      return;
    }
    const dep = this.deployables.find((d) => d.instanceId === objId && !d.destroyed);
    if (dep) {
      dep.hp -= dmg;
      this.emit('ABILITY_RESOLVED', { fighterId: f.fighterId, abilityId: a.id, name: a.name, kind: a.kind, objectTarget: dep.name });
      if (dep.hp <= 0) dep.destroyed = true;
    }
  }

  private damageFeaturesNear(x: number, z: number, radius: number, power: number, by: FighterRt) {
    for (const feat of this.features) {
      if (feat.destroyed || !feat.destructible) continue;
      if (dist2(feat.x, feat.z, x, z) > (radius + feat.radius) ** 2) continue;
      feat.currentHp -= power;
      if (feat.currentHp <= 0) {
        feat.destroyed = true;
        this.emit('FEATURE_DESTROYED', { featureId: feat.id, by: by.fighterId, type: feat.type });
      }
    }
  }

  private damageObjectsNear(x: number, z: number, radius: number, power: number) {
    for (const inst of this.wildcardInstances) {
      if (inst.destroyed || inst.expired || inst.hp <= 0) continue;
      if (dist2(inst.x, inst.z, x, z) > (radius + 1.5) ** 2) continue;
      inst.hp -= power;
      if (inst.hp <= 0) {
        inst.destroyed = true;
        this.emit('WILDCARD_DESTROYED', { wildcardId: inst.contract.wildcardId, name: inst.contract.normalizedName, by: 'area damage' });
        this.recomputeContext();
      }
    }
  }

  private harmfulObjectNear(f: FighterRt): { id: string; x: number; z: number } | null {
    for (const inst of this.wildcardInstances) {
      if (inst.destroyed || inst.expired || inst.hp <= 0 || inst.ownerTeamId === f.teamId) continue;
      const inArea = inst.contract.deployment === 'global' || dist2(f.x, f.z, inst.x, inst.z) <= (inst.contract.radius + 6) ** 2;
      const harmful = inst.contract.effects.some(
        (e) => (e.affects === 'enemies' || e.affects === 'both') && e.kind !== 'hot' && e.kind !== 'stealth_bonus',
      );
      if (inArea && harmful) return { id: inst.instanceId, x: inst.x, z: inst.z };
    }
    for (const dep of this.deployables) {
      if (dep.destroyed || dep.teamId === f.teamId) continue;
      if (dist2(f.x, f.z, dep.x, dep.z) <= (dep.radius + 6) ** 2) return { id: dep.instanceId, x: dep.x, z: dep.z };
    }
    return null;
  }

  private objDist(f: FighterRt, obj: { x: number; z: number }): number {
    return Math.sqrt(dist2(f.x, f.z, obj.x, obj.z));
  }

  private nearIntactCover(f: FighterRt): boolean {
    return this.features.some(
      (feat) => !feat.destroyed && (feat.type === 'cover' || feat.type === 'pillar') &&
        dist2(f.x, f.z, feat.x, feat.z) <= (feat.radius + 1.5) ** 2,
    );
  }

  // -------------------------------------------------------------------------
  // Movement
  // -------------------------------------------------------------------------

  private moveFighter(f: FighterRt) {
    if (this.hasCondition(f, 'stun') || this.hasCondition(f, 'root') || this.hasCondition(f, 'stagger')) return;
    const mods = this.wildcardMods(f);
    // Hover stays a hand's breadth up (ruleset 0.3.0): melee-reachable ground
    // altitude; only true flight climbs. Pre-0.3.0 counted hover as flight.
    const airMode = f.dna.movementModes.includes('flight') ||
      (!this.ruleset.hoverStaysLow && f.dna.movementModes.includes('hover'));
    const canFly = airMode && !mods.grounded && !this.hasCondition(f, 'grounded');
    // Altitude preference: fliers stay up unless grounded (flight-fatigue
    // grounding is applied in tickResources — stamina upkeep, ruleset 0.3.0).
    f.alt = canFly ? 3 : 0;

    let speed = (1.5 + f.dna.attributes.travelSpeed * 0.45) * f.envSpeedMult * mods.speedMult;
    for (const c of f.conditions) {
      if (c.kind === 'slow') speed *= 1 - c.magnitude;
      if (c.kind === 'haste') speed *= 1 + c.magnitude;
    }
    // terrain: water slows non-fliers without aquatic affinity (hover floats
    // above it when hoverStaysLow keeps hoverers at ground altitude)
    const hoverExempt = this.ruleset.hoverStaysLow && f.dna.movementModes.includes('hover');
    if (f.alt === 0 && !hoverExempt && !f.dna.interactions.powerTags.includes('hydro')) {
      const inWater = this.features.some(
        (feat) => !feat.destroyed && feat.type === 'water' && dist2(f.x, f.z, feat.x, feat.z) <= feat.radius ** 2,
      ) || this.wildcardInstances.some(
        (w) => !w.destroyed && !w.expired && w.contract.class === 'terrain' &&
          w.contract.effects.some((e) => e.kind === 'add_context_tags' && (e.tags ?? []).includes('water_present')) &&
          (w.contract.deployment === 'global' || dist2(f.x, f.z, w.x, w.z) <= w.contract.radius ** 2),
      );
      if (inWater) speed *= 0.65;
    }
    let stepLen = speed * (this.ruleset.tickMs / 1000);

    let dx = 0, dz = 0;
    const mi = f.moveIntent;
    if (mi.mode === 'approach') {
      const t = this.byId(mi.targetId);
      if (t && t.status === 'active') {
        const d = this.distTo(f, t);
        // approach surge (ruleset 0.3.0): the out-gunned closer crosses dead
        // ground faster — same trigger condition as the approach damage guard
        if (this.ruleset.approachSpeedSurge > 0 && d > this.kitMaxRange(f)) {
          stepLen *= 1 + this.ruleset.approachSpeedSurge;
        }
        if (d > mi.desiredRange) { dx = t.x - f.x; dz = t.z - f.z; }
        else if (d < mi.desiredRange * 0.5 && f.dna.identity.role === 'artillery') { dx = f.x - t.x; dz = f.z - t.z; }
      }
    } else if (mi.mode === 'retreat') {
      const side = this.teams[0].playerId === f.teamId ? -1 : 1;
      dx = side * this.arena.sizeX / 2 - f.x;
      dz = -f.z * 0.3;
    } else if (mi.mode === 'point') {
      dx = mi.x - f.x;
      dz = mi.z - f.z;
    }
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len > 0.5) {
      f.x = clamp(f.x + (dx / len) * stepLen, -this.arena.sizeX / 2, this.arena.sizeX / 2);
      f.z = clamp(f.z + (dz / len) * stepLen, -this.arena.sizeZ / 2, this.arena.sizeZ / 2);
    }
  }

  private applySeparation() {
    const active = this.fighters.filter((f) => f.status === 'active');
    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        const a = active[i], b = active[j];
        if (a.alt !== b.alt) continue;
        const d = Math.sqrt(dist2(a.x, a.z, b.x, b.z));
        if (d >= SEPARATION || d === 0) continue;
        const push = (SEPARATION - d) / 2;
        const nx = (b.x - a.x) / d, nz = (b.z - a.z) / d;
        a.x = clamp(a.x - nx * push, -this.arena.sizeX / 2, this.arena.sizeX / 2);
        a.z = clamp(a.z - nz * push, -this.arena.sizeZ / 2, this.arena.sizeZ / 2);
        b.x = clamp(b.x + nx * push, -this.arena.sizeX / 2, this.arena.sizeX / 2);
        b.z = clamp(b.z + nz * push, -this.arena.sizeZ / 2, this.arena.sizeZ / 2);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Terminal states
  // -------------------------------------------------------------------------

  private knockOut(f: FighterRt, reason: string) {
    if (f.status !== 'active') return;
    f.status = 'ko';
    f.vitality = 0;
    f.koTick = this.tick;
    f.conditions = [];
    f.windup = null;
    this.emit('FIGHTER_KNOCKED_OUT', { fighterId: f.fighterId, teamId: f.teamId, reason });
  }

  private checkVictory() {
    for (const team of this.teams) {
      const remaining = this.fighters.filter(
        (f) => f.teamId === team.playerId && (f.status === 'active' || f.status === 'reserve'),
      );
      if (remaining.length === 0) {
        this.finish(this.opponentOf(team.playerId), 'elimination');
        return;
      }
    }
    if (this.tick >= this.ruleset.hardLimitTicks) {
      // Decision verdict blends survival with delivered damage so raw vitality
      // pools alone cannot farm stalemate wins (Decision Ledger D-011 rev 2).
      const a = this.teams[0].playerId, b = this.teams[1].playerId;
      const da = this.fighters.filter((f) => f.teamId === a).reduce((s, f) => s + f.damageDealt, 0);
      const db = this.fighters.filter((f) => f.teamId === b).reduce((s, f) => s + f.damageDealt, 0);
      const dmgShareA = da + db > 0 ? da / (da + db) : 0.5;
      const scoreA = this.teamVitalityPct(a) * 0.6 + dmgShareA * 0.4;
      const scoreB = this.teamVitalityPct(b) * 0.6 + (1 - dmgShareA) * 0.4;
      this.finish(scoreA >= scoreB ? a : b, 'decision');
    }
  }

  private finish(winnerPlayerId: string, reason: 'elimination' | 'decision') {
    this.over = true;
    const tp = this.turningPoint();
    if (tp) this.emit('TURNING_POINT', { tick: tp.tick, description: tp.description });
    const teamVitalityPct: Record<string, number> = {};
    for (const t of this.teams) teamVitalityPct[t.playerId] = round2(this.teamVitalityPct(t.playerId));
    this.outcome = {
      winnerPlayerId,
      reason,
      finalTick: this.tick,
      teamVitalityPct,
      survivors: this.fighters.filter((f) => f.status === 'active' || f.status === 'reserve').map((f) => f.fighterId),
    };
    this.emit('MATCH_ENDED', { winner: winnerPlayerId, reason, tick: this.tick });
  }

  turningPoint(): { tick: number; description: string } | null {
    if (this.momentum.length < 4) return null;
    let bestIdx = 0, bestSwing = 0;
    const w = 20; // 80-tick window
    for (let i = 0; i < this.momentum.length; i++) {
      const j = Math.min(this.momentum.length - 1, i + w);
      const swing = Math.abs(this.momentum[j].diff - this.momentum[i].diff);
      if (swing > bestSwing) { bestSwing = swing; bestIdx = i; }
    }
    const sample = this.momentum[bestIdx];
    const later = this.momentum[Math.min(this.momentum.length - 1, bestIdx + w)];
    const towardA = later.diff > sample.diff;
    const teamName = towardA ? this.teams[0].displayName : this.teams[1].displayName;
    return {
      tick: sample.tick,
      description: `Momentum swung ${Math.round(bestSwing * 100)}% toward ${teamName} starting around ${formatTick(sample.tick, this.ruleset.tickMs)}`,
    };
  }

  // -------------------------------------------------------------------------
  // Queries & utilities
  // -------------------------------------------------------------------------

  byId(id: string): FighterRt | undefined {
    return this.fighters.find((f) => f.fighterId === id);
  }
  activeOf(teamId: string): FighterRt[] {
    return this.fighters.filter((f) => f.teamId === teamId && f.status === 'active');
  }
  opponentOf(teamId: string): string {
    return this.teams[0].playerId === teamId ? this.teams[1].playerId : this.teams[0].playerId;
  }
  teamOf(teamId: string): TeamSetup {
    return this.teams.find((t) => t.playerId === teamId)!;
  }
  teamVitalityPct(teamId: string): number {
    const roster = this.fighters.filter((f) => f.teamId === teamId);
    const cur = roster.reduce((s, f) => s + Math.max(0, f.vitality), 0);
    const max = roster.reduce((s, f) => s + f.dna.resources.vitality, 0);
    return max > 0 ? cur / max : 0;
  }
  hasCondition(f: FighterRt, kind: string): boolean {
    return f.conditions.some((c) => c.kind === kind);
  }
  distTo(a: FighterRt, b: FighterRt): number {
    return Math.sqrt(dist2(a.x, a.z, b.x, b.z));
  }
  /** Active fighters on `around`'s own team within radius (AoE value estimation). */
  enemiesNear(around: FighterRt, radius: number): FighterRt[] {
    return this.activeOf(around.teamId).filter((f) => dist2(f.x, f.z, around.x, around.z) <= radius * radius);
  }
  commandDamageByTeam(): Record<string, { kind: string; damage: number }[]> {
    const out: Record<string, { kind: string; damage: number }[]> = {};
    for (const c of this.commandHistory) {
      (out[c.teamId] ??= []).push({ kind: c.kind, damage: c.damageDuring });
    }
    return out;
  }
  weaknessDamageMap(): Record<string, number> {
    return { ...this.weaknessDamage };
  }

  private emit(type: MatchEventType, data: MatchEvent['data']) {
    this.events.push({ seq: this.seq++, tick: this.tick, type, data });
  }
}

// ---------------------------------------------------------------------------

function dist2(x1: number, z1: number, x2: number, z2: number): number {
  const dx = x1 - x2, dz = z1 - z2;
  return dx * dx + dz * dz;
}
function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
function sameTags(a?: string[], b?: string[]): boolean {
  return JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
}
export function formatTick(tick: number, tickMs: number): string {
  const s = Math.floor((tick * tickMs) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

