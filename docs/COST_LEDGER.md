# Cost Ledger

> Living document — updated 2026-08-19. Spending protocol: NOTHING paid without explicit
> Founder approval (constitution §Spending). Phase 0 provisional ceiling: $250 — a ceiling,
> not an authorization.

## Spend to date

| Date | Item | Amount | Approved by |
|------|------|--------|-------------|
| 2026-08-19 | — (all work on free/local/open-source tooling) | **$0.00** | n/a |

Total spent: **$0.00**. Recurring commitments: **none**.

## Free resources in use

- Node/npm, TypeScript, Vite, Three.js, Vitest, tsx — all MIT/Apache OSS, $0.
- GitHub repository `acekyle/DraftRoyale` (existing account, free tier).
- Local dev server for the playable build (no hosting).

## Pending Founder Gates with cost implications (not yet requested formally — see Digest)

| Gate | Purpose | Est. one-time | Est. recurring | Free alternative considered |
|------|---------|---------------|----------------|------------------------------|
| Alpha hosting | Deploy private alpha (static client + small WS room server) for friend-group tests | $0 | $0–5/mo | Static client on GitHub Pages/Netlify free tier is $0; a room server needs a free-tier Fly.io/Render instance — still $0 on starter tiers, listed because *any* hosting account is a gate item |
| LLM API budget | Character/wildcard compiler + commentary polish (Claude API) | — | est. $5–30/mo at alpha volumes | Rule-based compiler (current state) — works but cannot honor "type any character" |
| 3D generation bake-off credits | Provider bake-off for generated fighter models | est. $50–150 one-time | usage-based later | Procedural chassis primitives (current state) |
| Unity tooling | Second half of engine bake-off | $0 (Personal tier likely sufficient) | $0 | Deferred; browser-native provisional winner (ADR-0001) |

## Unit-economics placeholders (to be measured before any monetization phase)

Cost per generated fighter / refined fighter / wildcard / commentary-match / storage /
bandwidth: **no real data yet — deliberately not estimated.** Filled in only from measured
provider bake-off results (never invented).
