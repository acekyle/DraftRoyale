# ADR-0008: Deterministic rule-based character & wildcard compilers (Season 0)

- **Status:** Accepted
- **Date:** 2026-08-19
- **Proposer:** Character Canon & Compiler Lead · **Reviewers:** Executive Producer, IP & Safety Reviewer · **Red-team:** QA Lead

## Context

The "type any character / any wildcard" promise is core to the product, but LLM
API usage is Founder-gated spend. Waiting for the gate would leave the live
custom nomination flow (§11 Step 7, §22) completely unbuilt and untested.

## Decision

Ship **deterministic rule-based compilers** now behind the exact provider-neutral
signatures an LLM implementation will use later (`compileFighterFromText`,
`applySemanticCorrection`, `applyVisualCorrection`, `compileWildcardFromText` in
`@arena/character-compiler` / `@arena/wildcard-compiler`):

- Keyword taxonomy → power families → authored ability templates, chassis/role/
  movement inference, attribute modulation with a division soft-cap, ≥2 auto-
  derived weaknesses (opposing-family table), full Character Contract with
  provenance (`creator_lore` = the typed description; every inference listed in
  `aiAssumptions`, every clamp in `mechanicalNormalizations`).
- Unbounded clauses ("invincible", "instantly kills") are stripped and disclosed,
  never granted. Protected-IP names and real-person patterns are transformed into
  disclosed originals or blocked (§33) — keyword-list guards, honestly labeled as
  shallow in the compiler notes.
- Wildcards compile ONLY into the closed `WildcardEffectKind` DSL, are normalized
  (broad → symmetric/weaker), always carry counterplay, and pass `validateWildcard`.
- All output is `experimental` eligibility: private rooms only, never ranked.
- Same code runs client-side (local modes) and server-side (online experimental
  rooms) — determinism makes that safe.

## Why not wait for the LLM

The entire *pipeline* around interpretation (contract shape, validation, bounds,
pricing, corrections, eligibility, UI, moderation seams) is now real and tested;
the LLM upgrade becomes an interpretation-quality swap rather than a system
build. The honest limitation: rule-based interpretation is shallow — it cannot
capture nuanced lore. That is disclosed in-product via compiler notes and in
KNOWN_LIMITATIONS, and semantic fidelity is the headline criterion for the gated
LLM bake-off.
