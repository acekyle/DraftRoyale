# 3D Generation Bake-off — Founder Runsheet

> Executes the approved protocol in `docs/proposals/3d-generation-bakeoff-proposal.md` §5
> under **D-024: $100 HARD ceiling, $69.90 planned** (docs/COST_LEDGER.md).
> Everything in this folder runs at $0 until a key is provisioned; with no keys the
> runner is dry-run-only and never touches a provider.

## What gets tested

3 real Season-0 fighters × 3 providers, image-to-3D primary (text-to-3D once each for
the record), up to **5 iterations per pair** (hard stop at 45 generations total — the
runner refuses past that line). Winner gate: `RUBRIC.md` (≥18/30, no zero on silhouette
or budget-fit, all three fighters passing).

| Brief | Fighter | Chassis | Stress |
|---|---|---|---|
| `briefs/ember-ronin.md` | Ember Ronin | humanoid | cloak + emissive blade / materials |
| `briefs/razorback.md` | Razorback | quadruped | quadruped rig, hard-surface + organic |
| `briefs/orrin.md` | Orrin | floating | legless robes, non-standard rig |

## Step 0 — $0 prep (do this before any subscription)

```sh
npm run bakeoff:sheets     # builds the app, captures front/side/quarter stills of the
                           # procedural heroes + palette strips → tools/bakeoff/concept-sheets/
npm run bakeoff -- --dry-run   # prints the full plan for all 9 pairs; zero network calls
```

The concept sheets are the shared image-prompt input — the same three views feed every
provider, isolating the 3D variable (proposal §4: image-to-3D beats text-to-3D on
control; the sheet is the style lever).

## Step 1 — Subscriptions (Founder creates these personally)

One month each, **cancel before renewal** (calendar the cancel dates the day you subscribe).

| Provider | Plan | Price | Where the API key lives |
|---|---|---|---|
| Meshy | Pro (1,000 cr/mo) | $20/mo | meshy.ai → account/workspace **Settings → API** (API keys page) |
| Tripo | Pro (3,000 cr/mo) | $19.90/mo | platform.tripo3d.ai → **API Keys** (`platform.tripo3d.ai/api-keys`) |
| Rodin (Hyper3D) | Creator | $30/mo | hyper3d.ai → account/dashboard **API** section |

⚠ **Verify on the pricing page before paying** (terms drift; last checked 2026-08-20):

1. **Rodin: does the Creator tier include API access at all?** The proposal notes
   "full API" is advertised on the Business tier ($120/mo). If Creator is
   dashboard-only, EITHER run Rodin generations manually through its web UI (artifacts
   are still scoreable — record them in spend-log.jsonl by hand) OR buy direct credits
   ($1.50/credit) instead of the subscription. Do NOT buy Business for this bake-off.
2. **Tripo: confirm Pro subscription credits are spendable through the API key.** If
   the API bills from a separate wallet (API pricing: 1 credit = $0.01), skip the Pro
   subscription and load a small API balance (~$5 covers this whole bake-off at
   ~$0.25–0.35/generation) — cheaper and cleaner.
3. **Commercial-use terms on the tier you buy** (Tripo Pro "limited commercial access"
   hedge — proposal §2.2 flag).

## Step 2 — Provision keys (env vars ONLY — never in chat, never in files)

In the shell that will run the bake-off:

```sh
export MESHY_API_KEY="…"     # each pasted directly from the provider dashboard
export TRIPO_API_KEY="…"
export RODIN_API_KEY="…"
```

- Keys must never transit chat/transcripts (COST_LEDGER security note, 2026-08-19: the
  first LLM key had to be rotated for exactly this reason).
- The runner reads keys ONLY from these env vars. Missing key → clear "no key
  provisioned" message + dry-run plan; nothing is called, nothing is spent.
- **Tripo image mode only:** the concept sheets must be reachable at a public URL
  (Tripo's documented image input is `file:{type,url}`; Meshy takes base64 data URIs
  and Rodin takes direct file upload, so neither needs hosting). Easiest $0 path: copy
  `tools/bakeoff/concept-sheets/` into the GitHub Pages deployment and
  `export BAKEOFF_SHEETS_BASE_URL="https://<pages-host>/<path>"`.

## Step 3 — Run the protocol

One generation per command, always. Suggested order (cheapest sanity check first):

```sh
# 1) Smoke: one pair per provider, image mode (the primary path)
npm run bakeoff -- --provider meshy --fighter ember-ronin
npm run bakeoff -- --provider tripo --fighter ember-ronin
npm run bakeoff -- --provider rodin --fighter ember-ronin

# 2) Complete the 3×3 grid, image mode
npm run bakeoff -- --provider meshy --fighter razorback
npm run bakeoff -- --provider meshy --fighter orrin
# … same for tripo and rodin

# 3) One text-to-3D per pair, for the record (proposal §5 step 2)
npm run bakeoff -- --provider meshy --fighter ember-ronin --mode text
# … etc.

# 4) Iterate ONLY where the first result is close-but-not-there, up to 5 total
#    generations per pair. Iteration briefs live in briefs/iterations/ and are
#    passed with --brief so the frozen round-1 briefs stay untouched (the brief
#    path used is logged in every spend-log entry):
npm run bakeoff -- --provider meshy --fighter razorback \
  --brief tools/bakeoff/briefs/iterations/razorback-v2.md

# Check the running count any time:
npm run bakeoff -- --dry-run     # footer shows N/45 generations + M/90 finish tasks logged
```

## Step 3.5 — Finish pipeline (Meshy): generate → remesh → rig → score

Round-1 Meshy outputs came back **~72–77k tris and unrigged** against a ≤40k budget and
a rig-usability rubric line. Meshy sells both fixes as separate cheap tasks that take an
existing task id (per API pricing, `docs.meshy.ai/en/api/pricing`, 2026-08-21: remesh
5 cr, auto-rig 5 cr — ~$0.10 each at Pro). Same laws as generate: one paid call per
invocation, spend logged before the call, no auto-retry, `--dry-run` prints the exact
endpoint + payload for $0.

```sh
# 1) Remesh the best artifact per pair down under budget (quad topology, 38k target
#    leaves headroom under the 40k line). <taskRef> = the generation's task id from
#    spend-log.jsonl / results/meshy/<fighter>/. Output: <taskRef>.remesh.glb + meta.
npm run bakeoff -- --action remesh --provider meshy --task <taskRef> \
  [--target-polycount 38000 --topology quad]

# 2) Auto-rig the remeshed model (uses the local <taskRef>.remesh.glb when present,
#    else rigs the original by task id). Output: <taskRef>.rigged.glb/.fbx plus the
#    free walking/running preview animations.
npm run bakeoff -- --action rig --provider meshy --task <taskRef> [--height 1.7]
```

⚠ **Meshy auto-rig is humanoid-only.** The docs state programmatic rigging "only works
well with standard humanoid (bipedal) assets" and list non-humanoid assets as
unsupported (`docs.meshy.ai/en/api/rigging-and-animation`). For this bake-off that
means only **ember-ronin** can be auto-rigged; **razorback** (quadruped) and **orrin**
(floating robe) cannot — score them on *external* riggability (Blender/AccuRIG), the
same axis Rodin is scored on. The runner refuses a non-humanoid rig unless you pass
`--force-non-humanoid` (spends 5 cr on a documented-unsupported input — your call).

Tripo has its own remesh/rig products but they are not wired into this runner; Rodin
has no auto-rig at all.

Per run the tool: creates ONE task → polls to completion → downloads the artifacts to
`results/<provider>/<fighter>/` → appends to `spend-log.jsonl`
(`{at, provider, fighter, action, credits, artifactPath}`). Failed calls are logged and
**never auto-retried** — you decide whether to spend again.

`results/` and `concept-sheets/` are gitignored; `spend-log.jsonl` is committed
(ledger law — the EP reconciles it into `docs/COST_LEDGER.md`; this tool never edits
the ledger itself).

## Step 4 — Scoring

1. Best artifact per pair goes through the provider's own retopo/remesh (≤40k tris,
   ≤2K PBR) if not already applied by the run parameters — for Meshy that is
   `--action remesh` then `--action rig` (Step 3.5; rig is ember-ronin-only) —
   then auto-rig where offered (Tripo via its platform; Rodin and all non-humanoid
   fighters are scored on external riggability).
2. EP reviews each GLB in a viewer (e.g. the offline three.js gltf viewer or
   gltf-viewer.donmccurdy.com) AND loaded next to the procedural hero in our pedestal
   viewer (proposal §5 step 5).
3. Score with `RUBRIC.md` — two scorers, sheets committed as
   `tools/bakeoff/scores-<scorer>-<date>.md`.
4. Verdict per provider: all three fighters ≥18/30 with no silhouette/budget zero.
   No provider passes → free procedural fallback stands, gate closes with the question
   answered (that outcome is a success too).

## Step 5 — Shutdown checklist

- [ ] Cancel all three subscriptions before renewal.
- [ ] Rotate/delete the three API keys in each dashboard.
- [ ] EP reconciles `spend-log.jsonl` + provider dashboards into `docs/COST_LEDGER.md`
      (exact dollars, per-provider).
- [ ] Score sheets + recommendation attached to the follow-up Founder gate
      (Season-0 production pass, ≤$250 proposed ceiling — proposal §6.5).

## Safety rails (implemented in `run.ts`, not just policy)

- No keys → dry-run only; explicit run without a key exits with "no key provisioned".
- Exactly one generation per invocation; `--max-generations` guard (default 1).
- Hard refusal at 45 logged generations (5 × 9 pairs; way inside the $100 ceiling),
  and at 90 logged finish tasks (remesh/rig — 2 per possible generation, 5 cr each).
- Non-humanoid auto-rig is refused (documented as unsupported by Meshy) unless
  explicitly forced with `--force-non-humanoid`.
- Paid calls are one-shot — no retry loops anywhere near a paid POST.
- Spend intent is logged BEFORE the paid call, artifacts logged after: a crash
  mid-run over-counts rather than under-counts.
