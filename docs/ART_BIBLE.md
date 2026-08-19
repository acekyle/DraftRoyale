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
- **10% — Controlled multiverse contrast.** Many realms — comic, anime, fantasy, horror,
  cosmic, mythic, cyberpunk — but **one rendering universe**. Realm identity is expressed
  through costume, materials, and effects, never through incompatible AI style soup.

Motto: **"Different worlds, one collectible universe."**

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
- Realm flavor lives in costume, materials, and VFX color — never in a different rendering
  style per character.

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

**Implemented today (honest status):**

- No 3D art assets exist in this repository. The in-progress web client renders fighters as
  **stylized procedural chassis primitives** (parameterized by chassis type — humanoid /
  heavy / quadruped / floating — plus scale and the DNA presentation colors). This is a
  deliberate placeholder that proves the data pipeline: silhouette class, palette, and
  animation intents all flow from content files.
- Arena rendering is similarly schematic: floor plane, feature markers, destructibility state.
- All direction in §1–§7 is the target; none of it should be described as shipped visuals.

**Path to target (Planned, phased):**

1. Placeholder chassis primitives (current).
2. Authored animation-atom grammar mapped to `animationIntent` hints (partially in data now).
3. Stylized modeled characters for the Season 0 roster — production approach (hand-modeled vs
   3D-generation bake-off) is a Founder Gate because candidate tools may cost money.
4. Diorama arena art pass and collectible-pedestal draft presentation.

**Placeholder rule:** placeholder visuals must still respect silhouette, role color, and
readability rules so playtests measure the real game, not the missing art.
