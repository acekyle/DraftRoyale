#!/usr/bin/env tsx
/**
 * Heroforge — Season-0 hero production runner (D-026).
 *
 * Production shape decided by the D-024→D-025 bake-off: Tripo text-to-3D as
 * the primary generator (identity/style winner), Meshy auto-rig for biped
 * chassis while the already-paid Pro month lasts. Unlike the bake-off, Tripo
 * runs TRIANGLE topology (no quad flag) so the output is a web-ready GLB at
 * face_limit tris — no remesh hop, and Meshy's rig endpoint takes the GLB as
 * a data URI.
 *
 * SPENDING LAWS (constitution §Spending + D-026, $25 HARD ceiling):
 *  - Keys ONLY from env vars (TRIPO_API_KEY / MESHY_API_KEY). No key → dry-run.
 *  - Exactly ONE paid call per invocation. Spend logged BEFORE the call.
 *  - Paid calls are NEVER auto-retried; failures are logged and a human decides.
 *  - HARD caps: 48 generations (12 heroes × 4), 24 rigs. Every action appends
 *    to tools/heroforge/spend-log.jsonl (committed; EP reconciles COST_LEDGER).
 *
 * Usage:
 *   npm run heroforge -- --dry-run                     # full plan, $0
 *   npm run heroforge -- --fighter vex                 # 1 Tripo text-to-3D generation
 *   npm run heroforge -- --fighter vex --brief tools/heroforge/briefs/iterations/vex-v2.md
 *   npm run heroforge -- --action rig --fighter vex --task <tripoTaskRef>
 *                                                      # Meshy auto-rig of that GLB (bipeds)
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const RESULTS_DIR = join(HERE, 'results');
const SPEND_LOG = join(HERE, 'spend-log.jsonl');

const GENERATION_CAP = 48; // 12 heroes × 4 — inside the $25 ceiling at ~$0.20/gen
const RIG_CAP = 24;
const POLL_TIMEOUT_MS = 25 * 60 * 1000;

// ---------------------------------------------------------------------------
// Roster — chassis/scale come from the contract data, the single source of truth
// ---------------------------------------------------------------------------

type Chassis = 'humanoid' | 'heavy' | 'quadruped' | 'floating';
interface Hero {
  fighter: string;
  chassis: Chassis;
  scale: number;
}

function loadRoster(): Map<string, Hero> {
  const dir = join(ROOT, 'content', 'fighters');
  const roster = new Map<string, Hero>();
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
    const j = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    const id = j.dna?.identity;
    if (!id?.fighterId) continue;
    roster.set(id.fighterId, { fighter: id.fighterId, chassis: id.chassis, scale: id.scale ?? 1 });
  }
  return roster;
}

const ROSTER = loadRoster();
/** Meshy auto-rig is documented humanoid(biped)-only; heavy chassis are bipeds too — attempted, cheap to fail. */
const isBiped = (c: Chassis) => c === 'humanoid' || c === 'heavy';
/** height_meters for the rig: 1.7 m at scale 1 (Art Bible humanoid reference). */
const rigHeight = (h: Hero) => Math.round(1.7 * h.scale * 100) / 100;

// ---------------------------------------------------------------------------
// Briefs — same machine-read format as the bake-off kit
// ---------------------------------------------------------------------------

interface Brief {
  fighter: string;
  path: string;
  prompt: string;
  negative: string;
}

function section(md: string, name: string): string {
  const m = md.match(new RegExp(`^## ${name}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`, 'm'));
  if (!m) throw new Error(`brief is missing "## ${name}" section`);
  return m[1].trim().replace(/\s+/g, ' ');
}

function loadBrief(fighter: string, briefOverride?: string): Brief {
  const path = briefOverride ? resolve(briefOverride) : join(HERE, 'briefs', `${fighter}.md`);
  if (!existsSync(path)) throw new Error(`brief file not found: ${path}`);
  const md = readFileSync(path, 'utf8');
  const prompt = section(md, 'Prompt');
  const negative = section(md, 'Negative prompt');
  if (prompt.length > 1024) throw new Error(`${path}: prompt ${prompt.length} chars > 1024 (Tripo limit)`);
  if (negative.length > 255) throw new Error(`${path}: negative ${negative.length} chars > 255 (Tripo limit)`);
  return { fighter, path, prompt, negative };
}

// ---------------------------------------------------------------------------
// Spend log
// ---------------------------------------------------------------------------

interface SpendEntry {
  at: string;
  provider: 'tripo' | 'meshy';
  fighter: string;
  action: 'generation' | 'rig' | 'artifact' | 'failed';
  taskRef?: string;
  credits?: number | null;
  estimatedCredits?: string;
  artifactPath?: string | null;
  brief?: string;
  detail?: string;
}

const appendSpend = (e: SpendEntry) => appendFileSync(SPEND_LOG, `${JSON.stringify(e)}\n`);

function spendEntries(): SpendEntry[] {
  if (!existsSync(SPEND_LOG)) return [];
  return readFileSync(SPEND_LOG, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .flatMap((l) => {
      try {
        return [JSON.parse(l) as SpendEntry];
      } catch {
        return [];
      }
    });
}

const loggedGenerations = () => spendEntries().filter((e) => e.action === 'generation').length;
const loggedRigs = () => spendEntries().filter((e) => e.action === 'rig').length;

// ---------------------------------------------------------------------------
// HTTP — paid POSTs single-shot; free polls tolerate 3 transient errors
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function oneShotJson(url: string, init: RequestInit): Promise<any> {
  const res = await fetch(url, init); // single attempt, by law
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${url} → HTTP ${res.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : {};
}

async function pollJson(make: () => Promise<any>): Promise<any> {
  let transient = 0;
  for (;;) {
    try {
      return await make();
    } catch (err) {
      if (++transient > 3) throw err;
      await sleep(5000);
    }
  }
}

async function downloadTo(url: string, path: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${url} → HTTP ${res.status}`);
  writeFileSync(path, Buffer.from(await res.arrayBuffer()));
}

// ---------------------------------------------------------------------------
// Tripo generate — text_to_model, triangle topology → GLB
// (API shape verified during the bake-off, docs accessed 2026-08-20/21;
//  same endpoints as tools/bakeoff/run.ts)
// ---------------------------------------------------------------------------

const TRIPO_BASE = 'https://api.tripo3d.ai/v2/openapi';
const GEN_ESTIMATE = '~20 cr (text+texture, triangle topology; developers.tripo3d.ai/en/pricing) ≈ $0.20 at API rate';

function tripoPayload(brief: Brief) {
  return {
    type: 'text_to_model',
    prompt: brief.prompt,
    negative_prompt: brief.negative,
    model_version: 'v3.1-20260211',
    texture: true,
    pbr: true,
    texture_quality: 'standard',
    face_limit: 40000, // triangles in triangle mode — the web budget, directly
  };
}

async function tripoGenerate(brief: Brief, key: string, outDir: string) {
  const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const created = await oneShotJson(`${TRIPO_BASE}/task`, {
    method: 'POST',
    headers,
    body: JSON.stringify(tripoPayload(brief)),
  });
  const taskRef: string = created.data?.task_id;
  if (!taskRef) throw new Error(`tripo create returned no task_id: ${JSON.stringify(created).slice(0, 300)}`);

  const start = Date.now();
  let task: any;
  for (;;) {
    const res = await pollJson(() => oneShotJson(`${TRIPO_BASE}/task/${taskRef}`, { headers }));
    task = res.data;
    console.log(`[heroforge] tripo ${taskRef}: ${task.status} ${task.progress ?? 0}%`);
    if (task.status === 'success') break;
    if (['failed', 'banned', 'expired', 'cancelled', 'unknown'].includes(task.status)) {
      throw new Error(`tripo task ${taskRef} ended ${task.status}`);
    }
    if (Date.now() - start > POLL_TIMEOUT_MS) throw new Error(`tripo task ${taskRef} poll timeout`);
    await sleep(10_000);
  }

  // Output URLs expire in ~5 minutes — download immediately, meta last.
  const artifacts: string[] = [];
  const out = task.output ?? {};
  const modelUrl: string | undefined = out.pbr_model ?? out.model ?? out.base_model;
  if (modelUrl) {
    const ext = modelUrl.split('?')[0].split('.').pop() || 'glb';
    const model = join(outDir, `${taskRef}.${ext}`);
    await downloadTo(modelUrl, model);
    artifacts.push(model);
  }
  if (out.rendered_image) {
    const render = join(outDir, `${taskRef}.render.webp`);
    await downloadTo(out.rendered_image, render);
    artifacts.push(render);
  }
  writeFileSync(join(outDir, `${taskRef}.meta.json`), JSON.stringify(task, null, 2));
  artifacts.push(join(outDir, `${taskRef}.meta.json`));
  return { taskRef, credits: null as number | null, artifacts };
}

// ---------------------------------------------------------------------------
// Meshy rig — model_url data URI of the local Tripo GLB (biped chassis only)
// (API shape verified during the bake-off: docs.meshy.ai/en/api/rigging-and-animation)
// ---------------------------------------------------------------------------

const MESHY_BASE = 'https://api.meshy.ai';
const RIG_ESTIMATE = '5 cr auto-rigging (docs.meshy.ai/en/api/pricing) — Pro-month credits, no new cash';

async function pollMeshyTask(base: string, id: string, headers: Record<string, string>): Promise<any> {
  const start = Date.now();
  for (;;) {
    const task = await pollJson(() => oneShotJson(`${base}/${id}`, { headers }));
    console.log(`[heroforge] meshy ${id}: ${task.status} ${task.progress ?? 0}%`);
    if (task.status === 'SUCCEEDED') return task;
    if (['FAILED', 'CANCELED'].includes(task.status)) {
      throw new Error(`meshy task ${id} ended ${task.status}: ${JSON.stringify(task.task_error ?? {})}`);
    }
    if (Date.now() - start > POLL_TIMEOUT_MS) throw new Error(`meshy task ${id} poll timeout`);
    await sleep(10_000);
  }
}

async function meshyRig(hero: Hero, glbPath: string, key: string, outDir: string) {
  const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const created = await oneShotJson(`${MESHY_BASE}/openapi/v1/rigging`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model_url: `data:model/gltf-binary;base64,${readFileSync(glbPath).toString('base64')}`,
      height_meters: rigHeight(hero),
    }),
  });
  const rigId: string = created.result;
  if (!rigId) throw new Error(`meshy rigging create returned no id: ${JSON.stringify(created).slice(0, 300)}`);
  const finalTask = await pollMeshyTask(`${MESHY_BASE}/openapi/v1/rigging`, rigId, headers);

  const base = glbPath.replace(/\.glb$/, '');
  const artifacts: string[] = [];
  const metaPath = `${base}.rigged.meta.json`;
  writeFileSync(metaPath, JSON.stringify(finalTask, null, 2));
  artifacts.push(metaPath);
  const result = finalTask.result ?? {};
  if (result.rigged_character_glb_url) {
    const glb = `${base}.rigged.glb`;
    await downloadTo(result.rigged_character_glb_url, glb);
    artifacts.push(glb);
  }
  if (result.rigged_character_fbx_url) {
    const fbx = `${base}.rigged.fbx`;
    await downloadTo(result.rigged_character_fbx_url, fbx);
    artifacts.push(fbx);
  }
  // Free walking/running previews ship with the rig — collect any URLs defensively.
  const animUrls: Array<[string, string]> = [];
  const collect = (node: unknown, trail: string): void => {
    if (typeof node === 'string') {
      if (/^https?:\/\//.test(node)) animUrls.push([trail, node]);
    } else if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) collect(v, trail ? `${trail}-${k}` : k);
    }
  };
  collect(result.basic_animations, '');
  for (const [name, url] of animUrls.slice(0, 8)) {
    const ext = url.split('?')[0].split('.').pop() || 'glb';
    const safe = name.replace(/_?url$/i, '').replace(/[^\w.-]/g, '_') || 'anim';
    const path = `${base}.rigged.${safe}.${ext}`;
    await downloadTo(url, path);
    artifacts.push(path);
  }
  return { taskRef: rigId, credits: finalTask.consumed_credits ?? null, artifacts };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]) {
  const has = (f: string) => argv.includes(f);
  const val = (f: string): string | undefined => {
    const i = argv.indexOf(f);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    dryRun: has('--dry-run'),
    action: (val('--action') ?? 'generate') as 'generate' | 'rig',
    fighter: val('--fighter'),
    brief: val('--brief'),
    task: val('--task'),
    forceNonBiped: has('--force-non-biped'),
  };
}

function printPlan(): void {
  console.log('='.repeat(76));
  console.log('HEROFORGE DRY RUN — Season-0 production plan (D-026), NO provider calls');
  console.log('='.repeat(76));
  for (const hero of ROSTER.values()) {
    const briefPath = join(HERE, 'briefs', `${hero.fighter}.md`);
    const briefState = existsSync(briefPath) ? 'brief ready' : 'BRIEF MISSING';
    const rig = isBiped(hero.chassis) ? `meshy rig @ ${rigHeight(hero)}m` : 'no auto-rig (external craft / procedural hover)';
    console.log(`  ${hero.fighter.padEnd(18)} ${hero.chassis.padEnd(10)} scale ${hero.scale}  ${briefState}; ${rig}`);
    if (existsSync(briefPath)) {
      const b = loadBrief(hero.fighter);
      console.log(`    prompt ${b.prompt.length} chars / negative ${b.negative.length} chars`);
    }
  }
  console.log(`\n  generation payload template: ${JSON.stringify(tripoPayload({ fighter: '<f>', path: '', prompt: '<prompt>', negative: '<negative>' }))}`);
  console.log(`  estimated: ${GEN_ESTIMATE} per generation; ${RIG_ESTIMATE} per rig`);
  console.log(
    `  spend-log: ${loggedGenerations()}/${GENERATION_CAP} generations + ${loggedRigs()}/${RIG_CAP} rigs recorded`,
  );
  console.log('='.repeat(76));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.dryRun || !args.fighter) {
    printPlan();
    return;
  }

  const hero = ROSTER.get(args.fighter);
  if (!hero) {
    console.error(`[heroforge] unknown fighter "${args.fighter}" (roster: ${[...ROSTER.keys()].join(', ')})`);
    process.exit(1);
  }
  const outDir = join(RESULTS_DIR, hero.fighter);
  mkdirSync(outDir, { recursive: true });

  if (args.action === 'rig') {
    const key = process.env.MESHY_API_KEY;
    if (!key) {
      console.error('[heroforge] MESHY_API_KEY not set — nothing was called, nothing was spent.');
      process.exit(1);
    }
    if (!args.task) {
      console.error('[heroforge] --action rig needs --task <tripoTaskRef> (the generation to rig).');
      process.exit(1);
    }
    const glbPath = join(outDir, `${args.task}.glb`);
    if (!existsSync(glbPath)) {
      console.error(`[heroforge] ${glbPath} not found — rig takes the local Tripo GLB. Nothing was spent.`);
      process.exit(1);
    }
    if (!isBiped(hero.chassis) && !args.forceNonBiped) {
      console.error(
        `[heroforge] REFUSING to rig ${hero.fighter} (${hero.chassis}): Meshy auto-rig is documented biped-only. ` +
          'Pass --force-non-biped to spend anyway.',
      );
      process.exit(1);
    }
    if (loggedRigs() >= RIG_CAP) {
      console.error(`[heroforge] REFUSING: rig cap ${RIG_CAP} reached — new Founder gate required.`);
      process.exit(1);
    }
    console.log(`[heroforge] ONE rig task: meshy × ${hero.fighter} (${hero.chassis}, ${rigHeight(hero)}m) from ${args.task}.glb`);
    appendSpend({
      at: new Date().toISOString(),
      provider: 'meshy',
      fighter: hero.fighter,
      action: 'rig',
      taskRef: args.task,
      estimatedCredits: RIG_ESTIMATE,
      credits: null,
      artifactPath: null,
    });
    try {
      const result = await meshyRig(hero, glbPath, key, outDir);
      appendSpend({
        at: new Date().toISOString(),
        provider: 'meshy',
        fighter: hero.fighter,
        action: 'artifact',
        taskRef: result.taskRef,
        credits: result.credits,
        artifactPath: result.artifacts[0] ?? null,
        detail: `rig of ${args.task}: ${result.artifacts.length} file(s)`,
      });
      console.log(`[heroforge] DONE rig for ${hero.fighter} (rig task ${result.taskRef})`);
      for (const a of result.artifacts) console.log(`[heroforge]   artifact: ${a}`);
    } catch (err) {
      appendSpend({
        at: new Date().toISOString(),
        provider: 'meshy',
        fighter: hero.fighter,
        action: 'failed',
        taskRef: args.task,
        detail: `rig: ${(err as Error).message.slice(0, 500)}`,
      });
      console.error(`[heroforge] FAILED (no auto-retry, by law): ${(err as Error).message}`);
      process.exit(1);
    }
    return;
  }

  // generate
  const key = process.env.TRIPO_API_KEY;
  if (!key) {
    console.error('[heroforge] TRIPO_API_KEY not set — nothing was called, nothing was spent. Dry-run plan:');
    printPlan();
    process.exit(1);
  }
  if (loggedGenerations() >= GENERATION_CAP) {
    console.error(`[heroforge] REFUSING: generation cap ${GENERATION_CAP} reached — new Founder gate required.`);
    process.exit(1);
  }
  const brief = loadBrief(hero.fighter, args.brief);
  console.log(`[heroforge] ONE text-to-3D generation: tripo × ${hero.fighter} (${hero.chassis})`);
  console.log(`[heroforge] brief: ${brief.path}`);
  console.log(`[heroforge] estimated spend: ${GEN_ESTIMATE}`);
  console.log(`[heroforge] spend-log before this run: ${loggedGenerations()}/${GENERATION_CAP} generations`);

  appendSpend({
    at: new Date().toISOString(),
    provider: 'tripo',
    fighter: hero.fighter,
    action: 'generation',
    estimatedCredits: GEN_ESTIMATE,
    credits: null,
    artifactPath: null,
    brief: brief.path,
  });
  try {
    const result = await tripoGenerate(brief, key, outDir);
    appendSpend({
      at: new Date().toISOString(),
      provider: 'tripo',
      fighter: hero.fighter,
      action: 'artifact',
      taskRef: result.taskRef,
      credits: result.credits,
      artifactPath: result.artifacts[0] ?? null,
      brief: brief.path,
      detail: `${result.artifacts.length} file(s)`,
    });
    console.log(`[heroforge] DONE tripo × ${hero.fighter} (task ${result.taskRef})`);
    for (const a of result.artifacts) console.log(`[heroforge]   artifact: ${a}`);
  } catch (err) {
    appendSpend({
      at: new Date().toISOString(),
      provider: 'tripo',
      fighter: hero.fighter,
      action: 'failed',
      detail: (err as Error).message.slice(0, 500),
    });
    console.error(`[heroforge] FAILED (no auto-retry, by law): ${(err as Error).message}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`[heroforge] ${(err as Error).message}`);
  process.exit(1);
});
