# Project Constitution

> Living document. Last updated: 2026-08-19. This is the governing record for Infinite Arena
> (repo: DraftRoyale). Locked laws change only by explicit Founder decision, recorded in the
> Decision Ledger with a version bump to this document.

## 1. Product identity (locked)

**Social competitive 3D draft-battle simulator with an expandable character and wildcard
compiler.**

Defining loop: **Draft → Debate → Prepare → Battle → Explain → Preserve champion → Fresh
draft to dethrone.**

Protected sentence — the emotional target every release must serve:

> "Run it back. I know what team can beat that."

## 2. Priority order for conflicts (locked)

When two goals collide, the higher-numbered goal yields to the lower:

1. Draft strategy
2. Social competition / replayability
3. Battle spectacle
4. Character accuracy
5. Understandable outcomes
6. Scalable tech
7. Commercial safety
8. Production efficiency

## 3. Locked laws

1. **Fresh salary-cap drafts every match.** No persistent power progression of any kind.
2. **No pay-to-win.** No purchasable stats, energy timers, chest timers, or boosts — ever.
3. **Social replay over grind.** Systems reward running it back with friends, not hours logged.
4. **Accurate, bounded character interpretation with traceable evidence.** Versions are never
   silently blended; every mechanical claim traces to cited evidence.
5. **AI is the compiler, not the referee.** LLMs may compile characters/wildcards pre-combat
   and narrate post-combat from real recorded events. LLMs NEVER decide live outcomes. The
   deterministic rules engine decides everything. (Enforced in code today: nothing in
   `services/combat-sim/` calls a model; commentary is template-driven from the event log.)
6. **History is never erased.** Champions, prices, versions, and replays are immutable records.
7. **Every match is causally explainable.** A completed match must yield a causal breakdown
   built only from the authoritative event log (implemented: `services/combat-sim/src/breakdown.ts`).
8. **No repetitive combat loops.** Authored atoms, unpredictable battles — repetition is
   penalized in the engine itself (`behavior.repetitionAvoidance`).

## 4. Decision protocol

Applies to any decision that changes product behavior, schemas, pricing, content policy, or
architecture. Trivial implementation choices inside an already-approved decision do not need it.

### 4.1 Roles

- **Proposer** writes the decision brief: problem, options, recommendation, scores.
- **Two reviewers** score independently before seeing each other's scores.
- **Red-team reviewer** is added for risky areas: security, IP/likeness, monetization-adjacent
  systems, anything touching the locked laws, and anything user-generated reaching other users.

### 4.2 Weighted scoring (0–100 total)

| Criterion | Weight |
|---|---|
| Vision fit / social competition | 25 |
| Fun / readability | 20 |
| Accuracy / explainability | 15 |
| Feasibility | 15 |
| Scalability | 10 |
| Cost / speed | 5 |
| IP risk | 5 |
| Growth potential | 5 |

Each option is scored per criterion (0–weight), summed to 0–100. Highest score wins, with one
override rule: **prototypes beat opinions within 5 points.** If a working prototype exists for
the lower-scoring option and the gap is ≤ 5 points, the prototyped option wins. (Precedent:
the ABBA snake draft order was selected on the evidence of `tools/draft-order.ts`, a seeded
fairness simulation over the real market, not on argument.)

### 4.3 Recording

Every scored decision gets a Decision Ledger entry: date, proposer, reviewers, options, scores,
outcome, and — where a locked law or Founder Gate was involved — the Founder's explicit
response. Ledger entries are never edited after the fact; corrections are new entries.

## 5. Founder Gates

A **Founder Gate** is any decision the team may not make alone. Work stops at the gate until
the Founder answers.

Gate criteria — escalate when a decision would:

1. Spend money (see §6 — all spending is gated).
2. Change or reinterpret a locked law or the priority order.
3. Change the product identity, defining loop, or protected sentence.
4. Ship recognizable third-party IP anywhere a non-team member can see it.
5. Use a real person's likeness.
6. Expose the product, its content, or any user data publicly (deployment, links, marketing).
7. Add accounts, payments, or any collection of personal data.
8. Lower an acceptance-gate threshold (§ vertical slice metrics in docs/LAUNCH_PLAN.md).
9. Accept a known safety, security, or moderation gap into a build others will use.

### Required escalation format

Escalations to the Founder use this exact structure so decisions are fast and auditable:

```
FOUNDER GATE: <one-line title>
Category:     <spending | locked-law | identity | IP | likeness | exposure | data | gate-metric | safety>
Blocking:     <what work is stopped and since when>
Situation:    <3 sentences max: what happened, why it needs you>
Options:      A) <option> — cost/risk/benefit
              B) <option> — cost/risk/benefit
              C) do nothing — consequence
Recommendation: <one option + one-sentence why>
Deadline impact: <what slips per day of delay>
```

## 6. Spending protocol (locked)

- **Nothing paid without explicit Founder approval.** No paid APIs, cloud services, assets,
  fonts, contractors, tools, or subscriptions. Free tiers, local execution, mocks, and
  open-source are the default until an approval exists in the Decision Ledger.
- The Phase 0 provisional ceiling of **$250 is not authorization.** It is the maximum the
  Founder might approve quickly; every individual spend still requires an explicit yes.
- Any spend request uses the Founder Gate escalation format with exact monthly and one-time
  costs, the free alternative considered, and the cancellation path.
- Current reality: the repo runs entirely locally (Node ≥ 20, npm workspaces, Vitest, tsx,
  Vite). Zero paid dependencies exist.

## 7. Reporting cadence

- **Weekly Executive Digest** to the Founder: shipped work, metrics that exist (real data
  only — see the synthetic-data rule in docs/LAUNCH_PLAN.md), open risks, upcoming decisions,
  spending status (expected: $0 unless approved).
- **Founder Gates escalate immediately** — never held for the weekly digest.
- Test/simulation results are reported as what they are (automated results over synthetic
  matchups), never as human playtest metrics.

## 8. Status honesty rule

All project documents — this suite included — must separate **Implemented** (verifiable in
this repository today) from **Planned** (specified but not built). Claiming unbuilt work as
working is a constitution violation. The current implementation snapshot lives in
docs/TECHNICAL_ARCHITECTURE.md §10 and docs/BACKLOG.md.
