# 3D Generation Bake-off — RESULTS (2026-08-21)

> Executed under D-024 ($100 hard ceiling). **Verdict: GATE PASSED.**
> Scoring per RUBRIC.md (0–30, ≥18 passes, no-zero on silhouette/budget).
> All artifacts in results/ (gitignored); every paid action in spend-log.jsonl.

## Final scores

| Fighter | Meshy | Tripo | Notes |
|---|---|---|---|
| Ember Ronin (humanoid) | **20 ✓** | **20 ✓** | Meshy: auto-rigged + walk/run animations. Tripo: best stylization, nailed ember palette identity; faceless head |
| Razorback (quadruped) | 17 ✗ | **20 ✓** | Tripo delivered the lore (booster rockets) and the best silhouette of the bake-off (8/8) |
| Orrin (floating) | 13 ✗ | **18 ✓** (iter. 2) | Meshy missed the concept (standing, forbidden base). Tripo floated him with his dust ring both times; palette-faithful pale robes; missing energy accents |

## What the bake-off established

1. **Text mode beats image mode with placeholder references.** Image mode
   faithfully 3D-ified our procedural primitives; prose briefs produced real
   characters. Until we have true 2D concept art, briefs are the control lever.
2. **Tripo v3.1 is the identity/style winner** and bakes quad topology +
   face_limit into a single 25-credit (~$0.25) task. Concept fidelity was
   superior on all three fighters (booster rockets, hover ring, scorched robes).
3. **Meshy owns the finish pipeline**: remesh knob verified precise
   (19k quads → 34,945 tris, inside the ≤40k budget) and the only working
   auto-rig (humanoid-only, ships with free walk/run animations).
4. **Polycount units gotcha**: both providers count QUADS; a "40k" limit means
   ~70–80k triangles. Dial generation/remesh targets to half the intended
   tri budget.
5. **Rigging is the open craft problem**: nobody auto-rigs the quadruped or
   the floater today. Options: Tripo's advertised creature rigging (unprobed —
   needs an adapter extension), or external Blender/AccuRIG passes.
6. **Cross-character style consistency** (the known industry weakness) is not
   yet proven — three fighters is too few. The Season-0 production pass must
   hold a consistent register across 12; the shared style directive worked
   well enough here to proceed.

## Recommended production shape (needs Founder approval — separate gate)

**Tripo as primary generator** (identity fidelity, single-task topology,
~$0.25–1.00 per accepted hero incl. iterations) + **Meshy for humanoid
rigging** while the already-paid Pro month lasts. Estimated Season-0 pass for
all 12 heroes: **$10–25 total** including 3–5 iterations per hero, plus
external rigging effort for non-humanoids (craft time, not credits).

## Spend (reconciled to COST_LEDGER.md)

| Provider | Credits used | Cash |
|---|---|---|
| Meshy | 150 of 1,000 (4 generations, 4 remesh, 1 rig) | within the $20 Pro month |
| Tripo | 100 (4 generations; 1 failed pre-top-up attempt cost 0) | ~$1.00 of API top-up |
| Rodin | not engaged (held in reserve; never needed) | $0 |

Total cash exposure: **$20 Meshy sub + Founder's Tripo top-up** — far inside
the $100 ceiling. Both subscriptions should be CANCELLED before renewal once
the production pass (if approved) completes.
