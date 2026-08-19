# Known Limitations

> Living document — updated 2026-08-19. The honest gap list between the current build and
> the full product specification. Nothing here is hidden from the Founder or testers.

## Playability

1. **No online multiplayer.** Play modes are solo-vs-AI, couch hotseat, and dethrone
   challenges via URL. Remote friend-vs-friend rooms, spectators, chat/reactions, and
   reconnect are the next milestone (ADR-0002). This is the biggest gap to the 10-group test.
2. **No session resume.** A page reload mid-flow returns to the lobby (guest history,
   champions, and telemetry persist in localStorage; the in-progress match does not).
3. **Hotseat privacy is procedural** — pass-the-screen interstitials, honor system.
4. **No live typed custom fighter / custom wildcard.** The compiler pipeline is schema-
   and-validation only until an LLM budget is approved (Founder Gate). All 12 fighters and
   8 wildcards are curated content.
5. **AI opponent is heuristic**, not a meta-learning drafter. It value-drafts with synergy
   and role-diversity bonuses and uses scripted command/wildcard timing. Competent, not cunning.

## Presentation

6. **Fighters are stylized procedural chassis** (collectible-statue placeholders built
   from primitives with role/energy color language), not generated or sculpted models. The
   3D generation pipeline is a Founder-gated bake-off. Animation is procedural (lunge,
   flash, KO fall, hover bob) — the authored animation-atom grammar is designed
   (COMBAT_DNA presentation intents exist per fighter) but not yet asset-backed.
7. **Audio is absent.** Commentary is text-only (per spec: text first).
8. **One arena** (Meridian Plaza). Schema supports more; content pipeline proven.
9. **Camera director is functional but simple** (action-weighted centroid + event focus +
   shake). No multi-angle replay choices yet; replays re-render through the same director.

## Competitive systems

10. **Divisions exist at schema level; Season 0 ships Enhanced only.** No ranked
    matchmaking, ratings, brackets, or tournaments yet (per launch plan, deliberately).
11. **Prices cluster** in a ~$29–40M band this pass; spread widening is an open balance
    task (Risk R-4). Prices are still locked, transparent, and tamper-checked.
12. **Balance evidence is AI-self-play only** — thousands of seeded matches, zero humans.

## Trust boundaries

13. **Everything runs client-side today**, so "server-authoritative" is implemented as
    architecture (headless manifest runner + server-style validators) rather than as a
    deployed trust boundary. Local results are honest but not tamper-proof; online play
    will run the same sim server-side.
14. **Replay determinism verified same-engine.** Cross-browser bit-identity is untested
    (ADR-0004 has the mitigation ladder).
15. **No accounts.** Guest-only; history lives per-browser until account upgrade ships.
16. **No moderation/reporting systems** — acceptable strictly while access is private.
