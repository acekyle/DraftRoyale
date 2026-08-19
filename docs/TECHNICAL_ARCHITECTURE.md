# Technical Architecture

> Living document. Last updated: 2026-08-19. Describes the system as built, then the planned
> topology. Anything not in this repository today is marked Planned.

## 1. Monorepo layout (Implemented)

npm workspaces, Node ≥ 20, TypeScript, Vitest. Zero paid dependencies.

```
packages/contracts     Shared schemas & types + content validators (single source of truth)
services/combat-sim    Deterministic, renderer-independent authoritative simulation
tools/                 Balance harness, pricing, draft-order fairness, content validation
content/               Versioned JSON content: fighters, wildcards, arenas
apps/web               Desktop-web client workspace slot (client in progress, not yet merged)
docs/                  Project records (this suite)
```

Package responsibilities:

- **`packages/contracts`** — every shape the sim, client, tools, and content agree on:
  enums, Character Contract, Combat DNA, wildcards, arenas, ruleset, teams, match manifest,
  events, outcomes, breakdown, champion record, team readout — plus `validate.ts`
  (fighter/wildcard/arena/team-legality validators) and `ruleset.ts` (Season 0 constants,
  price band). Schema versions are exported constants (all 0.1.0); breaking changes bump
  them with a migration note.
- **`services/combat-sim`** — `sim.ts` (MatchSim), `rng.ts` (seeded RNG + FNV-1a hash),
  `harness.ts` (manifest build/run/replay-verify), `breakdown.ts` (causal explanation),
  `commentary.ts` (event-grounded templates), `readout.ts` (own-team analysis),
  `pricing.ts` (transparent price formula). No rendering, no I/O, no model calls.
- **`tools`** — `simulate.ts` (seeded round-robin balance harness with win rates, durations,
  stalemate and determinism-failure counts), `price.ts` (stamps locked season prices into
  content), `validate-content.ts` (CI-style content gate, exit 1 on error),
  `draft-order.ts` (ABAB-vs-ABBA fairness evidence), `load-content.ts` (Node content loader).

## 2. Core principle: simulation separate from rendering

The sim emits **semantic events**, never pixels: 24 `MatchEventType`s including
ABILITY_STARTED/RESOLVED/INTERRUPTED, ATTACK_EVADED, DAMAGE_APPLIED, HEALING_APPLIED,
CONDITION_APPLIED/EXPIRED, STABILITY_BROKEN, WEAKNESS_TRIGGERED,
WILDCARD_DEPLOYED/DESTROYED/EXPIRED, TACTICAL_COMMAND_ISSUED/REJECTED, ALLY_PROTECTED,
RESERVE_ENTERED, FEATURE_DESTROYED, RESOURCE_DEPLETED, ESCALATION, FIGHTER_CONTAINED,
FIGHTER_KNOCKED_OUT, TURNING_POINT, MATCH_ENDED. Each event carries seq, tick, and typed
data. The renderer's job is "thin simulation, thick cinema": turn events into animation,
VFX, camera, and commentary. Breakdown and commentary consume the same log — one source of
truth for what happened.

## 3. Deterministic simulation design (Implemented)

- **Tick model**: fixed 250 ms ticks (4/sec). Soft limit 720 ticks (3:00) starts escalation
  (+15% damage every 80 ticks); hard decision limit 1080 ticks (4:30) — decision goes to
  higher team vitality %, then total damage as tiebreaker. Per tick: recompute context →
  wildcards → deployables → conditions → resources → escalation → reserves → command expiry
  → fighter decisions/ability resolution → movement → separation → victory check.
- **Seeded RNG**: one mulberry32 instance per match (`createRng(seed)`); every random draw
  (hit rolls, compliance rolls, jitter, spawn scatter) flows through it. No `Math.random`
  in the sim.
- **Determinism discipline**: fighters sorted deterministically at init; commands and
  wildcard deployments are timeline inputs replayed at exact ticks; no wall-clock reads.
- **Event log + replay hashing**: `hashRun` = FNV-1a over the serialized event log + outcome.
  `verifyReplay` runs a manifest twice and compares hashes; the balance harness re-verifies
  one seed per matchup and exits nonzero on any determinism failure.
- **Match Manifest** = complete reproduction record: ruleset version, arena id+version, seed,
  full team setups, per-fighter contract/DNA/price versions, wildcard versions, and the
  command + wildcard timelines. Same manifest ⇒ same outcome, bit-for-bit (tested).

## 4. Data model inventory (from `types.ts`, all Implemented)

- Enums/closed vocabularies: Division, Role (8), Chassis (4), DamageType (7), MovementMode
  (6), Eligibility (4), Tier (1–10), ConditionKind (18), AbilityKind (7), TargetingMode,
  PassiveKind (8), TargetPreference (5), BehaviorConstraint (6), WildcardClass (4),
  WildcardEffectKind (9), ArenaFeatureType (5), ReinforcementTrigger (5), FormationId (4),
  TacticalCommandKind (6), MatchEventType (24), MatchEndReason (3).
- Structures: Ability, Passive, Weakness, CustomResource, BehaviorSpec, EnvRule, SynergyRule,
  CharacterContract (+SourceReference, CharacterClaim), CombatDNA (+CombatAttributes),
  FighterFile, WildcardContract (+WildcardEffect), ArenaDef (+ArenaFeature), Ruleset,
  TeamSetup, TacticalCommand, WildcardDeployment, MatchManifest, MatchEvent, MatchOutcome,
  CausalBreakdown (+CausalFactor), ChampionRecord, TeamReadout.

## 5. Versioning strategy (Implemented in data; registry Planned)

Version everything: schema versions (exported constants), contract version, combat DNA
version, price version (locked per season; `PRICE_VERSION = 'S0'`), arena version, ruleset
version, and the manifest pinning all of them per match. `validateFighter` rejects
contract/DNA version mismatches. Current limitation (honest): the ruleset registry resolves
only Season 0 — replaying a manifest with an unknown ruleset version throws rather than
guessing. Historical records keep the versions they were played under.

## 6. Pricing pipeline (Implemented)

`computePrice` blends four transparent 0–100 scores — capability 42%, versatility 25%,
reliability 18%, inverse counterability 15% — into the 8M–50M band, rounded to 0.5M, with a
generated human-readable rationale. `npm run price` stamps prices into content files; prices
are then locked for the season. No LLM involvement anywhere in pricing.

## 7. Current topology (Implemented): local-only

Everything runs on the developer machine: tests and tools headless via tsx/Vitest; the
in-progress web client (Vite + TypeScript + Three.js) embeds the sim in-process for local
vs-AI and hotseat play, with localStorage persistence. **No server, no network play, no
accounts, no deployment exist.** The client workspace is configured (`npm run dev`) but the
`apps/web` directory is not yet merged into this repository.

## 8. Planned topology: server-authoritative competition

Phase 2 remainder (design intent — no code exists):

- **Control plane** (WebSocket): rooms, challenge links, guest identity, draft orchestration
  (ABBA turn enforcement server-side), team prep, wildcard lock/reveal, spectator fan-out,
  reconnect via manifest + event-log catch-up.
- **Combat host**: runs `MatchSim` server-side from the manifest; clients receive the event
  stream and render. Clients never report results — the draft-legality and price validators
  in `contracts/validate.ts` were written to be the server-side gate ("the client is never
  trusted with these", per the source).
- **Records store**: immutable manifests, event logs, hashes, champion records, price
  history.
- Any hosting that costs money is a Founder Gate (see docs/PROJECT_CONSTITUTION.md §6).

## 9. Platform path preservation

Decisions that keep Steam/console/mobile-companion doors open without building them now:

- Sim is dependency-free TypeScript with no DOM/browser coupling — portable to any host
  (native shell, server, worker).
- Renderer consumes semantic events, so a higher-fidelity native renderer can replace the
  web renderer without touching game logic.
- Input is intent-level (commands/tokens), not twitch control — viable on TV and touch; a
  mobile companion (draft/spectate/command) needs only the control plane, not the renderer.
- No platform-exclusive dependencies; content is plain versioned JSON.

## 10. Performance envelope (targets, not yet measured)

- Rendering: **720p30 minimum on recent integrated graphics; 1080p60 recommended** hardware.
- Load: web shell interactive < 3 s; draft room ready < 8 s; first battle renderable < 30 s;
  subsequent cached battles < 10 s (broadband assumptions).
- Simulation is already effectively free relative to rendering: the full 22-test suite
  including dozens of complete headless matches runs in ~0.5 s locally.
- A measured baseline on reference hardware is a Phase 4 exit requirement; no performance
  claims are made until then.
