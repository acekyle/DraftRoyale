# 3D Character Generation Bake-off — Founder Gate Decision Brief

> **STATUS: PROPOSAL — NOT APPROVED. No spend has occurred.**
> This document was produced as a paper survey only: $0 spent, no accounts created,
> no tool APIs called, no downloads. All pricing below is from public web pages,
> accessed **2026-08-20** unless noted. Prices change; re-verify on approval day.
>
> Gate reference: [BACKLOG](../BACKLOG.md) Phase 3 — `[founder-gate] [spike] 3D character
> generation bake-off`. Art target: [ART_BIBLE](../ART_BIBLE.md) §1, §5, §8.
> Renderer context: [ADR-0001](../adr/0001-renderer-browser-native.md) (browser-native
> Three.js; assets must arrive as glTF/GLB).

---

## 1. The decision being gated

The Art Bible's phased path (§8, step 3) calls for stylized modeled characters for the 12
Season-0 heroes, replacing today's procedural chassis primitives — and the production
approach (hand-modeled vs AI 3D generation vs commission vs marketplace) is a Founder Gate
because every serious candidate except the in-house path costs money. This brief asks the
Founder to approve (or decline) a **small, capped bake-off spend (proposed ceiling: $100)**
to empirically test whether current AI 3D generation services can hit the "living
collectible" stylized-PBR bar across three real Season-0 briefs — before any larger
commitment. Declining is a legitimate outcome: the free procedural/hand-modeled fallback
remains viable for playtesting (Art Bible placeholder rule) and is quantified in §6.

**Hard requirements any pipeline must meet** (from Art Bible + ADR-0001 + fighter schema):

- 12 original hero designs driven by existing content files — each fighter's
  `presentation` block supplies `primaryColor`/`secondaryColor`/`energyColor`, a
  `silhouette` text spec, and `animationIntents` (e.g. `rocket_charge`, `guard`, `cast`)
  the engine drives. See `content/fighters/razorback.json` for the shape.
- Web delivery: glTF/GLB into Three.js; ~≤30–50k tris per hero; PBR texture sets ≤2K.
- Rigged (or cleanly riggable) — humanoid ×6, heavy ×2, quadruped ×2, floating ×2.
- One rendering universe: stylized PBR, no photorealism, no flat toon, no style soup (§1).
- IP-safe: original designs only; commercial license for a shipped game.
- Long-term: user-created fighters compiled at draft time eventually need 3D too, so the
  pipeline must be automatable — but the Season-0 pass may be a one-time effort.

---

## 2. Candidate landscape (August 2026)

### 2.1 Field summary

The market consolidated hard in the last 18 months. **Luma Genie is gone** (Luma removed
Genie and its 3D capture product as it pivoted to video — capture shut down Jan 2026;
sources: [Cinevva guide](https://app.cinevva.com/guides/ai-3d-model-generators),
[TheAISelect](https://www.theaiselect.com/en/tools/luma-genie)). **CSM/Cube is gone**
(Cube shut down 2026-01-05; Google acquired Common Sense Machines Jan 2026 — sources:
[Radiance Fields](https://radiancefields.com/platforms/csm),
[AI CERTs](https://www.aicerts.ai/news/google-ai-acquisition-boosts-spatial-3d-strategy/)).
The credible hosted survivors for character work are **Meshy, Tripo, and Rodin (Hyper3D)**;
2026 roundups consistently rank exactly these three, plus open-source
Hunyuan3D/TRELLIS for self-hosting
([Cinevva](https://app.cinevva.com/guides/ai-3d-model-generators),
[Medium/Ideas With Wings](https://medium.com/ideas-with-wings/best-ai-3d-model-generators-in-2026-tripo-ai-vs-meshy-rodin-kaedim-and-more-7eea7b05eb11),
[trellis2.app](https://trellis2.app/blog/best-ai-3d-model-generator)).

### 2.2 AI generation services

| | **Meshy** | **Tripo** | **Rodin / Hyper3D** |
|---|---|---|---|
| What it produces | Text/image→3D mesh + PBR texture set; quad remesh + "Smart Topology"; current gen "Meshy 6/7" | Text/image→3D (v3.1 engine, "Smart Mesh"); quad remesh 500–50k polys; part segmentation | Image/text→3D, Gen-2.5; sculpt-level detail to 10M+ polys; 4K PBR; 3D ControlNet, local 3D editing |
| Rigging / animation | Auto-rig humanoid **and quadruped**, ~30 s, **0 credits**; 600+ motion presets (paid); FBX/GLB export | Auto-rig, 7 creature types, T-pose export, auto weight painting; API-driven | Not a core feature; ChatAvatar is a separate (humanoid avatar) product — **rig support for arbitrary creatures unverified** |
| Web export | GLB/FBX/OBJ/USDZ + PBR maps (vendor docs) | GLB + engine-ready claims; API-first | Export formats listed only behind login — **unverified**; community reports GLB/FBX |
| Style control | Image-to-3D from your own concept art is the control lever; text-to-3D drifts. AI texturing tends toward generic PBR | Same lever; "stylized" toggles exist; strongest game-pipeline focus per 2026 roundups | Strongest raw geometry, but positioned photoreal/high-fidelity — **pulls against our no-photorealism rule**; ControlNet may help |
| License / IP | **Free tier output is CC BY 4.0 (public, attribution)**; paid tiers: private assets, full ownership/commercial rights ([meshy.ai/pricing](https://www.meshy.ai/pricing)) | Free tier non-commercial; paid tiers commercial. Pricing page hedges "limited commercial access" on Pro vs marketing "all paid plans" — **flag: verify exact Pro terms before relying on it** ([tripo3d.ai/pricing](https://www.tripo3d.ai/pricing)) | Paid plans give "broader export and usage rights"; Business tier lists commercial license explicitly — **free-tier terms unverified** ([hyper3d.ai/pricing](https://hyper3d.ai/pricing)) |
| Published pricing (accessed 2026-08-20) | Free $0/100 cr·mo; **Pro $20/mo, 1,000 cr**; Premium $40/mo ~3,000 cr; Ultra $100/mo ~8,000 cr; Studio $70/mo (5,500 shared). **20 cr per full textured generation** (10 mesh + 10 texture); rig/animate free. Sources: [meshy.ai/pricing](https://www.meshy.ai/pricing), [Meshy credits guide](https://www.meshy.ai/tutorials/meshy-credits-guide), [costbench](https://costbench.com/software/ai-3d-generation/meshy/) | Free $0/200 cr·mo; **Pro $19.90/mo, 3,000 cr**; Max $89.90/mo, 25,000 cr; Team $109.90/seat·mo (90,000 cr). Generation 25 cr (standard) – 50–60 cr (HD/Ultra); retopo 25–75 cr; gen+retopo ≈ 90 cr. **API: 1 cr = $0.01.** Sources: [tripo3d.ai/pricing](https://www.tripo3d.ai/pricing), [developers.tripo3d.ai/en/pricing](https://developers.tripo3d.ai/en/pricing) | Free $0 (pay-by-result preview); **Creator $30/mo (~60 models/mo, $24/mo annual)**; Business $120/mo (~416 models/mo, full API, High-Poly Quads); direct credits **$1.50/credit**. Source: [hyper3d.ai/pricing](https://hyper3d.ai/pricing) |
| 2026 reputation | "Most polished mainstream"; strong full pipeline | "Best hosted for game pipelines" (auto-rig + quad remesh + cheap credits) | "Wins on raw geometric detail"; pro fidelity |

Reputation quotes paraphrase the [Cinevva](https://app.cinevva.com/guides/ai-3d-model-generators)
and [trellis2.app](https://trellis2.app/blog/best-ai-3d-model-generator) 2026 roundups —
these are independent-ish editorial sources, not vendor pages, but note trellis2.app
promotes TRELLIS and 3daistudio.com promotes its own aggregator; treat rankings as
directional, not gospel.

**Other hosted tools, assessed and set aside:**

- **Sloyd** ([sloyd.ai](https://www.sloyd.ai)) — parametric/template-based, not free-form
  generation. Plus $15/mo (unlimited fair-use generations, AI rigging, commercial license),
  Pro $50/mo (4K textures) ([Sloyd pricing blog](https://www.sloyd.ai/blog/ai-3d-model-generator-pricing),
  [Capterra](https://www.capterra.com/p/10015811/Sloyd/pricing/)). Style-consistent by
  construction, but limited to its template library — it cannot produce a rocket-strapped
  war-boar or a legless floating monk ([3daistudio comparison](https://www.3daistudio.com/ai-3d-generator-comparison/sloyd),
  [OnyxRanked](https://onyxranked.com/sloyd-review-2026/)). **Not viable for the hero
  roster; possibly useful later for arena/diorama props.**
- **Spline AI** ([spline.design](https://spline.design)) — web design tool with AI 3D as a
  paid add-on (Free / Starter $12/mo / Professional $20/mo annual, AI credits extra;
  [saasworthy](https://www.saasworthy.com/product/spline-tool/pricing),
  [toolworthy](https://www.toolworthy.ai/tool/spline-ai)). Object-level generation for web
  design scenes, no character/rig pipeline. **Not viable.**
- **Kaedim** ([kaedim3d.com/pricing](https://www.kaedim3d.com/pricing)) — human-in-the-loop
  2D→3D outsourcing hybrid ("production-ready assets in days"); pricing is
  quote/calculator-based; third parties report premium plans from ~$150+/mo
  ([Techjockey](https://www.techjockey.com/detail/kaedim)). **No transparent published
  per-asset price — cannot be costed on paper; effectively a mini-outsourcing contract.**
- **Luma Genie, CSM/Cube** — discontinued (see §2.1).
- Aggregators/newcomers seen in comparisons but not independently verifiable on paper
  (3D AI Studio, Hitem3D): **not evaluated**; flagged for awareness only.

**Open-source / self-hosted (the $0-license path):**

- **Hunyuan3D 2.x** (Tencent) — two-stage mesh + real PBR paint (albedo/metallic/rough);
  community license; full pipeline wants ~29 GB VRAM
  ([arXiv 2506.15442](https://arxiv.org/pdf/2506.15442),
  [pixazo roundup](https://www.pixazo.ai/blog/best-open-source-3d-model-generation-apis)).
- **TRELLIS.2** (Microsoft) — MIT license, 4B params, 1536-res assets in <20 s on a single
  24 GB GPU; text- and image-to-3D
  ([trellis2.com comparison](https://trellis2.com/blog/trellis-2-vs-hunyuan3d-image-to-3d),
  [3daistudio state-of-2026](https://www.3daistudio.com/state-of-ai-3d-generation-2026)).
- **Reality check for us:** both are Linux/CUDA-focused. We develop on a Mac with no
  NVIDIA GPU; running them means renting a cloud GPU (spend → gated) or buying hardware
  (spend → gated). No auto-rig, no managed retopo — more cleanup labor than hosted tools.
  **"Free" in license, not in practice for this team today.** Revisit if a GPU box ever
  exists for other reasons; also the natural long-term self-host path for per-compile
  generation economics at scale.

### 2.3 Non-AI baselines

| Baseline | What you get | Cost (published market rates) | Fit vs Art Bible |
|---|---|---|---|
| **Commissioned character artist** | Bespoke sculpt→retopo→PBR→rig per hero, revisions, style adherence to our refs | Stylized game-ready character **from ~$2,000/model**; broad market range $1,000–10,000+; rig alone $100–300 if separate; US freelance median **$70/hr ($55–90)** ⇒ day-rate ≈ $440–720. Sources: [Pixune](https://pixune.com/blog/how-much-does-a-character-design-cost/), [VSQUAD](https://vsquad.art/blog/how-much-does-a-3d-character-cost-vsquad), [SalarySavvy](https://salarysavvy.ai/rates/3d-artist), [Fiverr guide](https://www.fiverr.com/resources/guides/costs/3d-artist) | **Highest ceiling; only path with guaranteed one-universe consistency** (one artist, one style). Cost is 2–3 orders of magnitude above AI path. Weeks–months of calendar time. |
| **Stock / marketplace models** | Pre-made characters; Sketchfab **Store closed → migrated to Epic's Fab** ([Sketchfab blog](https://sketchfab.com/blogs/community/sketchfab-update-what-you-need-to-know-now-that-fabs-live/)); Fab Standard License (Personal/Professional tiers, any engine — [Fab docs](https://dev.epicgames.com/documentation/en-us/fab/licenses-and-pricing-in-fab)); CGTrader royalty-free | Individual stylized characters/packs typically ~$10–150 each (browse-level observation — **exact prices per listing, not verifiable in aggregate**) | **Fails the brief.** 12 coherent originals matching our locked DNA silhouettes ("truck-sized armored boar, twin booster rockets") do not exist off-shelf; mixing vendors is style soup by definition; assets are non-exclusive (appear in other games); provenance of marketplace meshes increasingly polluted by unlabeled AI output. Viable only for props/greyboxing. |
| **In-house free path** | (a) Upgraded procedural chassis: better parametric primitives, modular kit-bash parts, stylized-PBR shader, driven by existing `presentation` data; (b) hand-modeled heroes in Blender ($0 license) | **$0 cash.** Labor: chassis upgrade est. 2–4 weeks; hand-modeling est. 20–60 h/hero ⇒ 240–720 h for 12 (internal estimate, not sourced) | Chassis path keeps silhouette/color/readability honest (placeholder rule §8) but will never read "living collectible." Hand-modeling can hit the bar in principle — it is the same craft the commission buys — but at severe calendar cost and dependent on in-house art skill we have not demonstrated. |

---

## 3. Cost table — Season-0 pass (12 heroes)

Assumption: **5–15 generations per hero to hit quality** (industry-consistent; picks best
of N, then retopo/rig the winner) ⇒ **60–180 full generations** total, 12 finals through
retopo + rig. Effective per-model costs: Meshy Pro $0.40/gen (20 cr @ $0.02/cr); Tripo Pro
$0.17–0.33/gen, ~$0.60 with retopo (per credit tables above); Rodin Creator ~$0.50/model
(60/mo @ $30).

| Candidate | Season-0 estimate (12 heroes) | Basis | Calendar |
|---|---|---|---|
| **Meshy** | **$40–80** | 1,200–3,600 cr ⇒ 2–4 mo of Pro ($20/mo) or 1–2 mo Premium ($40/mo); rig + animate 0 cr | 1–2 months |
| **Tripo** | **$40–90** | 3,000–9,900 cr (HD/Ultra gens + 12 retopo + rigs) ⇒ 2–4 mo Pro ($19.90) or 1 mo Max ($89.90) | 1–2 months |
| **Rodin (Hyper3D)** | **$30–90** (+ more cleanup labor) | 60–180 models ⇒ 1–3 mo Creator ($30/mo); redo caps (geometry ×20/mo) may force extra months; no rig included | 1–3 months |
| Open-source (Hunyuan3D/TRELLIS) | $0 license + **GPU rental or hardware (gated spend)** + highest cleanup labor | 24–29 GB VRAM CUDA; no Mac path | unknown |
| **Commission** | **$24,000–60,000** | 12 × $2,000–5,000 stylized game-ready w/ rig | 2–4 months |
| Marketplace (Fab/CGTrader) | $240–1,800 | 12 × ~$20–150 | days — **but fails style/originality (§2.3)** |
| **In-house free path** | **$0 cash** | 240–720 h hand-modeling, or chassis-upgrade-only at 2–4 weeks | 1–6+ months |

All AI paths additionally cost internal cleanup time (realistic: 2–8 h/hero for import,
material fixes, LOD, rig validation — internal estimate).

### Recurring implication: user-created fighters (Phase 3+)

If user fighters later get 3D at compile time (1–3 generations per fighter, no human
curation loop):

| Pipeline | Per-compile cost | 1,000 user fighters |
|---|---|---|
| Meshy API (Pro rates) | ~$0.40–1.20 | $400–1,200 |
| Tripo API (1 cr = $0.01; gen 25–60 cr, +retopo ⇒ ~90 cr) | **~$0.25–0.90** | $250–900 |
| Rodin (credits $1.50; Business API) | ~$1.50+ | $1,500+ |

Two structural warnings, independent of vendor: (1) hosted 3D generation takes **minutes,
not seconds** — it cannot live inside the 90-second live-nomination compile target
(docs/CHARACTER_COMPILER.md §8); user-fighter 3D would have to be asynchronous
(generate-after-draft, chassis primitive until ready). (2) Every generation of a
user-described character is an IP/moderation surface ("make Wolverine but blue") — the
Phase-3 prompt-injection/moderation suite must gate 3D-gen inputs exactly as it gates
stat compilation.

---

## 4. Quality-vs-Art-Bible risk assessment

Honest baseline for ALL current AI 3D (from independent reviews, not vendor pages):
verified user reports still describe **distorted faces, extra fingers, broken proportions**
on characters ([Top10AI Meshy review](https://top10ai.com/meshy-ai-review/)); meshes can be
dense/uneven/triangulated and hard to rig without the remesh pass
([see3d comparison](https://see3d.art/blog/detail/Meshy-AI-vs-Tripo-3D-AI-Review-Which-AI-3D-Generator-Fits-Your-Workflow-0ccbd577eb2b/),
[AssetHub on AI retopology](https://assethub.io/blog/ai-retopology)); r/gamedev consensus
rates **image-to-3D well above text-to-3D** because a concrete concept image constrains the
model. Character consistency across a *series* is a known unsolved pain: models "do not
inherently recall past generations" — the standard mitigation is reference-image
conditioning and rigid prompt templates
([getimg.ai guide](https://getimg.ai/blog/how-to-create-consistent-characters-with-ai) —
written for 2D, mechanism identical). **Implication: the real style-control lever is a
consistent 2D concept-art sheet per hero, produced first, in one style, then fed to
image-to-3D.** That front-end is a prerequisite regardless of which 3D vendor wins.

| Risk axis (Art Bible §5) | Meshy | Tripo | Rodin |
|---|---|---|---|
| Silhouette control | Moderate — image-to-3D preserves silhouette when the concept sheet is clean; text-to-3D unreliable | Moderate–good — same lever; part segmentation helps fix limbs | Good geometry fidelity — best chance of preserving fine silhouette elements (tusks, rockets, knife fans) |
| Material consistency ("stylized PBR, no photoreal, no toon") | Risk: AI texturing drifts generic/photoreal-ish; retexture passes help; needs a locked prompt/reference recipe across all 12 | Same risk; "stylized" style options exist (vendor claim — verify in bake-off) | **Highest style risk** — the product is explicitly positioned photorealistic/high-fidelity; may fight the collectible-statue look |
| Rig quality (dash/cast/guard intents; quadruped + floating) | Best on paper: free auto-rig, humanoid + quadruped, 600+ motions. Floating/robed = untested territory | Strong: 7 creature types, auto weights, T-pose export | Weak/unknown for arbitrary creatures — assume external rigging (Blender/AccuRIG) needed |
| Tri/texture budget fit (≤30–50k tris, ≤2K PBR) | Quad remesh + target poly counts in-product | Retopo to 500–50k quads in-product — cleanest budget story | Native output is 10M+ poly sculpts; needs aggressive decimation; High-Poly Quads is Business-tier |
| Known failure modes | Faces/hands, texture seams, occasional blobby detail | Same class; fewer complaints on topology post-Smart-Mesh (recent feature — thin independent evidence) | Overdetailed sculpts, photoreal drift; cost of redos |
| Marketing vs independent evidence | Vendor claims 97% printability etc. — print-world metric, irrelevant to us. Independent: polished but character anatomy still fails regularly | "Artist-quality quad meshes… no retopology needed" is a vendor claim; independent reviews are positive but note quality settings gate everything | "Sculpt-level detail" claims corroborated by independent comparisons; style-match claims are not |

**Bottom line:** nobody's gallery demonstrates *12 different heroes in one coherent
stylized-PBR universe*. Vendor galleries show one-off hero pieces (their best case);
independent evidence says per-character quality is achievable with iteration, but
cross-character consistency is our problem to engineer via the concept-sheet front-end —
and that is exactly what the bake-off must measure, because no paper survey can.

---

## 5. Bake-off protocol (if spend is approved)

**Candidates:** Meshy (Pro, $20) and Tripo (Pro, $19.90) as first-line game-pipeline
candidates; Rodin (Creator, $30) as the geometry-fidelity control. One month each.

**Test briefs — 3 real Season-0 fighters, one per chassis class under test:**

| Brief | Fighter | Chassis | Why chosen |
|---|---|---|---|
| 1 | **Ember Ronin** | humanoid | Representative of the 6-humanoid majority; cloak + glowing blade stresses materials/emissive |
| 2 | **Razorback** | quadruped | Quadruped rig test; hard-surface (plate, rockets) + organic mix; strongest silhouette spec |
| 3 | **Orrin** | floating | Non-standard anatomy (legless robes); rig/float-idle stress. (Cinder Wisp deliberately excluded — a living flame is VFX-led, not mesh-led, and would fail all candidates uninformatively.) |

**Procedure (per candidate, identical):**

1. **Free front-end first:** produce one concept sheet per brief (front/side/back, single
   locked style, using each fighter's `presentation` colors and `silhouette` text). Same
   three sheets feed all three candidates — this isolates the 3D variable.
2. Up to **10 generations per brief** (image-to-3D primary; text-to-3D once each, for the
   record). Pick best-of-N.
3. Run the winner through the candidate's own retopo/remesh to ≤50k tris, export GLB with
   PBR set ≤2K.
4. Auto-rig where offered (Meshy, Tripo); note failure honestly where not (Rodin).
5. Load into our existing Three.js client next to the current chassis primitive; drive
   idle + one `animationIntent` pose per fighter (dash/cast/guard class).

**Scoring rubric** (derived from Art Bible §5; 0–5 each, two independent scorers, score
sheets committed to the repo):

| Criterion | What 5 looks like |
|---|---|
| Silhouette read at black-profile | Matches the DNA `silhouette` text; identifiable in flat black |
| Stylized-PBR adherence | Reads collectible-statue; neither photoreal nor flat toon |
| One-universe consistency | The 3 briefs from this candidate look like one game |
| Budget fit | ≤50k tris and ≤2K PBR set **after** in-product processing, no manual fix |
| Rig usability | Auto-rig succeeds; dash/cast/guard poses deform acceptably; quadruped works |
| Cleanup cost | ≤2 h manual work to ship-ready (inverse-scored) |

**Pass gate:** a candidate advances to a full Season-0 estimate only with **≥18/30 and no
zero** on silhouette or budget. If no candidate passes, the recommendation auto-reverts to
the free fallback (§6) and this gate closes with ≤$70 spent and the question answered.

**Cost ceiling:** $20 + $19.90 + $30 = **$69.90 committed; $100 hard ceiling** (buffer for
one plan-tier bump or credit top-up). All three are month-to-month; cancel before renewal
is part of the protocol. Credentials/accounts to be provisioned by the Founder per the
established D-016 pattern (Founder provisions keys; rotation advisory applies).

---

## 6. Recommendation

**Approve the bake-off at the $100 ceiling.** Reasoning:

1. **The information is cheap and the alternatives are not.** The decision this gate
   really protects is the $24k–60k commission question and/or hundreds of hours of
   in-house labor. $70–100 buys ground truth on whether a $40–90 Season-0 pass is real.
   The expected-value math is lopsided.
2. **The risk is quality, not cost — and quality is unknowable on paper.** Published
   galleries prove single-hero capability; nothing public proves 12-hero one-universe
   consistency at our budgets. Only the experiment answers the Art Bible's actual bar.
3. **The free fallback is genuinely serviceable, so declining is safe.** An upgraded
   procedural chassis (better primitives, kit-bash parts, stylized-PBR shader, all driven
   by existing `presentation` data) keeps every playtest honest under the placeholder rule
   — silhouette class, palette, and animation intents already flow from content files. What
   it cannot do, at any polish level, is read as "living collectible" hero statues; and
   hand-modeling 12 heroes in Blender is 240–720 h of art labor we have not budgeted or
   proven. The fallback preserves the game; it does not deliver the art direction.
4. **Sequencing protects the direction either way.** The concept-sheet front-end (step 1,
   $0) is required for any pipeline — including a future commission, where the sheets
   become the artist brief. Nothing in the bake-off is wasted if AI loses.
5. **Suggested ceilings if the bake-off passes its gate:** Season-0 production pass
   **≤$250** (2–3 months of the winning subscription + top-ups + margin), decided by a
   follow-up gate with the scored results attached. Per-compile user-fighter 3D remains a
   separate future gate (asynchronous-only per §3, moderation-gated).

**Known limitations of this survey (flagged honestly):** all prices are point-in-time
(2026-08-20) from public pages; Tripo Pro-tier commercial terms and Rodin free-tier
license/export formats could not be verified without accounts; marketplace per-listing
prices are order-of-magnitude only; labor-hour estimates for the in-house path are
internal guesses, not sourced. One further unresolved legal note for the Founder: under
current US Copyright Office guidance, purely AI-generated output may not be copyrightable
without sufficient human authorship — our *designs* (concept sheets, DNA, lore) are
protectable, but the generated meshes themselves may not be. This is a portfolio-risk
consideration, not a blocker (statement of general legal landscape, not legal advice;
not independently re-verified for August 2026).
