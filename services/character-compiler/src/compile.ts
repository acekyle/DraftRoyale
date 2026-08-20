/**
 * Deterministic rule-based character compiler (Season 0 — ADR-0008).
 * parse() reads a free-text description into a CompileSpec; assemble() turns a
 * CompileSpec into a fully-validated CompiledFighterResult. Corrections
 * round-trip through specFromFighter() so they operate on artifacts alone.
 */
import type {
  Ability,
  BehaviorConstraint,
  CharacterClaim,
  CharacterContract,
  Chassis,
  CombatDNA,
  CompiledFighterResult,
  ConditionSpec,
  DamageType,
  FighterFile,
  MovementMode,
  Passive,
  Role,
  Tier,
  Weakness,
} from '@arena/contracts';
import { COMBAT_DNA_SCHEMA_VERSION, CONTRACT_SCHEMA_VERSION } from '@arena/contracts';
import { computePrice } from '@arena/combat-sim';
import { clamp, fnv1a32, frange, hex4, irange, pick, rngFor, round2, slugify } from './hash';
import { FAMILIES, FAMILY_ATTR, FAMILY_KEYS, type FamilyDef, type KitSlot } from './families';
import {
  ADJECTIVES,
  ATTRIBUTE_SUM_CAP,
  CELEBRITIES,
  CHASSIS_KEYWORDS,
  COLOR_WORDS,
  CONSTRAINT_CUES,
  DEFAULT_ROLE_BY_CHASSIS,
  HONORIFIC_RE,
  IP_BLOCKLIST,
  MOVEMENT_KEYWORDS,
  NAME_EPITHETS,
  REAL_PERSON_ARCHETYPE,
  ROLE_KEYWORDS,
  SCALE_BOUNDS,
  UNBOUNDED,
} from './lexicon';

export const ATTR_KEYS = [
  'forceOutput', 'durability', 'combatSpeed', 'reactionSpeed', 'travelSpeed', 'precision', 'mobility',
  'recovery', 'perception', 'combatSkill', 'tacticalIntelligence', 'teamwork', 'resolve',
] as const;
export type AttrKey = (typeof ATTR_KEYS)[number];

export const DESCRIPTION_NOTE_PREFIX = 'Player draft description (verbatim): ';

export interface CompileSpec {
  description: string;
  /** Seed for all rng-driven variation in assemble(). */
  rngSeed: number;
  /** 4-hex id suffix, stable across corrections. */
  hex: string;
  displayName: string;
  familyKeys: string[]; // 1–2 entries, primary first
  chassis: Chassis;
  scale: number;
  role: Role;
  movement: MovementMode[];
  attrs: Record<AttrKey, number>;
  weaknesses: Weakness[];
  constraints: BehaviorConstraint[];
  forceGuardShield: boolean;
  transformed: boolean;
  notes: string[];
  assumptions: string[];
  normalizations: string[];
  creatorFacts: string[];
  extraClaims: CharacterClaim[];
  confidence: 'high' | 'medium' | 'low';
  semanticRevisionCount: number;
  visualRevisionCount: number;
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

const containsWord = (text: string, word: string): boolean =>
  word.includes(' ') || word.includes('-')
    ? text.includes(word)
    : new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(text);

function countHits(text: string, words: string[]): { count: number; matched: string[] } {
  const matched: string[] = [];
  for (const w of words) if (containsWord(text, w)) matched.push(w);
  return { count: matched.length, matched };
}

function detectFamilies(text: string): { keys: string[]; matched: Map<string, string[]>; totalHits: number } {
  const scored: { key: string; count: number; order: number }[] = [];
  const matched = new Map<string, string[]>();
  FAMILY_KEYS.forEach((key, order) => {
    const { count, matched: words } = countHits(text, FAMILIES[key].keywords);
    if (count > 0) {
      scored.push({ key, count, order });
      matched.set(key, words);
    }
  });
  scored.sort((a, b) => b.count - a.count || a.order - b.order);
  const keys = scored.slice(0, 2).map((s) => s.key);
  return { keys, matched, totalHits: scored.reduce((s, x) => s + x.count, 0) };
}

function detectChassis(text: string): { chassis: Chassis; evidence: string | null } {
  for (const row of CHASSIS_KEYWORDS) {
    const { matched } = countHits(text, row.words);
    if (matched.length > 0) return { chassis: row.chassis, evidence: matched[0] };
  }
  return { chassis: 'humanoid', evidence: null };
}

function detectRole(text: string): { role: Role | null; evidence: string | null } {
  let best: { role: Role; count: number; idx: number; word: string } | null = null;
  ROLE_KEYWORDS.forEach((row, idx) => {
    const { count, matched } = countHits(text, row.words);
    if (count > 0 && (!best || count > best.count)) best = { role: row.role, count, idx, word: matched[0] };
  });
  return best ? { role: (best as { role: Role }).role, evidence: (best as { word: string }).word } : { role: null, evidence: null };
}

function extractName(original: string): string | null {
  const m = original.match(
    /\b(?:named|called|known as|name is)\s+["“”']?([A-Za-z][A-Za-z'’-]*(?:\s+[A-Z][A-Za-z'’-]*){0,2})/,
  );
  if (!m) return null;
  const raw = m[1].replace(/["“”']/g, '').trim().slice(0, 24);
  if (!raw) return null;
  return raw
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

const DAMAGE_TYPE_WORDS: DamageType[] = ['kinetic', 'energy', 'thermal', 'psychic', 'magic', 'toxic', 'sonic'];

function declaredWeaknesses(text: string): Weakness[] {
  const out: Weakness[] = [];
  const re = /(?:weak(?:ness)?\s+(?:to|against)|vulnerable\s+to|afraid\s+of|fears?)\s+([a-z][a-z ,-]{1,30})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const phrase = m[1];
    const fam = FAMILY_KEYS.find((k) => FAMILIES[k].keywords.some((w) => containsWord(phrase, w)));
    if (fam) {
      const f = FAMILIES[fam];
      out.push({
        id: `declared-${fam}`,
        description: `Creator-declared weakness: ${f.label} attacks land disproportionately hard.`,
        severity: 2,
        trigger: { damageTypes: [f.damageType], abilityTags: f.tags.slice(0, 2) },
        effect: { damageTakenMult: 1.3 },
        evidence: 'creator-desc',
      });
      continue;
    }
    const dt = DAMAGE_TYPE_WORDS.find((d) => containsWord(phrase, d));
    if (dt) {
      out.push({
        id: `declared-${dt}`,
        description: `Creator-declared weakness: ${dt} damage lands disproportionately hard.`,
        severity: 2,
        trigger: { damageTypes: [dt] },
        effect: { damageTakenMult: 1.3 },
        evidence: 'creator-desc',
      });
    }
  }
  // Dedupe by id, preserve order.
  const seen = new Set<string>();
  return out.filter((w) => (seen.has(w.id) ? false : (seen.add(w.id), true)));
}

function buildWeaknesses(
  familyKeys: string[],
  chassis: Chassis,
  movement: MovementMode[],
  declared: Weakness[],
  rng: () => number,
): { weaknesses: Weakness[]; assumptions: string[] } {
  const assumptions: string[] = [];
  const out: Weakness[] = [];
  const primary = FAMILIES[familyKeys[0]];

  // 1. Opposing-family weakness (always).
  const opp = FAMILIES[primary.opposed];
  out.push({
    id: `opposed-${opp.key}`,
    description: `Elemental opposition: ${primary.opposedPhrase}.`,
    severity: 2,
    trigger: { damageTypes: [opp.damageType], abilityTags: opp.tags.slice(0, 2) },
    effect: { damageTakenMult: 1.25 },
    evidence: 'compiler-taxonomy',
  });
  assumptions.push(
    `Weakness to ${opp.label} derived from the ${primary.label} family's opposing element (${primary.opposedPhrase}).`,
  );

  // 2. Structural weakness from a fixed table (first applicable, no duplicate triggers).
  const candidates: Weakness[] = [];
  if (familyKeys.includes('tech'))
    candidates.push({
      id: 'structural-emp',
      description: 'Powered systems fail under electromagnetic and magnetic attack.',
      severity: 2,
      trigger: { abilityTags: ['emp', 'magnetic'] },
      effect: { suppressTags: ['tech'] },
      evidence: 'compiler-structural',
    });
  if (chassis === 'heavy')
    candidates.push({
      id: 'structural-resonance',
      description: 'A massive frame resonates — sonic and seismic attacks shake it apart from within.',
      severity: 2,
      trigger: { damageTypes: ['sonic'], abilityTags: ['sonic', 'seismic'] },
      effect: { damageTakenMult: 1.25 },
      evidence: 'compiler-structural',
    });
  if (movement.includes('flight') || movement.includes('hover'))
    candidates.push({
      id: 'structural-grounding',
      description: 'Airborne advantage inverts when grounded — gravity and tether effects drag them down hard.',
      severity: 1,
      trigger: { abilityTags: ['gravity', 'grounding', 'net'] },
      effect: { applyCondition: { kind: 'grounded', magnitude: 0, durationTicks: 20 } },
      evidence: 'compiler-structural',
    });
  const generic: Weakness[] = [
    {
      id: 'structural-overload',
      description: 'Their power expression scrambles under nullifying strikes.',
      severity: 2,
      trigger: { abilityTags: ['nullify'] },
      effect: { suppressTags: [primary.tags[0]] },
      evidence: 'compiler-structural',
    },
    {
      id: 'structural-binding',
      description: 'A style built on momentum — binding and rooting effects hit disproportionately.',
      severity: 1,
      trigger: { abilityTags: ['bind', 'root'] },
      effect: { damageTakenMult: 1.2 },
      evidence: 'compiler-structural',
    },
    {
      id: 'structural-ambush',
      description: 'Tunnel vision under pressure — stealth and ambush attacks land harder.',
      severity: 1,
      trigger: { abilityTags: ['stealth', 'ambush'] },
      effect: { damageTakenMult: 1.25 },
      evidence: 'compiler-structural',
    },
  ];
  candidates.push(generic[Math.floor(rng() * generic.length) % generic.length], ...generic);
  const structural = candidates.find(
    (c) => !out.some((w) => w.id === c.id || JSON.stringify(w.trigger) === JSON.stringify(c.trigger)),
  )!;
  out.push(structural);
  assumptions.push(`Structural weakness "${structural.id}" inferred from chassis/movement/kit archetype.`);

  // 3. Creator-declared weaknesses (override/extend).
  for (const d of declared) if (!out.some((w) => w.id === d.id)) out.push(d);

  return { weaknesses: out, assumptions };
}

// ---------------------------------------------------------------------------
// parse — free text → CompileSpec
// ---------------------------------------------------------------------------

export function parseDescription(description: string, seed: number): CompileSpec {
  const hash = fnv1a32(`${description}${seed}`);
  const originalLower = description.toLowerCase();
  const notes: string[] = [];
  const assumptions: string[] = [];
  const normalizations: string[] = [];
  const creatorFacts: string[] = [];
  const extraClaims: CharacterClaim[] = [];

  // Guards: protected IP, then real-person likeness.
  let effective = originalLower;
  let transformed = false;
  const ipHit = IP_BLOCKLIST.find((r) => r.re.test(originalLower));
  if (ipHit) {
    transformed = true;
    effective = ipHit.archetype;
    notes.push(
      `This is an original transformed interpretation, not ${ipHit.name}; protected characters aren't available in public content.`,
    );
    normalizations.push(`Protected-IP request ("${ipHit.name}") transformed into an original archetype-inspired fighter.`);
  } else {
    const personHit = CELEBRITIES.find((c) => originalLower.includes(c)) ?? (HONORIFIC_RE.test(originalLower) ? originalLower.match(HONORIFIC_RE)![0] : null);
    if (personHit) {
      transformed = true;
      effective = REAL_PERSON_ARCHETYPE;
      notes.push(
        `Real-person likeness policy: "${personHit}" was transformed into an original fighter; real people aren't available as fighters.`,
      );
      normalizations.push(`Real-person reference ("${personHit}") transformed per likeness policy.`);
    }
  }
  if (transformed)
    notes.push('Note: the IP/likeness guard is keyword-based and limited; it catches well-known names, not every protected character.');

  // Unbounded clauses — scanned on the ORIGINAL text, honestly normalized.
  const attrDeltas: Partial<Record<AttrKey, number>> = {};
  let forceGuardShield = false;
  for (const rule of UNBOUNDED) {
    if (rule.re.test(originalLower)) {
      normalizations.push(rule.note);
      notes.push(rule.note);
      if (rule.grantsShield) forceGuardShield = true;
      for (const [k, v] of Object.entries(rule.deltas ?? {}))
        attrDeltas[k as AttrKey] = (attrDeltas[k as AttrKey] ?? 0) + (v as number);
    }
  }

  // Families.
  const famScan = detectFamilies(effective);
  let familyKeys = famScan.keys;
  let confidence: 'high' | 'medium' | 'low' = famScan.totalHits >= 2 ? 'high' : famScan.totalHits === 1 ? 'medium' : 'low';
  if (transformed && confidence === 'high') confidence = 'medium';
  if (familyKeys.length === 0) {
    const fallback = ['blade', 'stone', 'beast'];
    familyKeys = [fallback[Math.floor(rngFor(hash, 'fallback-family')() * fallback.length)]];
    confidence = 'low';
    const label = FAMILIES[familyKeys[0]].label;
    assumptions.push(`No recognizable power family in the description — defaulted to a ${label} discipline.`);
    notes.push(`No recognizable power family — compiled as a ${label}-discipline fighter (low confidence).`);
  } else {
    for (const k of familyKeys) creatorFacts.push(`${FAMILIES[k].label} powers (matched: ${(famScan.matched.get(k) ?? []).join(', ')})`);
  }

  // Chassis, movement, role.
  const chassisScan = detectChassis(effective);
  const chassis = chassisScan.chassis;
  if (chassisScan.evidence) creatorFacts.push(`${chassis} frame (matched: "${chassisScan.evidence}")`);
  else assumptions.push('No body-type cue found — defaulted to a humanoid chassis.');

  const movement: MovementMode[] = [chassis === 'floating' ? 'hover' : 'ground'];
  const mv = (mode: MovementMode, words: string[]) => {
    const { matched } = countHits(effective, words);
    if (matched.length > 0 && !movement.includes(mode)) {
      movement.push(mode);
      creatorFacts.push(`${mode} movement (matched: "${matched[0]}")`);
    }
    return matched.length > 0;
  };
  mv('flight', MOVEMENT_KEYWORDS.flight);
  if (chassis !== 'floating') mv('hover', MOVEMENT_KEYWORDS.hover);
  mv('blink', MOVEMENT_KEYWORDS.blink);
  const isFast = mv('sprint', MOVEMENT_KEYWORDS.sprint);
  if (chassis === 'heavy' && !movement.includes('leap')) {
    movement.push('leap');
    assumptions.push('Heavy chassis granted leap movement for arena traversal.');
  }

  const roleScan = detectRole(effective);
  const role: Role = roleScan.role ?? DEFAULT_ROLE_BY_CHASSIS[chassis];
  if (roleScan.evidence) creatorFacts.push(`${role} role (matched: "${roleScan.evidence}")`);
  else assumptions.push(`No role cue found — defaulted to ${role} for a ${chassis} chassis.`);

  // Attributes: base 5, family/role/chassis/adjective/movement deltas, seeded flavor, soft cap.
  const attrs = Object.fromEntries(ATTR_KEYS.map((k) => [k, 5])) as Record<AttrKey, number>;
  const add = (deltas: Partial<Record<string, number>>) => {
    for (const [k, v] of Object.entries(deltas)) attrs[k as AttrKey] += v as number;
  };
  for (const k of familyKeys) add(FAMILY_ATTR[k] ?? {});
  const ROLE_ATTR: Record<Role, Partial<Record<AttrKey, number>>> = {
    vanguard: { forceOutput: 1, resolve: 1 },
    defender: { durability: 2, resolve: 1 },
    bruiser: { forceOutput: 2, durability: 1 },
    skirmisher: { combatSpeed: 1, mobility: 2 },
    artillery: { precision: 2, perception: 1 },
    controller: { tacticalIntelligence: 2, perception: 1 },
    support: { teamwork: 2, tacticalIntelligence: 1 },
    tactician: { tacticalIntelligence: 2, teamwork: 1 },
  };
  add(ROLE_ATTR[role]);
  const CHASSIS_ATTR: Record<Chassis, Partial<Record<AttrKey, number>>> = {
    humanoid: {},
    heavy: { durability: 2, forceOutput: 1, mobility: -1, travelSpeed: -1 },
    quadruped: { travelSpeed: 1, mobility: 1 },
    floating: { mobility: 1, durability: -1 },
  };
  add(CHASSIS_ATTR[chassis]);
  for (const adj of ADJECTIVES) {
    const { matched } = countHits(effective, adj.words);
    if (matched.length > 0) {
      add(adj.deltas);
      assumptions.push(`Attribute inference: ${adj.note} (matched: "${matched[0]}").`);
    }
  }
  if (isFast) add({ travelSpeed: 1 });
  add(attrDeltas);
  const flavorRng = rngFor(hash, 'attr-flavor');
  for (let i = 0; i < 2; i++) attrs[pick(flavorRng, ATTR_KEYS)] += 1;
  for (const k of ATTR_KEYS) attrs[k] = clamp(Math.round(attrs[k]), 1, 10);
  let sum = ATTR_KEYS.reduce((s, k) => s + attrs[k], 0);
  if (sum > ATTRIBUTE_SUM_CAP) {
    const factor = ATTRIBUTE_SUM_CAP / sum;
    for (const k of ATTR_KEYS) attrs[k] = clamp(Math.max(1, Math.round(attrs[k] * factor)), 1, 10);
    sum = ATTR_KEYS.reduce((s, k) => s + attrs[k], 0);
    while (sum > ATTRIBUTE_SUM_CAP) {
      let bestKey: AttrKey = ATTR_KEYS[0];
      for (const k of ATTR_KEYS) if (attrs[k] > attrs[bestKey]) bestKey = k;
      attrs[bestKey] -= 1;
      sum -= 1;
    }
    const capNote = 'Power claims normalized to Enhanced division (attribute total capped at 78).';
    normalizations.push(capNote);
    notes.push(capNote);
  }

  // Weaknesses.
  const declared = declaredWeaknesses(originalLower);
  for (const d of declared) {
    creatorFacts.push(`declared weakness (${d.id.replace('declared-', '')})`);
    extraClaims.push({
      path: `weaknesses.${d.id}`,
      selectedValue: d.description,
      portrayalType: 'repeatable',
      conditions: ['always'],
      evidence: ['creator-desc'],
      conflicts: [],
      confidence: 'high',
    });
  }
  const { weaknesses, assumptions: wAssumptions } = buildWeaknesses(
    familyKeys, chassis, movement, declared, rngFor(hash, 'structural-weakness'),
  );
  assumptions.push(...wAssumptions);

  // Behavior constraints.
  const constraints: BehaviorConstraint[] = [];
  for (const cue of CONSTRAINT_CUES)
    if (cue.re.test(effective) && !constraints.includes(cue.constraint as BehaviorConstraint))
      constraints.push(cue.constraint as BehaviorConstraint);

  // Name.
  let displayName = transformed ? null : extractName(description);
  if (!displayName) {
    const nameRng = rngFor(hash, 'name');
    displayName = `${pick(nameRng, FAMILIES[familyKeys[0]].names)} ${pick(nameRng, NAME_EPITHETS)}`;
    assumptions.push(`No explicit name given — generated "${displayName}" from the ${FAMILIES[familyKeys[0]].label} naming pool.`);
  } else {
    creatorFacts.push(`named "${displayName}"`);
  }

  // Scale.
  const scaleRng = rngFor(hash, 'scale');
  const [lo, hi] = SCALE_BOUNDS[chassis];
  const scale = chassis === 'heavy' ? frange(scaleRng, 1.3, 1.6) : chassis === 'humanoid' ? 1 : frange(scaleRng, Math.max(lo, 0.95), Math.min(hi, 1.2));

  return {
    description,
    rngSeed: hash,
    hex: hex4(hash),
    displayName,
    familyKeys,
    chassis,
    scale,
    role,
    movement,
    attrs,
    weaknesses,
    constraints,
    forceGuardShield,
    transformed,
    notes,
    assumptions,
    normalizations,
    creatorFacts,
    extraClaims,
    confidence,
    semanticRevisionCount: 0,
    visualRevisionCount: 0,
  };
}

// ---------------------------------------------------------------------------
// Kit assembly
// ---------------------------------------------------------------------------

interface BuiltKit {
  foundational: Ability[];
  signature: Ability[];
  contextual: Ability[];
  escalation: Ability;
  passives: Passive[];
  animationIntents: string[];
}

function mkAbility(
  slot: KitSlot,
  fam: FamilyDef,
  base: Omit<Ability, 'id' | 'name' | 'animationIntent' | 'description' | 'tags'> & { tags?: string[] },
  usedIds: Set<string>,
): Ability {
  let id = slugify(slot.name);
  while (usedIds.has(id)) id = `${id}-2`;
  usedIds.add(id);
  const tags = [...fam.tags, ...(base.tags ?? [])].filter((t, i, a) => a.indexOf(t) === i);
  const { tags: _drop, ...rest } = base;
  return { id, name: slot.name, animationIntent: slot.anim, description: slot.desc, tags, ...rest };
}

function buildKit(spec: CompileSpec): BuiltKit {
  const rng = rngFor(spec.rngSeed, 'kit');
  const primary = FAMILIES[spec.familyKeys[0]];
  const secondary = spec.familyKeys[1] ? FAMILIES[spec.familyKeys[1]] : null;
  const usedIds = new Set<string>();
  const res = primary.resource?.name ?? 'stamina';

  const isMelee = (slot: KitSlot) => slot.anim.startsWith('quick_melee') || slot.anim.startsWith('heavy_') || slot.anim.startsWith('stance_');

  const jabMelee = isMelee(primary.kit.jab);
  const foundational = mkAbility(primary.kit.jab, primary, {
    kind: jabMelee ? 'melee' : 'ranged',
    targeting: 'enemy',
    range: jabMelee ? irange(rng, 2, 3) : irange(rng, 12, 16),
    power: irange(rng, 10, 12),
    damageType: primary.damageType,
    cost: { resource: 'stamina', amount: 4 },
    cooldownTicks: 4,
    windupTicks: 0,
    tags: [jabMelee ? 'melee' : 'projectile'],
  }, usedIds);

  const strikeFam = secondary ?? primary;
  const strikeMelee = isMelee(strikeFam.kit.strike);
  const strike = mkAbility(strikeFam.kit.strike, strikeFam, {
    kind: strikeMelee ? 'melee' : 'ranged',
    targeting: 'enemy',
    range: strikeMelee ? 3 : irange(rng, 18, 24),
    power: irange(rng, 22, 26),
    damageType: strikeFam.damageType,
    cost: { resource: strikeFam === primary ? res : 'stamina', amount: irange(rng, 14, 18) },
    cooldownTicks: irange(rng, 26, 32),
    windupTicks: irange(rng, 1, 3),
    effects: strikeFam.kit.strike.effect ? [strikeFam.kit.strike.effect] : undefined,
    tags: [strikeMelee ? 'melee' : 'projectile'],
  }, usedIds);

  const burst = mkAbility(primary.kit.burst, primary, {
    kind: 'area',
    targeting: 'enemy',
    range: irange(rng, 10, 14),
    radius: irange(rng, 5, 7),
    power: irange(rng, 18, 22),
    damageType: primary.damageType,
    cost: { resource: res, amount: irange(rng, 16, 20) },
    cooldownTicks: irange(rng, 34, 40),
    windupTicks: 2,
    effects: primary.kit.burst.effect ? [primary.kit.burst.effect] : undefined,
    tags: ['burst'],
  }, usedIds);

  const utility =
    spec.role === 'support'
      ? mkAbility(
          { name: 'Mending Surge', anim: 'support_heal', desc: 'A restorative surge channeled into a wounded ally.' },
          primary,
          {
            kind: 'support',
            targeting: 'ally',
            range: 10,
            power: irange(rng, 14, 18),
            cost: { resource: 'stamina', amount: irange(rng, 12, 15) },
            cooldownTicks: irange(rng, 40, 46),
            windupTicks: 1,
            effects: [{ kind: 'regen', magnitude: 0.8, durationTicks: 16 }],
            tags: ['support'],
          },
          usedIds,
        )
      : mkAbility(primary.kit.utility, primary, {
          kind: 'control',
          targeting: 'enemy',
          range: irange(rng, 8, 12),
          power: irange(rng, 8, 12),
          damageType: primary.damageType,
          cost: { resource: 'stamina', amount: irange(rng, 12, 15) },
          cooldownTicks: irange(rng, 40, 48),
          windupTicks: 1,
          effects: primary.kit.utility.effect ? [primary.kit.utility.effect] : undefined,
          tags: ['control'],
        }, usedIds);

  const wantsDash =
    !spec.forceGuardShield &&
    (spec.movement.includes('blink') || spec.movement.includes('sprint') || spec.role === 'skirmisher');
  const fourth = wantsDash
    ? mkAbility(primary.kit.dash, primary, {
        kind: 'movement',
        targeting: 'self',
        range: irange(rng, 8, 12),
        power: 0,
        cost: { resource: 'stamina', amount: irange(rng, 8, 12) },
        cooldownTicks: irange(rng, 28, 34),
        windupTicks: 0,
        selfEffects: [{ kind: 'haste', magnitude: 0.2, durationTicks: 8 }],
        tags: ['mobility'],
      }, usedIds)
    : mkAbility(primary.kit.guard, primary, {
        kind: 'support',
        targeting: 'self',
        range: 0,
        power: 0,
        cost: { resource: 'stamina', amount: irange(rng, 14, 16) },
        cooldownTicks: irange(rng, 44, 52),
        windupTicks: 0,
        effects: [{ kind: 'shield', magnitude: spec.forceGuardShield ? 40 : irange(rng, 36, 44), durationTicks: 40 }],
        tags: ['barrier'],
      }, usedIds);

  const escEffect: ConditionSpec | undefined = primary.kit.esc.effect;
  const escalation = mkAbility(primary.kit.esc, primary, {
    kind: 'area',
    targeting: 'enemy',
    range: irange(rng, 10, 12),
    radius: irange(rng, 8, 10),
    power: irange(rng, 45, 55),
    damageType: primary.damageType,
    cost: { resource: res, amount: irange(rng, 30, 38) },
    cooldownTicks: irange(rng, 220, 240),
    windupTicks: irange(rng, 5, 6),
    effects: escEffect ? [escEffect] : undefined,
    tags: ['finisher'],
  }, usedIds);

  const contextual: Ability[] = [];
  if (primary.contextGate && primary.kit.contextual) {
    contextual.push(
      mkAbility(primary.kit.contextual, primary, {
        kind: 'area',
        targeting: 'enemy',
        range: 12,
        radius: 8,
        power: irange(rng, 22, 26),
        damageType: primary.damageType,
        cost: { resource: res, amount: irange(rng, 24, 30) },
        cooldownTicks: 60,
        windupTicks: 3,
        requiresContext: [primary.contextGate],
        tags: ['contextual'],
      }, usedIds),
    );
  }

  // Passives (1–2).
  const passives: Passive[] = [];
  const pushPassive = (p: Passive) => {
    if (passives.length < 2 && !passives.some((x) => x.kind === p.kind)) passives.push(p);
  };
  if (spec.role === 'defender')
    pushPassive({ id: 'guard-mastery', name: 'Line Unbroken', kind: 'guard_mastery', magnitude: 0.15, tags: [primary.tags[0], 'guard'], description: 'Years of holding the line — guarding sheds noticeably more of every blow.' });
  if (spec.role === 'support')
    pushPassive({ id: 'ally-aura', name: 'Shelter Radius', kind: 'ally_aura_shield', magnitude: 1, radius: 6, tags: [primary.tags[0], 'aura'], description: 'Allies standing close pick up a thin, constantly-renewed ward.' });
  if (spec.familyKeys.includes('shadow'))
    pushPassive({ id: 'stealth-field', name: 'Unremembered', kind: 'stealth_field', magnitude: 0.15, tags: ['shadow', 'stealth'], description: 'Begins encounters as a rumor; re-fades when the fighting moves on.' });
  if (spec.movement.includes('flight') || spec.movement.includes('hover'))
    pushPassive({ id: 'evasive-flier', name: 'Slipstream Instincts', kind: 'evasive_flier', magnitude: 0.15, tags: ['aerial'], description: 'Hard to pin down while airborne.' });
  if (spec.familyKeys.includes('blade') || spec.familyKeys.includes('beast'))
    pushPassive({ id: 'counter-attack', name: 'Answer in Kind', kind: 'counter_attack', magnitude: 0.2, tags: [primary.tags[0], 'melee'], description: 'Strikes that land in melee are frequently answered before the arm withdraws.' });
  if (passives.length === 0)
    pushPassive({ id: 'battle-recovery', name: 'Second Wind Discipline', kind: 'regen', magnitude: 0.25, tags: [primary.tags[0]], description: `Wounds knit slowly amid ${primary.aura}.` });

  const animationIntents = [
    spec.chassis === 'floating' ? 'levitate_idle' : 'combat_idle',
    foundational.animationIntent,
    strike.animationIntent,
    burst.animationIntent,
    utility.animationIntent,
    fourth.animationIntent,
    ...contextual.map((c) => c.animationIntent),
    escalation.animationIntent,
  ];

  return { foundational: [foundational], signature: [strike, burst, utility, fourth], contextual, escalation, passives, animationIntents };
}

// ---------------------------------------------------------------------------
// assemble — CompileSpec → CompiledFighterResult
// ---------------------------------------------------------------------------

const SEVERITY_WORD: Record<number, 'minor' | 'serious' | 'defining'> = { 1: 'minor', 2: 'serious', 3: 'defining' };

export function assemble(spec: CompileSpec): CompiledFighterResult {
  const primary = FAMILIES[spec.familyKeys[0]];
  const secondary = spec.familyKeys[1] ? FAMILIES[spec.familyKeys[1]] : null;
  const fighterId = `${slugify(spec.displayName)}-x${spec.hex}`;
  const kit = buildKit(spec);
  const bRng = rngFor(spec.rngSeed, 'behavior');

  // Resources.
  const dur = spec.attrs.durability;
  const vitality = clamp(160 + dur * 22 + (spec.chassis === 'heavy' ? 60 : 0) + (spec.chassis === 'quadruped' ? 20 : 0), 100, 600);
  const stability = clamp(40 + dur * 7 + (spec.chassis === 'heavy' ? 30 : 0), 20, 200);
  const primaryResource = primary.resource
    ? { name: primary.resource.name, max: 100, start: primary.resource.regenRequiresContext ? 80 : 75, regenPerTick: 0.6,
        ...(primary.resource.regenRequiresContext ? { regenRequiresContext: primary.resource.regenRequiresContext } : {}),
        ...(primary.resource.drainInContext ? { drainInContext: primary.resource.drainInContext } : {}),
        ...(primary.resource.onDepletedSuppressTags ? { onDepletedSuppressTags: primary.resource.onDepletedSuppressTags } : {}) }
    : undefined;

  // Behavior.
  const ROLE_RISK: Record<Role, number> = { vanguard: 0.6, defender: 0.4, bruiser: 0.65, skirmisher: 0.6, artillery: 0.45, controller: 0.4, support: 0.35, tactician: 0.5 };
  const ROLE_PROTECT: Record<Role, number> = { vanguard: 0.5, defender: 0.8, bruiser: 0.45, skirmisher: 0.35, artillery: 0.4, controller: 0.5, support: 0.85, tactician: 0.65 };
  const ROLE_TARGET: Record<Role, CombatDNA['behavior']['targetPreference']> = {
    vanguard: 'highest_threat', defender: 'nearest', bruiser: 'nearest', skirmisher: 'isolated',
    artillery: 'isolated', controller: 'highest_threat', support: 'lowest_vitality', tactician: 'support_first',
  };
  let risk = ROLE_RISK[spec.role];
  if (spec.constraints.includes('reckless')) risk += 0.2;
  let protect = ROLE_PROTECT[spec.role];
  if (spec.constraints.includes('never_abandons_allies') || spec.constraints.includes('protects_captain')) protect += 0.15;
  const behavior: CombatDNA['behavior'] = {
    personality: primary.personality,
    riskTolerance: round2(clamp(risk + frange(bRng, -0.05, 0.05), 0.05, 0.95)),
    allyProtection: round2(clamp(protect + frange(bRng, -0.05, 0.05), 0.05, 0.95)),
    targetPreference: ROLE_TARGET[spec.role],
    commandCompliance: round2(clamp((spec.role === 'tactician' ? 0.9 : 0.75) - (spec.constraints.includes('reckless') ? 0.2 : 0), 0.05, 0.95)),
    constraints: spec.constraints,
    repetitionAvoidance: round2(0.6 + frange(bRng, 0, 0.2)),
  };

  // Presentation: description color words override the family palette.
  const colorHits = Object.keys(COLOR_WORDS).filter((w) => containsWord(spec.description.toLowerCase(), w));
  const presentation: CombatDNA['presentation'] = {
    primaryColor: colorHits[0] ? COLOR_WORDS[colorHits[0]] : primary.palette.primary,
    secondaryColor: colorHits[1] ? COLOR_WORDS[colorHits[1]] : primary.palette.secondary,
    energyColor: primary.palette.energy,
    silhouette: `${spec.scale >= 1.3 ? 'Towering' : spec.scale > 1.05 ? 'Imposing' : 'Poised'} ${spec.chassis} silhouette wreathed in ${primary.aura}`,
    animationIntents: kit.animationIntents,
  };

  // Power tags.
  const allAbilities = [...kit.foundational, ...kit.signature, ...kit.contextual, kit.escalation];
  const powerTags = [...new Set([...allAbilities.flatMap((a) => a.tags), ...kit.passives.flatMap((p) => p.tags)])];

  const dna: CombatDNA = {
    schemaVersion: COMBAT_DNA_SCHEMA_VERSION,
    identity: {
      fighterId,
      contractVersion: '1.0.0',
      combatVersion: '1.0.0',
      division: 'enhanced',
      role: spec.role,
      chassis: spec.chassis,
      scale: spec.scale,
    },
    attributes: Object.fromEntries(ATTR_KEYS.map((k) => [k, spec.attrs[k] as Tier])) as unknown as CombatDNA['attributes'],
    resources: {
      vitality,
      stability,
      stamina: 100 + (spec.role === 'support' ? 10 : 0),
      staminaRegenPerTick: 1.5,
      ...(primaryResource ? { primary: primaryResource } : {}),
    },
    movementModes: spec.movement,
    capabilities: {
      foundational: kit.foundational,
      signature: kit.signature,
      contextual: kit.contextual,
      escalation: kit.escalation,
      passives: kit.passives,
    },
    defenses: {
      resistances: [
        { damageType: primary.damageType, pct: 0.3 },
        ...(secondary && secondary.damageType !== primary.damageType
          ? [{ damageType: secondary.damageType, pct: 0.15 }]
          : []),
      ],
      immunities: primary.key === 'fire' ? (['burn'] as const).slice() : primary.key === 'toxic' ? (['corrode'] as const).slice() : [],
    },
    weaknesses: spec.weaknesses,
    behavior,
    interactions: {
      environmental: primary.envRules.map((r) => ({ ...r, effect: { ...r.effect } })),
      synergies: [
        {
          allyTag: primary.tags[0],
          effect: { damageMult: 1.06 },
          description: `Fights sharper alongside another ${primary.label}-aligned teammate.`,
        },
      ],
      powerTags,
    },
    balance: {
      capabilityScore: 0, versatilityScore: 0, reliabilityScore: 0, counterabilityScore: 0,
      draftPrice: 0, priceVersion: '', priceRationale: '',
    },
    presentation,
    validation: { eligibility: 'experimental', passedSuites: ['schema'], knownIssues: [] },
  };
  dna.balance = computePrice(dna);

  // Contract.
  const famPhrase = secondary ? `${primary.label} and ${secondary.label} powers` : `${primary.label} powers`;
  const descTrim = spec.description.trim().replace(/\s+/g, ' ').slice(0, 180);
  const claims: CharacterClaim[] = [
    {
      path: `powers.${primary.key}`,
      selectedValue: `${primary.label}-family kit dealing ${primary.damageType} damage with tags [${primary.tags.join(', ')}]`,
      portrayalType: 'repeatable',
      conditions: primaryResource ? [`${primaryResource.name} above zero`] : [],
      evidence: [spec.transformed ? 'transformed archetype (original description withheld from mechanics)' : 'creator-desc'],
      conflicts: [],
      confidence: spec.confidence,
    },
    {
      path: 'identity.chassis',
      selectedValue: `${spec.chassis} chassis at scale ${spec.scale}`,
      portrayalType: 'repeatable',
      conditions: [],
      evidence: ['creator-desc'],
      conflicts: [],
      confidence: spec.confidence,
    },
    {
      path: 'identity.role',
      selectedValue: `${spec.role} battlefield role`,
      portrayalType: 'repeatable',
      conditions: [],
      evidence: ['creator-desc'],
      conflicts: [],
      confidence: spec.confidence,
    },
    ...spec.extraClaims,
  ];

  const contract: CharacterContract = {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    identity: {
      fighterId,
      displayName: spec.displayName,
      version: '1.0.0',
      continuity: 'player-custom',
      era: 'season-0',
      creator: 'player',
      ownership: 'creator_owned',
      visibility: 'private',
      remixPolicy: 'allowed_with_attribution',
      division: 'enhanced',
      chassis: spec.chassis,
    },
    canon: {
      summary:
        `${spec.displayName} enters the Enhanced division as a ${spec.role} on a ${spec.chassis} chassis, shaped by ${famPhrase}. ` +
        (spec.transformed
          ? 'An original interpretation inspired by a familiar archetype — the source request named protected material, so this fighter shares the silhouette of the idea, not the identity. '
          : descTrim
            ? `Creator lore records: "${descTrim}${spec.description.trim().length > 180 ? '…' : ''}". `
            : 'The creator supplied no lore beyond the concept itself; the arena will write the rest. ') +
        `Their counterplay is real: ${FAMILIES[primary.opposed].label} answers and ${spec.weaknesses.length} disclosed weaknesses keep the division honest.`,
      primarySources: [
        {
          id: 'creator-desc',
          kind: 'creator_lore',
          note: `${DESCRIPTION_NOTE_PREFIX}${spec.description}`,
        },
      ],
      selectedInterpretation: `Season 0 rule-compiled interpretation — ${famPhrase}, ${spec.role} role, bounded to Enhanced-division mechanics.`,
      disputedClaims: [],
      assumptions: spec.assumptions,
    },
    powerSources: spec.familyKeys.map((k) => FAMILIES[k].powerSource),
    capabilitySummary: {
      core: [kit.foundational[0].name, kit.signature[0].name],
      conditional: kit.contextual.map((c) => c.name),
      defensive: [kit.signature[3].name, ...kit.passives.map((p) => p.name)],
      movement: spec.movement.slice(),
      signature: kit.signature.map((s) => s.name),
    },
    limitations: spec.weaknesses.map((w) => ({
      description: w.description,
      severity: SEVERITY_WORD[w.severity],
      condition: w.trigger.envTags?.length ? w.trigger.envTags.join(', ') : 'always',
      evidence: w.evidence,
    })),
    weaknessSummary: spec.weaknesses.map((w) => ({
      description: w.description,
      severity: SEVERITY_WORD[w.severity],
      exposureMethod: [
        ...(w.trigger.damageTypes ?? []).map((d) => `${d} damage`),
        ...(w.trigger.abilityTags ?? []).map((t) => `${t}-tagged abilities`),
        ...(w.trigger.envTags ?? []).map((t) => `${t} conditions`),
      ].join(', '),
      evidence: w.evidence,
    })),
    behaviorSummary: {
      combatIntelligence: primary.personality,
      tacticalStyle: `${spec.role} play built around ${kit.signature[0].name} and ${kit.signature[1].name}.`,
      riskTolerance: behavior.riskTolerance >= 0.6 ? 'High — presses advantages hard.' : behavior.riskTolerance >= 0.45 ? 'Moderate — commits when the numbers agree.' : 'Low — preserves themselves and the plan.',
      allyProtection: behavior.allyProtection >= 0.65 ? 'High — shelters teammates by instinct.' : 'Moderate — helps when it does not cost the objective.',
      moralConstraints: spec.constraints.includes('avoids_lethal_force') ? ['Prefers containment over lethal finishes'] : [],
      commandConstraints: spec.constraints.includes('never_retreats') ? ['Rejects disengage orders'] : [],
    },
    provenance: {
      claims,
      conflicts: [],
      confidence: spec.confidence,
      creatorFacts: spec.creatorFacts,
      aiAssumptions: spec.assumptions,
      mechanicalNormalizations: spec.normalizations,
    },
    approval: {
      creatorApproved: false,
      semanticRevisionCount: spec.semanticRevisionCount,
      visualRevisionCount: spec.visualRevisionCount,
      eligibility: 'experimental',
    },
  };

  const fighter: FighterFile = { contract, dna };
  return { fighter, notes: spec.notes, confidence: spec.confidence, transformed: spec.transformed };
}

// ---------------------------------------------------------------------------
// Spec recovery (corrections operate purely on the artifact)
// ---------------------------------------------------------------------------

export function specFromFighter(result: CompiledFighterResult): CompileSpec {
  const { contract, dna } = result.fighter;
  const srcNote = contract.canon.primarySources[0]?.note ?? '';
  const description = srcNote.startsWith(DESCRIPTION_NOTE_PREFIX)
    ? srcNote.slice(DESCRIPTION_NOTE_PREFIX.length)
    : contract.canon.summary;
  const hexMatch = dna.identity.fighterId.match(/-x([0-9a-f]{4})$/);
  // Primary family drives the escalation; the secondary (if any) drives the strike.
  const primaryKey = FAMILY_KEYS.find((k) => dna.capabilities.escalation.tags.includes(FAMILIES[k].tags[0]));
  const secondaryKey = FAMILY_KEYS.find(
    (k) => k !== primaryKey && dna.capabilities.signature[0]?.tags.includes(FAMILIES[k].tags[0]),
  );
  const familyKeys = [primaryKey, secondaryKey].filter((k): k is string => !!k);
  return {
    description,
    rngSeed: fnv1a32(`spec::${dna.identity.fighterId}`),
    hex: hexMatch ? hexMatch[1] : hex4(fnv1a32(dna.identity.fighterId)),
    displayName: contract.identity.displayName,
    familyKeys: familyKeys.length > 0 ? familyKeys : ['blade'],
    chassis: dna.identity.chassis,
    scale: dna.identity.scale,
    role: dna.identity.role,
    movement: dna.movementModes.slice(),
    attrs: Object.fromEntries(ATTR_KEYS.map((k) => [k, dna.attributes[k]])) as Record<AttrKey, number>,
    weaknesses: JSON.parse(JSON.stringify(dna.weaknesses)) as Weakness[],
    constraints: dna.behavior.constraints.slice(),
    forceGuardShield: false,
    transformed: result.transformed,
    notes: [],
    assumptions: contract.provenance.aiAssumptions.slice(),
    normalizations: contract.provenance.mechanicalNormalizations.slice(),
    creatorFacts: contract.provenance.creatorFacts.slice(),
    extraClaims: [],
    confidence: result.confidence,
    semanticRevisionCount: contract.approval.semanticRevisionCount,
    visualRevisionCount: contract.approval.visualRevisionCount,
  };
}
