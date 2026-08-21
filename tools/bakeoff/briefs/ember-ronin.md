# Bake-off brief — Ember Ronin (humanoid)

> Fighter: `ember-ronin` · role: skirmisher · chassis: humanoid · scale 1.0
> Sources: `content/fighters/ember-ronin.json` (`contract.canon.summary` + `dna.presentation`);
> shape reference: `apps/web/src/battle/heroMeshes.ts` (biped chassis);
> protocol: `docs/proposals/3d-generation-bakeoff-proposal.md` §5; scoring: `tools/bakeoff/RUBRIC.md`.
>
> This file IS the prompt package. `run.ts` machine-reads the `## Prompt` and
> `## Negative prompt` sections and sends the SAME text to all three providers.
> Providers with a dedicated negative field (Tripo) get the two sections separately;
> providers without one (Meshy, Rodin) get `Prompt + " Avoid: " + Negative` as one string.
> Budget: combined ≤600 chars (Meshy prompt limit); negative alone ≤255 chars (Tripo limit).

## Prompt

Ember Ronin, a wandering swordmaster who banks heat in his body and vents it through a single katana. Lean humanoid duelist in a scorched traveling cloak over light armor, blade edge glowing ember-orange, A-pose. Colors: scorched crimson #b3382c, charred umber #2b2320, ember-orange glow #ff8c42. Stylized-PBR living-collectible statue, strong black-profile silhouette, heroic proportions; no photorealism, no flat toon; game-ready, full body, single figure.

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

No style drift between briefs, no photoreal skin or materials, no text/logos/watermarks,
no display base or pedestal in the mesh, no scene background, no extra limbs or
duplicate characters, no weapon clutter beyond the single katana.

## Silhouette (DNA, verbatim)

"Lean swordsman in a scorched traveling cloak, single blade glowing ember-orange along its edge"

## Chassis / proportions

Humanoid biped, lean skirmisher build, ~6.5-head heroic stance. Single-edged katana in
one hand (or sheathed at hip in the rig pose); cloak must not swallow the silhouette —
the blade line and shoulder read are the identity.

## Palette (named)

| Slot | Hex | Name |
|---|---|---|
| Primary | `#b3382c` | scorched crimson (cloak / body) |
| Secondary | `#2b2320` | charred umber (under-armor / trim) |
| Energy | `#ff8c42` | ember-orange glow (blade edge, emissive accents) |

## Image references (image-to-3D primary path)

`tools/bakeoff/concept-sheets/ember-ronin-{front,side,quarter}.png` plus
`ember-ronin-palette.png` — generated for $0 from our procedural hero meshes via
`npm run bakeoff:sheets`. Same three views feed every provider identically.
