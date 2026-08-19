# Wildcard System

> Living document. Last updated: 2026-08-19. Wildcards are the one player-authored variable
> each match: a compiled battlefield element locked before battle. The schema, engine
> effects, and validators described here are **Implemented**; the live natural-language
> compiler pipeline is the Phase 3 target, with Season 0 shipping curated templates.

## 1. Wildcard Contract schema (Implemented)

`WildcardContract` (`packages/contracts/src/types.ts`), stored per wildcard in
`content/wildcards/*.json`:

- **Identity**: wildcardId, version, creator, `inputDescription` (the request as typed),
  `normalizedName` (what it became).
- **Classification**: `class` (§2), `deployment` (`placed | global`), `radius` (≤25 m bound),
  `durationTicks` (≤720 bound; 0 = match-permanent, terrain only), `objectHp` (objects must
  be destructible — hp > 0 enforced).
- **Effects**: a list of closed-vocabulary `WildcardEffect`s (§3), each declaring `affects`:
  `enemies | allies | both` — "both" is "the honesty price of broad power" (quoted from the
  schema itself).
- **Disclosure fields**: environmentalInteractions, sideEffects, `counterplay` (≥1 required —
  validator enforced), visualManifestation (required — invisible wildcards are rejected),
  audioManifestation.
- **Governance**: confidence, provenance, moderation status, eligibility stage.

## 2. The 4 manifestation classes

| Class | What it is | Engine handling (Implemented) |
|---|---|---|
| **object** | A physical destructible thing (beacon, turret, totem) | Has HP; attackable; destroying it is built-in counterplay (`WILDCARD_DESTROYED`). High-tactical-intelligence AI targets harmful objects on its own. |
| **field** | An area effect over a radius | Per-tick effects on fighters inside the radius while it lasts (`WILDCARD_EXPIRED` at end). |
| **condition** | A global match-state change (weather, eclipse) | Adds/removes match context tags; interacts with env rules, context-gated abilities, and resource regen. |
| **terrain** | A persistent battlefield reshaping | May be match-permanent (durationTicks 0); terrain water interacts with movement (non-hydro ground fighters slowed). |

## 3. Effect vocabulary (closed, Implemented)

`suppress_tags` (disable tagged abilities/passives/resources in area — tags required),
`dot` / `hot` (damage/healing per tick — positive magnitude required), `speed_mult`,
`accuracy_delta`, `ground_flight` (forces fliers down), `stealth_bonus`,
`add_context_tags` / `remove_context_tags`. Nothing outside this list can exist in content;
new effect kinds are engine changes (schema + validator + sim + tests).

Engine integration: one wildcard per player per match (enforced at deploy time), deployment
position clamped to arena bounds, per-instance impact tracking (damage, healing, suppression
fighter-ticks, grounded fighter-ticks) feeding the post-match causal breakdown, and
`enemy_wildcard_deployed` reinforcement triggers reacting to deployment.

## 4. Compiler pipeline

The full pipeline a wildcard request passes through. In Season 0 the "compiler" is the
curation team following these stages by hand; in Phase 3 an LLM performs the early stages
with the same outputs, and the validators/engine remain the sole authority on what runs.

1. **Interpret** — parse the player's request (`inputDescription`) into intent.
2. **Classify** — choose one of the 4 manifestation classes.
3. **Target** — decide affected parties per effect (enemies / allies / both).
4. **Interactions** — enumerate environmental interactions with arena tags and known kits.
5. **Specificity** — resolve vague requests into concrete magnitudes, radii, durations.
6. **Normalize** — apply the balance rules (§6): bound magnitudes, add symmetry or side
   effects to broad power.
7. **Counterplay** — attach at least one real counterplay path (hard requirement).
8. **Compile** — emit the mechanical `effects` list in the closed vocabulary, within
   validator bounds.
9. **Visualize** — define visual + audio manifestation (must be visible; invisible influence
   is banned).
10. **Show exact mechanics** — the player sees the compiled numbers, not vibes, before
    committing.
11. **Lock** — the choice is committed and hidden from the opponent.
12. **Reveal** — after both players lock, both wildcards are revealed.

Steps 10–12 are a UI flow of the in-progress client; the data contract for them is complete.

## 5. Counterplay requirement (locked, validator-enforced)

Every wildcard must ship ≥1 counterplay path or it fails validation. Canonical paths:
destroy the object (objects must have HP), leave/deny the radius, wait out the duration,
exploit the symmetry harder than the opponent, or bring a kit that ignores the effect.

## 6. Normalization rules

- **Broad = weaker or symmetric.** Arena-wide conditions affect both teams (a
  one-team global condition is flagged by the validator for normalization review) or carry
  meaningfully weaker magnitudes than a placed field.
- Bounded everything: duration ≤ 720 ticks (3:00), radius ≤ 25 m, dot/hot magnitudes
  positive and reviewed against vitality pools.
- Power wants a cost: strong effects get side effects, destructible anchors, or positioning
  demands, recorded in `sideEffects`.
- No unwinnable states: a wildcard may tilt a match, never end it by itself.

### Rejected-request examples

| Request | Ruling |
|---|---|
| "All enemies instantly die" | Rejected — wildcards alter the field, they do not decide outcomes. Offered instead: a bounded damage field with counterplay. |
| "Permanent invisibility for my whole team" | Rejected — invisible, uncounterable influence. Offered: a timed stealth-bonus field that acting breaks. |
| "Disable the enemy team's powers for the whole match" | Rejected — exceeds duration bound, no counterplay. Offered: a destructible suppression object with tag-scoped effect. |
| "A meteor that destroys the arena" | Rejected — removes the fight. Offered: a placed dot field with visual spectacle and a safe zone. |
| "My fighters can't be hit" | Rejected — no counterplay path exists by construction. |

## 7. Season 0 catalog

Season 0 ships **8 curated wildcard templates** (players pick and place; free-text compilation
is Phase 3). Honest status: **2 of 8 are checked into the repo**; the remaining 6 are being
authored in the parallel content workstream and must pass `npm run validate` before merge.

In repo now:

1. **Total Eclipse** (`eclipse`) — global condition, 240 ticks: removes `daylight`, adds
   `darkness`, affects both teams. Counterplay: wait it out, exploit the dark harder, or
   draft no light-dependency. Covered by an automated engine test.
2. **Aegis Beacon** (`aegis-beacon`) — placed object, 70 HP, 7 m, 320 ticks: heals allies
   0.8 vitality/tick in radius. Counterplay: destroy it, fight away from it, out-burst it.

Planned templates (authoring, subject to validation): remaining 6 across the object / field /
condition / terrain classes to give each class ≥1 offensive and ≥1 non-offensive option.

## 8. Player flow rules (locked)

- 1 wildcard per player per match (Season 0 ruleset; engine refuses a second deploy).
- Exact compiled mechanics visible to the owner before lock; both revealed after lock.
- Wildcards are deployed at a chosen moment and position during battle by the player —
  timing is a real skill expression (`WILDCARD_DEPLOYED` at the recorded tick, replayable
  from the manifest's wildcard timeline).
- User-authored wildcards (Phase 3+) pass moderation before any shared room sees them
  (`moderation: approved | pending | rejected` field exists today).
