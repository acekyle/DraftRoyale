# Cost Ledger

> Living document — updated 2026-08-19. Spending protocol: NOTHING paid without explicit
> Founder approval (constitution §Spending). Phase 0 provisional ceiling: $250 — a ceiling,
> not an authorization.

## Approved budgets (Founder, 2026-08-19)

- **Gate 1 — alpha hosting**: ~$0–5/mo. Implemented at $0: GitHub Pages (client)
  + Cloudflare quick tunnel (server, no account) with Fly/Render configs ready.
- **Gate 2 — LLM API (Claude)**: ~$5–30/mo at alpha volume. Implemented; live
  calls begin when the Founder sets ANTHROPIC_API_KEY server-side. Every call is
  logged with a running cost estimate.

## Spend to date

| Date | Item | Amount | Approved by |
|------|------|--------|-------------|
| 2026-08-19 | Hosting: GitHub Pages + trycloudflare tunnel (both free tiers) | **$0.00** | Founder (Gate 1) |
| 2026-08-19 | LLM API: key provisioned by the Founder; smoke test run (3 live calls, ~$0.15–0.40 est.) — Gate 2 ACTIVE | **<$1** | Founder (Gate 2) |

Total spent: **$0.00**. Recurring commitments: **none** (both gates currently on $0 tiers).

**Security note (2026-08-19):** the first key transited a chat transcript during
provisioning; the Founder was advised to rotate it after testing and provision
replacements directly into terminal/secret stores only.

## Unit economics — first real numbers

Cost per LLM-compiled fighter: est. $0.05–$0.15 (claude-opus-5, structured
output; measured precisely by the server's [llm] spend log once a key exists).
Cost per wildcard compile: est. $0.03–$0.10. Commentary remains $0 (template
engine). Storage/bandwidth: $0 at current tiers.

## ⚠ Discovered account issue (Founder action)

The GitHub account has an Actions **billing lock** ("account is locked due to a
billing issue") blocking all CI runs and automatic Pages builds. Workarounds are
in docs/DEPLOY.md; the fix is GitHub → Settings → Billing.

## Free resources in use

- Node/npm, TypeScript, Vite, Three.js, Vitest, tsx — all MIT/Apache OSS, $0.
- GitHub repository `acekyle/DraftRoyale` (existing account, free tier).
- Local dev server for the playable build (no hosting).

## Pending Founder Gates with cost implications (not yet requested formally — see Digest)

| Gate | Purpose | Est. one-time | Est. recurring | Free alternative considered |
|------|---------|---------------|----------------|------------------------------|
| Alpha hosting | Deploy private alpha (static client + small WS room server) for friend-group tests | $0 | $0–5/mo | Static client on GitHub Pages/Netlify free tier is $0; a room server needs a free-tier Fly.io/Render instance — still $0 on starter tiers, listed because *any* hosting account is a gate item |
| LLM API budget | Character/wildcard compiler + commentary polish (Claude API) | — | est. $5–30/mo at alpha volumes | Rule-based compiler (current state) — works but cannot honor "type any character" |
| 3D generation bake-off credits | **APPROVED by Founder 2026-08-20** (D-024): $100 HARD CEILING, $69.90 planned (1 mo each: Meshy Pro $20, Tripo Pro $19.90, Rodin Creator $30). Founder creates the accounts/subscriptions personally; keys provisioned as env vars, never through chat. $0 spent as of approval; every credit spent gets logged here | $69.90–100 one-time | none (cancel after bake-off) | Procedural hero pass (shipped, D-023) remains the fallback if no candidate passes the ≥18/30 rubric gate |
| Unity tooling | Second half of engine bake-off | $0 (Personal tier likely sufficient) | $0 | Deferred; browser-native provisional winner (ADR-0001) |

## Unit-economics placeholders (to be measured before any monetization phase)

Cost per generated fighter / refined fighter / wildcard / commentary-match / storage /
bandwidth: **no real data yet — deliberately not estimated.** Filled in only from measured
provider bake-off results (never invented).
