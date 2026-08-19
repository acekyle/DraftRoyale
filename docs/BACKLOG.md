# Backlog

> Living document. Last updated: 2026-08-19. Phase-organized. A checked box means the work
> is verifiable in this repository today; in-progress items say so explicitly. Labels:
> **[founder-gate]** requires explicit Founder approval before starting/spending,
> **[spike]** timeboxed investigation, **[risk]** known risk attached — see the item.

## Phase 0 — Proof Architecture ✅ (complete)

- [x] Monorepo scaffold (npm workspaces, TypeScript, Vitest, tsx; zero paid dependencies)
- [x] Shared contracts package: full schema suite (Character Contract, Combat DNA, wildcards,
      arenas, ruleset, teams, manifest, events, outcomes, breakdown, champion, readout)
- [x] Season 0 ruleset constants (tick 250 ms, $100M cap, 3–5 roster, ABBA, 2 tokens,
      1 wildcard, escalation + hard decision limits, Enhanced division)
- [x] Content validators with hard bounds (fighter / wildcard / arena / team legality)
- [x] Decision evidence tooling: draft-order fairness simulation (ABAB vs ABBA)

## Phase 1 — Deterministic Combat Core ✅ (complete)

- [x] MatchSim: tick loop, seeded RNG (mulberry32), utility-based fighter decisions,
      movement/formations/separation, conditions (18 kinds), resources + custom power
      sources, weakness triggers, guarding/stability, stealth, counters, summons/deployables
- [x] Squad Relay: reserves, reinforcement triggers, tactical swaps
- [x] Tactical command tokens with behavior-constraint and compliance rejections
- [x] Wildcard runtime: 4 classes, 9 effect kinds, deployment/destruction/expiry, impact
      tracking
- [x] Arena features: cover vs ranged, destructibles, water terrain, context grants
- [x] Escalation stalemate-breaker + hard decision limit
- [x] Match Manifest build/replay; FNV-1a replay hashing; `verifyReplay`
- [x] Causal breakdown builder (event-log-grounded factors, turning point, per-fighter stats)
- [x] Template commentary from real events (deterministic; no LLM)
- [x] Team Readout (own-team only, 12 axes, no win probability)
- [x] Transparent pricing formula + season price locking tool
- [x] Balance harness (round-robin, win-rate outlier flags, determinism check)
- [x] Test suite: 22 passing (determinism/replay, property invariants, relay, commands,
      wildcards, explainability, draft legality, wildcard normalization)

## Phase 2 — Draft-to-Battle Loop (in progress)

Content + client (parallel workstreams, underway):

- [~] Season 0 roster: 12 curated original fighters — **2 of 12 in repo** (Solaria, AEGIS-9)
- [~] Season 0 wildcards: 8 templates — **2 of 8 in repo** (Total Eclipse, Aegis Beacon)
- [x] Season 0 arena: Meridian Plaza (full pre-draft disclosures)
- [ ] Run `npm run price` across final roster; lock S0 prices (current files carry
      provisional prices pending the stamp)
- [ ] Full-roster balance-harness pass; resolve win-rate outliers before Community Verified
- [~] Desktop-web client (Vite + TS + Three.js): draft → prep → readout → wildcard →
      battle → breakdown → champion → run-it-back; local vs-AI and hotseat; procedural
      chassis placeholder rendering; localStorage persistence — **in progress, not yet
      merged into this repo**
- [ ] Integration tests over shipped content (see docs/QA_PLAN.md §6)

Phase 2 remainder (online layer — not started):

- [ ] WebSocket control plane: rooms, challenge links, guest entry (no account), draft
      orchestration, wildcard lock/reveal [risk: first networked trust boundary — apply
      docs/SECURITY_AND_MODERATION.md §4 from day one]
- [ ] Server-authoritative combat host (sim runs server-side; clients render event stream)
- [ ] Spectators (event fan-out, join-in-progress catch-up)
- [ ] Reconnect (manifest + event-log resume)
- [ ] Signed manifests + append-only records store (immutable champions/prices/replays)
- [ ] [spike] Free-tier hosting options survey — **produces a proposal only**;
      any actual hosting spend is [founder-gate]

## Phase 3 — Character Creation (not started)

- [ ] Creator workshop UI: author contract + DNA with live validation; correction passes
      (semantic/visual counts); publish/remix/attribution controls
- [ ] [founder-gate] LLM compiler adapters behind provider-neutral interfaces — interface
      first, local/mock implementation free; any paid API key requires Founder approval
- [ ] Compiler pipeline stages per docs/WILDCARD_SYSTEM.md §4 and
      docs/CHARACTER_COMPILER.md §8 (90-second modular live-nomination target)
- [ ] Prompt-injection red-team suite + schema-constrained outputs + post-generation
      validation/moderation [risk: T4/T5 in docs/SECURITY_AND_MODERATION.md]
- [ ] Provenance graph tooling: render evidence→claim→mechanic chains; automated
      no-mechanic-without-claim check
- [ ] Eligibility promotion tooling (Experimental → Community Verified → Ranked Eligible →
      Tournament Frozen) with recorded gate results
- [ ] [founder-gate] [spike] 3D character generation bake-off (candidate tools, quality vs
      the Art Bible, cost table) — **REQUIRES Founder-approved spend before any paid tool
      or API is touched**; free/procedural pipeline remains the fallback
- [ ] Moderation pipeline for user content: pending-by-default, review queue, upload
      scanning

## Phase 4 — Social Vertical Slice (not started)

- [ ] [founder-gate] Deployment (hosting, domain, TLS) — **REQUIRES Founder approval**;
      includes exposure review (docs/PROJECT_CONSTITUTION.md §5, gate #6)
- [ ] Crash reporting (self-hosted/free tier unless approved otherwise)
- [ ] Analytics wiring: the 12-event funnel + Run-It-Back Rate
      (docs/LAUNCH_PLAN.md §3–4); synthetic/real separation enforced in the pipeline
- [ ] Champion share + dethrone links end-to-end
- [ ] Moderation basics live: reporting, blocking, queue, audit log (public-launch
      requirement)
- [ ] Performance baseline measured on reference hardware (720p30 integrated /
      1080p60 recommended; load budgets) — no performance claims before this
- [ ] Session-integrity hardening: room/guest tokens, rate limits

## Phase 5 — Closed Alpha & Launch Validation (not started)

- [ ] Stage 1: ≥10 founder-adjacent friend groups through full sessions
- [ ] Measure the vertical-slice acceptance gate (docs/LAUNCH_PLAN.md §2): run-it-back ≥60%,
      character approval ≥85% within one semantic correction, winner-explanation ≥85%,
      crash-free ≥95%, dethrone usage ≥50%, replay reproduction 100%
- [ ] Correction-loop instrumentation (semantic/visual revision counts per contract)
- [ ] Stage 2: competitive/creator captains; Stage 3: waitlist intake in group batches
- [ ] Weekly Executive Digest includes real human metrics for the first time
      (never before — see the synthetic-data rule)
- [ ] Post-gate review: go/no-go on broader public alpha [founder-gate]

## Explicitly deferred (each needs its own Founder Gate to even schedule)

- Ranked matchmaking · monetization of any kind · paid marketplace · voice chat ·
  additional divisions beyond Enhanced · brackets/tournaments · mobile companion ·
  Steam/console packaging (path preserved per docs/TECHNICAL_ARCHITECTURE.md §9)
