#!/usr/bin/env bash
# Deploy the client to GitHub Pages (branch-based).
# NOTE: while the GitHub account's Actions billing lock persists, Pages builds
# must be requested explicitly — this script does that.
set -euo pipefail
cd "$(dirname "$0")/.."

BASE_PATH=/DraftRoyale/ npm run build

TMP=$(mktemp -d)
git init -q -b gh-pages "$TMP"
cp -r apps/web/dist/* "$TMP"/
touch "$TMP/.nojekyll"
git -C "$TMP" add -A
git -C "$TMP" -c user.email="aaronanderson.anderson@gmail.com" -c user.name="A.Anderson" \
  commit -q -m "Deploy client build $(git rev-parse --short HEAD)"
# Large postBuffer: image payloads (concept sheets, future art) trip the
# default 1MB buffer with "RPC failed; HTTP 400" on smart-HTTP pushes.
git -C "$TMP" -c http.postBuffer=157286400 push -f https://github.com/acekyle/DraftRoyale.git gh-pages:gh-pages
rm -rf "$TMP"

gh api -X POST repos/acekyle/DraftRoyale/pages/builds >/dev/null
echo "Pages build requested. Live shortly at: https://acekyle.github.io/DraftRoyale/"
