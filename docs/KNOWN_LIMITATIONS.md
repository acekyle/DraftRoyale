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

6. **Custom-fighter statues need the local forge service.** Season heroes ship
   committed Tripo statues (D-026/D-028); custom nominations forge theirs on the
   spot through the dev-server middleware (D-029) — so statues only appear when
   the dev server runs with `TRIPO_API_KEY` set, land ~2–3 minutes after
   approval (next mount picks them up; no mid-battle swap), are per-machine
   (gitignored), and skip the rubric. On the deployed static build customs stay
   procedural chassis with palette/scale/silhouette variation — the guaranteed
   floor. Custom statues are unrigged (Meshy rig not wired for customs).
6b. **Battle animation quality varies by rig source** (D-030/D-031): all 12
   fighters wear their real multiverse bodies in battle — 8 bipeds on
   Meshy-clip sets via Blender skeleton transfer, 2 quadrupeds on scripted
   rigs with authored clips (functional, not artist-grade — trot/lunge/
   collapse), 2 floaters as statue bodies with group-level hover motion (no
   joint gestures). Known blemishes: solaria's light ribbons deform with her
   arms (reads as wings), grimspike uses proximity-transferred weights from
   the AEGIS-9 mech (coarse on his slabs), whisper's drone ring rides her
   shoulder bones. The procedural chassis remains the instant fallback while
   assets load and for customs. Artist-grade polish = a human Blender pass.
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
12b. **Balance residuals are AI-self-play readings** (D-027, ADR-0010): after the
    0.3.0 approach/flight rebalance, grimspike still aggregates ~72% and the
    duelist/ambusher/protector archetypes (ember-ronin, sable-howl, AEGIS-9)
    read low — but the bot AI cannot bait interruptible telegraphs, duel,
    ambush-cycle, or peel, exactly the skills those kits reward or punish.
    Tuning deliberately stopped; the human vertical-slice gate decides. If
    humans confirm grimspike, the sketched next lever is a core-exposure
    vulnerability window on stability break (provenance-reviewed content pass).

## Trust boundaries

13. **Server-authoritative online, but LAN-scope security**: bearer session tokens
    without expiry/origin checks/TLS; no accounts. Local modes remain client-side
    and honest-but-not-tamper-proof.
14. **Cross-engine float determinism measured equal on V8 and JavaScriptCore**
    (3 mechanic-sweeping manifests, chromium+webkit E2E). Any future divergence
    on an unmeasured engine is still surfaced by the hash check and resolved in
    the server's favor, not silently wrong (ADR-0004/0007).
15. **Moderation basics only** (D-021): in-room reporting, review queue, audit
    log, client-side block/mute. Enforcement (kick/ban), person-level blocks,
    and reviewer RBAC wait on accounts; hard gate before any public stage.
16. **Persisted match records live in a JSONL file** on whatever machine ran the
    server; no backups, no queryable history service yet.
