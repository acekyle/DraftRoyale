# ADR-0003: ABBA snake draft order for 1v1 Market Draft

- **Status:** Accepted
- **Date:** 2026-08-19
- **Proposer:** Draft & Competitive Systems Designer · **Reviewers:** Product Director, QA Lead

## Evidence (tools/draft-order.ts, reproducible)

2,000 seeded drafts per format, greedy value-with-noise drafters, real Season 0 market,
3-pick rosters under the $100M cap:

| Order | Mean first-picker advantage | Mean absolute gap |
|---|---|---|
| ABAB (alternating) | **+$0.16M** | $3.17M |
| ABBA (snake) | **−$0.10M** | $3.12M |

ABBA cuts the structural first-pick advantage below the noise floor (and slightly favors
the second picker, which is the desirable compensation direction). The absolute-gap metric
is unchanged, i.e. ABBA does not add variance. The margin is small on the current
compressed price band and grows with price spread, which strengthens (not weakens) the
choice as pricing widens.

## Decision

Default 1v1 competitive order is **ABBA snake** (`A B B A A B B A A B`), with the
first-pick side assigned by seeded coin flip at room creation. Recorded in the ruleset as
`draftOrder: 'abba'`. Live Auction Draft remains a later format behind its own design pass.

Per constitution: this decision does not go to the Founder.
