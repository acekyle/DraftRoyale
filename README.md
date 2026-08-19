# Infinite Arena (working codename — repo: DraftRoyale)

**Social competitive 3D draft-battle simulator with an expandable character and wildcard compiler.**

> "Run it back. I know what team can beat that."

Players receive a salary cap, draft a fresh team of powerful characters, add one wildcard
element, and watch the resulting teams fight through a cinematic but explainable 3D battle.

- **Draft** creates the argument.
- **Battle** settles it.
- **Champion** creates the next argument.

## Status

Phase 0/1/2 bootstrap: deterministic combat core, shared schemas, curated content, and a
playable desktop-web vertical slice (draft → prepare → wildcard → battle → breakdown →
champion → run it back). See [docs/](docs/) for the full project records, including the
[Decision Ledger](docs/DECISION_LEDGER.md), [Risk Register](docs/RISK_REGISTER.md), and
[Known Limitations](docs/KNOWN_LIMITATIONS.md).

## Quick start

```bash
npm install
npm run dev        # playable slice at http://localhost:5173
npm test           # unit + property + determinism tests
npm run simulate   # headless balance harness (seeded matchups)
npm run validate   # validate all content against schemas
```

## Monorepo layout

```
apps/web              Desktop-web client (Vite + TypeScript + Three.js)
services/combat-sim   Deterministic, renderer-independent authoritative simulation
packages/contracts    Shared schemas & types (Character Contract, Combat DNA, Wildcards,
                      Match events, Match Manifest, Ruleset) + content validators
content/fighters      12 curated original fighters (Character Contract + Combat DNA)
content/wildcards     8 validated wildcard templates
content/arenas        Curated destructible arena(s)
tools                 Balance harness, pricing generator, draft-order simulation
docs                  Project constitution, blueprints, ledgers, ADRs
```

## Core principles (locked)

1. Fresh salary-cap drafts every match — no persistent power progression, no pay-to-win.
2. AI compiles characters before combat and narrates after it; the deterministic rules
   engine alone decides live outcomes.
3. Every match result is causally explainable and exactly replayable from its Match Manifest.
4. Authored animation atoms, unpredictable battles — never repetitive combat loops.
5. History is never erased: champions, prices, versions, and replays are immutable records.
