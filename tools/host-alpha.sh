#!/usr/bin/env bash
# One-command alpha hosting from this machine: starts the room server and a
# free Cloudflare quick tunnel (no account), then prints the public WSS address
# players paste into the deployed client at https://acekyle.github.io/DraftRoyale/
#
# The tunnel URL is EPHEMERAL — it lives while this script runs. For a durable
# address, deploy the server with infra/server/fly.toml or render.yaml (see
# docs/DEPLOY.md).
#
# Optional: export ANTHROPIC_API_KEY beforehand to enable LLM-backed custom
# fighter/wildcard compilation (Founder Gate 2).
set -euo pipefail
cd "$(dirname "$0")/.."

command -v cloudflared >/dev/null || { echo "cloudflared missing: brew install cloudflared"; exit 1; }

npm run server &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null || true' EXIT

LOG=$(mktemp)
cloudflared tunnel --url http://localhost:8790 --no-autoupdate >"$LOG" 2>&1 &
TUNNEL_PID=$!
trap 'kill $SERVER_PID $TUNNEL_PID 2>/dev/null || true' EXIT

echo "Waiting for tunnel..."
for _ in $(seq 1 30); do
  URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$LOG" | head -1 || true)
  [ -n "${URL:-}" ] && break
  sleep 1
done
[ -n "${URL:-}" ] || { echo "tunnel failed to start"; cat "$LOG"; exit 1; }

WSS="wss://${URL#https://}"
echo
echo "════════════════════════════════════════════════════════════"
echo "  Infinite Arena alpha is PUBLIC while this window stays open"
echo "  Client:  https://acekyle.github.io/DraftRoyale/"
echo "  Server:  $WSS"
echo "  → Open the client, Online Room, paste the server address,"
echo "    create a room, then use 'Copy join link' to invite friends."
echo "════════════════════════════════════════════════════════════"
echo
wait $SERVER_PID
