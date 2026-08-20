# Decision Ledger

> Living document — updated 2026-08-19. Every material decision: proposer, reviewers,
> result, and where the evidence lives. Detailed rationale in [adr/](adr/).

| # | Date | Decision | Proposer → Reviewers | Result | Evidence |
|---|------|----------|----------------------|--------|----------|
| D-001 | 2026-08-19 | Monorepo: npm workspaces, TypeScript everywhere, shared `@arena/contracts` as single schema source | Tech Architect → Backend Lead, Client Lead | Accepted | repo layout |
| D-002 | 2026-08-19 | Deterministic sim: 250 ms ticks, mulberry32, timeline-as-input, FNV event hashing, 100% replay gate | Tech Architect → Combat Designer, QA (red-team) | Accepted | [ADR-0004](adr/0004-deterministic-sim-design.md), 22 passing tests |
| D-003 | 2026-08-19 | Browser-native Three.js renderer for slice; Unity bake-off half deferred behind tooling gate, portability preserved via event contract | Tech Architect → Client Lead, EP; QA red-team | Accepted (provisional) | [ADR-0001](adr/0001-renderer-browser-native.md) |
| D-004 | 2026-08-19 | Local-first slice (solo AI / hotseat / URL dethrone); control-plane bake-off deferred to online milestone | Backend Lead → Tech Architect, EP | Accepted | [ADR-0002](adr/0002-control-plane-local-first.md) |
| D-005 | 2026-08-19 | ABBA snake draft order for 1v1 | Draft Designer → Product Director, QA | Accepted | [ADR-0003](adr/0003-draft-order-abba.md): −$0.10M vs +$0.16M first-pick bias over 2,000 sims |
| D-006 | 2026-08-19 | No LLM calls in slice (compiler & commentary rule-based); LLM phases designed but Founder-gated (spend) | Compiler Lead → EP, IP Reviewer | Accepted | [ADR-0005](adr/0005-ai-boundaries-and-content-format.md) |
| D-007 | 2026-08-19 | JSON content format; YAML only as future creator-facing view | Compiler Lead → Tech Architect | Accepted | [ADR-0005](adr/0005-ai-boundaries-and-content-format.md) |
| D-008 | 2026-08-19 | Transparent pricing formula (capability .42 / versatility .25 / reliability .18 / inverse-counterability .15 → 8–50M band), machine-stamped, season-locked | Draft Designer → Combat Designer, EP | Accepted | `services/combat-sim/src/pricing.ts`, `npm run price` |
| D-009 | 2026-08-19 | Squad Relay reserve semantics: relay-on-defeat always guaranteed when team would field zero; plans add eager-swap triggers; swapped-out fighters do not return | Combat Designer → Draft Designer, QA | Accepted | sim `tickReserves`, GAME_BLUEPRINT |
| D-010 | 2026-08-19 | Containment as non-lethal defeat: `contained` lands only below 35% vitality, else degrades to a short root | Combat Designer → Compiler Lead | Accepted | sim `applyCondition` |
| D-011 | 2026-08-19 | Escalation stalemate-breaker: +15% cumulative damage every 20 s after 3:00; decision verdict at 4:30 by remaining team vitality | Combat Designer → Product Director, QA | Accepted | ruleset S0; harness duration stats |
| D-012 | 2026-08-19 | All 12 Season-0 fighters are studio originals; no protected-character content anywhere in the repo or product | IP Reviewer → EP, Compiler Lead | Accepted | content/fighters/* provenance blocks |
| D-013 | 2026-08-19 | Bounded reviewer price override for Orrin (+$5.5M, within the ±25% bound): suppression/containment utility is a formula-v1 blind spot; cross-schedule sims showed top-tier win contribution at a bottom-third price | Draft Designer → Combat Designer, EP; QA red-team (harness evidence) | Accepted | tools/price.ts override table; harness runs 2026-08-19 |
| D-014 | 2026-08-19 | Ember Ronin correction is mechanical, not numerical: empower stance replaced with a gap-closing dash (melee approach tax was the root cause); commentary gains phrase memory (escalating backoff + per-match line cap) after variety-analyzer findings | Combat Designer → QA Lead, Product Director | Accepted | 18.1%→32.0% cross-schedule; variety report 0 repetition findings |

## Standing dissent / open questions

- **QA:** "provisional" renderer decisions tend to calcify — revisit is wired to the Phase 4
  performance gate (release blocker) so it cannot be skipped silently.
- **Draft Designer:** current price band is compressed (~$29–40M); pricing-formula spread
  widening is an open tuning task (see Risk R-4) and may warrant a formula revision ADR.
- **Backend Lead:** URL-encoded dethrone links carry the champion team client-side; fine for
  local play, but online play must re-validate every frozen team server-side (noted in
  SECURITY_AND_MODERATION).
