# Security and Moderation

> Living document. Last updated: 2026-08-19. Honest scope note: today the product runs
> locally with no server, no accounts, and no user-generated content pipeline, so most
> threats below are *future* surface. They are catalogued now because several current
> design decisions (server-side validators, closed DSL, no live LLM) exist specifically to
> neutralize them before they become real.

## 1. Threat list

| # | Threat | Vector |
|---|---|---|
| T1 | Client result forgery | A client reports a fabricated match outcome |
| T2 | Salary/price manipulation | Client submits discounted prices or an over-cap roster |
| T3 | Duplicate/illegal picks | Duplicate exact versions, out-of-division fighters, invalid captains/actives |
| T4 | Prompt injection | Malicious text in character/wildcard requests steers a future LLM compiler into forbidden output |
| T5 | Generated-code execution | Generated content smuggles executable logic into the engine |
| T6 | Asset abuse | Uploaded images/models/names carrying infringing, hateful, or sexual content |
| T7 | Event flooding | Spam of commands/deploys/joins to degrade rooms or the sim host |
| T8 | Session takeover | Stealing a guest/room identity to act as another player |
| T9 | Replay tampering | Editing stored manifests/logs to falsify history (champions, prices) |

## 2. Current mitigations — implemented and verifiable in code

- **T1/T3 (and the enforcement seam for T2):** all competition-critical checks live in
  `packages/contracts/src/validate.ts`, written as server-side gates — the source states
  "the client is never trusted with these." `validateTeamSetup` enforces roster size, salary
  cap, duplicate-exact-version rejection, division eligibility, active-count/captain/reserve
  integrity, and **locked-price matching** (a tampered `pricePaid` is rejected against the
  content's `draftPrice`). Covered by 6 automated tests, including an explicit
  price-tampering test. *(Today these run in-process; the planned server runs the same
  functions authoritatively — see §4.)*
- **T1:** outcomes are never "reported" at all — they are computed by `MatchSim` from a
  manifest. The architecture has no path for a submitted result.
- **T5:** the content model is a **safe closed-vocabulary declarative DSL** — conditions,
  passives, effects, constraints are fixed enums the engine implements; content is plain
  JSON with validator-enforced bounds (durations, radii, resistances ≤ 0.75, price band,
  tick caps). There is no eval, no plugin loading, no code in content, by construction.
- **T4 (pre-emptive):** no LLM runs anywhere in the product today, and the locked law "AI is
  the compiler, not the referee" means even the future compiler only *proposes* schema-bound
  data that must pass the same validators and moderation before entering play. Live combat
  is model-free (`sim.ts` header documents this; commentary is template-only from real
  events).
- **T7 (partial):** the engine enforces hard budgets — 2 tactical tokens and 1 wildcard per
  player per match; extra attempts are refused (tested).
- **T9 (foundation):** deterministic replay hashing (FNV-1a over event log + outcome) means
  any tampered replay fails re-simulation from its manifest; 100% replay reproduction is an
  enforced test gate.

## 3. Known current gaps (honest)

Local builds trust the local machine entirely: a player can modify their own local content
or client. This is acceptable for hotseat/vs-AI and becomes unacceptable the moment two
machines compete — which is why online play is gated on the server-authoritative control
plane, not shipped before it.

## 4. Planned mitigations (with the phase that needs them)

- **Server-authoritative topology** (Phase 2 online): server runs the sim and the validators;
  clients send intents only. Neutralizes T1–T3 structurally.
- **Signed manifests and content** (Phase 2): server-signed match manifests, content hashes
  pinned per season; records store is append-only. Completes T9.
- **Sandboxed workers** (Phase 3): any compiler/asset-processing pipeline runs in isolated
  workers with no filesystem/network beyond allowlist — defense in depth for T4/T5 even
  though the DSL already forbids code.
- **Compiler injection defenses** (Phase 3): treat all user text as data; schema-constrained
  outputs; validator + moderation pass after generation; red-team prompt suite in QA
  (docs/QA_PLAN.md §6).
- **Upload scanning** (Phase 3 workshop): file-type allowlist, size caps, malware scan,
  perceptual matching against known-infringing sets, human review before public visibility
  (T6).
- **Rate limits & quotas** (Phase 2/4): per-connection and per-room limits on joins,
  messages, compile requests; backpressure on spectator fan-out (T7).
- **Session integrity** (Phase 2/4): unguessable room/guest tokens, short-lived and
  room-scoped; account binding when accounts arrive; no privilege from display names (T8).
- **Audit logs + RBAC** (before public launch): immutable moderation/admin action logs;
  role-based access for moderation tooling.

## 5. Moderation model (required before public launch — none of it exists yet)

- **Reporting:** in-product report on any user-visible content (fighters, wildcards, names,
  champion records) with category + free text.
- **Blocking:** player-level block that removes the blocked player's content and presence
  from the blocker's rooms.
- **Queues:** reported items enter a review queue; user-generated content defaults to
  `moderation: pending` (the field already exists on wildcard contracts) and is invisible to
  public rooms until approved.
- **Appeals:** removals are appealable; appeal outcomes are logged.
- **Audit:** every moderation action (who, what, why, when) in an append-only log.
- Staffing reality: at alpha scale this is the team + Founder with documented turnaround
  targets, not a fantasy trust-and-safety org; scope of Stage 3/4 intake is throttled to
  moderation capacity (see docs/LAUNCH_PLAN.md).

## 6. Public-content policy (summary; locked)

- **Closed private prototype** may test with recognizable concepts internally.
  **Public product ships originals, licensed, or public-domain characters only.**
- Requests for protected characters get a **transformed original alternative, disclosed as
  such** — never a silent clone.
- **Real-person likenesses require verified permission** from that person. No exceptions,
  including "parody" framings.
- **Creator ownership:** creators own their originals, with publish/remix/attribution
  controls (the schema already carries `ownership`, `visibility`, `remixPolicy`).
- **Safety envelope:** teen-oriented superhero violence; no gore-as-identity, no sexual
  content, no extremist content. The engine supports this structurally — defeat is knockout
  or containment; there is no death state.
- Enforcement layers: authoring policy (now) → moderation pipeline (Phase 3) → reporting +
  audit (pre-launch requirement).
