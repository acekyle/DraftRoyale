/**
 * Performance baseline harness — Phase 4 exit measurement (docs/PERF_BASELINE.md).
 *
 * OPT-IN ONLY: every test here is skipped unless PERF=1, so the default
 * `npm run e2e` suite stays fast and green. Run the real thing with:
 *
 *     npm run perf          # PERF=1 playwright test --config=playwright.perf.config.ts
 *
 * The perf config serves the PRODUCTION build via `vite preview` and runs
 * headed by default so WebGL uses the real GPU (see playwright.perf.config.ts).
 *
 * Measurements (each repeated REPS times; medians computed in the teardown):
 *  - Load: navigation → interactive home screen (#mode-solo rendered, handlers
 *    bound synchronously in the same render pass), plus DCL/load and network
 *    payload from the Resource Timing API. Fresh context per rep = cold cache.
 *  - Battle: full scripted solo loop (same driver pattern as helpers.ts), then
 *    ≥20 s of in-page requestAnimationFrame deltas during the LIVE battle at
 *    1× speed, at 1280×720 and 1920×1080.
 *  - Memory: JS heap on the breakdown screen after the match completes
 *    (performance.memory — Chromium-only; null elsewhere).
 */
import { expect, test, type Browser, type Page } from '@playwright/test';
import {
  CHEAP_FIRST, draftFirstAvailable, enterSoloDraft, waitForMyPick,
} from './helpers';
import {
  REPS, SAMPLE_MS, WARMUP_MS, fpsStats, writeResult,
  type BattleSample, type LoadSample,
} from './perf-baseline.shared';

test.skip(!process.env.PERF, 'perf baseline is opt-in — run `npm run perf`');

const PLAYER = 'Perf Baseline';
const HEADLESS = !!process.env.PERF_HEADLESS;
const VIEWPORTS = [
  { width: 1280, height: 720 },
  { width: 1920, height: 1080 },
] as const;

// ---------------------------------------------------------------------------
// Load: navigation → interactive home screen
// ---------------------------------------------------------------------------

test(`load: navigation to interactive home, ${REPS} cold reps`, async ({ browser, browserName }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL!;
  const samples: LoadSample[] = [];

  for (let rep = 0; rep < REPS; rep++) {
    const context = await browser.newContext({ baseURL, viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    // In-page observer stamps performance.now() the instant the home screen's
    // solo button enters the DOM — no Playwright polling latency in the number.
    await page.addInitScript(() => {
      const w = window as unknown as { __homeReadyMs?: number };
      const check = () => {
        if (w.__homeReadyMs === undefined && document.querySelector('#mode-solo')) {
          w.__homeReadyMs = performance.now();
          obs.disconnect();
        }
      };
      const obs = new MutationObserver(check);
      obs.observe(document, { childList: true, subtree: true });
      check();
    });
    await page.goto('/', { waitUntil: 'load' });
    await page.locator('#mode-solo').waitFor({ state: 'visible', timeout: 30_000 });
    samples.push(
      await page.evaluate((): LoadSample => {
        const w = window as unknown as { __homeReadyMs?: number };
        const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
        const res = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
        const sum = (pick: (r: PerformanceResourceTiming) => number) =>
          res.reduce((a, r) => a + (pick(r) || 0), 0);
        return {
          homeReadyMs: w.__homeReadyMs ?? performance.now(),
          homeReadyApprox: w.__homeReadyMs === undefined,
          domContentLoadedMs: nav ? nav.domContentLoadedEventEnd : null,
          loadEventMs: nav ? nav.loadEventEnd : null,
          transferBytes: (nav?.transferSize ?? 0) + sum((r) => r.transferSize),
          encodedBytes: (nav?.encodedBodySize ?? 0) + sum((r) => r.encodedBodySize),
          resourceCount: res.length,
        };
      }),
    );
    await context.close();
  }

  writeResult(`load-${browserName}`, {
    kind: 'load', browser: browserName, headless: HEADLESS,
    at: new Date().toISOString(), loadSamples: samples,
  });
});

// ---------------------------------------------------------------------------
// Battle FPS + post-match heap, per viewport
// ---------------------------------------------------------------------------

for (const viewport of VIEWPORTS) {
  const label = `${viewport.width}x${viewport.height}`;
  test(`battle: live FPS at ${label} + post-match heap, ${REPS} reps`, async ({ browser, browserName }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL!;
    const samples: BattleSample[] = [];
    for (let rep = 0; rep < REPS; rep++) {
      samples.push(await runBattleRep(browser, baseURL, viewport));
    }
    writeResult(`battle-${browserName}-${label}`, {
      kind: 'battle', browser: browserName, headless: HEADLESS,
      at: new Date().toISOString(), battleSamples: samples,
    });
  });
}

async function runBattleRep(
  browser: Browser,
  baseURL: string,
  viewport: { width: number; height: number },
): Promise<BattleSample> {
  const context = await browser.newContext({ baseURL, viewport: { ...viewport } });
  const page = await context.newPage();
  // A legality-gate alert() mid-flow would otherwise hang the run silently.
  page.on('dialog', (d) => void d.dismiss().catch(() => {}));
  try {
    await enterSoloDraft(page, PLAYER);
    for (let pickNo = 1; pickNo <= 3; pickNo++) {
      await waitForMyPick(page, pickNo);
      await draftFirstAvailable(page, CHEAP_FIRST);
    }
    await advanceToBattleStart(page);

    // Environment facts for the report: real canvas backing size + GPU string.
    const env = await page.evaluate(() => {
      const canvas = document.querySelector('.battle-canvas canvas, #canvas-host canvas') as HTMLCanvasElement | null;
      const probe = document.createElement('canvas');
      const gl = (probe.getContext('webgl2') ?? probe.getContext('webgl')) as WebGLRenderingContext | null;
      let glInfo: { renderer: string; vendor: string } | null = null;
      if (gl) {
        const dbg = gl.getExtension('WEBGL_debug_renderer_info');
        glInfo = {
          renderer: String(gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : gl.RENDERER)),
          vendor: String(gl.getParameter(dbg ? dbg.UNMASKED_VENDOR_WEBGL : gl.VENDOR)),
        };
      }
      return {
        actualCanvas: canvas ? { width: canvas.width, height: canvas.height } : null,
        devicePixelRatio: window.devicePixelRatio,
        gl: glInfo,
      };
    });

    const raw = await sampleBattleFps(page);
    await finishMatch(page);

    // Let the breakdown screen settle before reading the heap.
    await page.waitForTimeout(1_500);
    const memory = await page.evaluate(() => {
      const m = (performance as unknown as {
        memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number };
      }).memory;
      return m
        ? { usedJSHeapSize: m.usedJSHeapSize, totalJSHeapSize: m.totalJSHeapSize, jsHeapSizeLimit: m.jsHeapSizeLimit }
        : null;
    });

    return {
      viewport,
      actualCanvas: env.actualCanvas,
      devicePixelRatio: env.devicePixelRatio,
      gl: env.gl,
      ...fpsStats(raw.deltas),
      endedEarly: raw.endedEarly,
      visibilityLost: raw.startedHidden || raw.hiddenEvents > 0,
      memory,
    };
  } finally {
    await context.close();
  }
}

/** Roster lock → prep → wildcard → battle start (helpers.ts flow, minus fast-forward). */
async function advanceToBattleStart(page: Page): Promise<void> {
  const lockRoster = page.locator('#btn-pass');
  const prepContinue = page.locator('#btn-continue');
  await expect(lockRoster.or(prepContinue)).toBeVisible({ timeout: 30_000 });
  if (await lockRoster.isVisible()) await lockRoster.click();
  await expect(prepContinue).toBeVisible({ timeout: 30_000 });
  await prepContinue.click();
  await expect(page.locator('.wildcard-card').first()).toBeVisible();
  await page.locator('.wildcard-card').first().click();
  const lock = page.locator('#btn-lock');
  await expect(lock).toBeEnabled();
  await lock.click();
  const battle = page.locator('#btn-battle');
  await expect(battle).toBeVisible({ timeout: 15_000 });
  await battle.click();
  await expect(page.locator('.battle-root')).toBeVisible({ timeout: 15_000 });
}

/**
 * Sample rAF frame deltas in-page during the live battle (1× speed). The
 * sampler stops itself if the battle screen unmounts (match ended early) and
 * records visibility loss, which invalidates a rep (browsers throttle rAF in
 * hidden tabs/windows).
 */
async function sampleBattleFps(page: Page): Promise<{
  deltas: number[]; endedEarly: boolean; hiddenEvents: number; startedHidden: boolean;
}> {
  await page.waitForTimeout(WARMUP_MS);
  await page.evaluate(() => {
    const state = {
      deltas: [] as number[],
      running: true,
      hiddenEvents: 0,
      startedHidden: document.visibilityState === 'hidden',
    };
    (window as unknown as { __perfFps: typeof state }).__perfFps = state;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') state.hiddenEvents++;
    });
    let last: number | undefined;
    const tick = (now: number) => {
      if (!state.running) return;
      if (!document.querySelector('.battle-root')) {
        state.running = false; // battle screen unmounted — stop measuring
        return;
      }
      if (last !== undefined) state.deltas.push(now - last);
      last = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.waitForTimeout(SAMPLE_MS);
  return page.evaluate(() => {
    const s = (window as unknown as {
      __perfFps: { deltas: number[]; running: boolean; hiddenEvents: number; startedHidden: boolean };
    }).__perfFps;
    const endedEarly = !s.running;
    s.running = false;
    return { deltas: s.deltas, endedEarly, hiddenEvents: s.hiddenEvents, startedHidden: s.startedHidden };
  });
}

/** Fast-forward whatever battle remains and land on the breakdown screen. */
async function finishMatch(page: Page): Promise<void> {
  const ff = page.locator('#btn-ff');
  if (await ff.isVisible().catch(() => false)) await ff.click().catch(() => {});
  await expect(page.locator('.verdict h1')).toBeVisible({ timeout: 120_000 });
}
