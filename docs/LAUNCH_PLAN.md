# Launch Plan

> Living document. Last updated: 2026-08-19. Nothing has launched. There is no deployment,
> no external users, and no human playtest data yet — every number in this document is a
> target or a gate, not a result. Deployment itself is a Founder Gate.

## 1. Staged launch (4 stages)

Each stage begins only when the previous stage's exit criteria are met and the Founder
approves the expansion.

| Stage | Audience | Purpose | Key exit signal |
|---|---|---|---|
| 1 | Founder's friend groups | Validate the core loop with people who will be honest | Vertical-slice acceptance gate (§2) passed |
| 2 | Competitive/creator captains | Invited captains bring their own groups; stress the draft meta and creator expectations | Retention + character-approval targets hold beyond the founder's circle |
| 3 | Waitlist | Controlled intake from a public waitlist | Stability and moderation capacity hold at growing scale |
| 4 | Broader public alpha | Open the doors | Sustained metrics + moderation/audit readiness (see docs/SECURITY_AND_MODERATION.md) |

## 2. Vertical-slice acceptance gate (before broad production)

All must hold, measured on real friend-group sessions:

- ≥ 10 friend groups tested
- ≥ 60% immediate run-it-back after a completed session
- ≥ 85% character approval within one semantic correction
- ≥ 85% of players can articulate why the winner won
- ≥ 95% crash-free match completion
- **100% replay reproduction in automated tests** (already enforced in CI-style tests today —
  the only gate line with current real data; see docs/QA_PLAN.md)
- Performance baseline met (720p30 integrated / 1080p60 recommended; load targets in
  docs/TECHNICAL_ARCHITECTURE.md §10)
- ≥ 50% of groups use or share the Dethrone challenge link

Lowering any threshold is a Founder Gate.

## 3. Analytics event funnel (Planned — no analytics code exists yet)

Instrumentation lands with the online layer (Phase 4 wiring). The funnel, in order:

1. Challenge-link opens
2. Guest joins (no-account entry)
3. Draft starts
4. Draft completions
5. Fighter/arena inspections during draft (depth-of-engagement signal)
6. Wildcard locks
7. Match completions
8. Post-match breakdown opens (explainability engagement)
9. Champion shares
10. Dethrone-link usage
11. Rematch / fresh-draft starts
12. 7-day group return (same group, new session within 7 days)

Instrumentation rules: events carry room/group context (the unit of analysis is the friend
group, not the individual), no PII beyond what the feature needs, and every metric
definition is written down before the first dashboard.

## 4. North star: Run-It-Back Rate

**Definition:** the percentage of completed friend-group sessions that start another fresh
draft shortly after a result (same group, new draft within the same sitting — operationally:
a new draft start in the same room/group within 30 minutes of `MATCH_ENDED`).

It is the north star because it directly measures the protected sentence — "Run it back.
I know what team can beat that." — and cannot be inflated by grind mechanics we have banned.

## 5. Synthetic vs real data (locked rule)

- **Never report synthetic or simulated data as human metrics.** Balance-harness output
  (`npm run simulate`), automated test results, and AI-vs-AI matches are engineering data
  and are always labeled as such.
- Human metrics exist only once real friend groups play; until then, dashboards and digests
  say "no human data yet" rather than showing simulator numbers.
- The Weekly Executive Digest separates the two under distinct headings, permanently.

## 6. Stage 2–3 specifics

- **Creator captains (Stage 2):** invited players who care about character fidelity; their
  semantic/visual correction rates are the leading indicator for the character compiler.
  Their groups must reproduce Stage 1 metrics without the Founder in the room.
- **Waitlist (Stage 3):** public signup, controlled admission in group-sized batches
  (admitting isolated individuals undermines the social loop). Referral = inviting your own
  group. Any paid waitlist tooling is a Founder Gate; default is a free/self-hosted form.

## 7. Explicitly NOT launching in the first alpha

- No ranked matchmaking (Challenge the Crown + friendly rooms only)
- No monetization of any kind (and never pay-to-win — locked law)
- No paid marketplace (creator publishing is attribution-based sharing only)
- No voice chat (groups bring their own call; we avoid the moderation surface)

Each of these requires its own Founder Gate, design review, and — for anything involving
money or user-to-user audio — a safety review before it is even scheduled.

## 8. Launch readiness checklist (summary; details in the named docs)

- [ ] Vertical-slice gate metrics met (§2)
- [ ] Deployment approach approved by Founder (hosting = spend = gate)
- [ ] Crash reporting + analytics wired and privacy-reviewed (Phase 4)
- [ ] Moderation basics live: reporting, blocking, review queue, audit logs
      (docs/SECURITY_AND_MODERATION.md §5 — required before public launch)
- [ ] Public-content policy enforced: originals/licensed/public-domain only in public
      (docs/SECURITY_AND_MODERATION.md §6)
- [ ] History-immutability guarantees hold in the hosted records store
