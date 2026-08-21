# ADR-0010 — Ruleset 0.3.0: approach guard, flight upkeep, hover altitude (Season-0 systemic rebalance)

- **Status:** Accepted (D-027)
- **Date:** 2026-08-21
- **Deciders:** Combat Designer (proposal) → Draft Designer, QA (harness evidence); EP replay-compat review
- **Supersedes behavior of:** ruleset 0.2.0 (archived as `RULESET_S0_V020`, replays forever)

## Context

Two systemic findings had survived every battery since 2026-08-19 (see the
balance memory trail and D-014/D-017):

1. **Melee approach tax** — pure-melee fighters pay damage crossing open
   ground with no recourse: razorback 26.6% and ember-ronin 30.1% aggregate
   win rate, razorback below 38% in *every* schedule ever run.
2. **Air superiority was absolute** — `moveFighter` kept every `flight`/`hover`
   fighter at altitude 3 permanently, and `targetReachable` makes airborne
   targets flat-out immune to melee. A melee trio vs the artillery trio
   (solaria/cinder-wisp/orrin) went **0/12 in direct probes regardless of any
   damage tuning**: the tax was not a number, it was a topology. This also
   explains the high side of the table: solaria 70.2% (outlier in every
   schedule), orrin 62.6%, cinder-wisp 59.0%.

Fighter-file nerf stacking had already failed on this class of problem
(grimspike, D-014 notes) — these are engine-shape issues, so the levers are
engine-level, version-keyed, and content-untouched.

## Decision — four levers, one ruleset bump (0.2.0 → 0.3.0)

1. **Approach guard** (`approachGuardReduction: 0.3`): a fighter in approach
   movement takes ×0.7 ranged/area damage from attackers beyond the fighter's
   own maximum kit range ("out-gunned while closing"). Deterministic from
   state; the guarded event carries `approachGuarded: true`.
2. **Approach surge** (`approachSpeedSurge: 0.25`): same trigger condition;
   the out-gunned closer moves ×1.25 — dead ground is crossed faster.
3. **Flight stamina upkeep** (`flightStaminaUpkeep: 0.6`): no catching your
   breath in the air. While airborne, stamina does not regenerate and drains
   0.6/tick; at 0 the flier takes a `grounded` recovery window (24 ticks,
   source `flight-fatigue`, ordinary CONDITION_APPLIED event). Air becomes a
   duty cycle instead of a state.
4. **Hover stays low** (`hoverStaysLow: true`): `hover` is a hand's-breadth
   float per canon (Orrin "drifts a hand's breadth above the ground") —
   ground altitude, melee-reachable, floats over water. Only true `flight`
   climbs.

Companion draft-layer correction (same decision): **grimspike reviewer price
override +$7.5M → $45.0M** (+20%, inside the ±25% §19.8 bound, D-013
precedent) — stat-bulk endurance is formula-v1-undervalued and he was the
only fighter >62% in every schedule of every battery ever run, at a price
already baked into those team constructions.

## Evidence (6 schedules × 8 seeds = 1,920 matches per arm, prices unchanged
between arms so schedules are identical; `npm run simulate -- --approachguard 0
--approachsurge 0 --flightupkeep 0 --hover-high` reproduces the baseline arm)

| Fighter | 0.2.0 | 0.3.0 levers | Note |
|---|---|---|---|
| razorback | 26.6% (every-schedule outlier) | 36.0% | flag cleared |
| ember-ronin | 30.1% | 34.7% | improving |
| solaria | 70.2% (every-schedule outlier) | 60.8% | flag cleared |
| cinder-wisp | 59.0% | 50.5% | centered |
| whisper | 41.0% | 48.1% | centered |
| grimspike | 66.9% | 69.1% | rises as artillery falls → price override |
| decisions | 21.4% | ~8% | matches end decisively far more often |
| zero-KO decisions | 2.1% | ~0.9% | below the D-017 floor |

Probe detail (melee trio vs artillery trio, 12 seeds): 0.2.0 gave the melee
trio 62 landed hits vs 721 taken and 0 groundings; 0.3.0 gives 111 landed,
50 forced groundings. The matchup stays artillery-favored — that is a
composition consequence, not a bug.

## Replay compatibility (locked law)

- All four levers are `Ruleset` fields; `RULESET_S0_V020` and
  `RULESET_S0_V010` are frozen archives with the levers zeroed/off, registered
  in `RULESETS_BY_VERSION`. Old manifests replay byte-identical (regression:
  `services/combat-sim/test/sim.test.ts` legacy-replay spec).
- `approachGuarded` is emitted only when the guard fired, so pre-0.3.0 event
  payloads are unchanged (same conditional-emission pattern as D-017's
  `healingMult`).

## Second wave (same decision): ambush payoff, grimspike telegraph

- **Stealth ambush** (`stealthAmbushBonus: 0.35`): the strike that breaks a
  `stealth_field` fighter's stealth lands ×1.35 (stealth was defense-only —
  an ambusher archetype with no ambush). Event carries `ambush: true`.
- **Grimspike content correction**: boulder-hurl wind-up 2→4 ticks
  (interruptible via stability break — wind-ups cancel on stagger/stun) and
  cooldown 36→44; knownIssues provenance in his file. Geology telegraphs.
- **Grimspike price override** +$7.5M → $45.0M (bounded ±25%, D-013 pattern).

## Where tuning STOPPED, and why (12 schedules × 8 seeds, post-reshuffle)

Fixed and stable: razorback 46.8%, cinder-wisp 55.0%, whisper 47.9%,
riptide 44.1%, vex 48.7%. Decisions 21.4%→~10%, zero-KO ~1–2%.

Residual watch items — deliberately NOT tuned further:

- **grimspike 72.1%** even at $45M with the telegraph. Every lever tried
  (bulk nerfs pre-D-014, healing damp, approach/flight rebalance, +20% price,
  wind-up telegraph) leaves him >62% in every schedule. Root judgment: AI
  self-play systematically overvalues unkillable bulk — bots neither kite,
  focus-fire, nor bait the new interruptible wind-up. The balance law already
  says AI-vs-AI is a smoke test; the human vertical-slice gate decides. If
  humans confirm dominance, the sketched next lever is core-exposure (his
  crystal core as a stability-break vulnerability window), which needs a
  provenance-reviewed content pass.
- **ember-ronin 30.2% / sable-howl 38.6% / aegis-9 36.4%**: the same
  self-play blindness inverted — duelist, ambusher, and protector archetypes
  whose value the bot AI cannot express (no duel discipline, no ambush
  patience, no peel positioning). Ambush bonus helps sable only marginally
  in-harness for exactly this reason. Human data first, then tune.
- **solaria 66.9% / orrin 63.8% / captain-meridian 60.6%**: down from the
  0.2.0 highs, schedule-dependent, monitored.

## Consequences

- Draft meta: artillery walls are contestable; flier duty cycles create the
  strike windows melee comps pay for. Watch item: sable-howl dipped to ~40%
  in the lever arm — inside band, monitored next battery.
- Grimspike at $45M shrinks his cap-legal trio pool (~30% fewer harness
  games); residual >62% aggregate is monitored post-reshuffle (schedule
  randomization trap — see balance memory).
- Any future engine-behavior change keeps the pattern: bump ruleset version,
  archive the old constant, preserve old event shapes.
