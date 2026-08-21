# 3D Generation Bake-off — Scoring Rubric (0–30)

> Source: `docs/proposals/3d-generation-bakeoff-proposal.md` §5, criteria derived from
> Art Bible §5 (character presentation rules) with §3 palette fidelity added.
> **Pass gate: ≥18/30, AND no zero on Silhouette or Topology/budget** (a candidate that
> cannot hold the silhouette or the budget fails regardless of total).
> Two independent scorers per artifact where possible (EP + Founder); score sheets are
> committed to the repo next to this file.
>
> Scope: score the BEST artifact per provider×fighter pair (best-of-N within the
> iteration cap), after the provider's own retopo/remesh pass, loaded in a glTF viewer
> and beside the procedural hero in the pedestal viewer.

## Criteria and anchors

### 1. Silhouette black-profile read — 0–8

Art Bible §5: "a fighter must be identifiable in black profile." Compare the artifact's
flat-black profile against the DNA `silhouette` text and the concept-sheet profile.

| Score | Anchor |
|---|---|
| **0** | Silhouette unrecognizable or wrong chassis class (e.g. Razorback reads biped, Orrin grew legs). Instant overall fail. |
| **4** | Chassis class and mass read correctly, but one or more identity elements are lost or mushy (rockets fused into the back, katana line lost in the cloak, dust ring absent). |
| **8** | Identifiable in flat black at a glance; every identity element from the DNA silhouette text survives (tusks + rockets; blade + cloak; legless robe taper + ring). |

### 2. Material / style consistency — 0–8

Art Bible §5: "stylized PBR — no photorealism, no flat toon"; §1: one rendering
universe. Judge against the shared style directive AND across this provider's three
artifacts together (one-universe check).

| Score | Anchor |
|---|---|
| **0** | Photoreal drift (skin pores, groomed fur, raw-photo textures) or flat toon; or the three artifacts obviously come from different universes. |
| **4** | Broadly stylized-PBR but inconsistent — one artifact drifts (generic PBR mush, plastic sheen, mismatched detail density between the three). |
| **8** | Reads as a collectible statue; materials clean and deliberate (cloth/metal/emissive separation); the provider's three artifacts look like one game. |

### 3. Topology / budget fit — 0–6

ADR-0001 + Art Bible §8: web delivery, ≤40k tris after the provider's own
retopo/remesh, PBR texture set ≤2K, clean UVs. Measure, don't eyeball: tri count from
the glTF inspector, texture sizes from the files.

| Score | Anchor |
|---|---|
| **0** | Over 40k tris after in-product processing, or textures over 2K, or UVs unusable (overlapping shells that break the bake). Instant overall fail. |
| **3** | Within budget but dirty — uneven density, triangulated soup where quads were requested, UV waste, needs manual retopo touch-up (≤2h). |
| **6** | Within budget with headroom; even, deformation-friendly topology; clean non-overlapping UVs; no manual fix needed. |

### 4. Rig usability — 0–5

Proposal §5 step 4–5: auto-rig where offered (Meshy, Tripo); Rodin scored on external
riggability (Blender/AccuRIG). Drive one `animationIntent`-class pose per fighter:
dash (ember-ronin), charge (razorback), cast/guard (orrin).

| Score | Anchor |
|---|---|
| **0** | Rig fails outright or mesh is unriggable without re-modeling (fused limbs, solid robe shell with no joint room). |
| **2–3** | Rig succeeds but deformation is rough — candy-wrapper joints, cloak/robe collapse, quadruped spine kinks; fixable within the ≤2h cleanup budget. |
| **5** | Rig succeeds (auto or external ≤30min); dash/cast/guard-class poses deform acceptably; quadruped and floating anatomies handled without hacks. |

### 5. Palette fidelity — 0–3

DNA `presentation` colors are contract data (Art Bible §3/§5) — the pipeline must
honor them. Compare against the palette strip (`<fighter>-palette.png`).

| Score | Anchor |
|---|---|
| **0** | Palette ignored (recolored hero, wrong energy color family). |
| **1–2** | Primary/secondary in family but drifted (hue/value shifts); energy color present but not where the DNA puts it. |
| **3** | Primary, secondary, and energy colors land where the brief places them; emissive accents use the energy color. |

## Score sheet template

One table per scorer. Copy into `tools/bakeoff/scores-<scorer>-<date>.md`.
Column key: S=Silhouette /8 · M=Material /8 · T=Topology /6 · R=Rig /5 · P=Palette /3.

| Provider | Fighter | S /8 | M /8 | T /6 | R /5 | P /3 | Total /30 | Pass (≥18, no S/T zero) | Best artifact path | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| meshy | ember-ronin | | | | | | | | | |
| meshy | razorback | | | | | | | | | |
| meshy | orrin | | | | | | | | | |
| tripo | ember-ronin | | | | | | | | | |
| tripo | razorback | | | | | | | | | |
| tripo | orrin | | | | | | | | | |
| rodin | ember-ronin | | | | | | | | | |
| rodin | razorback | | | | | | | | | |
| rodin | orrin | | | | | | | | | |

**Per-provider verdict** = mean of its three fighter totals, with the pass gate applied
per fighter: a provider advances to a Season-0 estimate only if **all three** of its
fighters pass. If no provider passes, the recommendation auto-reverts to the free
procedural fallback (proposal §6) and the gate closes with the question answered.

## Cleanup-cost note (recorded, not scored)

Proposal §5 also tracks cleanup cost (≤2h to ship-ready). Log actual manual minutes per
winning artifact in the Notes column — it feeds the Season-0 cost estimate but is
already reflected in the Topology and Rig anchors above, so it is not double-counted
as points.
