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
| 3D generation bake-off credits | **EXECUTED 2026-08-21, GATE PASSED** (D-024→D-025): Meshy Pro $20 (150/1,000 credits used), Tripo API top-up (100 credits ≈ $1.00 used; the Founder's top-up amount is the committed figure), Rodin $0 (never engaged). Cash exposure ~$20 + top-up — far under the $100 ceiling. Full per-action log: tools/bakeoff/spend-log.jsonl; results: tools/bakeoff/RESULTS.md. **CANCEL Meshy before renewal** unless the production pass is approved. Season-0 production pass (est. $10–25, 12 heroes) is a NEW gate, not yet requested | ~$21–25 actual | none if cancelled | Gate passed — procedural pass remains the shipped floor until a production pass is approved |
| Season-0 hero production pass | **EXECUTED + COMPLETE 2026-08-21 (D-026): 12/12 heroes rubric-passed and shipped.** 30 Tripo text-to-3D generations (12-hero statue pass + 5 iterations, then the D-028 multiverse re-pass: 3-fighter probe + 9 realm re-gens + solaria v2 + 2 failed orrin anime attempts) at ~20 cr each ≈ **$6.00 of the $25 ceiling**; 7 Meshy auto-rig attempts on the paid Pro month (3 succeeded — meridian/aegis-9/ember-ronin with free walk/run anims; 4 pose-rejected, uncharged). Per-action log: tools/heroforge/spend-log.jsonl; scores: tools/heroforge/SCORES.md. **⚠ FOUNDER: CANCEL the Meshy Pro AND Tripo subscriptions NOW — nothing further needs them; only the prepaid Tripo API wallet balance remains useful for future one-off assets** | **~$6.00** (+ prior sub costs already ledgered under the bake-off) | none once subs cancelled | Procedural heroes remain the locked fallback (manifest-gated loading; any GLB can be demoted with `npm run heroforge:promote -- --demote <fighter>`) |
| Custom-nomination statue forge | **LIVE 2026-08-21 (D-029), $0 spent so far.** On-the-spot Tripo generation for compiled custom fighters at nomination-accept (dev-server forge service). Hard cap 12 custom generations ≈ **$2.40** from the prepaid Tripo API wallet (the wallet the production-pass note says stays useful for one-off assets — no subscription needed). Per-action log: tools/heroforge/spend-log.jsonl (`custom:*` entries) | $0 to date, ≤$2.40 capped | none | No key → forge quietly disabled; procedural chassis is the floor. Cap raise is a Founder gate |
| Unity tooling | Second half of engine bake-off | $0 (Personal tier likely sufficient) | $0 | Deferred; browser-native provisional winner (ADR-0001) |

## Unit-economics placeholders (to be measured before any monetization phase)

Cost per generated fighter / refined fighter / wildcard / commentary-match / storage /
bandwidth: **no real data yet — deliberately not estimated.** Filled in only from measured
provider bake-off results (never invented).
