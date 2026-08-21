# Known Limitations

> Living document — updated 2026-08-19 (post-online-milestone). The honest gap list
> between the current build and the full product specification. Nothing here is
> hidden from the Founder or testers.

## Playability

1. **Online play is LAN/self-hosted only.** The control plane (`npm run server`)
   provides server-authoritative rooms, spectators (20), reactions, reconnect, and
   lockstep battles — verified live with two clients — but there is **no public
   deployment** (Founder gate). Friends can play only on a shared network or a
   machine someone exposes themselves.
2. **No session resume for local modes.** A reload mid-flow returns to the lobby
   (online rooms DO reconnect via session tokens). Guest history/champions persist
   per browser.
3. **No online rematch loop yet** — a finished room requires creating a new room;
   run-it-back online means sharing a fresh code. (Local modes have one-click
   run-it-back.)
4. **Custom fighters/wildcards are rule-compiled, not LLM-interpreted.** The
   deterministic 15-family taxonomy honors the full pipeline (contracts,
   provenance, corrections, normalization, pricing, experimental eligibility) but
   its understanding is keyword-shallow; nuanced lore won't be captured. IP and
   real-person guards are keyword lists (~54 names + honorific patterns) — they
   miss misspellings and description-only references. All disclosed in compiler
   notes in-product; LLM upgrade is Founder-gated (ADR-0008).
5. **AI opponent is heuristic** (value-drafting, scripted command/wildcard timing;
   its wildcard pick is random — it may counter itself).

## Presentation

6. **Fighters are stylized procedural chassis**, not generated/sculpted models;
   animation is procedural. The 3D pipeline is a Founder-gated bake-off. Custom
   fighters get palette/scale/silhouette variation of the same chassis — the spec's
   "rotatable 3D preview, polished and recognizable" bar for live nominations is
   NOT met visually yet (mechanically and narratively it is).
7. **Audio absent; commentary text-only** (per spec: text first). Commentary now
   has phrase memory; zero repetition findings in the variety analyzer.
8. **One arena.** 9. **Camera director is simple** (action-weighted centroid,
   event focus, shake; tactical toggle; no alternate replay angles).

## Competitive systems

10. **Season 0 = Enhanced division only; no ranked/ratings/tournaments**
    (deliberate, per launch plan; local Bracket Night is a party mode, not a
    competitive system).
11. **Balance is AI-self-play only.** Cross-schedule harness (6 schedules × seeds)
    shows no fighter outside 32–68% aggregate with every remaining flag
    schedule-dependent; Orrin priced via bounded reviewer override (D-013).
    Human play remains the real gate.
12. **Escalation vs sustain — damped, not eliminated** (D-017): ruleset 0.2.0
    ramps healing down at the same rate escalation ramps damage up, cutting
    zero-KO decisions ~27% cross-schedule. A residual ~1.6–2% floor remains and
    appears shield/evasion-driven (shields are deliberately not damped); that is
    a separate lever if human play surfaces it as a problem.

## Trust boundaries

13. **Server-authoritative online, but LAN-scope security**: bearer session tokens
    without expiry/origin checks/TLS; no accounts. Local modes remain client-side
    and honest-but-not-tamper-proof.
14. **Cross-engine float determinism measured equal on V8 and JavaScriptCore**
    (3 mechanic-sweeping manifests, chromium+webkit E2E). Any future divergence
    on an unmeasured engine is still surfaced by the hash check and resolved in
    the server's favor, not silently wrong (ADR-0004/0007).
15. **No moderation/reporting systems** — acceptable strictly while access is
    private; hard gate before any public stage.
16. **Persisted match records live in a JSONL file** on whatever machine ran the
    server; no backups, no queryable history service yet.
