# Combat DNA

> Living document. Last updated: 2026-08-19. Combat DNA is the engine-executable half of a
> fighter. Everything in this document is **Implemented** in
> `packages/contracts/src/types.ts` (schema), `packages/contracts/src/validate.ts` (bounds),
> and `services/combat-sim/src/sim.ts` (runtime) unless explicitly marked Planned.

## 1. Design principle: a safe declarative rules language

Combat DNA is data, not code. Fighters — including future user-generated ones — can only
combine **closed vocabularies** the engine already knows how to execute, inside **bounds the
validators enforce**. No content file can introduce a new mechanic or execute arbitrary
generated code. This is the technical enforcement of "AI is the compiler, not the referee."

## 2. CombatDNA schema walkthrough

- **identity** — fighterId, contractVersion (must match the paired contract — validator
  enforced), combatVersion, division, role (8-role vocabulary), chassis
  (humanoid/heavy/quadruped/floating), visual scale.
- **attributes** — exactly 13 tiers, each 1–10 (validator enforced): forceOutput, durability,
  combatSpeed, reactionSpeed, travelSpeed, precision, mobility, recovery, perception,
  combatSkill, tacticalIntelligence, teamwork, resolve. Runtime uses include: forceOutput
  scales damage (`0.7 + forceOutput * 0.06`), combatSpeed sets decision cadence, travelSpeed
  sets movement speed, precision vs mobility sets hit chance, recovery drives stability
  regen, tacticalIntelligence gates weakness knowledge and wildcard counterplay targeting.
- **resources** — vitality 100–600, stability 20–200 (validator bounds), stamina + regen, and
  an optional custom primary resource (§5).
- **movementModes** — ground / flight / hover / leap / blink / sprint. Flight/hover fighters
  fight airborne (alt 3) unless grounded, gaining melee-reachability protection and any
  `evasive_flier` bonus.
- **capabilities** — the ability kit (§3): ≥1 foundational, exactly 4 signature (ranked
  requirement, validator enforced), ≤2 contextual (must declare `requiresContext`), exactly
  1 escalation finisher, plus passives.
- **defenses** — typed resistances capped at 0.75 ("no immunity via resistance" — validator
  enforced) and condition immunities.
- **weaknesses** — ≥2 for ranked fighters (validator enforced), each with severity 1–3, at
  least one concrete trigger vector (damage types / ability tags / env tags), an effect
  (bonus damage multiplier via severity — 1.3×/1.6×/2.0×, applied condition, or tag
  suppression), and an evidence reference. Triggering emits `WEAKNESS_TRIGGERED` and feeds
  the causal breakdown.
- **behavior** — see §6.
- **interactions** — environment rules (§7), ally-tag synergies, and the fighter's full
  `powerTags` union.
- **balance** — the four transparent pricing scores + draftPrice (8M–50M band, validator
  enforced), priceVersion, human-readable rationale. Stamped by `npm run price`; never
  invented by an LLM. (Honest status: the 2 checked-in fighters currently carry provisional
  hand-set prices and zeroed scores pending a pricing-tool run — the files say so
  themselves via a `_generated` note.)
- **presentation** — colors, silhouette, animation intents (renderer hints only; zero
  mechanical effect).
- **validation** — eligibility stage, passed suites, known issues.

## 3. Ability model

`Ability`: kind (melee / ranged / area / support / control / movement / summon), targeting
(enemy / ally / self / point), range (0–80 m bound; arena ≈ 60×40 m), power, optional
damageType (7-type vocabulary: kinetic, energy, thermal, psychic, magic, toxic, sonic), cost
(stamina or the primary resource), cooldown (≤400 ticks), windup (≤16 ticks — windups are
interruptible), radius for areas (≤20 m), on-hit `effects` and `selfEffects` (condition
specs), **tags**, optional `requiresContext`, an `animationIntent` hint, and description.

**Tags are the interaction currency.** Suppression fields, weakness triggers, environment
rules, synergies, and wildcards all key off ability/power tags ('solar', 'tech', 'projectile',
…). An untagged ability is a validator warning because nothing can counter it.

## 4. Condition vocabulary (closed)

18 runtime status kinds, each with magnitude + duration (≤240 ticks, validator bound):

stagger, stun, root, slow, haste, burn, corrode, regen, shield, vulnerable, fortified, blind,
empower, suppress (tag-scoped ability/passive disablement — tags required), grounded,
stealth, drain, contained.

Notable runtime semantics: shields absorb before vitality; `contained` is the non-lethal
finish — it only lands on targets below 35% vitality (otherwise it degrades to a short root)
and removes the fighter as `FIGHTER_CONTAINED`; stacking refreshes duration and takes the max
magnitude rather than multiplying.

## 5. Resource framework

- **Vitality** — health; 0 = knockout.
- **Stability** — poise; breaking it staggers the fighter (`STABILITY_BROKEN`), then resets
  to 40%. Guarding trades vitality damage for stability damage.
- **Stamina** — baseline ability fuel with flat regen.
- **Primary custom resource** (optional, e.g. Solaria's `solar_charge`, AEGIS-9's
  `suit_power`) — the power-source model: max/start/regen, `regenRequiresContext` (regen only
  under given context tags), `drainInContext` (drains under hostile tags), and
  `onDepletedSuppressTags` (kit shuts down at 0, emitting `RESOURCE_DEPLETED`). This is how
  "his powers depend on X" becomes real, counterable mechanics.

## 6. Behavior vocabulary (closed)

`BehaviorSpec`: personality prose, riskTolerance / allyProtection / commandCompliance /
repetitionAvoidance (all 0–1, validator enforced), targetPreference (nearest,
lowest_vitality, highest_threat, support_first, isolated), and constraints from a closed list:

- `never_abandons_allies` — rejects disengage/regroup while an ally is below 35%
- `never_retreats` — rejects disengage
- `protects_captain` — biases toward guarding the captain
- `avoids_lethal_force` — prefers containment finishes
- `hunts_strongest` — refuses focus commands aimed at the weakest enemy
- `reckless` — ignores own low vitality when scoring aggression

At runtime these drive utility-scored decisions each cadence tick (candidates: use ability,
guard, move, protect), with repetition penalties (`repetitionAvoidance` — the anti-loop law
in code) and bounded jitter. Constraints and compliance rolls can reject player commands,
emitting `TACTICAL_COMMAND_REJECTED` — Character Contracts outrank the joystick.

## 7. Environment interaction rules

`EnvRule`: when a context tag is present (from the arena, a wildcard, or a nearby feature),
apply speed/damage/damage-taken/regen multipliers, suppress tags, or unlock a personal
context. Context is recomputed every tick from: arena `contextTags` + global wildcard
add/remove effects + per-fighter feature proximity (e.g. `water_present` near the fountain) +
placed wildcard areas. This is how "solar hero in an eclipse" or "hydrokinetic near water"
resolves mechanically — and it is covered by an automated test (eclipse suppresses
daylight-gated regen).

## 8. Forms-as-separate-fighters rule (locked)

A transformation or alternate form that meaningfully changes capabilities is **a separate
fighter file** — its own contract version, DNA, price, and draft slot — not a runtime state
switch. Rationale: forms priced as one fighter hide power from the salary cap and break
"accurate bounded interpretation". The engine has no form-swap mechanic by design; bounded
stance changes within one kit are expressed as `selfEffects` (e.g. an overcharge condition)
or context-gated abilities. The draft validator's "duplicate exact version" rule is the
enforcement seam: same character, different form/version = different market entry.

## 9. How DNA compiles to runtime state

At match start `MatchSim` deterministically builds a `FighterRt` per rostered fighter:
position from side + formation (+captain offset), full resources, precomputed team synergy
multipliers, stealth-field initial stealth, and empty condition/cooldown state. Fighters are
sorted deterministically (team+id) so iteration order can never diverge between replays.
Per tick, cached env/wildcard modifiers are recomputed, conditions and resources tick,
escalation and reserves process, then each active fighter decides and moves. Every observable
effect emits a semantic `MatchEvent`; the event log + outcome hash is the replay contract
(see docs/TECHNICAL_ARCHITECTURE.md §4).

## 10. Extending the DSL (process)

Adding a new condition kind, passive kind, effect kind, or constraint is an **engine change**,
not a content change: schema union + validator bounds + runtime implementation + tests +
schema-version bump. Content can never smuggle new semantics in — that is the point.
