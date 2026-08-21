# Backlog

> Living document. Last updated: 2026-08-21. Phase-organized. A checked box means the work
> is verifiable in this repository today; in-progress items say so explicitly. Labels:
> **[founder-gate]** requires explicit Founder approval before starting/spending,
> **[spike]** timeboxed investigation, **[risk]** known risk attached — see the item.

## Phase 0 — Proof Architecture ✅ (complete)

- [x] Monorepo scaffold (npm workspaces, TypeScript, Vitest, tsx; zero paid dependencies)
- [x] Shared contracts package: full schema suite (Character Contract, Combat DNA, wildcards,
      arenas, ruleset, teams, manifest, events, outcomes, breakdown, champion, readout)
- [x] Season 0 ruleset constants (tick 250 ms, $100M cap, 3–5 roster, ABBA, 2 tokens,
      1 wildcard, escalation + hard decision limits, Enhanced division)
- [x] Content validators with hard bounds (fighter / wildcard / arena / team legality)
- [x] Decision evidence tooling: draft-order fairness simulation (ABAB vs ABBA)

## Phase 1 — Deterministic Combat Core ✅ (complete)

- [x] MatchSim: tick loop, seeded RNG (mulberry32), utility-based fighter decisions,
      movement/formations/separation, conditions (18 kinds), resources + custom power
      sources, weakness triggers, guarding/stability, stealth, counters, summons/deployables
- [x] Squad Relay: reserves, reinforcement triggers, tactical swaps
- [x] Tactical command tokens with behavior-constraint and compliance rejections
- [x] Wildcard runtime: 4 classes, 9 effect kinds, deployment/destruction/expiry, impact
      tracking
- [x] Arena features: cover vs ranged, destructibles, water terrain, context grants
- [x] Escalation stalemate-breaker + hard decision limit
- [x] Match Manifest build/replay; FNV-1a replay hashing; `verifyReplay`
- [x] Causal breakdown builder (event-log-grounded factors, turning point, per-fighter stats)
- [x] Template commentary from real events (deterministic; no LLM)
- [x] Team Readout (own-team only, 12 axes, no win probability)
- [x] Transparent pricing formula + season price locking tool
- [x] Balance harness (round-robin, win-rate outlier flags, determinism check)
- [x] Test suite: 22 passing (determinism/replay, property invariants, relay, commands,
      wildcards, explainability, draft legality, wildcard normalization)

## Phase 2 — Draft-to-Battle Loop (in progress)

Content + client (parallel workstreams, underway):

- [x] Season 0 roster: 12 curated original fighters — all 12 in repo
- [x] Season 0 wildcards: 8 templates — all 8 in repo
- [x] Season 0 arena: Meridian Plaza (full pre-draft disclosures)
- [x] `npm run price` stamped + season-locked (reviewer overrides D-013 orrin, D-027
      grimspike)
- [x] Full-roster balance-harness pass — systemic rebalance in ruleset 0.3.0 (D-027,
      ADR-0010); residual outliers documented as AI-self-play blindness classes,
      human-gate-decided
- [x] Desktop-web client (Vite + TS + Three.js): full loop, local vs-AI, hotseat, online;
      generated hero statues with procedural fallback (D-026)
- [x] Integration tests over shipped content (182 unit/integration + 8 E2E)

Phase 2 remainder (online layer — landed 2026-08-19, ADR-0006/0007):

- [x] WebSocket control plane: rooms, challenge links, guest entry (no account), draft
      orchestration, wildcard lock/reveal (session-integrity hardening per
      SECURITY_AND_MODERATION §4)
- [x] Server-authoritative combat host (lockstep-deterministic clients with server hash
      authority, ADR-0007)
- [x] Spectators (20 per room, reactions, join-in-progress)
- [x] Reconnect (guest session tokens)
- [~] Records store: append-only JSONL persistence (matches/reports/audit). Manifest
      SIGNING not yet implemented — becomes relevant with accounts/hosted records
- [x] [spike] Hosting survey → infra/server/ (Dockerfile, fly.toml, render.yaml);
      actual durable hosting spend remains [founder-gate]

## Phase 3 — Character Creation (in progress)

- [~] Creator workshop: live custom nomination in local AND online drafts with
      semantic/visual correction passes (ADR-0008 compilers). Full standalone
      workshop UI with publish/remix/attribution controls not yet built
- [x] [founder-gate] LLM compiler adapters behind provider-neutral interfaces —
      rule-based fallback always available; Claude interpretation layer live behind
      Gate 2 (D-016, ADR-0009)
- [x] Compiler pipeline: deterministic assembler + validators, 15-family taxonomy,
      IP/real-person transforms, unbounded-clause normalization (ADR-0008)
- [ ] Prompt-injection red-team suite + schema-constrained outputs + post-generation
      validation/moderation [risk: T4/T5 in docs/SECURITY_AND_MODERATION.md]
- [ ] Provenance graph tooling: render evidence→claim→mechanic chains; automated
      no-mechanic-without-claim check
- [ ] Eligibility promotion tooling (Experimental → Community Verified → Ranked Eligible →
      Tournament Frozen) with recorded gate results
- [ ] [founder-gate] [spike] 3D character generation bake-off (candidate tools, quality vs
      the Art Bible, cost table) — **REQUIRES Founder-approved spend before any paid tool
      or API is touched**; free/procedural pipeline remains the fallback
- [ ] Moderation pipeline for user content: pending-by-default, review queue, upload
      scanning

## Phase 4 — Social Vertical Slice (in progress)

- [x] [founder-gate] Deployment — Gate 1 APPROVED and live (GitHub Pages client +
      self-hosted tunnel server; docs/DEPLOY.md, D-015)
- [x] Crash reporting — self-hosted: local ring buffer + `client_crash` telemetry events
      to our own control plane (no third-party service)
- [x] Analytics wiring: the 12-event funnel + Run-It-Back Rate
      (docs/LAUNCH_PLAN.md §3–4); synthetic/real separation enforced at the source
      and in the report (D-018)
- [x] Champion share + dethrone links end-to-end (champion card PNG, URL-fragment
      dethrone links, live-verified 2026-08-19)
- [x] Moderation basics live (D-021): reporting + rate caps, client-side blocking,
      `npm run moderation` review queue, append-only audit log. Deferred until accounts
      exist: enforcement (kick/ban), person-level blocks, reviewer RBAC — see ledger
- [~] Performance baseline: repeatable harness (`npm run perf`) + first measured
      baseline recorded in docs/PERF_BASELINE.md (M1 Pro: vsync-limited at both
      720p and 1080p, 242 KB gzip bundle, ~11 MB heap). Gate line stays OPEN —
      the 720p30 integrated-graphics floor still needs a representative low-end
      machine (listed in the doc). Cheap wins identified: frame cap for the 4 Hz
      sim, DPR raster cost, per-frame vector allocations
- [x] Session-integrity hardening: room/guest tokens, rate limits, payload caps
      (ADR-0006)

## Phase 5 — Closed Alpha & Launch Validation (not started)

- [ ] Stage 1: ≥10 founder-adjacent friend groups through full sessions
- [ ] Measure the vertical-slice acceptance gate (docs/LAUNCH_PLAN.md §2): run-it-back ≥60%,
      character approval ≥85% within one semantic correction, winner-explanation ≥85%,
      crash-free ≥95%, dethrone usage ≥50%, replay reproduction 100%
- [ ] Correction-loop instrumentation (semantic/visual revision counts per contract)
- [ ] Stage 2: competitive/creator captains; Stage 3: waitlist intake in group batches
- [ ] Weekly Executive Digest includes real human metrics for the first time
      (never before — see the synthetic-data rule)
- [ ] Post-gate review: go/no-go on broader public alpha [founder-gate]

## Explicitly deferred (each needs its own Founder Gate to even schedule)

- Ranked matchmaking · monetization of any kind · paid marketplace · voice chat ·
  additional divisions beyond Enhanced · brackets/tournaments · mobile companion ·
  Steam/console packaging (path preserved per docs/TECHNICAL_ARCHITECTURE.md §9)

---

## Verification findings — live E2E pass, 2026-08-19 (Executive Producer)

Full solo-mode loop verified in-browser with zero console errors: guest entry → arena
reveal → ABBA draft (inspection, cap enforcement, AI opponent, roster lock) → team prep +
readout → wildcard exact-mechanics/lock/reveal → live 3D battle (eclipse lighting change,
focus command, enemy counterplay destroyed the Nullstone Shard, escalation flag, decision
verdict) → causal breakdown (draft value, weakness exploitation, turning point, command +
wildcard factors, transcript) → champion record → run-it-back restart. Polish items observed:

- [x] [qa] `ally_below_35` relay swap — deterministic unit test added 2026-08-20: swap
      fires the same tick a fighter is <35% at check time, holds at exactly 35%. The E2E
      observation was heals keeping everyone above threshold at check time (engine correct)
- [x] [gameplay] Sustain-heavy zero-KO decisions — escalation now damps healing
      symmetrically (D-017, ruleset 0.2.0; residual shield-driven floor recorded in
      KNOWN_LIMITATIONS §12)
- [x] [gameplay] AI wildcard selection scores against both drafts (landed 2026-08-19 wave)
- [x] [frontend] Team Readout axis bars — sqrt display curve + numeric value beside each bar
- [x] [frontend] Corner drift — render-only camera framing bias toward arena center
      (up to 30% pull at the wall; sim untouched)
- [x] [frontend] Inspect-drawer body scroll-lock (landed 2026-08-19 wave)

---

## Online milestone — landed 2026-08-19 (second wave)

- [x] [multiplayer] Control plane: rooms, guest sessions + token reconnect, server-authoritative draft/prep/wildcard/battle, spectators (20), reactions, rate limits, JSONL persistence (ADR-0006)
- [x] [multiplayer] Lockstep-deterministic clients with server hash authority (ADR-0007); live two-client match verified
- [x] [compiler] Deterministic character + wildcard compilers, 15-family taxonomy, corrections, IP/real-person transforms, unbounded-clause normalization (ADR-0008); live nomination + typed custom wildcard flows in local AND online modes
- [x] [qa] Playwright E2E (6 specs, chromium+webkit); schedule-randomized balance harness; combat-variety analyzer (0 repetition findings after commentary phrase memory)
- [x] [qa] Replay Original for custom content: match records persist compiled contracts; replay-to-hash test
- [x] [gameplay] Balance pass with trustworthy cross-schedule evidence; Orrin reviewer override (D-013); Ember gap-closer (D-014); AI-drafter soft-lock fix
- [x] [frontend] Champion card PNG export, accessibility settings, crash capture, challenge-under-current-rules, drawer scroll-lock
- [x] Governance: CODEOWNERS, protected main with required CI check

### Next free work (no gates) — all landed
- [x] [multiplayer] Online rematch/run-it-back within a finished room (2026-08-19 wave)
- [x] [gameplay] Basic 4-player bracket — Bracket Night (2026-08-19 wave)
- [x] [gameplay] AI opponent wildcard selection scores against both drafts (2026-08-19 wave)
- [x] [qa] Safari/JavaScriptCore lockstep divergence trial — measured EQUAL, 3 manifests,
      chromium+webkit (2026-08-19 wave)
- [x] [frontend] Team Readout bar scaling; camera corner-drift bias; escalation healing
      damp (D-017) — this wave

## Telemetry wave — landed 2026-08-20

- [x] [analytics] Control-plane `POST /telemetry` (CORS for the Pages origin, size caps,
      per-event validation, JSONL) + client uploader (20 s flush + sendBeacon on hide,
      offline-tolerant outbox) — D-018
- [x] [analytics] Real-vs-synthetic separation enforced at the source: deployed
      origin stamps `alpha`, localhost stamps `local-dev`; anonymous client id; room-or-device
      group key (LAUNCH_PLAN §5)
- [x] [analytics] Crash capture ships `client_crash` events → crash-free gate computable
- [x] [analytics] One-tap comprehension prompt on breakdown → winner-explanation gate
      computable
- [x] [analytics] `npm run funnel` — 12-step funnel, Run-It-Back Rate, gate table vs
      LAUNCH_PLAN §2 with PASS/FAIL/NO DATA and written metric definitions
- [x] [engine] Escalation healing damp 0.15 in ruleset 0.2.0 + version-keyed ruleset
      registry: 0.1.0 manifests replay to their original hashes forever (D-017)

### Instrumentation gaps (found while wiring the funnel)
- [x] [analytics] Online `draft_completed` emitted at the draft→prep transition (both
      seats report; funnel dedupes per room)
- [x] [analytics] Online nominations emit `custom_correction`/`fighter_approved`

## Hero visuals + Phase-4 closeout wave — landed 2026-08-20 (third wave)

- [x] [frontend] **Procedural hero pass** (D-023): sculpted chassis silhouettes, pedestal
      draft presentation with role rings/plates, role color+icon language, Meridian Plaza
      diorama, pose atoms — Art Bible §8 step 1→2; free path; modeled characters remain
      behind the 3D bake-off Founder Gate (proposal ready in docs/proposals/)
- [x] [frontend] Camera framing bias corrected (position-biased, target stays on the
      fight); 60 fps render cap; frame-loop allocation cleanup (perf baseline offsets)
- [x] [qa] Perf baseline harness `npm run perf` + docs/PERF_BASELINE.md (gate line stays
      open pending reference low-end hardware)
- [x] [moderation] Reporting/blocking/queue/audit (D-021) + online draft void backstop
      (D-022), protocol 0.3.0

### Rev-2 + cap-lock wave — landed 2026-08-20 (second wave)
- [x] [multiplayer] Protocol rev-2 (0.2.0): typed `room_closed`, `battle_wildcard` carries
      a validated `wildcardId`, declined nominations keep the nomination right (D-019)
- [x] [gameplay] **Cap-lock guard** (D-020): live repro found the AI (and any player)
      could be priced out of a legal minimum roster when the opponent drained the cheap
      market — the draft then dead-ended. `minRosterReserve` (worst-case snipe bound) now
      gates picks in solo AI, local UI, and the server; voided-draft recovery screen added
      as backstop
- [x] [frontend] Readout axes: two-column grid collapsed bar tracks to 0px inside the prep
      panel — single column + honest numeric values (the actual cause of the "near-empty
      bars" finding)
- [x] [frontend] Comprehension prompt survives breakdown re-renders; one RESPONSE per
      match, not one showing

### Founder-gated (spend/accounts — the current stop-line)
- [ ] [founder-gate] Alpha hosting/deployment (static client + room server) → unlocks Stage 1 friend-group testing
- [ ] [founder-gate] LLM API budget → semantic-fidelity upgrade for both compilers behind existing signatures
- [ ] [founder-gate] 3D generation bake-off credits → real fighter models/preview
- [ ] [founder-gate] Unity tooling → completes the deferred engine bake-off half (ADR-0001)

## Production heroes + Season-0 rebalance wave — landed 2026-08-21 (fourth wave)

- [x] [founder-gate] 3D bake-off EXECUTED (D-024→D-025): gate PASSED — Tripo 3/3
      (identity/style winner), Meshy finish pipeline; ~$21 of the $100 ceiling
- [x] [founder-gate] Season-0 hero production pass (D-026, $25 ceiling):
      tools/heroforge — Tripo text-to-3D triangle GLBs at the 40k-tri web budget for
      all 12 heroes; Meshy auto-rig captured for biped chassis while the paid month
      lasts; promote tool → apps/web/public/heroes + manifest
- [x] [frontend] Generated hero statues live in the pedestal inspect drawer with
      async swap + procedural fallback (battle rendering stays procedural-rig —
      GLB battle animation is a future craft pass)
- [x] [engine] Ruleset 0.3.0 systemic rebalance (D-027, ADR-0010): approach
      guard/surge, flight stamina duty cycles, hover reclassified melee-reachable,
      stealth ambush payoff, grimspike telegraph + $45M override. Razorback
      26.6→46.8%; decisions 21%→~10%; watch items recorded honestly

## Animation & physics roadmap (Founder question 2026-08-21: "physics all the way around")

Three tiers, cheapest-first; each tier ships value on its own. Sim stays
deterministic and untouched throughout — all of this is presentation.

**Tier 1 — procedural reaction language (SHIPPED this wave):** typed hit
reactions (flinch pose scaled by damage; psychic reels in place, sonic
vibrates the figure, kinetic/thermal shove the victim), stagger pose on
stability break, anticipation wind-back on attacks, idle breathing/sway,
lean-into-travel with flight banking (superhero flight read), lunge lean,
hit recoil, KO hop + eased slump, damage-type projectiles (fireballs/
beams/bolts/wavefronts/tracers).

**Tier 2 — procedural physics polish (SHIPPED 2026-08-21, same session):** impact debris and
ground scorch decals per damage type, knock-down vs knock-back distinction
for heavy hits (brief floor bounce before recovery), landing dust + takeoff
crouch-spring for fliers on the 0.3.0 duty cycle, cloth-like lag on capes/
tails (secondary motion springs on existing joints), weapon trails on melee
swings. All still on the procedural rigs — no external tools, $0.

**Tier 3 — rigged clip animation (craft-work gate):** the generated GLBs are
statues; real keyframed movement needs skeletons + clips. Assets in hand:
Meshy auto-rigs + free walk/run clips for captain-meridian, aegis-9,
ember-ronin (tools/heroforge/results/). Path: retarget a shared clip set
(idle/walk/attack/cast/hit/KO) onto auto-rigged bipeds via Blender/AccuRIG
(≈2h/hero craft work), THREE.AnimationMixer playback keyed by the same
animationIntent grammar, procedural rigs remain the fallback and the
quadruped/floater answer until they get bespoke rigs. This is a time gate,
not a money gate — schedule it when a human animator (or a Founder Blender
session) is available.
