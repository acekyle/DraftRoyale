/**
 * Shared plumbing for the performance-baseline harness (docs/PERF_BASELINE.md):
 * result-file types, stats helpers, and the globalSetup that cleans the results
 * directory and returns the teardown which aggregates every sample file into a
 * median summary (console + summary.md/summary.json).
 *
 * Imported by e2e/perf-baseline.spec.ts and referenced as globalSetup by
 * playwright.perf.config.ts. Import-time side effects are deliberately zero —
 * worker processes import this module too.
 */
import { execSync } from 'node:child_process';
import {
  existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

export const RESULTS_DIR = join(__dirname, '.artifacts', 'perf-baseline');
export const REPS = Math.max(1, Number(process.env.PERF_REPS ?? 3) || 3);
export const SAMPLE_MS = Math.max(20_000, (Number(process.env.PERF_SAMPLE_S ?? 22) || 22) * 1000);
export const WARMUP_MS = 2_000; // excluded from FPS stats: first-use shader compile jank

// ---------------------------------------------------------------------------
// Result shapes (one JSON file per test, medians computed in the teardown)
// ---------------------------------------------------------------------------

export interface LoadSample {
  homeReadyMs: number; // navigation start → #mode-solo in DOM (interactive home)
  homeReadyApprox: boolean; // true if the MutationObserver missed and we fell back
  domContentLoadedMs: number | null;
  loadEventMs: number | null;
  transferBytes: number; // Σ transferSize (0 where the engine does not report it)
  encodedBytes: number; // Σ encodedBodySize (compressed payload, cache-independent)
  resourceCount: number;
}

export interface BattleSample {
  viewport: { width: number; height: number };
  actualCanvas: { width: number; height: number } | null; // WebGL backing store, px
  devicePixelRatio: number;
  gl: { renderer: string; vendor: string } | null;
  sampledMs: number;
  frames: number;
  meanFps: number;
  p5Fps: number; // 5th-percentile instantaneous FPS (1000 / p95 frame time)
  worstFrameMs: number;
  dropped30Pct: number; // % frames > 1.5 × 33.3 ms (missed a 30 fps vsync)
  dropped60Pct: number; // % frames > 1.5 × 16.7 ms (missed a 60 fps vsync)
  endedEarly: boolean; // match finished before the sampling window closed
  visibilityLost: boolean; // page went hidden mid-sample → rep is suspect
  memory: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } | null;
}

export interface ResultFile {
  kind: 'load' | 'battle';
  browser: string;
  headless: boolean;
  at: string;
  loadSamples?: LoadSample[];
  battleSamples?: BattleSample[];
}

export function writeResult(name: string, result: ResultFile): void {
  mkdirSync(RESULTS_DIR, { recursive: true });
  // Results are throwaway measurement artifacts — keep them out of git without
  // touching the repo's .gitignore.
  const ignore = join(RESULTS_DIR, '.gitignore');
  if (!existsSync(ignore)) writeFileSync(ignore, '*\n');
  writeFileSync(join(RESULTS_DIR, `${name}.json`), JSON.stringify(result, null, 2));
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return NaN;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

export function percentile(xs: number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 0) return NaN;
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return s[idx];
}

/** Turn raw rAF deltas (ms) into the battle FPS statistics we report. */
export function fpsStats(deltas: number[]) {
  const frames = deltas.length;
  const sampledMs = deltas.reduce((a, b) => a + b, 0);
  const over = (limitMs: number) => deltas.filter((d) => d > limitMs).length;
  return {
    frames,
    sampledMs,
    meanFps: frames > 0 && sampledMs > 0 ? (1000 * frames) / sampledMs : NaN,
    p5Fps: frames > 0 ? 1000 / percentile(deltas, 95) : NaN,
    worstFrameMs: frames > 0 ? Math.max(...deltas) : NaN,
    dropped30Pct: frames > 0 ? (100 * over(1.5 * (1000 / 30))) / frames : NaN,
    dropped60Pct: frames > 0 ? (100 * over(1.5 * (1000 / 60))) / frames : NaN,
  };
}

// ---------------------------------------------------------------------------
// globalSetup — clean stale results; returned function = global teardown
// ---------------------------------------------------------------------------

export default async function globalSetup(): Promise<() => Promise<void>> {
  rmSync(RESULTS_DIR, { recursive: true, force: true });
  mkdirSync(RESULTS_DIR, { recursive: true });
  return async () => {
    try {
      report();
    } catch (err) {
      console.error('[perf] failed to build summary:', err);
    }
  };
}

// ---------------------------------------------------------------------------
// Teardown report: medians, bundle sizes, machine spec
// ---------------------------------------------------------------------------

function loadResults(): ResultFile[] {
  if (!existsSync(RESULTS_DIR)) return [];
  return readdirSync(RESULTS_DIR)
    .filter((f) => f.endsWith('.json') && f !== 'summary.json')
    .map((f) => JSON.parse(readFileSync(join(RESULTS_DIR, f), 'utf8')) as ResultFile);
}

function machineSpec(): Record<string, string> {
  const spec: Record<string, string> = {
    cpu: os.cpus()[0]?.model ?? 'unknown',
    logicalCores: String(os.cpus().length),
    ramGB: (os.totalmem() / 2 ** 30).toFixed(0),
    os: `${os.platform()} ${os.release()} (${os.arch()})`,
    node: process.version,
  };
  if (os.platform() === 'darwin') {
    const read = (cmd: string) => {
      try { return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return ''; }
    };
    const model = read('sysctl -n hw.model');
    const macos = read('sw_vers -productVersion');
    if (model) spec.model = model;
    if (macos) spec.os = `macOS ${macos} (${os.arch()})`;
  }
  return spec;
}

interface DistEntry { file: string; bytes: number; gzipBytes: number }

function distReport(): { entries: DistEntry[]; totals: Record<string, { bytes: number; gzipBytes: number }> } | null {
  const dist = join(__dirname, '..', 'apps', 'web', 'dist');
  if (!existsSync(dist)) return null;
  const entries: DistEntry[] = [];
  const walk = (dir: string, rel: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const r = rel ? `${rel}/${name}` : name;
      if (statSync(p).isDirectory()) walk(p, r);
      else {
        const buf = readFileSync(p);
        entries.push({ file: r, bytes: buf.length, gzipBytes: gzipSync(buf, { level: 9 }).length });
      }
    }
  };
  walk(dist, '');
  const totals: Record<string, { bytes: number; gzipBytes: number }> = {};
  for (const e of entries) {
    const ext = e.file.includes('.') ? e.file.slice(e.file.lastIndexOf('.')) : '(none)';
    const bucket = (totals[ext] ??= { bytes: 0, gzipBytes: 0 });
    bucket.bytes += e.bytes;
    bucket.gzipBytes += e.gzipBytes;
    const all = (totals['TOTAL'] ??= { bytes: 0, gzipBytes: 0 });
    all.bytes += e.bytes;
    all.gzipBytes += e.gzipBytes;
  }
  return { entries: entries.sort((a, b) => b.bytes - a.bytes), totals };
}

const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
const mb = (n: number) => `${(n / (1024 * 1024)).toFixed(1)} MB`;
const f1 = (n: number) => (Number.isFinite(n) ? n.toFixed(1) : 'n/a');

function report(): void {
  const results = loadResults();
  if (results.length === 0) {
    console.log('[perf] no result files found — nothing to summarize.');
    return;
  }
  const lines: string[] = [];
  const spec = machineSpec();
  lines.push('# Perf baseline summary', '');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Machine: ${Object.entries(spec).map(([k, v]) => `${k}=${v}`).join(' · ')}`);
  lines.push(`Reps per measurement: ${REPS} (values below are medians across reps)`);
  lines.push('');

  // Load
  const loads = results.filter((r) => r.kind === 'load');
  if (loads.length) {
    lines.push('## Load (production build, fresh browser context = cold cache)', '');
    lines.push('| browser | headless | home interactive (ms) | DOMContentLoaded (ms) | load event (ms) | transfer | compressed payload |');
    lines.push('|---|---|---|---|---|---|---|');
    for (const r of loads) {
      const s = r.loadSamples ?? [];
      lines.push(`| ${r.browser} | ${r.headless} | ${f1(median(s.map((x) => x.homeReadyMs)))} | ${f1(
        median(s.map((x) => x.domContentLoadedMs ?? NaN)),
      )} | ${f1(median(s.map((x) => x.loadEventMs ?? NaN)))} | ${kb(median(s.map((x) => x.transferBytes)))} | ${kb(
        median(s.map((x) => x.encodedBytes)),
      )} |`);
    }
    lines.push('');
  }

  // Battle
  const battles = results.filter((r) => r.kind === 'battle');
  if (battles.length) {
    lines.push('## Battle rendering (live solo battle at 1×, rAF frame deltas)', '');
    lines.push('| browser | viewport | headless | mean FPS | p5 low FPS | worst frame (ms) | dropped % vs 30fps | dropped % vs 60fps | sampled (s) | WebGL renderer |');
    lines.push('|---|---|---|---|---|---|---|---|---|---|');
    for (const r of battles) {
      const s = r.battleSamples ?? [];
      const vp = s[0] ? `${s[0].viewport.width}x${s[0].viewport.height}` : '?';
      const flags = [
        s.some((x) => x.endedEarly) ? 'some reps: match ended early' : '',
        s.some((x) => x.visibilityLost) ? 'VISIBILITY LOST — suspect' : '',
      ].filter(Boolean).join('; ');
      lines.push(`| ${r.browser} | ${vp} | ${r.headless} | ${f1(median(s.map((x) => x.meanFps)))} | ${f1(
        median(s.map((x) => x.p5Fps)),
      )} | ${f1(median(s.map((x) => x.worstFrameMs)))} | ${f1(median(s.map((x) => x.dropped30Pct)))} | ${f1(
        median(s.map((x) => x.dropped60Pct)),
      )} | ${f1(median(s.map((x) => x.sampledMs)) / 1000)} | ${s[0]?.gl?.renderer ?? 'n/a'}${flags ? ` (${flags})` : ''} |`);
    }
    lines.push('');

    // Memory (chromium-only API)
    const withMem = battles
      .map((r) => ({ r, mems: (r.battleSamples ?? []).map((s) => s.memory?.usedJSHeapSize).filter((n): n is number => !!n) }))
      .filter((x) => x.mems.length > 0);
    lines.push('## JS heap after a full match (performance.memory — Chromium only)', '');
    if (withMem.length) {
      lines.push('| browser | viewport | used JS heap (median) |');
      lines.push('|---|---|---|');
      for (const { r, mems } of withMem) {
        const s = r.battleSamples ?? [];
        const vp = s[0] ? `${s[0].viewport.width}x${s[0].viewport.height}` : '?';
        lines.push(`| ${r.browser} | ${vp} | ${mb(median(mems))} |`);
      }
    } else {
      lines.push('No engine in this run exposes performance.memory.');
    }
    lines.push('');
  }

  // Bundle
  const dist = distReport();
  if (dist) {
    lines.push('## Production bundle (apps/web/dist)', '');
    lines.push('| kind | raw | gzip |');
    lines.push('|---|---|---|');
    for (const [ext, t] of Object.entries(dist.totals).sort((a, b) => b[1].bytes - a[1].bytes)) {
      lines.push(`| ${ext} | ${kb(t.bytes)} | ${kb(t.gzipBytes)} |`);
    }
    lines.push('');
    lines.push('Largest files:');
    for (const e of dist.entries.slice(0, 5)) {
      lines.push(`- ${e.file}: ${kb(e.bytes)} raw / ${kb(e.gzipBytes)} gzip`);
    }
    lines.push('');
  }

  lines.push(
    'Caveat: numbers describe THIS machine only. The 720p30-on-integrated-graphics',
    'floor requires representative low-end hardware — see docs/PERF_BASELINE.md.',
  );

  const md = lines.join('\n');
  writeFileSync(join(RESULTS_DIR, 'summary.md'), md);
  writeFileSync(
    join(RESULTS_DIR, 'summary.json'),
    JSON.stringify({ machine: spec, reps: REPS, results, dist: dist?.totals ?? null }, null, 2),
  );
  console.log(`\n${md}\n\n[perf] summary written to ${join(RESULTS_DIR, 'summary.md')}`);
}
