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

---

## Verification findings — live E2E pass, 2026-08-19 (Executive Producer)

Full solo-mode loop verified in-browser with zero console errors: guest entry → arena
reveal → ABBA draft (inspection, cap enforcement, AI opponent, roster lock) → team prep +
readout → wildcard exact-mechanics/lock/reveal → live 3D battle (eclipse lighting change,
focus command, enemy counterplay destroyed the Nullstone Shard, escalation flag, decision
verdict) → causal breakdown (draft value, weakness exploitation, turning point, command +
wildcard factors, transcript) → champion record → run-it-back restart. Polish items observed:

- [ ] [qa] E2E coverage for `ally_below_35` relay swap — a 4-roster match saw the reserve
      never enter despite heavy damage on an active (heals may have kept everyone above the
      threshold at check time; needs a deterministic test either way)
- [ ] [gameplay] Sustain-heavy comps can carry a full match to the 4:30 decision with zero
      KOs — consider escalation also damping healing, or a shrinking-zone pressure
- [ ] [gameplay] AI wildcard selection is random — should score wildcards against both
      drafts (it picked anti-solar Nullstone while fielding Solaria)
- [ ] [frontend] Team Readout axis bars render near-empty for mid values — display scaling
- [ ] [frontend] Fights can drift into arena corners — add soft centering pressure or
      camera framing bias
- [ ] [frontend] Inspect-drawer clicks can land on re-flowed cards after background scroll —
      lock body scroll while the drawer is open

---

## Online milestone — landed 2026-08-19 (second wave)

- [x] [multiplayer] Control plane: rooms, guest sessions + token reconnect, server-authoritative draft/prep/wildcard/battle, spectators (20), reactions, rate limits, JSONL persistence (ADR-0006)
- [x] [multiplayer] Lockstep-deterministic clients with server hash authority (ADR-0007); live two-client match verified
- [x] [compiler] Deterministic character + wildcard compilers, 15-family taxonomy, corrections, IP/real-person transforms, unbounded-clause normalization (ADR-0008); live nomination + typed custom wildcard flows in local AND online modes
- [x] [qa] Playwright E2E (6 specs, chromium+webkit); schedule-randomized balance harness; combat-variety analyzer (0 repetition findings after commentary phrase memory)
- [x] [qa] Replay Original for custom content: match records persist compiled contracts; replay-to-hash test
- [x] [gameplay] Balance pass with trustworthy cross-schedule evidence; Orrin reviewer override (D-013); Ember gap-closer (D-014); AI-drafter soft-lock fix
- [x] [frontend] Champion card PNG export, accessibility settings, crash capture, challenge-under-current-rules, drawer scroll-lock
- [x] Governance: CODEOWNERS, protected main with required CI check

### Next free work (no gates)
- [ ] [multiplayer] Online rematch/run-it-back within a finished room; dedicated room_closed signal; protocol rev-2 items from ADR-0006
- [ ] [gameplay] Basic 4-player bracket (local room sequencing first)
- [ ] [gameplay] AI opponent wildcard selection should score against both drafts
- [ ] [qa] Safari/JavaScriptCore lockstep divergence trial (two-browser matrix)
- [ ] [frontend] Team Readout axis bar scaling; camera corner-drift bias; escalation-vs-sustain tuning experiment (healing damp)

### Founder-gated (spend/accounts — the current stop-line)
- [ ] [founder-gate] Alpha hosting/deployment (static client + room server) → unlocks Stage 1 friend-group testing
- [ ] [founder-gate] LLM API budget → semantic-fidelity upgrade for both compilers behind existing signatures
- [ ] [founder-gate] 3D generation bake-off credits → real fighter models/preview
- [ ] [founder-gate] Unity tooling → completes the deferred engine bake-off half (ADR-0001)
