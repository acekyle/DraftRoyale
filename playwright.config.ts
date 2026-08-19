import { defineConfig, devices } from '@playwright/test';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

/**
 * Browser E2E for the playable web client.
 *
 * webkit is included only when its Playwright build is actually installed
 * (`npx playwright install webkit`); a chromium-only machine still runs green.
 */
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
  outputDir: './e2e/.artifacts/test-results',
  fullyParallel: false, // files run internally in order; distinct files may still parallelize
  workers: process.env.CI ? 1 : 2,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 180_000, // full solo loop includes a (fast-forwarded) battle sim
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5199',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npx vite --port 5199',
    cwd: './apps/web',
    port: 5199,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    ...(webkitInstalled() ? [{ name: 'webkit', use: { ...devices['Desktop Safari'] } }] : []),
  ],
});
