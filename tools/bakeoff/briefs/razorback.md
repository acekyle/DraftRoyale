# Bake-off brief — Razorback (quadruped)

> Fighter: `razorback` · role: bruiser · chassis: quadruped · scale 1.2
> Sources: `content/fighters/razorback.json` (`contract.canon.summary` + `dna.presentation`);
> shape reference: `apps/web/src/battle/heroMeshes.ts` (quadruped chassis);
> protocol: `docs/proposals/3d-generation-bakeoff-proposal.md` §5; scoring: `tools/bakeoff/RUBRIC.md`.
>
> This file IS the prompt package. `run.ts` machine-reads the `## Prompt` and
> `## Negative prompt` sections and sends the SAME text to all three providers.
> Providers with a dedicated negative field (Tripo) get the two sections separately;
> providers without one (Meshy, Rodin) get `Prompt + " Avoid: " + Negative` as one string.
> Budget: combined ≤600 chars (Meshy prompt limit); negative alone ≤255 chars (Tripo limit).

## Prompt

Razorback, a truck-sized bio-forged war-boar plated in ablative tusk-steel, chipped steel tusks, twin booster rockets strapped over the haunches. Massive quadruped bruiser, heavy chest, low head, four-legged stance. Colors: rust-brown hide #7a4a2b, dark oiled leather #3d2a1a, rocket-flame amber #ffb347. Stylized-PBR living-collectible statue, strong black-profile silhouette, heroic proportions; no photorealism, no flat toon; game-ready, full body, single figure.

## Negative prompt

style drift, photoreal skin, flat toon, text, logos, watermark, base, pedestal, background, extra limbs, duplicate figures

## Style directive (shared verbatim across all three briefs — long form)

- Stylized-PBR "living collectible" statue finish (Art Bible §1/§5) — a premium
  collectible figure brought to life; crisp sculpted forms, clean material separation
  (matte cloth / brushed metal / emissive energy accents).
- Strong black-profile silhouette: the fighter must be identifiable in flat black.
- Heroic proportions (humanoids ≈ 6.5 heads).
- NO photorealism. NO flat toon shading. One rendering universe across all three briefs.
- Game-ready topology target ≤40k tris; PBR texture set ≤2K.
- T-pose or A-pose for rigging (bipeds); natural neutral stance for the quadruped;
  relaxed hover for the floating chassis.

## Negative directives (long form)

No style drift between briefs, no photoreal boar hide or fur groom, no text/logos/
warnings stenciled on the rockets, no display base or pedestal in the mesh, no scene
background, no extra limbs or duplicate characters.

## Silhouette (DNA, verbatim)

"Truck-sized armored boar, chipped steel tusks, twin booster rockets strapped over the haunches"

## Chassis / proportions

Quadruped, scale 1.2 (largest of the three briefs). Mass forward: heavy chest ruff and
shoulders, lower rump, head carried low with tusks leading. The two booster rockets over
the haunches and the twin tusk sweep ARE the black-profile identity — they must survive
any simplification. Hard-surface plate over organic muscle (armor/organic mix stress test).

## Palette (named)

| Slot | Hex | Name |
|---|---|---|
| Primary | `#7a4a2b` | rust-brown hide (body / plate tint) |
| Secondary | `#3d2a1a` | dark oiled leather (straps / underbody) |
| Energy | `#ffb347` | rocket-flame amber (nozzles, emissive accents) |

## Image references (image-to-3D primary path)

`tools/bakeoff/concept-sheets/razorback-{front,side,quarter}.png` plus
`razorback-palette.png` — generated for $0 from our procedural hero meshes via
`npm run bakeoff:sheets`. Same three views feed every provider identically.
