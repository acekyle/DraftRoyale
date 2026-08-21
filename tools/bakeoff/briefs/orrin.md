# Bake-off brief — Orrin (floating)

> Fighter: `orrin` · role: controller · chassis: floating · scale 1.0
> Sources: `content/fighters/orrin.json` (`contract.canon.summary` + `dna.presentation`);
> shape reference: `apps/web/src/battle/heroMeshes.ts` (floating chassis, robed variant);
> protocol: `docs/proposals/3d-generation-bakeoff-proposal.md` §5; scoring: `tools/bakeoff/RUBRIC.md`.
>
> This file IS the prompt package. `run.ts` machine-reads the `## Prompt` and
> `## Negative prompt` sections and sends the SAME text to all three providers.
> Providers with a dedicated negative field (Tripo) get the two sections separately;
> providers without one (Meshy, Rodin) get `Prompt + " Avoid: " + Negative` as one string.
> Budget: combined ≤600 chars (Meshy prompt limit); negative alone ≤255 chars (Tripo limit).

## Prompt

Orrin, a serene monk of the Hollow Bell order adrift in legless robes, palms open, a ring of stilled dust orbiting beneath him. Floating controller, slight frame in layered robes, no legs, relaxed hover, arms in open A-pose. Colors: bone linen #c9c2ae, weathered taupe #5e5648, pale moonlight glow #e8f0ff. Stylized-PBR living-collectible statue, strong black-profile silhouette, heroic proportions; no photorealism, no flat toon; game-ready, full body, single figure.

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

No style drift between briefs, no photoreal skin, no text/logos/watermarks, no legs or
feet under the robe (legless is the identity), no display base or pedestal in the mesh,
no scene background, no extra limbs or duplicate characters.

## Silhouette (DNA, verbatim)

"Serene figure adrift in legless robes, palms open, a faint ring of stilled dust orbiting beneath him"

## Chassis / proportions

Floating chassis: the robe tapers to nothing — NO legs, NO feet. Torso and open palms
carry the upper read; the orbiting dust ring beneath closes the lower silhouette. This
brief is the non-standard-anatomy / rig-stress test: the mesh should be riggable for a
hover idle, palm strikes, and cast gestures (spine + arms only).

## Palette (named)

| Slot | Hex | Name |
|---|---|---|
| Primary | `#c9c2ae` | bone linen (outer robes) |
| Secondary | `#5e5648` | weathered taupe (inner layers / trim) |
| Energy | `#e8f0ff` | pale moonlight glow (dust ring, emissive accents) |

## Image references (image-to-3D primary path)

`tools/bakeoff/concept-sheets/orrin-{front,side,quarter}.png` plus
`orrin-palette.png` — generated for $0 from our procedural hero meshes via
`npm run bakeoff:sheets`. Same three views feed every provider identically.
