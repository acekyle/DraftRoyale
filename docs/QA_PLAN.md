# QA Plan

> Living document. Last updated: 2026-08-19. Current verified state: **22 automated tests,
> all passing** (`npm test`: 12 in `services/combat-sim/test/sim.test.ts`, 10 in
> `packages/contracts/test/validate.test.ts`; last verified on this date). Everything else
> in the taxonomy is Planned and says so.

## 1. Test taxonomy

| Layer | Purpose | Status |
|---|---|---|
| Unit | Validators, pricing, readout, commentary in isolation | **Partial — implemented** (validator coverage strong; pricing/readout lack dedicated units) |
| Property | Invariants over many seeds (no negative resources, termination, event uniqueness) | **Implemented (initial)** — 2 property-style tests over 20+ seeds |
| Simulation | Full headless matches: determinism, replay, systems integration | **Implemented** — core of the current suite + `npm run simulate` harness |
| Integration | Draft→prep→battle→breakdown pipeline against real shipped content | Planned (currently exercised via programmatic fixtures, not shipped content) |
| Browser | Client flows (draft UI, battle rendering, hotseat) via automated browser | Planned (client not yet merged) |
| Performance | Load-time and frame-rate budgets on reference hardware | Planned (targets in docs/TECHNICAL_ARCHITECTURE.md §10) |
| Visual | Renderer output sanity (silhouette/color/readability regressions) | Planned |
| Safety | Content policy checks, moderation-path tests, prompt-injection resistance for Phase 3 compiler | Planned |

## 2. What the 22 existing tests actually cover

### `services/combat-sim/test/sim.test.ts` (12)

**Deterministic simulation (4):**
1. A match reaches a terminal state, within the hard tick limit, ending in `MATCH_ENDED`.
2. Identical manifests reproduce identical event/outcome hashes across 6 seeds — the
   automated form of the 100% replay-reproduction gate.
3. Different seeds produce different battles (seeded variation, not a fixed script).
4. A manifest with command + wildcard timelines replays deterministically and emits the
   corresponding `WILDCARD_DEPLOYED` / `TACTICAL_COMMAND_ISSUED` events.

**Property invariants (2):**
5. Across 20 seeds: vitality/stamina/primary resources never negative; matches always
   terminate within the hard limit.
6. Each knocked-out fighter emits exactly one KO event.

**Squad relay (1):**
7. Reserves enter when an active fighter is defeated.

**Tactical commands (2):**
8. Commands consume tokens; a third command is refused (2-token budget).
9. Behavior constraints reject conflicting commands ("contract over commands" —
   `never_retreats` refuses disengage, with a `TACTICAL_COMMAND_REJECTED` event).

**Wildcards (2):**
10. One wildcard per player; a second deploy is refused.
11. An eclipse-style global condition removes `daylight`/adds `darkness` and suppresses
    context-gated solar regen (the flagship character–wildcard–environment interaction).

**Explainability (1):**
12. Every finished match yields a causal breakdown (summary, factors, 6 per-fighter rows)
    and commentary lines that reference only ticks present in the real event log.

### `packages/contracts/test/validate.test.ts` (10)

**Draft legality — server-side, never client-trusted (6):**
1. Accepts a legal 3-fighter roster.
2. Rejects salary-cap violations.
3. Rejects duplicate exact versions in one draft.
4. Rejects price tampering (client reporting a discounted price vs the locked price).
5. Rejects rosters outside 3–5 and wrong active counts.
6. Rejects a captain outside the roster.

**Wildcard normalization (4):**
7. Every wildcard must declare counterplay.
8. Object wildcards must be destructible (HP > 0).
9. Wildcards must manifest visibly.
10. Unbounded durations are rejected.

## 3. Standing tooling gates (Implemented, run on demand)

- `npm run validate` — every content file against schema/bounds validators; exit 1 on error.
- `npm run simulate` — seeded round-robin over shipped content: win rates with outlier flags
  (>62% / <38%), duration stats, stalemate counts, and a replay determinism check per
  matchup that fails the run on any mismatch. (Currently skips gracefully below 6 fighters —
  it activates fully as the parallel content workstream lands the roster.)
- `npm run price` — reprice check; diffs against locked prices indicate an unauthorized
  balance drift.

## 4. Determinism / replay requirements (locked)

- **100% replay reproduction, enforced automatically.** Same manifest ⇒ same FNV-1a hash of
  (event log + outcome). Tested directly (suite) and continuously (harness).
- Determinism rules for contributors: all randomness through the match RNG; no wall-clock,
  no unordered iteration over maps/objects feeding outcomes; commands/wildcards enter only
  via tick-stamped timelines; any new nondeterminism source is a release blocker.
- Planned hardening: cross-platform hash verification (different OS/Node versions), and a
  golden-manifest corpus replayed on every CI run once CI exists.

## 5. Release gates per eligibility stage

Gates a fighter/wildcard must pass to advance (`validation.eligibility`); the schema half is
enforced today by validators, the simulation and human halves are process:

| Stage | Gate (cumulative) | Enforced today by |
|---|---|---|
| Experimental | Schema + bounds validation passes (`npm run validate`) | **Code** |
| Community Verified | Balance harness: no win-rate outliers over the seeded round-robin; no determinism failures; no crash/known-issue reports from casual rooms | Harness (code) + process |
| Ranked Eligible | ≥2 meaningful weaknesses, exactly 4 signatures (code-enforced); price stamped by the pricing tool; creator approval recorded; passes suite recorded in `validation.passedSuites` | Code + process |
| Tournament Frozen | Version-locked; any change requires a new version and re-entry at Experimental | Process (planned tooling) |

## 6. Planned test work (priority order)

1. Integration suite over **shipped content** (not just fixtures): full pipeline
   draft→readout→battle→breakdown for every legal Season 0 matchup sample.
2. Unit coverage for `pricing.ts` (formula regression lock) and `readout.ts` (never outputs
   a win probability — encode the locked law as a test).
3. Browser tests for the client once merged (hotseat happy path, draft legality UI, replay
   viewer).
4. Performance budget checks on reference hardware (Phase 4 exit requirement).
5. Safety suite alongside Phase 3: compiler prompt-injection cases, moderation-path tests,
   content-policy regression fixtures.
6. CI pipeline (free tier only unless the Founder approves spend) running: typecheck, tests,
   content validation, balance harness smoke, golden-manifest replay.

## 7. Bug policy

Determinism breaks, draft-legality bypasses, and locked-law violations (e.g. anything making
an LLM outcome-deciding, any win-probability leak in the readout) are severity-1: fix before
any other work ships. Known issues on content ride in `validation.knownIssues` and block
Ranked Eligible promotion until cleared.
