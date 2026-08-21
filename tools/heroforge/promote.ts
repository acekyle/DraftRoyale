#!/usr/bin/env tsx
/**
 * Promote an accepted heroforge GLB into the web client (D-026 step 3).
 *
 * Copies tools/heroforge/results/<fighter>/<task>.glb (or .rigged.glb) to
 * apps/web/public/heroes/<fighter>.glb and rebuilds heroes/manifest.json from
 * the directory contents. Promotion is the acceptance act: only rubric-passing
 * artifacts (≥18/30, no silhouette/budget zero — scores in SCORES.md) go here.
 *
 *   npm run heroforge:promote -- --fighter vex --task <taskRef> [--rigged]
 *   npm run heroforge:promote -- --demote vex     # procedural fallback again
 *   npm run heroforge:promote                     # just rebuild the manifest
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const HEROES_DIR = join(ROOT, 'apps', 'web', 'public', 'heroes');

const argv = process.argv.slice(2);
const val = (f: string) => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};
const fighter = val('--fighter');
const task = val('--task');
const demote = val('--demote');
const rigged = argv.includes('--rigged');

mkdirSync(HEROES_DIR, { recursive: true });

if (demote) {
  const target = join(HEROES_DIR, `${demote}.glb`);
  if (existsSync(target)) {
    rmSync(target);
    console.log(`[promote] removed ${target} — ${demote} ships procedural again`);
  }
} else if (fighter && task) {
  const src = join(HERE, 'results', fighter, `${task}${rigged ? '.rigged' : ''}.glb`);
  if (!existsSync(src)) {
    console.error(`[promote] not found: ${src}`);
    process.exit(1);
  }
  copyFileSync(src, join(HEROES_DIR, `${fighter}.glb`));
  console.log(`[promote] ${fighter} ← ${src}`);
} else if (fighter || task) {
  console.error('[promote] need BOTH --fighter and --task (or --demote <fighter>, or no args to rebuild manifest)');
  process.exit(1);
}

const ids = readdirSync(HEROES_DIR)
  .filter((n) => n.endsWith('.glb'))
  .map((n) => n.replace(/\.glb$/, ''))
  .sort();
writeFileSync(join(HEROES_DIR, 'manifest.json'), `${JSON.stringify(ids, null, 2)}\n`);
console.log(`[promote] manifest: ${ids.length} hero(es) — ${ids.join(', ') || '(none)'}`);
