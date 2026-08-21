import { defineConfig, devices } from '@playwright/test';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

/**
 * Performance-baseline harness config (docs/PERF_BASELINE.md).
 *
 * Run via `npm run perf` — this is deliberately NOT part of `npm run e2e`.
 *
 * Differences from playwright.config.ts, all load-bearing for measurement:
 *  - Serves the PRODUCTION build (`vite build` + `vite preview`), never the
 *    dev server: dev-mode module loading and unminified three.js would make
 *    every number meaningless.
 *  - Headed by default so WebGL runs on the real GPU. Headless Chromium
 *    rasterizes WebGL with SwiftShader (software), which silently turns a GPU
 *    baseline into a CPU benchmark. Set PERF_HEADLESS=1 to force headless —
 *    the harness records the WebGL renderer string either way so the report
 *    is honest about which path was measured.
 *  - workers: 1, no retries, trace off: timing runs must not share the machine
 *    with each other or pay tracing overhead.
 *
 * Knobs (env): PERF_HEADLESS=1, PERF_REPS=<n> (default 3),
 * PERF_SAMPLE_S=<seconds of battle FPS sampling> (default 22).
 */

const PREVIEW_PORT = 5205;

/** Same probe as playwright.config.ts: include webkit only when installed. */
function webkitInstalled(): boolean {
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    join(homedir(), 'Library', 'Caches', 'ms-playwright'), // macOS
    join(homedir(), '.cache', 'ms-playwright'), // Linux
  ].filter((p): p is string => !!p);
  for (const root of roots) {
    if (!existsSync(root)) continue;
    try {
      if (readdirSync(root).some((d) => d.startsWith('webkit-'))) return true;
    } catch {
      /* unreadable cache dir — treat as not installed */
    }
  }
  return false;
}

export default defineConfig({
  testDir: './e2e',
  testMatch: 'perf-baseline.spec.ts',
  outputDir: './e2e/.artifacts/test-results/perf-run',
  globalSetup: './e2e/perf-baseline.shared.ts',
  fullyParallel: false,
  workers: 1, // measurements must never compete for the machine
  retries: 0,
  timeout: 900_000, // one test = PERF_REPS full solo matches
  expect: { timeout: 20_000 },
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PREVIEW_PORT}`,
    headless: !!process.env.PERF_HEADLESS,
    trace: 'off',
  },
  webServer: {
    // Fresh production build every run — never reuse a stale preview.
    command: `npx vite build && npx vite preview --port ${PREVIEW_PORT} --strictPort`,
    cwd: './apps/web',
    port: PREVIEW_PORT,
    reuseExistingServer: false,
    timeout: 180_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    ...(webkitInstalled() ? [{ name: 'webkit', use: { ...devices['Desktop Safari'] } }] : []),
  ],
});
