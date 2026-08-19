# Character Compiler

> Living document. Last updated: 2026-08-19. **Current reality up front:** every character in
> the game today is a curated, hand-authored Character Contract + Combat DNA written by the
> team and checked by validators. LLM-assisted compilation is a gated future phase (Phase 3).
> This document describes both the implemented data model and the planned compiler around it.

## 1. What "compiling a character" means

A character enters the game as two linked artifacts (schema: `packages/contracts/src/types.ts`,
bundled per fighter as `FighterFile` in `content/fighters/*.json`):

1. **Character Contract** — the narrative, provenance, and approval record: who this character
   is, which version, what the evidence says, what was assumed, and what the creator approved.
2. **Combat DNA** — the mechanical translation the engine executes (documented separately in
   docs/COMBAT_DNA.md).

The compiler's job — human today, AI-assisted later — is to get from source material to a
Contract whose every mechanical consequence is traceable, then to a DNA that the deterministic
engine can run. AI never referees combat; it only compiles before and narrates after
(Product Constitution, locked law).

## 2. Character Contract schema walkthrough (Implemented)

`CharacterContract` fields, as defined in code:

- **identity** — fighterId, displayName, `version`, `continuity` (which universe/branch),
  `era`, creator, ownership (`studio_original | creator_owned | licensed | public_domain`),
  visibility (`private | published`), remixPolicy (`allowed_with_attribution | prohibited`),
  division, chassis. Versioned identity is what makes "never silently blend versions"
  enforceable: a different interpretation is a different fighterId/version, and
  `validateFighter` rejects contract/DNA version mismatches.
- **canon** — summary, `primarySources` (typed references: creator_lore, design_document,
  reference_image, external), `selectedInterpretation` (one sentence naming exactly which
  version this is), `disputedClaims`, `assumptions` (things the compiler had to invent,
  declared openly).
- **powerSources** — each power's origin, dependencies, and interruption conditions. These
  drive the DNA resource model (e.g. Solaria's `solar_charge` depends on daylight; its
  interruption conditions become mechanical drain/suppression).
- **capabilitySummary** — core / conditional / defensive / movement / signature capabilities
  in prose, before mechanical translation.
- **limitations** and **weaknessSummary** — severity-rated (minor/serious/defining), each with
  its condition or exposure method and an evidence reference.
- **behaviorSummary** — combat intelligence, tactical style, risk tolerance, ally protection,
  moral constraints, and command constraints in prose; translated into the DNA `BehaviorSpec`.
- **provenance** — the claims graph (§3) plus rolled-up conflicts, confidence, `creatorFacts`
  (stated by the creator), `aiAssumptions` (invented and disclosed), and
  `mechanicalNormalizations` (where raw fiction was bounded for fair play — e.g. Solaria's
  supernova normalized to a 10 m escalation ability, recorded in the shipped file).
- **approval** — creatorApproved flag, `semanticRevisionCount`, `visualRevisionCount`, and
  eligibility stage (§7).

## 3. Attribute Provenance Graph

Every mechanical property must be traceable end to end:

```
evidence (source reference)
  → claim (CharacterClaim: path, selectedValue, portrayalType, conditions, conflicts, confidence)
    → attribute / capability (Contract capabilitySummary + DNA attribute or ability)
      → conditions (context tags, resource dependencies, weakness triggers)
        → mechanical translation (numbers within validator bounds)
          → runtime effect (engine behavior + emitted MatchEvents)
```

**Implemented:** the `CharacterClaim` structure carries this chain in data (path,
selectedValue, portrayalType `repeatable | conditional | peak_feat`, conditions, evidence ids,
conflicts, confidence), and the shipped fighters populate it (e.g. Solaria's
`weaknesses.darkness` claim → darkness drain/weakness in DNA → `RESOURCE_DEPLETED` /
`WEAKNESS_TRIGGERED` events at runtime, surfaced in the causal breakdown).
**Planned:** tooling that renders the graph and verifies no DNA mechanic exists without a
claim behind it (today this is a review discipline, not an automated check).

## 4. Version ambiguity rules (locked)

- Never silently blend versions. One contract = one `selectedInterpretation` from one
  continuity/era.
- Conflicting portrayals are recorded in `disputedClaims` / claim `conflicts` with the chosen
  resolution and its evidence — the choice is visible, not laundered.
- Wanting a different version means authoring a different contract (new version/fighterId),
  each drafted and priced separately. The draft validator treats "duplicate exact version" as
  illegal in one draft; distinct versions are distinct market entries.

## 5. Source hierarchy and the typical-portrayal baseline

When sources disagree, precedence is:

1. Creator-stated facts about their own original character (`creatorFacts`).
2. Primary source material of the selected continuity/era.
3. Secondary/reference material.
4. Compiler assumption — allowed only when gaps remain, and always logged in
   `aiAssumptions` / `canon.assumptions`.

**Typical-portrayal baseline:** attributes are compiled to the character's *repeatable,
typical* portrayal in the selected continuity — not one-off peak feats. Peak feats may only
appear as `peak_feat` claims gated by explicit conditions (contextual abilities, escalation
finishers), never as the baseline. This keeps divisions and pricing honest.

## 6. Original-character gap rules

Originals (all Season 0 content is `studio_original`) have no external canon, so:

- The creator's lore/design documents are the primary sources and are cited like any canon.
- Gaps are filled by declared assumption, recorded in `aiAssumptions` (e.g. Solaria's exact
  darkness drain rate: "chosen for pacing (0.4 charge/tick)").
- **Ranked-eligible originals need ≥ 2 meaningful weaknesses/counterpaths** — enforced in
  code: `validateFighter` errors on fewer than 2 mechanical weaknesses, each requiring a
  concrete trigger vector.

## 7. Eligibility lifecycle

`Eligibility` (Implemented as schema + validator inputs; the promotion *process* around it is
Planned):

1. **Experimental** — schema-valid; playable in casual/private rooms only.
2. **Community Verified** — survived balance simulation and community play without breaking
   approval or balance gates.
3. **Ranked Eligible** — passed the full gate set: schema, ≥2 weaknesses, exactly 4 signature
   abilities, balance-harness win-rate bounds, creator approval.
4. **Tournament Frozen** — version-locked for a competitive season; changes require a new
   version.

Per-stage release gates are detailed in docs/QA_PLAN.md §5.

## 8. Live nomination target (Planned — Phase 3+)

Target experience for "compile a character live at the table": **~90 seconds, modular.**
The compiler streams stages (identity → sources → claims → capabilities → weaknesses →
behavior → DNA draft → price) so the room can watch and correct mid-stream, and slow stages
degrade gracefully to "finish in background". This is a design target only — no LLM
compilation code exists in the repository today.

## 9. Correction allowance (locked targets)

- Creators get a **semantic correction** pass ("that's not how her power works") and a
  **visual correction** pass ("she doesn't look like that") before approval; counts are
  tracked per contract (`semanticRevisionCount`, `visualRevisionCount` — Implemented as
  fields).
- Vertical-slice acceptance target: ≥ 85% of characters approved within **one** semantic
  correction (see docs/LAUNCH_PLAN.md).

## 10. Current reality vs the planned compiler

| Capability | Status |
|---|---|
| Contract + DNA schemas, versioning, validators | **Implemented** |
| Curated hand-authored fighters (2 in repo: Solaria, AEGIS-9; 12-fighter Season 0 roster in authoring) | **Implemented / in progress** |
| Transparent formula pricing (never LLM-invented) | **Implemented** (`pricing.ts`, `npm run price`) |
| Provenance graph rendering / automated traceability check | Planned |
| LLM compilation behind provider-neutral adapter interfaces | Planned (Phase 3, Founder Gate for any paid API) |
| Creator workshop UI (author, correct, approve, publish) | Planned (Phase 3) |
| Protected-IP request handling (transformed original alternative, disclosed) | Planned policy — see docs/SECURITY_AND_MODERATION.md §6 |
