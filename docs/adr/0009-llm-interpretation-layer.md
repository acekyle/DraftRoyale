# ADR-0009: LLM interpretation layer for the compilers (Gate 2)

- **Status:** Accepted (Founder approved the API budget 2026-08-19)
- **Date:** 2026-08-19
- **Proposer:** Character Canon & Compiler Lead · **Reviewers:** Technical Architect, IP & Safety Reviewer · **Red-team:** QA Lead

## Decision

Claude (`claude-opus-5`, structured outputs via `client.messages.parse` +
`zodOutputFormat`) performs **interpretation only**. For fighters it emits a
bounded overlay of the existing `CompileSpec` intermediate (families from the
authored taxonomy, 13 attributes, ≥2 weaknesses as trigger vectors, narrative,
and mandatory disclosure lists); for wildcards, a draft constrained to the
closed `WildcardEffectKind` DSL. Everything then flows through the SAME
deterministic assembler, clamps, normalization rules, and validators as the
rule-based path — the model never authors runtime mechanics (Product Law 4.5
"AI is the compiler, not the referee" holds mechanically, not by trust).

Key properties:

- **Fallback by construction:** any model/network/schema/validation failure
  returns the deterministic compiler's result with a disclosure note. No key →
  fallback. The 128-test suite runs entirely on the fallback path.
- **Server-only:** the SDK lives behind `@arena/character-compiler/llm` /
  `@arena/wildcard-compiler/llm` subpath exports imported only by the control
  plane. Keys never reach the browser; local client modes stay deterministic.
- **Race-safe wiring:** nomination/correction/custom-wildcard rights are
  reserved before the async call and reverted on failure; results arriving
  after a phase change are discarded.
- **Provenance honesty:** the prompt requires exhaustive `creatorFacts` /
  `assumptions` / `normalizations`; IP and real-person requests come back
  `transformed=true` with an explicit in-product disclosure (§33), replacing the
  shallow keyword guards as the primary detector (keyword guards remain in the
  fallback path).
- **Spend accounting:** every call logs tokens + running cost estimate
  (`llmSpendSummary()`), feeding the Cost Ledger's unit-economics table.

## Alternatives considered

Full-fighter JSON generation by the model (rejected: giant schema, validator
whack-a-mole, and it would put the model one step from authoring mechanics);
tool-use agentic compilation (rejected: latency vs the 90-second live-draft
target; a single structured call fits the budget and the deadline).
