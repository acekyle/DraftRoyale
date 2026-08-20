# Deployment Runbook

> Living document — updated 2026-08-19. Founder Gates 1 (hosting) and 2 (LLM API)
> approved 2026-08-19; this is how the alpha is served.

## Current live deployment

- **Client:** https://acekyle.github.io/DraftRoyale/ — GitHub Pages, branch-based
  (`gh-pages`), free. Redeploy with `tools/deploy-pages.sh`.
- **Server:** self-hosted + Cloudflare quick tunnel (free, no account). One
  command: `tools/host-alpha.sh` — starts the room server, opens a public
  `wss://…trycloudflare.com` address, and prints the invite instructions.
  **The tunnel address is ephemeral** (changes each run, dies with the process).

## ⚠ GitHub account billing lock (needs the Founder)

GitHub **Actions is refusing all workflow runs** on this account: *"The job was
not started because your account is locked due to a billing issue."* This blocks
CI (tests on push/PR) and automatic Pages deploys. Fix it in GitHub → Settings →
Billing (only the account owner can). Until then:

- CI must be run locally (`npm test`, `npm run e2e`, `npm run validate`).
- Pages deploys use `tools/deploy-pages.sh`, which pushes `gh-pages` and requests
  the build explicitly (manual build requests still work under the lock).
- The branch-protection required check ("test") can never pass on PRs — direct
  pushes by the admin still work.

## Durable server hosting (5-minute setup, Founder account required)

Prepared configs in `infra/server/` (Docker-based, `/health` endpoint wired):

- **Fly.io** — `fly launch --config infra/server/fly.toml --dockerfile infra/server/Dockerfile`
  then `fly deploy`. Free-allowance friendly (shared-cpu-1x, 256MB,
  autostop/autostart). Server address: `wss://<app>.fly.dev`.
- **Render** — dashboard → New → Blueprint → this repo (`infra/server/render.yaml`),
  free plan. Note: free instances sleep after idle; first connection takes ~30s.

After deploying, players use the same Pages client and paste the durable
`wss://…` address once — the client remembers it, and join links embed it.

## Enabling LLM compilation (Gate 2)

Set `ANTHROPIC_API_KEY` in the SERVER environment only (never in the client,
never in git):

- Local/tunnel: `export ANTHROPIC_API_KEY=sk-… && tools/host-alpha.sh`
- Fly: `fly secrets set ANTHROPIC_API_KEY=sk-…`
- Render: dashboard → Environment → add secret.

Verify with `ANTHROPIC_API_KEY=sk-… npm run compiler:smoke` (3 live calls,
prints estimated spend). Without a key everything falls back to the
deterministic compiler automatically. Model: `claude-opus-5`; per-compile cost
is roughly $0.05–$0.15; the server logs `[llm]` lines with a running total.

## Update cadence

`tools/deploy-pages.sh` after client changes; `fly deploy` (or Render auto-deploy
on push) after server changes. Match records persist to the server's
`services/control-plane/data/matches.jsonl` — on PaaS free tiers this is
ephemeral disk; back it up before instance recycles or attach a volume when
history durability starts to matter (pre-Stage-2 task).
