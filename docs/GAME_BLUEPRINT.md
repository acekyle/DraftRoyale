# Game Blueprint

> Living document. Last updated: 2026-08-19. Describes the product design and marks each
> element **Implemented** (verifiable in this repo) or **Planned** (specified, not yet built).

## 1. Product identity

Social competitive 3D draft-battle simulator with an expandable character and wildcard
compiler. Players receive a salary cap, draft a fresh team of powerful characters, add one
wildcard element, and watch the resulting teams fight a cinematic but explainable battle.

- **Draft** creates the argument. **Battle** settles it. **Champion** creates the next argument.
- North-star behavior: a friend group finishes a match and immediately starts another fresh
  draft to dethrone the champion ("Run it back. I know what team can beat that.").

## 2. Audience

Friend groups who argue about "who would win" — versus-debate fans, fantasy-draft players,
and character enthusiasts. First-match friction must be near zero: a room link and a display
name, no account (Planned — the current build is local-only; see §12).

## 3. The 12-step match flow

Season 0 ruleset values below are **Implemented** in `packages/contracts/src/ruleset.ts`
(RULESET_S0) and enforced by `validateTeamSetup` and the simulation.

1. **Room link** — a player creates a room and shares a challenge link. *(Planned — online
   rooms; current builds run local vs-AI and hotseat.)*
2. **Guest entry** — joining the first match needs no account, just a display name. *(Planned.)*
3. **Room config** — 1v1, $100M salary cap, 3–5 fighter rosters, Market Draft, 1 wildcard +
   2 tactical command tokens per player. *(Implemented as the Season 0 ruleset.)*
4. **Power division select** — Street / Enhanced / Global / Cosmic / Open. Season 0 ships the
   **Enhanced** division only; the division field and draft-legality check are implemented
   (non-`open` rulesets reject out-of-division fighters).
5. **Arena reveal BEFORE drafting** — the arena and *all* of its mechanical disclosures are
   shown before any pick. *(Implemented at the data layer: `ArenaDef.disclosures` is required,
   and `validateArena` rejects arenas without disclosures. Meridian Plaza ships 8 disclosures.)*
6. **ABBA snake Market Draft** — alternating snake picks (A B B A …) against locked season
   prices. Price tampering, cap violations, and duplicate exact versions are rejected
   server-side. *(Implemented: `validateTeamSetup`; order fairness evidence: `tools/draft-order.ts`.)*
7. **Team prep** — choose 3 actives, a captain, a formation (balanced / protect_captain /
   spread / ambush), and a reinforcement plan (ally_ko / ally_below_35 /
   enemy_wildcard_deployed / one_enemy_remains / never_hold_reserve). *(Implemented in the
   sim and validators.)*
8. **Private Team Readout** — own-team analysis only. See §7. *(Implemented:
   `services/combat-sim/src/readout.ts`.)*
9. **Wildcard selection** — exact compiled mechanics are shown before lock; both players'
   wildcards are revealed after both lock. *(Data + engine implemented; the pre-lock/reveal
   UI flow is part of the in-progress web client.)*
10. **Battle** — ~3–4 minutes continuous. Escalation stalemate-breaker begins at 3:00
    (+15% damage every 20 s); hard decision limit at 4:30. *(Implemented: soft limit 720
    ticks, hard limit 1080 ticks at 250 ms/tick.)*
11. **Post-match causal breakdown** — why the winner won, from real events only.
    *(Implemented: `buildBreakdown` produces summary, turning point, ranked causal factors,
    per-fighter stats.)*
12. **Champion record + dethrone link + run-it-back** — the winning team is preserved as an
    immutable champion record with a dethrone challenge link and instant fresh-draft rematch.
    *(Schema implemented: `ChampionRecord`. Share links and persistence beyond the local
    client are Planned.)*

## 4. Squad Relay

- 3 active fighters per side; reserves enter on KO or configured triggers. **Implemented**:
  relay-on-KO, ally-below-35% tactical swap, reaction to enemy wildcard deployment, and the
  hold-reserve-until-one-enemy-remains plan all execute in `sim.ts` (`tickReserves`,
  `trySwapLowest`).
- **No direct character control.** Players spend tactical command tokens (2 per match) on
  intent commands: focus_target, protect_ally, press_attack, disengage, regroup, spread_out.
  Commands last 10 seconds of sim time.
- **Character Contracts can refuse commands.** Behavior constraints reject conflicting orders
  (e.g. `never_retreats` refuses disengage; `never_abandons_allies` refuses retreat while an
  ally is endangered; `hunts_strongest` refuses ganging up on the weakest enemy), and each
  fighter's `commandCompliance` value can produce an "instinct override" rejection. Both paths
  emit `TACTICAL_COMMAND_REJECTED` events the player sees. **Implemented and tested.**

## 5. Competitive influence targets

Design targets for what decides matches (validated continuously via `npm run simulate` as the
roster grows; these are targets, not measured guarantees):

| Factor | Target share |
|---|---|
| Draft quality & team synergy | 55% |
| Matchup + wildcard interaction | 25% |
| Tactical in-match decisions | 15% |
| Controlled seeded variation | 5% |

There are **no hidden crit lotteries**: all randomness flows through one seeded RNG, bounded
(e.g. hit chance clamped 0.15–0.97, decision jitter ±10%), and identical
manifests replay identically.

## 6. Power divisions

Street → Enhanced → Global → Cosmic, plus Open (no division restriction). Divisions bound
interpretation and pricing so drafts stay arguments about strategy, not raw scale. Season 0:
**Enhanced only** (Implemented as the shipped ruleset; other divisions are schema-supported
but have no content or ruleset yet — Planned).

## 7. Team Readout rules (locked)

The readout analyzes **your own team only**. It must never:

- state or imply a win probability;
- analyze or solve the opponent's draft.

**Implemented**: `computeTeamReadout` returns an archetype name, tagline, 12 capability axes
(offense, endurance, mobility, range, control, support, recovery, environmentFit, synergy,
reliability, reserveDepth, counterCoverage), and arena-fit notes — computed exclusively from
the player's roster and the revealed arena.

## 8. Champion / dethrone loop

- A finished match produces an immutable `ChampionRecord`: the exact team, match id, arena,
  ruleset version, win streak, and defenses.
- The champion team is **frozen as drafted** (fighter versions and prices recorded in the
  match manifest). Dethroning means drafting a fresh team against it — never editing history.
- Dethrone links let anyone in the group challenge the standing champion. *(Schema
  implemented; link sharing and persistence are part of the in-progress client / Planned
  online layer.)*

## 9. Competitive modes

- **Challenge the Crown** (primary, Season 0): champion holds the room; challengers draft
  fresh to dethrone. Streaks and defenses tracked on the champion record.
- **Brackets** (Planned, later): friend-group tournaments over the same fresh-draft rules.
- **Ranked matchmaking** (gated): explicitly out of scope for the first alpha; requires a
  Founder Gate plus the eligibility pipeline (Tournament Frozen content) before design starts.

## 10. Rank / legacy persistence rules

- Persistent records are **legacy, never power**: champion history, streaks, defended counts,
  match replays, price history. Nothing persistent affects future match strength (locked law:
  fresh drafts every match).
- History is never erased. Champions, prices, versions, and replays are immutable; season
  price changes create new price versions, and historical records keep the version they were
  played under (Implemented in the manifest: per-fighter contract, DNA, and price versions
  are recorded per match).

## 11. Explainability commitments

Every match must answer "why did the winner win?" without hand-waving:

- Semantic event log (24 event types, from `MATCH_STARTED` to `MATCH_ENDED`) — Implemented.
- Causal breakdown with ranked factors (draft value, weakness exploitation, wildcard impact,
  tactical commands, reserve entries, arena interactions, decisive swing) — Implemented.
- Commentary generated only from real events (template-driven today; an LLM voice may later
  rephrase but never invent) — Implemented.

## 12. Current build reality

- **Implemented in repo**: contracts/schemas, Season 0 ruleset, deterministic combat core with
  22 passing tests, causal breakdown, template commentary, team readout, transparent pricing,
  balance/draft-order/validation tools, curated content in progress (currently 2 fighters,
  2 wildcards, 1 arena checked in; the 12-fighter / 8-wildcard Season 0 roster is being
  authored in a parallel workstream).
- **In progress**: desktop-web client (Vite + TypeScript + Three.js; local vs-AI and hotseat)
  — not yet merged into this repository (`apps/` workspace slot exists, directory does not).
- **Planned**: online rooms/multiplayer, spectators, accounts, deployment. See docs/BACKLOG.md.
