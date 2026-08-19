# ADR-0002: Local-first slice; control-plane bake-off deferred to online milestone

- **Status:** Accepted
- **Date:** 2026-08-19
- **Proposer:** Multiplayer & Backend Lead · **Reviewers:** Technical Architect, Executive Producer

## Context

The constitution requires comparing a mature multiplayer control-plane framework against a
lightweight custom service (rooms, draft sync, presence, spectators, server-authoritative
hosting) before adopting either. The first playable slice, however, can prove the entire
draft→battle→explain→run-it-back loop without any network at all.

## Decision

1. Ship the vertical slice with **local play modes** (solo vs AI, couch hotseat,
   URL-encoded dethrone challenges) — zero backend, zero hosting spend, zero auth surface.
2. Keep every networked concept in the shared contracts NOW (Room/Guest/TeamSetup/
   MatchManifest/commands as serializable timelines), so the sim already runs headless from
   a manifest exactly as a server would run it. `validateTeamSetup` is written as the
   server-side check it will become.
3. Run the control-plane bake-off (framework vs custom `ws` + SQLite/Postgres service) as
   the FIRST task of the online-rooms milestone, before any adoption. Evaluation dimensions
   per constitution §36; recorded here when measured.

## Consequences

- Friend groups cannot play remotely yet — the single biggest gap between this slice and
  the 10-group test. Tracked as the top item in the Risk Register.
- A mid-match page reload loses the local session (no server to resume from). Accepted for
  the slice; documented in KNOWN_LIMITATIONS.
- Dethrone links already work serverlessly (champion team frozen into the URL fragment),
  which lets the share loop be tested before any backend exists.
