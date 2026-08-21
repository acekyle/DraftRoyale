# Performance Baseline

> Phase 4 measurement record (docs/BACKLOG.md: "Performance baseline measured on reference
> hardware"; budgets in docs/TECHNICAL_ARCHITECTURE.md §10). First measured: 2026-08-20.
>
> **Status: baseline harness + first data point. The Phase-4 gate line is NOT closed** —
> see §5 "What this baseline is not" below.

## 1. How to reproduce

```bash
npm install                      # workspace deps (Playwright is already a dev dependency)
npx playwright install chromium webkit
npm run perf                     # builds apps/web for production, then measures
```

`npm run perf` = `PERF=1 playwright test --config=playwright.perf.config.ts`. It:

1. Runs `vite build` and serves the **production** bundle with `vite preview` on port 5205
   (never the dev server — dev-mode module loading would invalidate every number).
2. Launches **headed** browsers so WebGL runs on the real GPU. Headless Chromium falls back
   to SwiftShader software rasterization, which silently turns a GPU baseline into a CPU
   benchmark. The harness records the WebGL renderer string with every sample so a report
   can always be checked for which path was measured.
3. Repeats every measurement 3× and reports **medians**.

The full summary (plus raw per-rep JSON) lands in `e2e/.artifacts/perf-baseline/summary.md`.
The measurement spec itself is `e2e/perf-baseline.spec.ts` + `e2e/perf-baseline.shared.ts`;
it is skipped unless `PERF=1`, so `npm run e2e` is unaffected.

Knobs: `PERF_REPS=<n>` (default 3), `PERF_SAMPLE_S=<s>` (battle sampling window, default 22,
floor 20), `PERF_HEADLESS=1` (headless run — numbers are then software-rendered; the summary
will show a SwiftShader renderer string). On Windows, set `PERF=1` via your shell instead of
the npm script's POSIX prefix.

### What is measured, exactly

- **Load — "interactive home"**: navigation start → the home screen's Solo Gauntlet card
  (`#mode-solo`) enters the DOM, timestamped in-page by a `MutationObserver` (no test-runner
  polling latency). Home handlers are bound synchronously in the same render pass, so
  element-present ≈ interactive. Every rep uses a fresh browser context = fully cold cache.
  DOMContentLoaded / load-event times and network payload come from the Navigation/Resource
  Timing APIs. Note: `index.html` loads the Rajdhani/Barlow stylesheet from Google Fonts —
  a render-blocking remote fetch that is included in these numbers (production parity),
  which also makes load times partially network-dependent.
- **Battle FPS**: scripted full solo loop (market draft → prep → wildcard → battle) with the
  same driver pattern as `e2e/helpers.ts`, then the battle runs **live at 1× speed** while an
  in-page `requestAnimationFrame` sampler records frame deltas for ≥20 s (default 22 s),
  after a 2 s warmup that is excluded (first-use shader compilation jank). Reported per
  viewport (1280×720 and 1920×1080, `devicePixelRatio` 1, so the WebGL backing store is
  exactly 720p/1080p — the harness records the real canvas size to prove it):
  - mean FPS (frames / elapsed),
  - p5 low FPS (5th-percentile instantaneous FPS = 1000 / p95 frame time),
  - worst frame ms,
  - dropped-frame % vs the 30 fps and 60 fps targets (a frame is "dropped" when its delta
    exceeds 1.5× the target interval, i.e. > 50 ms and > 25 ms respectively).
  The sampler aborts if the battle screen unmounts (early KO) and flags visibility loss
  (browsers throttle rAF when hidden); flagged reps are called out in the summary.
- **Memory**: `performance.memory.usedJSHeapSize` on the breakdown screen after the match
  completes (1.5 s settle, no forced GC — medians absorb the noise). **Chromium-only API**;
  WebKit reports `n/a`.
- **Bundle**: every file in `apps/web/dist`, raw and `gzip -9`, summed by type.

## 2. Machine measured (NOT the reference floor)

| | |
|---|---|
| Machine | MacBook Pro 14" 2021 (`MacBookPro18,3`) |
| CPU | Apple M1 Pro, 8 cores (6 performance + 2 efficiency) |
| GPU | Apple M1 Pro, 14-core (integrated, Metal 4) |
| RAM | 16 GB |
| Display | 3024×1964 Retina, ProMotion (rAF can tick up to 120 Hz — FPS ceiling is refresh-limited) |
| OS | macOS 26.5.2 |
| Node | v22.17.0 |
| Browsers | Playwright chromium-1234 (Chrome for Testing 151), webkit-2336 |
| Network | app served from localhost; only Google Fonts fetched over the internet |

Spec pulled via `system_profiler SPHardwareDataType SPDisplaysDataType`, `sysctl -n
machdep.cpu.brand_string`, `sw_vers`. The harness re-collects CPU/RAM/OS automatically on
every run and prints them in the summary; GPU is evidenced by the per-sample WebGL renderer
string.

## 3. Results (medians of 3 reps, headed, production build, 2026-08-20)

Run: `npm run perf` — 6/6 measurements green in 7.8 min. All reps clean: no early match
end, no visibility loss, canvas backing store verified at exactly 1280×720 / 1920×1080.

### Load (fresh context = cold cache, localhost + live Google Fonts)

| browser | home interactive (ms) | DOMContentLoaded (ms) | load event (ms) | transfer | compressed payload |
|---|---|---|---|---|---|
| chromium | 170.9 | 171.0 | 299.7 | 244.9 KB | 243.7 KB |
| webkit | 50.0 | 50.0 | 97.0 | 244.2 KB | 243.3 KB |

### Battle rendering (live solo battle at 1×, 22 s of rAF deltas after 2 s warmup)

| browser | viewport | mean FPS | p5 low FPS | worst frame (ms) | dropped % vs 30fps | dropped % vs 60fps | WebGL renderer |
|---|---|---|---|---|---|---|---|
| chromium | 1280×720 | 120.0 | 100.0 | 10.4 | 0.0 | 0.0 | ANGLE Metal — Apple M1 Pro |
| chromium | 1920×1080 | 120.0 | 107.5 | 9.4 | 0.0 | 0.0 | ANGLE Metal — Apple M1 Pro |
| webkit | 1280×720 | 60.0 | 55.6 | 20.0 | 0.0 | 0.0 | Apple GPU |
| webkit | 1920×1080 | 59.9 | 55.6 | 35.0 | 0.0 | 0.1 | Apple GPU |

Reading the FPS ceilings correctly: Chromium's 120 fps is the ProMotion display refresh
cap; WebKit caps `requestAnimationFrame` at 60 Hz regardless, so its 60.0 mean is a vsync
ceiling, not a GPU limit. Both engines rendered essentially every frame their ceiling
allowed — 0% drops vs the 30 fps target everywhere, and one 35 ms frame across all of
WebKit 1080p (0.1% vs the 60 fps target) as the only blemish.

### JS heap after a full match (`performance.memory` — Chromium-only API)

| browser | viewport | used JS heap (median of 3) |
|---|---|---|
| chromium | 1280×720 | 10.8 MB |
| chromium | 1920×1080 | 10.5 MB |
| webkit | — | API not available (noted, not a gap in the app) |

JS heap excludes GPU-side buffers/textures; with procedural geometry and no texture
assets, GPU memory pressure is currently minimal by construction.

### Production bundle (`apps/web/dist`, gzip -9)

| kind | raw | gzip |
|---|---|---|
| **total** | **876.8 KB** | **242.2 KB** |
| .js (single chunk, three.js + sim + UI) | 861.0 KB | 237.8 KB |
| .css | 15.1 KB | 3.9 KB |
| .html | 0.8 KB | 0.5 KB |

## 4. Budget check (docs/TECHNICAL_ARCHITECTURE.md §10) — on THIS machine only

| Budget | Target | Measured here | Verdict (this machine only) |
|---|---|---|---|
| Web shell interactive | < 3 s | 0.17 s (chromium) / 0.05 s (webkit), cold cache, localhost | Pass, with ~17× headroom before network cost |
| Rendering minimum | 720p30 | 0% dropped frames vs 30 fps, both engines | Pass here; **floor hardware untested** |
| Rendering recommended | 1080p60 | chromium 120 fps (refresh-capped); webkit 59.9 mean / 55.6 p5, 0.1% dropped | Pass here |
| Draft room ready | < 8 s | Not separately instrumented yet | Open |
| First battle renderable | < 30 s | Not separately instrumented yet | Open |
| Cached battle | < 10 s | Not separately instrumented yet | Open |

The three "Open" rows are single-page-app transitions with **zero additional network
fetches** (one JS chunk carries everything), so on this machine they are bounded by the
0.17 s shell load plus sim init — but the budgets are written for broadband + real CDN,
so they must be timed against the deployed GitHub Pages origin during the
reference-hardware pass, not inferred from localhost.

## 4b. Observations for later optimization work (recorded, deliberately not acted on)

None of these block anything on the measured hardware (worst Chromium frame: 10.4 ms);
they are the obvious levers if the low-end pass comes back tight:

1. **Uncapped render loop.** The battle loop renders at display refresh — 120 fps on
   ProMotion — doing interpolation + full scene render twice as often as the 60 fps
   recommendation needs, for no gameplay benefit (sim ticks at 4 Hz). A frame cap or
   "battery saver" setting is a cheap, low-risk win on laptops.
2. **Pixel-ratio multiplier on HiDPI.** `renderer.setPixelRatio(min(2, devicePixelRatio))`
   (apps/web/src/battle/renderer.ts) means a Retina/HiDPI 1080p viewport rasterizes at up
   to 3840×2160 ≈ 4× the pixels measured here (these runs are DPR 1). On weak integrated
   GPUs with HiDPI screens this will be the dominant cost; a pixel-ratio cap or quality
   setting is the biggest single lever, and the low-end measurement must include a DPR>1
   case.
3. **Per-frame allocations.** The frame loop allocates fresh `THREE.Vector3`s for every
   fighter label projection and floater every frame, and clones vectors per projectile
   (renderer.ts `frame()`). Invisible on M1 Pro; candidate GC-hitch source on low-end —
   reusable scratch vectors are a contained fix if p5 lows suffer there.
4. **Single 861 KB JS chunk.** Fine against the load budget (238 KB gzip), but three.js
   dominates it; splitting the renderer out would cut parse cost on weak CPUs if shell
   interactivity ever regresses.
5. **Render-blocking Google Fonts stylesheet** in `index.html`'s head: a remote fetch on
   the critical path of every load — cheap insurance would be `media="print"` swap or
   self-hosting, if real-network load numbers disappoint.

## 5. What this baseline is not

**This machine is not the reference "720p30 on recent integrated graphics" floor.** An
M1 Pro's 14-core GPU is integrated only in the technical sense; it outperforms the entire
class of hardware the 720p30 promise is aimed at. Passing here predicts almost nothing
about a 2019 dual-core laptop with Intel UHD graphics. Accordingly:

- **The Phase-4 gate line stays open.** No public performance claims may be made from this
  document alone (constitution discipline: "no performance claims before this" refers to
  the *reference-hardware* measurement).
- What this document does establish: a **repeatable harness**, the **bundle/load budgets on
  record**, and an **upper-bound sanity check** (if numbers were bad *here*, low-end
  hardware would be hopeless).

### Hardware still needed to close the gate

Measured with the same `npm run perf` command (the summary auto-collects the machine spec):

1. **Representative integrated-graphics Windows laptop** — e.g. Intel UHD 620 / Iris Xe or
   AMD Vega 8 class, 8 GB RAM, 1080p display, Chrome — this is the 720p30 floor target.
2. **An older Intel Mac** (pre-Apple-silicon, Iris Plus class) for Safari/WebKit on weak GPUs.
3. Optionally a **mid-range desktop with a discrete GPU** to validate the 1080p60
   "recommended" tier as an explicit pass rather than an extrapolation.

Real-network load numbers (GitHub Pages CDN, not localhost) should be captured on the same
machines; the localhost numbers here isolate client boot cost, not network cost.

## 6. Known caveats in the numbers

- Headed browser windows on a live desktop: minor scheduler noise vs. a dedicated rig;
  medians of 3 mitigate but don't eliminate it.
- The 120 Hz ProMotion display caps nothing here in practice (targets are 30/60), but mean
  FPS above 60 on this machine reflects the 120 Hz rAF ceiling, not "spare 4×" headroom.
- `devicePixelRatio` is 1 in these runs. On real Retina/HiDPI deployments the renderer
  multiplies pixels by `min(2, devicePixelRatio)` (renderer.ts), so a 1080p CSS viewport
  can rasterize ~8.3 MP — materially heavier than what was measured here. The low-end
  measurement must include a DPR>1 case or the renderer needs a pixel-ratio quality cap.
- Resource Timing `transferSize` happened to be reported by both engines in this run, but
  it is not guaranteed everywhere; the summary's "compressed payload" column
  (encodedBodySize) and the dist gzip table are the authoritative payload numbers.
- JS heap is sampled without forced GC and only in Chromium (`performance.memory` does not
  exist in WebKit/Firefox).
