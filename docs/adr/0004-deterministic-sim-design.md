# ADR-0004: Deterministic simulation design (ticks, RNG, hashing)

- **Status:** Accepted
- **Date:** 2026-08-19
- **Proposer:** Technical Architect · **Reviewers:** Combat Systems Designer, QA Lead · **Red-team:** QA Lead

## Decisions

1. **Fixed 250 ms tick** (4 ticks/s). Coarse enough for cheap headless simulation
   (thousands of balance matches per minute), fine enough for readable pacing; the
   renderer interpolates between ticks so presentation is smooth at any frame rate.
2. **mulberry32 seeded RNG**, single stream per match. Every random draw (hit rolls,
   AI jitter, spawn scatter) flows through it; `Math.random`/`Date` are banned in sim code.
3. **Command/wildcard timelines are inputs.** Player actions are recorded into the
   MatchManifest with their `issuedTick` and applied before that tick's step — live play
   and replay share one code path (`runManifest`).
4. **Replay verification = FNV-1a hash** over the full ordered event log + outcome.
   `verifyReplay` runs the manifest twice and compares hashes; the automated gate requires
   100% reproduction (currently enforced in tests and the balance harness).
5. **Stable iteration order** everywhere (fighters sorted by teamId+fighterId at init) so
   no map/object ordering can leak nondeterminism.

## Known risk: cross-platform float determinism

JS float math is deterministic per engine, and in practice consistent across modern
IEEE-754 JS engines, but we do not yet CLAIM cross-browser bit-identical replays — that
requires a conformance test matrix (Phase 2 remainder). Two mitigations if drift appears:
(a) authoritative outcomes are computed server-side once online play exists, with clients
replaying events, not re-deriving outcomes; (b) the damage pipeline can be quantized to
fixed-point without redesign. Risk logged in RISK_REGISTER.

## Accepted stat impurity (documented, deterministic)

`suppressionFighterTicks`/`groundedFighterTicks` wildcard-impact counters increment inside
query paths, so they measure "query-weighted exposure", not exact fighter-ticks. They are
only used to RANK causal factors, never to decide outcomes, and they are fully
deterministic. Cleanup tracked in BACKLOG.
