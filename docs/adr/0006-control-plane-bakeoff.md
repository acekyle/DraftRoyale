# ADR-0006: Control-plane bake-off — lightweight custom WebSocket service

- **Status:** Accepted (measured; working prototype is the shipped service)
- **Date:** 2026-08-19
- **Proposer:** Multiplayer & Backend Lead · **Reviewers:** Technical Architect, Executive Producer · **Red-team:** QA Lead

## Comparison (constitution §36, weighted per §6)

| Criterion (weight) | Framework (Colyseus/Nakama) | Custom `ws` service | Rationale |
|---|---:|---:|---|
| Vision / social-replay fit (25) | 18 | 22 | Colyseus's delta-patched state-sync model actively fights an input-relay lockstep design — we would bypass its core feature |
| Fun / readability (20) | 16 | 16 | Neutral: gameplay lives in the sim, not the transport |
| Accuracy / explainability (15) | 10 | 14 | One process owns sim + inputs; hash-verified replay from the persisted manifest is proven in tests. Framework serialization layers are places determinism bugs hide |
| Feasibility (15) | 11 | 14 | ~1,300 lines, one dependency (`ws`), already green. Nakama adds a server binary + DB + SDK for a LAN alpha |
| Scalability (10) | 8 | 5 | Honest loss — frameworks bring matchmaking, presence, horizontal scale. Custom is single-process in-memory rooms; fine for the 10-group target, a real ceiling later |
| Cost / speed (5) | 3 | 5 | Zero infra spend; `npm run server` anywhere |
| IP / platform risk (5) | 5 | 5 | Neutral |
| Growth (5) | 4 | 3 | Frameworks bring accounts/leaderboards later; custom builds or migrates |
| **Total** | **75** | **84** | Custom wins by 9; §6's prototype-override was not needed — the prototype IS the shipped, tested service |

## Decision

Adopt the custom service (`services/control-plane`). Evidence: 11 integration tests
including the lockstep proof (two real ws clients reproduce the server's event
hash exactly), a rejection matrix (tampered prices, out-of-turn, over-cap,
duplicate picks, token/wildcard limits, spectator gates), reconnect mid-draft and
mid-battle, and Replay Original from persisted records including compiled custom
content.

## Honest risks of the custom path

No horizontal scaling story (sticky in-memory rooms); bearer-token sessions with
no expiry/origin checks/TLS — LAN/private-alpha scope only; append-only JSONL
persistence, not a queryable DB; matchmaking/presence/accounts are future builds
or a future migration; all hardening is ours to maintain. Revisit trigger: Stage
3 (waitlist) concurrency planning, where a managed layer or DB-backed rewrite is
evaluated against real load numbers.

## Protocol frictions recorded for the next revision

Wire `issuedTick` is the pre-step convention while manifest timelines store the
application tick (off-by-one, handled server-side and proven by replay tests);
`battle_wildcard` omits `wildcardId` (assumes `wildcardsPerPlayer: 1`); custom
fighters are publicly visible but nominator-draftable (required for lockstep
content anyway); no dedicated `room_closed` message; a declined nomination still
consumes the one-per-player right.
