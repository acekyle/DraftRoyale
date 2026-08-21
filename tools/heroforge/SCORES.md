# Season-0 production pass — EP score sheet (2026-08-21, D-026)

> Rubric: tools/bakeoff/RUBRIC.md (0–30; ≥18 passes, no zero on Silhouette or
> Topology/budget). Scored from Tripo render + GLB inspection
> (tools/heroforge/inspect.mjs); "in-viewer beside procedural" check done in
> the live pedestal drawer. Second scorer (Founder) can append a column —
> every render is in tools/heroforge/results/<fighter>/.
> FINAL: 12/12 heroes promoted (17 generations total incl. 5 iterations ≈ $3.40
> Tripo API; 3 auto-rigs captured on Meshy sub credits).
> R (rig) axis: bipeds scored after the Meshy auto-rig lands; floaters need no
> rig (procedural hover animates them); quadrupeds scored on external
> riggability like the bake-off.

| Fighter | Task | S /8 | M /8 | T /6 | R /5 | P /3 | Total | Verdict |
|---|---|---|---|---|---|---|---|---|
| vex | 20d2715a | 7 | 7 | 6 (39,448) | 3* | 3 | 26 | **PASS — promoted** |
| captain-meridian | 01a348fb | 6 | 7 | 6 (38,704) | 4 | 3 | 26 | **PASS — promoted** (shield-lance reads lance-forward; tower-shield mass soft) |
| aegis-9 | a40c44e3 | 8 | 8 | 6 (39,454) | 4 | 3 | 29 | **PASS — promoted** (best of pass) |
| grimspike | ed6295fa | 8 | 7 | 6 (37,883) | 3* | 3 | 27 | **PASS — promoted** |
| riptide | 7b3366b5 | 6 | 6 | 6 (39,468) | 3* | 3 | 24 | **PASS — promoted** (water ribbons read chunky/coral — polish candidate) |
| solaria | ed5604ba | 7 | 6 | 6 (38,628) | 3* | 3 | 25 | **PASS — promoted** (more chrome-gold than cream flight suit) |
| ember-ronin | 67fa32c1 | 7 | 7 | 6 (39,650) | 3* | 3 | 26 | **PASS — promoted** |
| cinder-wisp | 22da8eb1 | 6 | 7 | 6 (38,866) | n/a | 3 | 22+ | **PASS — promoted** (flame taper acceptable; no rig needed) |
| whisper | 74c2fb17 → **v2 5eeebced** | 7 | 7 | 6 (37,712) | 3* | 3 | 26 | v1 FAIL (stalk-arms holding drones); **v2 PASS — promoted** (drones detached, two arms, mint coat) |
| orrin | 73645131 → v2 d614c5ef → **v3 7607bfb9** | 8 | 7 | 6 (38,930) | n/a | 2 | 23 | v1+v2 FAIL (grew feet, no ring — even under a hammered negative; stochastic, reroll beats re-brief); **v3 PASS — promoted** (legless taper + orbiting dust ring) |
| razorback | a0fc599f | 7 | 7 | 6 (39,160) | n/a* | 3 | 23+ | **PASS — promoted** (tusks + twin boosters read; quadruped = external rig path) |
| sable-howl | 5f0d606d → **v2 8bd43afa** | 7 | 6 | 6 (38,282) | n/a* | 3 | 22 | v1 pass-with-drift (indigo coat, P 1); **v2 PASS — promoted** (void-black coat, violet eyes the only fixed points) |

*R 3 = Meshy auto-rig pose-rejected; scored on external riggability (clean
single-mesh biped, ≤2h Blender/AccuRIG). Meridian/AEGIS-9 R 4 = auto-rigged.

*orrin totals ≥18 numerically but the feet break the legless identity the
rubric names explicitly — EP fails it on identity, not arithmetic.

All GLBs land inside the ≤40k-tri budget with 2K-class JPEG texture sets —
the triangle-mode `face_limit` dial is confirmed accurate (no remesh hop
needed anywhere).

## Rig capture (Meshy Pro month, 5 cr per attempt, failures uncharged)

captain-meridian and aegis-9 auto-rigged successfully — rigged GLB/FBX plus
free walking/running previews in their results folders. vex, grimspike,
riptide, solaria, ember-ronin fail Meshy pose estimation at submit (422 —
facing/pose constraints on the Tripo output). Consistent with the bake-off
verdict: auto-rigging remains the open craft problem; the external
Blender/AccuRIG path is the fallback, and nothing in the shipped game needs
these rigs today (battle animates procedural chassis; draft shows statues).
