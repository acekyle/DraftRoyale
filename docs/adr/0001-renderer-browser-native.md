# ADR-0001: Browser-native renderer (Three.js) for the vertical slice

- **Status:** Accepted (provisional — revisit criteria below)
- **Date:** 2026-08-19
- **Proposer:** Technical Architect · **Reviewers:** Game Client Lead, Executive Producer · **Red-team:** QA Lead

## Context

The constitution mandates a measured two-engine bake-off (Unity web vs a browser-native
candidate) before committing. This environment has **no Unity installation**; installing
Unity requires licensing decisions and tooling that fall under the Founder spending/tooling
gate. Halting all rendering work on that gate would block the entire vertical slice.

## Decision

Build the vertical-slice renderer browser-native with **Three.js**, while preserving every
condition needed to run the Unity half of the bake-off later:

1. The authoritative simulation is renderer-independent (`services/combat-sim` emits
   semantic events; the client only presents them). A Unity client could consume the same
   event contract without touching the sim.
2. The web client's battle scene doubles as the browser-native bake-off scene: 3 active
   fighters/side + reserves, standard/heavy/quadruped/floating chassis, melee, ranged,
   area, a wildcard field, tactical commands, destructible arena sections, and
   event-timeline replay — the representative scene the bake-off spec requires.
3. Performance/memory/load capture across Chrome/Edge/Safari is a Phase 2-remainder QA task.

Why Three.js over Babylon/PlayCanvas for the browser-native candidate: smallest dependency
surface, no editor/tooling lock-in, largest ecosystem, trivially embedded in the Vite
monorepo, MIT license. This was a short documented comparison, not a measured spike —
acceptable because the renderer is presentation-only and swappable by design.

## What this is NOT

This is **not** the completed engine bake-off. The Unity spike remains open
([BACKLOG](../BACKLOG.md), `[spike]`), gated on Founder approval of Unity tooling. If the
Unity spike later wins on the weighted criteria (especially Steam/console migration, 15%),
migration cost is bounded to the client package because of (1).

## Revisit criteria

- Browser performance misses the 720p30 minimum on integrated graphics, or
- Safari reliability failures exceed what progressive-quality tiers can absorb, or
- Steam/console phase begins (native client work makes the Unity comparison mandatory).

## Dissent

QA Lead notes the risk that "provisional" hardens into permanent by inertia; mitigated by
tying the revisit to the Phase 4 performance gate, which is a release blocker.
