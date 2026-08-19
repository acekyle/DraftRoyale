# ADR-0007: Lockstep-deterministic client mirror for online battles

- **Status:** Accepted
- **Date:** 2026-08-19
- **Proposer:** Multiplayer & Backend Lead · **Reviewers:** Technical Architect, Game Client Lead · **Red-team:** QA Lead

## Context

The renderer consumes rich local `MatchSim` state (positions, windups, stealth,
conditions) every frame. Streaming that state from the server would either mean a
fat per-tick snapshot protocol or a renderer rewrite against thin snapshots.

## Decision

Online battles run **lockstep-deterministic**: the server hosts the authoritative
`MatchSim` and relays only (a) validated player inputs stamped with their
`issuedTick` and (b) `tick_advance` authorizations. Every client builds an
identical sim from the battle snapshot (same engine code, same seed, same input
timeline) and steps it no further than the authorized tick. The renderer keeps
reading a local sim, unchanged. Reconnect = snapshot (teams/seed/full input
timeline/authorizedTick) + fast-forward.

**Server authority is preserved** exactly as the constitution requires: the
server's outcome and FNV event-log hash are broadcast at `battle_over`; a client
whose local hash diverges displays the authoritative server result with a
divergence notice. Clients never report results.

## Trade-offs

- Bandwidth: near-zero during battle (~4 tiny messages/sec + rare inputs).
- Risk: cross-engine float divergence (V8 server vs JavaScriptCore in Safari).
  Chrome/Edge/Node share V8 so LAN alpha risk is low; the hash check makes any
  divergence *visible* rather than silent, and the fallback ladder from ADR-0004
  (server-streamed event replay, fixed-point quantization) remains available.
- Anti-cheat: a client can only see what it is sent; private prep/wildcards stay
  server-side until reveal. A modified client cannot change outcomes (server sim
  decides), only its own display.
