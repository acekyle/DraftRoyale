#!/usr/bin/env tsx
/**
 * Promote a rigged hero + its clip set into the web client (Tier 3, D-030).
 *
 *   npm run heroforge:promote-anim -- --fighter captain-meridian \
 *     --model <genTask> --rig <rigTask>
 *
 * Copies results/<fighter>/<genTask>.rigged.glb → public/heroes/rigged/<fighter>.glb
 * and every results/<fighter>/<rigTask>.anim<ID>.glb → <fighter>.<name>.glb using
 * the library-id map below, then rebuilds rigged/manifest.json
 * (fighterId → clip names) from the directory contents.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const OUT = join(ROOT, 'apps', 'web', 'public', 'heroes', 'rigged');

/** Meshy animation-library action_id → semantic clip name. */
const CLIP_NAMES: Record<string, string> = {
  '0': 'idle',
  '30': 'walk',
  '96': 'attack', // Kung_Fu_Punch
  '102': 'attack', // Sword_Judgment
  '219': 'attack', // Right_Hand_Sword_Slash
  '87': 'attack', // Boxing_Practice
  '97': 'attack', // Left_Slash
  '125': 'cast', // Charged_Spell_Cast
  '138': 'guard', // Block1
  '173': 'hit', // Slap_Reaction
  '8': 'dead',
};

const argv = process.argv.slice(2);
const val = (f: string) => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};
const fighter = val('--fighter');
const model = val('--model');
const rig = val('--rig');

mkdirSync(OUT, { recursive: true });

if (fighter && model && rig) {
  const dir = join(HERE, 'results', fighter);
  const rigged = join(dir, `${model}.rigged.glb`);
  if (!existsSync(rigged)) {
    console.error(`[promote-anim] not found: ${rigged}`);
    process.exit(1);
  }
  copyFileSync(rigged, join(OUT, `${fighter}.glb`));
  let clips = 0;
  for (const name of readdirSync(dir)) {
    const m = name.match(new RegExp(`^${rig}\\.anim(\\d+)\\.glb$`));
    if (!m) continue;
    const clip = CLIP_NAMES[m[1]];
    if (!clip) {
      console.warn(`[promote-anim] no clip name for action_id ${m[1]} — skipped`);
      continue;
    }
    copyFileSync(join(dir, name), join(OUT, `${fighter}.${clip}.glb`));
    clips++;
  }
  console.log(`[promote-anim] ${fighter}: rigged model + ${clips} clip(s)`);
} else if (fighter || model || rig) {
  console.error('[promote-anim] need --fighter, --model (gen task) and --rig (rig task); or no args to rebuild the manifest');
  process.exit(1);
}

// Rebuild manifest from directory contents.
const manifest: Record<string, string[]> = {};
for (const name of readdirSync(OUT)) {
  const m = name.match(/^(.+?)\.([a-z]+)\.glb$/);
  if (m) (manifest[m[1]] ??= []).push(m[2]);
}
// Only fighters whose base rigged model exists count.
for (const id of Object.keys(manifest)) {
  if (!existsSync(join(OUT, `${id}.glb`))) delete manifest[id];
  else manifest[id].sort();
}
writeFileSync(join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`[promote-anim] manifest: ${Object.entries(manifest).map(([k, v]) => `${k}(${v.length})`).join(', ') || '(none)'}`);
