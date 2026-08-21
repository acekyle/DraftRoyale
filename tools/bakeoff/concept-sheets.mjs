#!/usr/bin/env node
/**
 * Bake-off concept sheets — $0 style control (proposal §5, step 1).
 *
 * Captures front / side / three-quarter stills of the three test fighters from
 * OUR OWN pedestal viewer (apps/web/src/pedestalPreview.ts), plus a palette
 * strip per fighter from the DNA presentation colors. These images are the
 * shared image-prompt input for every provider — the same three sheets feed
 * Meshy, Tripo and Rodin identically, isolating the 3D variable.
 *
 * No paid services touched. Run from the repo root:
 *
 *   node tools/bakeoff/concept-sheets.mjs [--skip-build] [--port 5210] [--headed]
 *
 * How it works (no app code modified):
 *  - builds apps/web and serves dist via `vite preview` on --port (default 5210)
 *  - sets `ia_settings.reducedMotion` BEFORE app load, so the pedestal
 *    turntable is static instead of continuously rotating
 *  - registers a `__THREE_DEVTOOLS__` hook before app load; three.js (r170)
 *    announces every Scene to it, which lets us reach the pedestal viewer's
 *    heroSlot group from page context and set exact camera-relative angles
 *    (front 0 rad · side +PI/2 · three-quarter -0.5 rad, the app's rest pose)
 *  - walks the real UI: home → solo → arena reveal → draft, opens each
 *    fighter's inspect drawer and screenshots the pedestal canvas
 *
 * Output: tools/bakeoff/concept-sheets/<fighter>-{front,side,quarter}.png
 *         tools/bakeoff/concept-sheets/<fighter>-palette.png
 */
import { chromium } from '@playwright/test';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const OUT_DIR = join(HERE, 'concept-sheets');

const FIGHTERS = ['ember-ronin', 'razorback', 'orrin'];
/** heroSlot.rotation.y per view. -0.5 is the app's own three-quarter rest pose. */
const VIEWS = [
  ['front', 0],
  ['side', Math.PI / 2],
  ['quarter', -0.5],
];

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const PORT = Number(opt('--port', '5210'));
const BASE = `http://localhost:${PORT}`;

function log(msg) {
  console.log(`[concept-sheets] ${msg}`);
}

function presentationOf(fighterId) {
  const file = JSON.parse(
    readFileSync(join(ROOT, 'content', 'fighters', `${fighterId}.json`), 'utf8'),
  );
  return file.dna.presentation;
}

/** Minimal PNG IHDR parse — sanity-check outputs without extra deps. */
function pngSize(path) {
  const buf = readFileSync(path);
  if (buf.length < 24 || buf.readUInt32BE(12) !== 0x49484452 /* "IHDR" */) {
    throw new Error(`${path}: not a PNG`);
  }
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), bytes: buf.length };
}

async function waitForServer(url, timeoutMs = 30_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`vite preview did not come up at ${url} within ${timeoutMs}ms`);
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  if (!flag('--skip-build')) {
    log('building apps/web (vite build)…');
    execSync('npm run build', { cwd: ROOT, stdio: 'inherit' });
  }

  log(`serving dist via vite preview on :${PORT}…`);
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: join(ROOT, 'apps', 'web'),
    stdio: 'ignore',
    detached: false,
  });
  const killServer = () => {
    try {
      server.kill('SIGTERM');
    } catch {
      /* already gone */
    }
  };
  process.on('exit', killServer);

  let browser;
  try {
    await waitForServer(BASE);

    browser = await chromium.launch({ headless: !flag('--headed') });
    const page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
      deviceScaleFactor: 2, // crisp 2x captures from the pedestal canvas
    });
    page.on('dialog', (d) => d.dismiss().catch(() => {}));

    // BEFORE app scripts: static turntable + three.js devtools hook.
    await page.addInitScript(() => {
      try {
        localStorage.setItem('ia_settings', JSON.stringify({ reducedMotion: true }));
      } catch {
        /* private mode */
      }
      // three.js announces new Scene/WebGLRenderer instances to this hook
      // (see node_modules/three/build/three.module.js, __THREE_DEVTOOLS__).
      const captured = [];
      const hook = new EventTarget();
      hook.addEventListener('observe', (e) => captured.push(e.detail));
      window.__IA_THREE_CAPTURED = captured;
      window.__THREE_DEVTOOLS__ = hook;
    });

    // Home → solo → arena reveal → draft (same path as e2e/helpers.ts).
    log('navigating: home → solo gauntlet → draft…');
    await page.goto(BASE);
    await page.locator('#p1name').fill('Bakeoff');
    await page.locator('#mode-solo').click();
    await page.locator('.disclosure-list li').first().waitFor({ timeout: 15_000 });
    await page.locator('#btn-draft').click();
    // Human on the clock for pick 1 — no re-renders while we hold it.
    await page
      .locator('.turn-banner', { hasText: '(pick 1)' })
      .waitFor({ timeout: 30_000 });

    const results = [];
    for (const fighter of FIGHTERS) {
      log(`capturing ${fighter}…`);
      await page.locator(`.fighter-card[data-id="${fighter}"]`).click();
      const canvas = page.locator('.inspect .hero-stage canvas');
      try {
        await canvas.waitFor({ timeout: 10_000 });
      } catch {
        throw new Error(
          'pedestal canvas never appeared — WebGL unavailable in this browser ' +
            '(the app fell back to the 2D silhouette). Try --headed, or a machine with GPU/SwiftShader.',
        );
      }

      for (const [view, angle] of VIEWS) {
        const ok = await page.evaluate((rotY) => {
          const scenes = (window.__IA_THREE_CAPTURED ?? []).filter((o) => o && o.isScene);
          for (const scene of scenes) {
            // pedestalPreview.ts: heroSlot is the Group parked at y=0.7 (the
            // pedestal top) holding the mounted hero.
            const slot = scene.children.find(
              (c) => c.isGroup && Math.abs(c.position.y - 0.7) < 1e-6 && c.children.length > 0,
            );
            if (slot) {
              slot.rotation.y = rotY;
              // Provider-input hygiene (capture only; the app is untouched):
              //  - hide the pedestal — the briefs' negative prompt forbids a
              //    base, so the reference image must not show one
              //  - shrink slightly so tall heroes' heads clear the fixed frame
              slot.scale.setScalar(0.86);
              const pedestal = scene.children.find(
                (c) => c.isGroup && c !== slot && c.children.every((m) => m.isMesh),
              );
              if (pedestal) pedestal.visible = false;
              return true;
            }
          }
          return false;
        }, angle);
        if (!ok) throw new Error(`could not locate pedestal heroSlot for ${fighter}/${view}`);

        // Let the (reducedMotion-static, but still rendering) RAF loop present the frame.
        await page.evaluate(
          () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
        );

        const path = join(OUT_DIR, `${fighter}-${view}.png`);
        await canvas.screenshot({ path });
        results.push(path);
      }

      // The pedestal canvas overlaps the close button's hit area in headless
      // layout — dispatch the click on the element directly.
      await page.locator('.inspect .close').evaluate((el) => el.click());
    }

    // Palette strips: 3 named swatches per fighter, straight from DNA data.
    for (const fighter of FIGHTERS) {
      const p = presentationOf(fighter);
      const swatches = [
        ['primary', p.primaryColor],
        ['secondary', p.secondaryColor],
        ['energy', p.energyColor],
      ];
      const dataUrl = await page.evaluate(
        ({ name, swatches }) => {
          const W = 720;
          const H = 160;
          const c = document.createElement('canvas');
          c.width = W;
          c.height = H;
          const g = c.getContext('2d');
          g.fillStyle = '#14171f';
          g.fillRect(0, 0, W, H);
          swatches.forEach(([label, hex], i) => {
            const x = 16 + i * 232;
            g.fillStyle = hex;
            g.fillRect(x, 16, 216, 96);
            g.strokeStyle = '#ffffff33';
            g.strokeRect(x + 0.5, 16.5, 215, 95);
            g.fillStyle = '#e8ecf5';
            g.font = '600 15px system-ui, sans-serif';
            g.fillText(`${label}  ${hex}`, x + 4, 136);
          });
          g.fillStyle = '#8a93a8';
          g.font = '600 12px system-ui, sans-serif';
          g.save();
          g.translate(W - 10, H - 10);
          g.rotate(-Math.PI / 2);
          g.fillText(name, 0, 0);
          g.restore();
          return c.toDataURL('image/png');
        },
        { name: fighter, swatches },
      );
      const path = join(OUT_DIR, `${fighter}-palette.png`);
      writeFileSync(path, Buffer.from(dataUrl.split(',')[1], 'base64'));
      results.push(path);
    }

    // Verify every output: exists, non-trivial, sane dimensions.
    log('verifying outputs…');
    let bad = 0;
    for (const path of results) {
      const { w, h, bytes } = pngSize(path);
      const okDims = w >= 200 && h >= 100;
      const okBytes = bytes > 4_000; // a blank/black canvas compresses far smaller than a lit statue
      const status = okDims && okBytes ? 'ok' : 'SUSPECT';
      if (status !== 'ok') bad += 1;
      log(`  ${path.replace(ROOT + '/', '')}  ${w}x${h}  ${(bytes / 1024).toFixed(1)}KB  ${status}`);
    }
    if (bad > 0) throw new Error(`${bad} output(s) look wrong — inspect them before using as provider input`);

    log(`done — ${results.length} files in tools/bakeoff/concept-sheets/`);
  } finally {
    await browser?.close();
    killServer();
  }
}

main().catch((err) => {
  console.error(`[concept-sheets] FAILED: ${err.message}`);
  process.exit(1);
});
