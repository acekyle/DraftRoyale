# Art Bible

> Living document. Last updated: 2026-08-19. Direction is locked; execution status is marked
> honestly — see §8 for what is actually rendered today.

## 1. Direction: "Living Collectible Multiverse"

One sentence: **characters are high-end collectible statues brought to life, battling in
diorama arenas, presented through a high-energy comic interface.**

The blend, by visual weight:

- **70% — Premium living-collectible presentation.** Characters read as collectible statues
  animated to life: strong silhouettes, heroic proportions, stylized PBR materials,
  illuminated pedestals in draft/selection contexts, arenas as detailed miniature dioramas.
- **20% — High-energy comic-book interface.** Bold role colors, angular panels, readable
  power icons, energetic typography. The UI is loud; the characters stay premium.
- **10% — Controlled multiverse contrast — REVISED 2026-08-21 (D-028, Founder direction).**
  Realm identity is now expressed through **per-realm rendering registers** — each fighter
  belongs to a realm (comic / animated / anime / cinematic) and is modeled in that realm's
  style, the way a versus-multiverse key art mixes a comic hero, an animated heroine, a
  cinematic gunslinger, and an anime duelist in one frame. What stays unified: the shared
  lighting/material pipeline (stylized PBR, one light rig), the black-profile silhouette
  law, the DNA palette contract, and the pedestal/diorama presentation. What varies by
  realm: proportions, surface finish, and detail density. The earlier "one rendering
  universe" rule (miniature-toy statue register for every fighter) is retired — it
  flattened the multiverse fantasy (Founder review of the first full statue pass).

Motto: **"Many worlds, one arena."**

## 2. Reference images (canonical descriptions)

Three reference compositions define the target look:

1. **Comic selection screen** — a character-select layout built from angular comic panels in
   saturated blue, orange, and red; each panel frames a hero statue with bold name typography
   and role iconography; energy lines and halftone accents carry motion without clutter.
2. **Collectible figures in a miniature battle environment** — finely detailed collectible
   figures posed on illuminated pedestals inside a diorama-scale battle scene: cracked
   pavement, scattered debris, dramatic rim lighting; the environment reads as an expensive
   display piece, not a photoreal city.
3. **Realms united through portals** — multiple stylistically distinct realms (fantasy spires,
   neon cyberpunk streets, cosmic void, mythic ruins) visible through glowing portals that
   ring a central arena; every realm's content is rendered in the same material and lighting
   language, proving the "one universe" rule.

## 3. Role color language

Each combat role owns a color family used in UI panels, icons, and energy accenting.
(The 8 roles are Implemented in the schema — `Role` in `packages/contracts/src/types.ts`;
the color assignments below are the art-direction target for the client.)

| Role | Color family | Feel |
|---|---|---|
| Vanguard | Crimson red | First through the wall |
| Defender | Cobalt blue | Immovable |
| Bruiser | Burnt orange | Blunt force |
| Skirmisher | Electric yellow | Fast, slippery |
| Artillery | Magenta/violet | Reach and payload |
| Controller | Teal/cyan | The battlefield bends |
| Support | Emerald green | Keeps the team standing |
| Tactician | White/silver | The plan is the weapon |

Per-fighter identity colors are separate and already data-driven: every Combat DNA carries a
`presentation` block (primaryColor, secondaryColor, energyColor, silhouette description,
animation intents) — Implemented and populated in the shipped content files.

## 4. UI presentation rules

- Comic-panel framing for menus and draft; battle HUD stays minimal and diegetic-leaning.
- Power icons must be readable at glance distance; one icon = one mechanical concept.
- Role color always accompanies role iconography — never color alone (accessibility).
- Numbers players reason about (prices, cap space, cooldowns, damage) are never hidden behind
  style; spectacle may not reduce mechanical legibility (priority order: readability of
  outcomes outranks spectacle polish).
- Arena disclosures are presented before drafting, in full, in plain language (the data
  contract for this is implemented; see `ArenaDef.disclosures`).

## 5. Character presentation rules

- Strong silhouette first: a fighter must be identifiable in black profile (each DNA's
  `silhouette` field records the intended read).
- Heroic proportions, stylized PBR — no photorealism, no flat toon shading.
- Pedestal presentation in draft/collection contexts; battle poses come from the authored
  animation-intent grammar (`animationIntent` per ability, `animationIntents` per fighter).
- Realm register (D-028): each fighter's realm (comic / animated / anime / cinematic,
  recorded in its heroforge brief) sets its modeling register — proportions, finish,
  detail density. Silhouette law, DNA palette contract, and the shared lighting/material
  pipeline still bind every realm; "different rendering style" means register, never
  incompatible pipelines (no photoreal drift outside the cinematic realm, no flat toon
  anywhere).

## 6. Violence envelope (locked)

Teen-oriented superhero combat:

- Yes: impacts, shockwaves, craters, knockouts, armor damage, environmental destruction,
  energy effects, containment finishes.
- No: gore-as-identity, dismemberment, torture framing, sexual content, extremist content.
- Defeat states are knockout or containment (`FIGHTER_KNOCKED_OUT`, `FIGHTER_CONTAINED` are
  the engine's terminal fighter events — there is no death state in the simulation).

## 7. Arenas

Arenas are diorama stages with mechanically honest features: cover, pillars, water,
elevation, hazards — each disclosed pre-draft and destructible where declared (Implemented in
data + sim: features have HP, break under area damage, and emit `FEATURE_DESTROYED`).
Meridian Plaza (sun-drenched urban plaza, flooded fountain channel, four destructible
pillars) is the shipped reference arena.

## 8. Current visual reality vs target

**Implemented today (honest status, updated 2026-08-20 — procedural hero pass, D-023):**

- Still no authored 3D art assets — but the client now renders **sculpted procedural hero
  meshes** (`apps/web/src/battle/heroMeshes.ts`): four authored chassis silhouettes
  (humanoid ~6.5-head heroic stance / bulked heavy / predatory quadruped / hovering
  floating with ring + shards), deterministic per-fighter variation (proportions, head
  variants, 1–2 accessories hashed from fighterId), stylized-PBR materials with rim-light
  shells, all palette-driven from each DNA's presentation block.
- **Collectible-pedestal draft presentation is live**: turntable pedestal viewer in the
  inspect drawer with role-colored ring inlay, angular name plate, hexagonal role icon
  chip; the §3 role color language + 8 inline SVG role glyphs ship on draft/prep cards
  (`roleTheme.ts`; color always paired with icon per §4).
- **Meridian Plaza renders as a diorama**: procedural canvas plaza tiling, recessed
  fountain basin, fluted destructible columns that break to rubble, apron dressing,
  cool-key/warm-rim collectible lighting tuned to the §4 readability floor.
- Poses are 4 procedural blend atoms (attack/cast/guard/KO) driven by `animationIntent`.
  This is still procedural placeholder art in the §8 sense — it respects silhouette, role
  color, and readability rules, but §1–§7's "collectible statue" bar requires modeled
  characters.

**Path to target (updated):**

1. ~~Placeholder chassis primitives~~ → **sculpted procedural heroes + pedestal
   presentation + diorama arena (shipped 2026-08-20)**.
2. Authored animation-atom grammar mapped to `animationIntent` hints (4 blend atoms
   shipped; per-intent unique animations remain).
3. Stylized modeled characters for the Season 0 roster — production approach (hand-modeled
   vs 3D-generation bake-off) is a Founder Gate; decision brief prepared at
   `docs/proposals/3d-generation-bakeoff-proposal.md` ($0 spent, awaiting Founder).
4. Full diorama arena art pass beyond Meridian Plaza + realm-portal presentation.

**Placeholder rule:** placeholder visuals must still respect silhouette, role color, and
readability rules so playtests measure the real game, not the missing art.
