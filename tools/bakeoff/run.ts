#!/usr/bin/env tsx
/**
 * 3D-generation bake-off runner — Meshy / Tripo / Rodin (Hyper3D).
 *
 * Implements docs/proposals/3d-generation-bakeoff-proposal.md §5 under the
 * Founder-approved D-024 budget ($100 HARD ceiling, $69.90 planned).
 *
 * SPENDING LAWS (constitution §Spending + D-024):
 *  - Keys come ONLY from env vars (MESHY_API_KEY / TRIPO_API_KEY / RODIN_API_KEY),
 *    never from files, argv, or chat. No key → dry-run, with a clear message.
 *  - `--dry-run` (the default whenever any key is missing) prints the complete
 *    plan for every provider×fighter pair WITHOUT any network call to providers.
 *  - A real run does exactly ONE generation per invocation (`--provider` +
 *    `--fighter` required), capped by --max-generations (default 1).
 *  - HARD STOP at 45 logged generations total (5 iterations × 9 pairs — well
 *    inside the $100 ceiling). The runner refuses to start past that line.
 *  - Paid calls are NEVER auto-retried. A failed call is logged and the run
 *    aborts; a human decides whether to try again.
 *  - Every generation appends to tools/bakeoff/spend-log.jsonl (ledger law:
 *    docs/COST_LEDGER.md is EP-maintained from this log — this tool never
 *    edits the ledger itself).
 *
 * Usage:
 *   npm run bakeoff -- --dry-run                       # plan for all 9 pairs, $0
 *   npm run bakeoff -- --provider meshy --fighter ember-ronin            # 1 image-to-3D gen
 *   npm run bakeoff -- --provider tripo --fighter razorback --mode text  # 1 text-to-3D gen
 *   npm run bakeoff -- --provider meshy --fighter razorback \
 *     --brief tools/bakeoff/briefs/iterations/razorback-v2.md            # iteration brief override
 *
 * Finish pipeline (Meshy only; same one-paid-call-per-invocation law):
 *   npm run bakeoff -- --action remesh --provider meshy --task <taskRef> \
 *     [--target-polycount 38000 --topology quad]       # retopo an existing generation
 *   npm run bakeoff -- --action rig --provider meshy --task <taskRef> \
 *     [--height 1.7]                                   # auto-rig — HUMANOID ONLY per Meshy docs
 *
 * Prereqs for image mode (the protocol's primary path):
 *   npm run bakeoff:sheets   # $0 concept sheets from our procedural heroes
 *   (Tripo image mode additionally needs BAKEOFF_SHEETS_BASE_URL — see its adapter.)
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHEETS_DIR = join(HERE, 'concept-sheets');
const RESULTS_DIR = join(HERE, 'results');
const SPEND_LOG = join(HERE, 'spend-log.jsonl');

const TOTAL_GENERATION_CAP = 45; // 9 pairs × 5 iterations — the protocol maximum
// Finish tasks (remesh/rig) are cheap (5 cr each per Meshy's API pricing page)
// but still paid: cap them at 2 per possible generation, same refusal style.
const TOTAL_FINISH_CAP = 90;
const POLL_TIMEOUT_MS = 25 * 60 * 1000;

const FIGHTERS = ['ember-ronin', 'razorback', 'orrin'] as const;
type Fighter = (typeof FIGHTERS)[number];
const CHASSIS: Record<Fighter, 'humanoid' | 'quadruped' | 'floating'> = {
  'ember-ronin': 'humanoid',
  razorback: 'quadruped',
  orrin: 'floating',
};

const PROVIDERS = ['meshy', 'tripo', 'rodin'] as const;
type ProviderName = (typeof PROVIDERS)[number];
type Mode = 'image' | 'text';

// ---------------------------------------------------------------------------
// Briefs — the .md files ARE the prompt package (machine-read here)
// ---------------------------------------------------------------------------

interface Brief {
  fighter: Fighter;
  /** The brief file actually read (default or --brief override) — logged to spend-log. */
  path: string;
  prompt: string;
  negative: string;
  /** prompt + " Avoid: " + negative — for providers without a negative field. */
  combined: string;
}

function section(md: string, name: string): string {
  const m = md.match(new RegExp(`^## ${name}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`, 'm'));
  if (!m) throw new Error(`brief is missing "## ${name}" section`);
  return m[1].trim().replace(/\s+/g, ' ');
}

function loadBrief(fighter: Fighter, briefOverride?: string): Brief {
  // --brief lets iteration briefs live in briefs/iterations/ without touching
  // the frozen round-1 files; default stays briefs/<fighter>.md.
  const path = briefOverride ? resolve(briefOverride) : join(HERE, 'briefs', `${fighter}.md`);
  if (briefOverride && !existsSync(path)) throw new Error(`--brief file not found: ${path}`);
  const md = readFileSync(path, 'utf8');
  const prompt = section(md, 'Prompt');
  const negative = section(md, 'Negative prompt');
  const combined = `${prompt} Avoid: ${negative}`;
  // Provider hard limits (from the public docs cited in the adapters below).
  if (combined.length > 600) throw new Error(`${path}: combined prompt ${combined.length} chars > 600 (Meshy limit)`);
  if (prompt.length > 1024) throw new Error(`${path}: prompt ${prompt.length} chars > 1024 (Tripo limit)`);
  if (negative.length > 255) throw new Error(`${path}: negative ${negative.length} chars > 255 (Tripo limit)`);
  return { fighter, path, prompt, negative, combined };
}

function sheetPath(fighter: Fighter, view: 'front' | 'side' | 'quarter'): string {
  return join(SHEETS_DIR, `${fighter}-${view}.png`);
}

function sheetStatus(path: string): string {
  if (!existsSync(path)) return 'MISSING — run `npm run bakeoff:sheets` first';
  return `${(statSync(path).size / 1024).toFixed(0)}KB`;
}

function sheetDataUri(path: string): string {
  return `data:image/png;base64,${readFileSync(path).toString('base64')}`;
}

// ---------------------------------------------------------------------------
// Spend log — append-only JSONL; the cap guard and the ledger both read it
// ---------------------------------------------------------------------------

interface SpendEntry {
  at: string;
  provider: ProviderName;
  fighter: Fighter;
  action: 'generation' | 'remesh' | 'rig' | 'artifact' | 'failed';
  mode?: Mode;
  taskRef?: string;
  credits?: number | null;
  dollars?: number | null;
  estimatedCredits?: string;
  artifactPath?: string | null;
  /** Brief file used (generate action only) — tracks iteration briefs. */
  brief?: string;
  detail?: string;
}

function appendSpend(entry: SpendEntry): void {
  appendFileSync(SPEND_LOG, `${JSON.stringify(entry)}\n`);
}

function spendEntries(): SpendEntry[] {
  if (!existsSync(SPEND_LOG)) return [];
  return readFileSync(SPEND_LOG, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => {
      try {
        return JSON.parse(l) as SpendEntry;
      } catch {
        return null;
      }
    })
    .filter((e): e is SpendEntry => e !== null);
}

function loggedGenerations(): number {
  return spendEntries().filter((e) => e.action === 'generation').length;
}

function loggedFinishTasks(): number {
  return spendEntries().filter((e) => e.action === 'remesh' || e.action === 'rig').length;
}

// ---------------------------------------------------------------------------
// HTTP helpers — paid POSTs are single-shot (NEVER auto-retried); free status
// polls tolerate up to 3 consecutive transient errors
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
      transient += 1;
      if (transient > 3) throw err;
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
// Adapter contract
// ---------------------------------------------------------------------------

interface PlanCall {
  title: string;
  method: string;
  url: string;
  payload: unknown;
}

interface Plan {
  calls: PlanCall[];
  estimatedCredits: string;
  notes: string[];
}

interface GenResult {
  taskRef: string;
  credits: number | null;
  artifacts: string[];
}

interface Adapter {
  name: ProviderName;
  envKey: string;
  docs: string[];
  plan(brief: Brief, mode: Mode): Plan;
  /** Runs exactly one generation: create → poll → download. Never retries paid calls. */
  generate(brief: Brief, mode: Mode, key: string, outDir: string): Promise<GenResult>;
}

// ---------------------------------------------------------------------------
// Meshy adapter
//
// API shape verified against public docs, accessed 2026-08-20:
//   https://docs.meshy.ai/en/api/text-to-3d   (POST/GET /openapi/v2/text-to-3d,
//     mode preview|refine, prompt ≤600 chars, topology quad|triangle,
//     target_polycount 100–300000, pose_mode a-pose|t-pose|"", enable_pbr,
//     texture_resolution 2k, statuses PENDING/IN_PROGRESS/SUCCEEDED/FAILED/CANCELED,
//     model_urls.glb, consumed_credits)
//   https://docs.meshy.ai/en/api/image-to-3d  (POST/GET /openapi/v1/image-to-3d,
//     image_url accepts base64 data URIs, should_texture, enable_pbr,
//     texture_prompt ≤600 chars)
//   https://www.meshy.ai/tutorials/meshy-credits-guide (mesh 20 cr + texture 10 cr;
//     Pro = 1,000 cr/mo at $20)
// Auth: Authorization: Bearer $MESHY_API_KEY
// ---------------------------------------------------------------------------

const MESHY_BASE = 'https://api.meshy.ai';

/** Free status polling shared by every Meshy task family (generate/remesh/rig). */
async function pollMeshyTask(base: string, id: string, headers: Record<string, string>): Promise<any> {
  const start = Date.now();
  for (;;) {
    const task = await pollJson(() => oneShotJson(`${base}/${id}`, { headers }));
    console.log(`[bakeoff] meshy ${id}: ${task.status} ${task.progress ?? 0}%`);
    if (task.status === 'SUCCEEDED') return task;
    if (['FAILED', 'CANCELED'].includes(task.status)) {
      throw new Error(`meshy task ${id} ended ${task.status}: ${JSON.stringify(task.task_error ?? {})}`);
    }
    if (Date.now() - start > POLL_TIMEOUT_MS) throw new Error(`meshy task ${id} poll timeout`);
    await sleep(10_000);
  }
}

const meshy: Adapter = {
  name: 'meshy',
  envKey: 'MESHY_API_KEY',
  docs: [
    'https://docs.meshy.ai/en/api/text-to-3d',
    'https://docs.meshy.ai/en/api/image-to-3d',
    'https://docs.meshy.ai/en/api/remesh',
    'https://docs.meshy.ai/en/api/rigging-and-animation',
  ],

  plan(brief, mode) {
    const poseMode = CHASSIS[brief.fighter] === 'humanoid' ? 'a-pose' : '';
    if (mode === 'image') {
      const sheet = sheetPath(brief.fighter, 'quarter');
      return {
        calls: [
          {
            title: 'create image-to-3D task',
            method: 'POST',
            url: `${MESHY_BASE}/openapi/v1/image-to-3d`,
            payload: {
              image_url: `<base64 data URI of ${sheet} (${sheetStatus(sheet)})>`,
              ai_model: 'latest',
              should_texture: true,
              enable_pbr: true,
              texture_resolution: '2k',
              texture_prompt: brief.combined,
              should_remesh: true,
              topology: 'quad',
              target_polycount: 40000,
              pose_mode: poseMode,
              target_formats: ['glb'],
            },
          },
          {
            title: 'poll until SUCCEEDED, then download model_urls.glb',
            method: 'GET',
            url: `${MESHY_BASE}/openapi/v1/image-to-3d/{id}`,
            payload: null,
          },
        ],
        estimatedCredits: '~40 cr (mesh 20 + texture 10 + texture_prompt 10; docs 2026-08-20) ≈ $0.80 at Pro',
        notes: ['image_url is a base64 data URI — no hosting needed for Meshy'],
      };
    }
    return {
      calls: [
        {
          title: 'create text-to-3D PREVIEW task',
          method: 'POST',
          url: `${MESHY_BASE}/openapi/v2/text-to-3d`,
          payload: {
            mode: 'preview',
            prompt: brief.combined,
            ai_model: 'latest',
            should_remesh: true,
            topology: 'quad',
            target_polycount: 40000,
            pose_mode: poseMode,
            target_formats: ['glb'],
          },
        },
        {
          title: 'create REFINE task (textures) after preview succeeds',
          method: 'POST',
          url: `${MESHY_BASE}/openapi/v2/text-to-3d`,
          payload: {
            mode: 'refine',
            preview_task_id: '<id from preview>',
            enable_pbr: true,
            texture_resolution: '2k',
            target_formats: ['glb'],
          },
        },
        {
          title: 'poll each until SUCCEEDED, then download model_urls.glb',
          method: 'GET',
          url: `${MESHY_BASE}/openapi/v2/text-to-3d/{id}`,
          payload: null,
        },
      ],
      estimatedCredits: '~30 cr (preview 20 + refine 10; docs 2026-08-20) ≈ $0.60 at Pro',
      notes: ['no separate negative-prompt field in v2 — negatives ride inside the prompt ("Avoid: …")'],
    };
  },

  async generate(brief, mode, key, outDir) {
    const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
    const poseMode = CHASSIS[brief.fighter] === 'humanoid' ? 'a-pose' : '';

    const pollTask = (base: string, id: string): Promise<any> => pollMeshyTask(base, id, headers);

    let finalTask: any;
    let credits = 0;
    let taskRef: string;

    if (mode === 'image') {
      const created = await oneShotJson(`${MESHY_BASE}/openapi/v1/image-to-3d`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          image_url: sheetDataUri(sheetPath(brief.fighter, 'quarter')),
          ai_model: 'latest',
          should_texture: true,
          enable_pbr: true,
          texture_resolution: '2k',
          texture_prompt: brief.combined,
          should_remesh: true,
          topology: 'quad',
          target_polycount: 40000,
          pose_mode: poseMode,
          target_formats: ['glb'],
        }),
      });
      taskRef = created.result;
      finalTask = await pollTask(`${MESHY_BASE}/openapi/v1/image-to-3d`, taskRef);
      credits = finalTask.consumed_credits ?? 0;
    } else {
      const preview = await oneShotJson(`${MESHY_BASE}/openapi/v2/text-to-3d`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          mode: 'preview',
          prompt: brief.combined,
          ai_model: 'latest',
          should_remesh: true,
          topology: 'quad',
          target_polycount: 40000,
          pose_mode: poseMode,
          target_formats: ['glb'],
        }),
      });
      const previewTask = await pollTask(`${MESHY_BASE}/openapi/v2/text-to-3d`, preview.result);
      credits += previewTask.consumed_credits ?? 0;
      const refine = await oneShotJson(`${MESHY_BASE}/openapi/v2/text-to-3d`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          mode: 'refine',
          preview_task_id: preview.result,
          enable_pbr: true,
          texture_resolution: '2k',
          target_formats: ['glb'],
        }),
      });
      taskRef = refine.result;
      finalTask = await pollTask(`${MESHY_BASE}/openapi/v2/text-to-3d`, taskRef);
      credits += finalTask.consumed_credits ?? 0;
    }

    const artifacts: string[] = [];
    writeFileSync(join(outDir, `${taskRef}.meta.json`), JSON.stringify(finalTask, null, 2));
    artifacts.push(join(outDir, `${taskRef}.meta.json`));
    if (finalTask.model_urls?.glb) {
      const glb = join(outDir, `${taskRef}.glb`);
      await downloadTo(finalTask.model_urls.glb, glb);
      artifacts.push(glb);
    }
    if (finalTask.thumbnail_url) {
      const thumb = join(outDir, `${taskRef}.thumbnail.png`);
      await downloadTo(finalTask.thumbnail_url, thumb);
      artifacts.push(thumb);
    }
    return { taskRef, credits, artifacts };
  },
};

// ---------------------------------------------------------------------------
// Meshy finish pipeline — remesh (retopo/polycount) then auto-rig
//
// Round-1 text-to-3D outputs came back ~72–77k tris and unrigged (GLB parse),
// against a ≤40k budget and a rig-usability rubric line. Meshy exposes both
// fixes as separate paid tasks that take an existing task id.
//
// API shape verified against public docs, accessed 2026-08-21:
//   https://docs.meshy.ai/en/api/remesh
//     (POST/GET /openapi/v1/remesh; exactly one of input_task_id — a completed
//      Text/Image-to-3D task — or model_url; target_formats subset of
//      glb|fbx|obj|usdz|blend|stl|3mf (default ["glb"]); topology
//      quad|triangle (default triangle); target_polycount 100–300,000
//      (default 30,000); create returns { result: "<task-id>" }; statuses
//      PENDING/IN_PROGRESS/SUCCEEDED/FAILED; task carries model_urls +
//      consumed_credits; credits refunded on failure)
//   https://docs.meshy.ai/en/api/rigging-and-animation
//     (POST/GET /openapi/v1/rigging; exactly one of input_task_id or
//      model_url — public URL or data URI of a .glb; height_meters (number,
//      default 1.7, must be positive); optional texture_image_url;
//      result.rigged_character_glb_url / rigged_character_fbx_url +
//      result.basic_animations (walking/running, GLB+FBX);
//      CONSTRAINT quoted from the docs: "programmatic rigging currently only
//      works well with standard humanoid (bipedal) assets" — unsupported:
//      non-humanoid assets, untextured meshes, unclear limb/body structure,
//      >300k faces, models not facing +Z. For this bake-off that means ONLY
//      ember-ronin (humanoid) is auto-riggable; razorback (quadruped) and
//      orrin (floating robe) must be scored on external riggability
//      (Blender/AccuRIG), same as the Rodin path.)
//   https://docs.meshy.ai/en/api/pricing (accessed 2026-08-21: Remesh 5 cr,
//      Auto-Rigging 5 cr, Animation 3 cr)
// ---------------------------------------------------------------------------

const REMESH_ESTIMATE = '5 cr (https://docs.meshy.ai/en/api/pricing, 2026-08-21) ≈ $0.10 at Pro';
const RIG_ESTIMATE = '5 cr auto-rigging (https://docs.meshy.ai/en/api/pricing, 2026-08-21) ≈ $0.10 at Pro';

interface FinishOpts {
  taskRef: string;
  targetPolycount: number;
  topology: 'quad' | 'triangle';
  heightMeters: number;
}

/** Locate which fighter's results dir holds artifacts for a task ref. */
function findMeshyTask(taskRef: string): { fighter: Fighter; dir: string } | null {
  for (const f of FIGHTERS) {
    const dir = join(RESULTS_DIR, 'meshy', f);
    if (!existsSync(dir)) continue;
    if (readdirSync(dir).some((name) => name.startsWith(taskRef))) return { fighter: f, dir };
  }
  return null;
}

function meshyRemeshPlan(opts: FinishOpts): Plan {
  return {
    calls: [
      {
        title: 'create remesh task from a completed generation',
        method: 'POST',
        url: `${MESHY_BASE}/openapi/v1/remesh`,
        payload: {
          input_task_id: opts.taskRef,
          target_formats: ['glb'],
          topology: opts.topology,
          target_polycount: opts.targetPolycount,
        },
      },
      {
        title: 'poll until SUCCEEDED, then download model_urls.glb as <taskRef>.remesh.glb',
        method: 'GET',
        url: `${MESHY_BASE}/openapi/v1/remesh/{id}`,
        payload: null,
      },
    ],
    estimatedCredits: REMESH_ESTIMATE,
    notes: [
      'input_task_id must be a COMPLETED Meshy text/image-to-3D task id (the taskRef in spend-log/results)',
      `target_polycount ${opts.targetPolycount} leaves headroom under the 40k-tri budget (docs range 100–300,000)`,
      'output lands alongside the original as <taskRef>.remesh.glb; meta keeps the remesh task id for the rig step',
    ],
  };
}

function meshyRigPlan(opts: FinishOpts, located: { fighter: Fighter; dir: string } | null): Plan {
  const remeshGlb = located ? join(located.dir, `${opts.taskRef}.remesh.glb`) : null;
  const useLocalRemesh = remeshGlb !== null && existsSync(remeshGlb);
  const payload = useLocalRemesh
    ? {
        model_url: `<base64 data URI of ${remeshGlb} (${sheetStatus(remeshGlb)})>`,
        height_meters: opts.heightMeters,
      }
    : { input_task_id: opts.taskRef === '<taskRef>' ? '<taskRef of a completed Meshy task>' : opts.taskRef, height_meters: opts.heightMeters };
  return {
    calls: [
      {
        title: `create auto-rig task (${useLocalRemesh ? 'from local remeshed GLB via data URI' : 'from task id — remesh first for a budget-fit rig'})`,
        method: 'POST',
        url: `${MESHY_BASE}/openapi/v1/rigging`,
        payload,
      },
      {
        title: 'poll until SUCCEEDED, then download result.rigged_character_{glb,fbx}_url as <taskRef>.rigged.<ext>',
        method: 'GET',
        url: `${MESHY_BASE}/openapi/v1/rigging/{id}`,
        payload: null,
      },
    ],
    estimatedCredits: RIG_ESTIMATE,
    notes: [
      'DOCS CONSTRAINT: "programmatic rigging currently only works well with standard humanoid (bipedal) assets"',
      'bake-off applicability: ember-ronin (humanoid) YES; razorback (quadruped) NO; orrin (floating robe) NO —',
      '  the two non-humanoids are scored on EXTERNAL riggability (Blender/AccuRIG), like the Rodin path',
      'basic walking/running animations come back free with the rig (result.basic_animations) and are downloaded too',
    ],
  };
}

async function meshyRemesh(opts: FinishOpts, key: string, dir: string): Promise<GenResult> {
  const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const created = await oneShotJson(`${MESHY_BASE}/openapi/v1/remesh`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      input_task_id: opts.taskRef,
      target_formats: ['glb'],
      topology: opts.topology,
      target_polycount: opts.targetPolycount,
    }),
  });
  const remeshId: string = created.result;
  if (!remeshId) throw new Error(`meshy remesh create returned no id: ${JSON.stringify(created).slice(0, 300)}`);
  const finalTask = await pollMeshyTask(`${MESHY_BASE}/openapi/v1/remesh`, remeshId, headers);

  const artifacts: string[] = [];
  // Meta first — it carries the remesh task id the rig step chains from.
  const metaPath = join(dir, `${opts.taskRef}.remesh.meta.json`);
  writeFileSync(metaPath, JSON.stringify(finalTask, null, 2));
  artifacts.push(metaPath);
  if (finalTask.model_urls?.glb) {
    const glb = join(dir, `${opts.taskRef}.remesh.glb`);
    await downloadTo(finalTask.model_urls.glb, glb);
    artifacts.push(glb);
  }
  return { taskRef: remeshId, credits: finalTask.consumed_credits ?? null, artifacts };
}

async function meshyRig(opts: FinishOpts, key: string, dir: string): Promise<GenResult> {
  const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  // Prefer the local remeshed GLB (docs: model_url accepts a data URI to a
  // .glb) so the rig lands on the budget-fit mesh; otherwise rig the original
  // generation by task id.
  const remeshGlb = join(dir, `${opts.taskRef}.remesh.glb`);
  const body = existsSync(remeshGlb)
    ? {
        model_url: `data:model/gltf-binary;base64,${readFileSync(remeshGlb).toString('base64')}`,
        height_meters: opts.heightMeters,
      }
    : { input_task_id: opts.taskRef, height_meters: opts.heightMeters };
  if (!existsSync(remeshGlb)) {
    console.log(`[bakeoff] no ${opts.taskRef}.remesh.glb found — rigging the ORIGINAL (possibly over-budget) mesh by task id`);
  }

  const created = await oneShotJson(`${MESHY_BASE}/openapi/v1/rigging`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const rigId: string = created.result;
  if (!rigId) throw new Error(`meshy rigging create returned no id: ${JSON.stringify(created).slice(0, 300)}`);
  const finalTask = await pollMeshyTask(`${MESHY_BASE}/openapi/v1/rigging`, rigId, headers);

  const artifacts: string[] = [];
  const metaPath = join(dir, `${opts.taskRef}.rigged.meta.json`);
  writeFileSync(metaPath, JSON.stringify(finalTask, null, 2));
  artifacts.push(metaPath);
  const result = finalTask.result ?? {};
  if (result.rigged_character_glb_url) {
    const glb = join(dir, `${opts.taskRef}.rigged.glb`);
    await downloadTo(result.rigged_character_glb_url, glb);
    artifacts.push(glb);
  }
  if (result.rigged_character_fbx_url) {
    const fbx = join(dir, `${opts.taskRef}.rigged.fbx`);
    await downloadTo(result.rigged_character_fbx_url, fbx);
    artifacts.push(fbx);
  }
  // basic_animations ships free with the rig (walking/running per docs); the
  // exact nesting isn't pinned in the docs, so collect any URLs defensively.
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
    const path = join(dir, `${opts.taskRef}.rigged.${safe}.${ext}`);
    await downloadTo(url, path);
    artifacts.push(path);
  }
  return { taskRef: rigId, credits: finalTask.consumed_credits ?? null, artifacts };
}

// ---------------------------------------------------------------------------
// Tripo adapter
//
// API shape verified against public docs, accessed 2026-08-20:
//   https://docs.tripo3d.ai/get-started/quick-start.html
//     (base https://api.tripo3d.ai/v2/openapi, Bearer auth,
//      POST /task, GET /task/{task_id}, poll until data.status === "success")
//   https://docs.tripo3d.ai/model-generation/text-to-model-v3-0-v3-1.html
//     (type text_to_model, prompt ≤1024, negative_prompt ≤255,
//      model_version "v3.1-20260211", texture, pbr, quad, face_limit, …)
//   https://docs.tripo3d.ai/model-generation/image-to-model-v3-0-v3-1.html
//     (type image_to_model, file:{type, url | file_token | object};
//      "url": direct JPEG/PNG URL ≤20MB)
//   https://docs.tripo3d.ai/task-query/get-your-task-result.html
//     (statuses queued/running/success/failed/banned/expired/cancelled/unknown,
//      data.output.{model,base_model,pbr_model,rendered_image};
//      download URLs EXPIRE after ~5 minutes — fetch immediately)
//   https://developers.tripo3d.ai/en/pricing (text 20 cr textured, image 30 cr
//     textured, quad +5; 1 credit = $0.01 for API billing)
// Auth: Authorization: Bearer $TRIPO_API_KEY
//
// TODO (unverifiable from public docs without an account): the direct
// local-file upload flow. docs.tripo3d.ai documents an STS flow
// (/file-upload/upload-in-sts.html: POST /upload/sts/token + AWS S3 STS
// upload, then file:{object:{bucket,key}}), which we have NOT implemented —
// it needs S3 signing that we won't write blind. Image mode here uses the
// fully documented file:{type,url} shape instead: host the concept sheets at
// any public URL (e.g. the repo's GitHub Pages) and set
// BAKEOFF_SHEETS_BASE_URL to that folder. Meshy/Rodin need no hosting.
// NOTE: a v2→v3 OpenAPI migration is advertised (v2 retirement reported as
// 2026-11-01). v2 is documented + live for the bake-off window; re-verify if
// the bake-off slips past October 2026.
// ---------------------------------------------------------------------------

const TRIPO_BASE = 'https://api.tripo3d.ai/v2/openapi';

function tripoImageUrl(fighter: Fighter): string | null {
  const base = process.env.BAKEOFF_SHEETS_BASE_URL;
  if (!base) return null;
  return `${base.replace(/\/$/, '')}/${fighter}-quarter.png`;
}

const tripo: Adapter = {
  name: 'tripo',
  envKey: 'TRIPO_API_KEY',
  docs: [
    'https://docs.tripo3d.ai/get-started/quick-start.html',
    'https://docs.tripo3d.ai/model-generation/image-to-model-v3-0-v3-1.html',
    'https://docs.tripo3d.ai/task-query/get-your-task-result.html',
  ],

  plan(brief, mode) {
    const common = {
      model_version: 'v3.1-20260211',
      texture: true,
      pbr: true,
      texture_quality: 'standard',
      quad: true,
      face_limit: 40000,
    };
    const payload =
      mode === 'image'
        ? {
            type: 'image_to_model',
            file: {
              type: 'png',
              url: tripoImageUrl(brief.fighter) ?? '<SET BAKEOFF_SHEETS_BASE_URL — public URL of the concept sheets>',
            },
            ...common,
          }
        : { type: 'text_to_model', prompt: brief.prompt, negative_prompt: brief.negative, ...common };
    return {
      calls: [
        { title: `create ${payload.type} task`, method: 'POST', url: `${TRIPO_BASE}/task`, payload },
        {
          title: 'poll until data.status === "success", then download data.output.pbr_model (URLs expire ~5 min)',
          method: 'GET',
          url: `${TRIPO_BASE}/task/{task_id}`,
          payload: null,
        },
      ],
      estimatedCredits:
        mode === 'image'
          ? '~35 cr (image+texture 30 + quad 5; docs 2026-08-20) ≈ $0.35 at API rate'
          : '~25 cr (text+texture 20 + quad 5; docs 2026-08-20) ≈ $0.25 at API rate',
      notes: [
        mode === 'image'
          ? 'needs BAKEOFF_SHEETS_BASE_URL (public https URL serving the concept-sheet PNGs); local-file STS upload flow not implemented — see TODO in adapter'
          : 'dedicated negative_prompt field — briefs pass prompt and negative separately',
        'quad:true forces FBX alongside GLB per docs; keep GLB for the Three.js check',
      ],
    };
  },

  async generate(brief, mode, key, outDir) {
    const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
    let payload: Record<string, unknown>;
    const common = {
      model_version: 'v3.1-20260211',
      texture: true,
      pbr: true,
      texture_quality: 'standard',
      quad: true,
      face_limit: 40000,
    };
    if (mode === 'image') {
      const url = tripoImageUrl(brief.fighter);
      if (!url) {
        throw new Error(
          'Tripo image mode needs BAKEOFF_SHEETS_BASE_URL (public https folder serving the concept-sheet PNGs, ' +
            'e.g. the repo GitHub Pages). Meshy/Rodin do not need this. Nothing was called, nothing was spent.',
        );
      }
      payload = { type: 'image_to_model', file: { type: 'png', url }, ...common };
    } else {
      payload = { type: 'text_to_model', prompt: brief.prompt, negative_prompt: brief.negative, ...common };
    }

    const created = await oneShotJson(`${TRIPO_BASE}/task`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    const taskRef: string = created.data?.task_id;
    if (!taskRef) throw new Error(`tripo create returned no task_id: ${JSON.stringify(created).slice(0, 300)}`);

    const start = Date.now();
    let task: any;
    for (;;) {
      const res = await pollJson(() => oneShotJson(`${TRIPO_BASE}/task/${taskRef}`, { headers }));
      task = res.data;
      console.log(`[bakeoff] tripo ${taskRef}: ${task.status} ${task.progress ?? 0}%`);
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
    // Tripo's task response does not report consumed credits — log null and
    // let the EP reconcile against the dashboard wallet.
    return { taskRef, credits: null, artifacts };
  },
};

// ---------------------------------------------------------------------------
// Rodin (Hyper3D) adapter — Gen-2.5
//
// API shape verified against public docs, accessed 2026-08-20:
//   https://docs.hyper3d.ai/en/api-specification/rodin-gen2-5
//     (POST https://api.hyper3d.com/api/v2/rodin, multipart/form-data;
//      fields: images (1–5 files, first drives materials), prompt (required if
//      no images), tier — REQUIRED, e.g. "Gen-2.5-Medium"; texture_mode;
//      response: { uuid, jobs: { uuids, subscription_key }, consumed })
//   https://docs.hyper3d.ai/en/api-specification/check-status
//     (POST /api/v2/status { subscription_key } → jobs[].status in
//      Waiting | Generating | Done | Failed)
//   https://docs.hyper3d.ai/en/api-specification/download-results
//     (POST /api/v2/download { task_uuid } → { list: [{ name, url }] };
//      URLs expire — fetch promptly)
// Auth: Authorization: Bearer $RODIN_API_KEY
//
// Notes: no documented negative-prompt field (negatives ride in the prompt);
// no auto-rig product — rig usability is scored via external rigging per the
// proposal. Docs list base cost 0.5 credits + surcharges; the response's
// `consumed` field is authoritative and is what we log.
// ---------------------------------------------------------------------------

const RODIN_BASE = 'https://api.hyper3d.com/api/v2';

const rodin: Adapter = {
  name: 'rodin',
  envKey: 'RODIN_API_KEY',
  docs: [
    'https://docs.hyper3d.ai/en/api-specification/rodin-gen2-5',
    'https://docs.hyper3d.ai/en/api-specification/check-status',
    'https://docs.hyper3d.ai/en/api-specification/download-results',
  ],

  plan(brief, mode) {
    const views: Array<'front' | 'side' | 'quarter'> = ['quarter', 'front', 'side'];
    const images =
      mode === 'image'
        ? views.map((v) => `<file: ${sheetPath(brief.fighter, v)} (${sheetStatus(sheetPath(brief.fighter, v))})>`)
        : undefined;
    return {
      calls: [
        {
          title: `create Gen-2.5 generation (${mode === 'image' ? 'image refs + prompt' : 'prompt only'})`,
          method: 'POST',
          url: `${RODIN_BASE}/rodin`,
          payload: {
            '(multipart/form-data)': true,
            ...(images ? { images } : {}),
            prompt: brief.combined,
            tier: 'Gen-2.5-Medium',
            texture_mode: 'medium',
          },
        },
        {
          title: 'poll status until every job is Done',
          method: 'POST',
          url: `${RODIN_BASE}/status`,
          payload: { subscription_key: '<jobs.subscription_key from create>' },
        },
        {
          title: 'download all result files (URLs expire — fetch promptly)',
          method: 'POST',
          url: `${RODIN_BASE}/download`,
          payload: { task_uuid: '<top-level uuid from create>' },
        },
      ],
      estimatedCredits: '~0.5–1.0 Rodin credits (docs 2026-08-20; response `consumed` is authoritative)',
      notes: [
        'style risk axis of the bake-off: Rodin is positioned photoreal/high-fidelity — the shared style prompt + image refs are the counterweight',
        'no auto-rig: score rig usability via external rigging (Blender/AccuRIG) per proposal §5 step 4',
      ],
    };
  },

  async generate(brief, mode, key, outDir) {
    const authHeaders = { Authorization: `Bearer ${key}` };
    const form = new FormData();
    if (mode === 'image') {
      for (const view of ['quarter', 'front', 'side'] as const) {
        const p = sheetPath(brief.fighter, view);
        form.append('images', new Blob([readFileSync(p)], { type: 'image/png' }), `${brief.fighter}-${view}.png`);
      }
    }
    form.append('prompt', brief.combined);
    form.append('tier', 'Gen-2.5-Medium');
    form.append('texture_mode', 'medium');

    const created = await oneShotJson(`${RODIN_BASE}/rodin`, {
      method: 'POST',
      headers: authHeaders, // fetch sets the multipart boundary itself
      body: form,
    });
    const taskRef: string = created.uuid;
    const subKey: string = created.jobs?.subscription_key;
    if (!taskRef || !subKey) throw new Error(`rodin create response unexpected: ${JSON.stringify(created).slice(0, 300)}`);

    const start = Date.now();
    for (;;) {
      const status = await pollJson(() =>
        oneShotJson(`${RODIN_BASE}/status`, {
          method: 'POST',
          headers: { ...authHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ subscription_key: subKey }),
        }),
      );
      const jobs: Array<{ status: string }> = status.jobs ?? [];
      const summary = jobs.map((j) => j.status).join(',') || 'no-jobs';
      console.log(`[bakeoff] rodin ${taskRef}: ${summary}`);
      if (jobs.some((j) => j.status === 'Failed')) throw new Error(`rodin task ${taskRef} has a Failed job`);
      if (jobs.length > 0 && jobs.every((j) => j.status === 'Done')) break;
      if (Date.now() - start > POLL_TIMEOUT_MS) throw new Error(`rodin task ${taskRef} poll timeout`);
      await sleep(15_000);
    }

    const dl = await oneShotJson(`${RODIN_BASE}/download`, {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ task_uuid: taskRef }),
    });
    const artifacts: string[] = [];
    for (const f of (dl.list ?? []).slice(0, 25)) {
      const safe = String(f.name ?? 'file').replace(/[^\w.\-]/g, '_');
      const path = join(outDir, safe);
      await downloadTo(f.url, path);
      artifacts.push(path);
    }
    writeFileSync(join(outDir, `${taskRef}.meta.json`), JSON.stringify({ created, download: dl }, null, 2));
    artifacts.push(join(outDir, `${taskRef}.meta.json`));
    return { taskRef, credits: typeof created.consumed === 'number' ? created.consumed : null, artifacts };
  },
};

const ADAPTERS: Record<ProviderName, Adapter> = { meshy, tripo, rodin };

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const ACTIONS = ['generate', 'remesh', 'rig'] as const;
type Action = (typeof ACTIONS)[number];

function parseArgs(argv: string[]) {
  const has = (f: string) => argv.includes(f);
  const val = (f: string): string | undefined => {
    const i = argv.indexOf(f);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    dryRun: has('--dry-run'),
    action: (val('--action') ?? 'generate') as Action, // default: existing behavior
    provider: val('--provider') as ProviderName | undefined,
    fighter: val('--fighter') as Fighter | undefined,
    mode: (val('--mode') ?? 'image') as Mode,
    maxGenerations: Number(val('--max-generations') ?? '1'),
    brief: val('--brief'), // generate only: iteration-brief override
    task: val('--task'), // remesh/rig: taskRef of a completed Meshy generation
    targetPolycount: Number(val('--target-polycount') ?? '38000'), // remesh (docs 100–300,000)
    topology: (val('--topology') ?? 'quad') as 'quad' | 'triangle', // remesh
    height: Number(val('--height') ?? '1.7'), // rig: height_meters (docs default 1.7)
    // rig: spend on a non-humanoid anyway (docs say humanoid-only; refused otherwise)
    forceNonHumanoid: has('--force-non-humanoid'),
  };
}

function printPlan(mode: Mode, briefFor?: Fighter, briefPath?: string): void {
  console.log('='.repeat(76));
  console.log(`BAKE-OFF DRY RUN — full plan, ${mode}-to-3D mode, NO provider network calls`);
  console.log(`(use \`--mode ${mode === 'image' ? 'text' : 'image'}\` to see the other mode)`);
  console.log('='.repeat(76));

  for (const p of PROVIDERS) {
    const a = ADAPTERS[p];
    const keySet = !!process.env[a.envKey];
    console.log(`\n### provider: ${p}  [${a.envKey}: ${keySet ? 'set' : 'NOT SET — real runs blocked'}]`);
    console.log(`    docs: ${a.docs.join('\n          ')}`);
    for (const f of FIGHTERS) {
      const brief = loadBrief(f, f === briefFor ? briefPath : undefined);
      const plan = a.plan(brief, mode);
      console.log(`\n  -- ${p} × ${f} (${CHASSIS[f]}) --------------------------------`);
      if (f === briefFor && briefPath) console.log(`     brief override: ${brief.path}`);
      console.log(`     estimated spend: ${plan.estimatedCredits}`);
      for (const note of plan.notes) console.log(`     note: ${note}`);
      for (const call of plan.calls) {
        console.log(`     ${call.method} ${call.url}   # ${call.title}`);
        if (call.payload != null) {
          const json = JSON.stringify(call.payload, null, 2)
            .split('\n')
            .map((l) => `       ${l}`)
            .join('\n');
          console.log(json);
        }
      }
    }
  }

  const total = loggedGenerations();
  console.log(`\n${'='.repeat(76)}`);
  console.log(
    `spend-log: ${total}/${TOTAL_GENERATION_CAP} generations + ${loggedFinishTasks()}/${TOTAL_FINISH_CAP} finish tasks recorded ` +
      `(${SPEND_LOG.replace(`${HERE}/`, '')})`,
  );
  console.log('No network call was made to any provider. To run ONE real generation:');
  console.log('  npm run bakeoff -- --provider <meshy|tripo|rodin> --fighter <ember-ronin|razorback|orrin> [--mode image|text]');
  console.log('Finish pipeline for a completed Meshy generation (generate → remesh → rig → score):');
  console.log('  npm run bakeoff -- --action remesh --provider meshy --task <taskRef> [--target-polycount 38000 --topology quad]');
  console.log('  npm run bakeoff -- --action rig    --provider meshy --task <taskRef> [--height 1.7]  # HUMANOID ONLY per docs');
  console.log('  (add --dry-run to either to print the exact endpoint+payload, $0)');
  console.log('  Rig constraint: Meshy auto-rig is humanoid-only → ember-ronin only; razorback/orrin need external rigging.');
  console.log('='.repeat(76));
}

function printFinishPlan(action: 'remesh' | 'rig', opts: FinishOpts): void {
  const located = opts.taskRef === '<taskRef>' ? null : findMeshyTask(opts.taskRef);
  const plan = action === 'remesh' ? meshyRemeshPlan(opts) : meshyRigPlan(opts, located);
  console.log('='.repeat(76));
  console.log(`BAKE-OFF DRY RUN — ${action} plan, NO provider network calls`);
  console.log('='.repeat(76));
  console.log(`docs: https://docs.meshy.ai/en/api/${action === 'remesh' ? 'remesh' : 'rigging-and-animation'}`);
  console.log(`      https://docs.meshy.ai/en/api/pricing`);
  console.log(`task ref: ${opts.taskRef}${located ? `  → results/meshy/${located.fighter}/ (${CHASSIS[located.fighter]})` : opts.taskRef === '<taskRef>' ? '  (pass --task <taskRef> of a completed Meshy generation)' : '  (NOT FOUND under results/meshy/*/ — check the taskRef)'}`);
  if (action === 'rig' && located && CHASSIS[located.fighter] !== 'humanoid') {
    console.log(`⚠ ${located.fighter} is ${CHASSIS[located.fighter]} — Meshy auto-rig is documented as humanoid-only; a real run will refuse. Score external riggability instead.`);
  }
  console.log(`estimated spend: ${plan.estimatedCredits}`);
  for (const note of plan.notes) console.log(`note: ${note}`);
  for (const call of plan.calls) {
    console.log(`${call.method} ${call.url}   # ${call.title}`);
    if (call.payload != null) console.log(JSON.stringify(call.payload, null, 2));
  }
  console.log('='.repeat(76));
}

/**
 * remesh / rig — the Meshy finish pipeline. Same laws as generate: one paid
 * call per invocation, spend logged BEFORE the call, no auto-retry, dry-run
 * whenever the run is under-specified or the key is missing.
 */
async function runFinishTask(args: ReturnType<typeof parseArgs>): Promise<void> {
  const action = args.action as 'remesh' | 'rig';
  if (args.provider && args.provider !== 'meshy') {
    console.error(
      `[bakeoff] --action ${action} is implemented for meshy only. Tripo/Rodin outputs are finished ` +
        'externally (Blender/AccuRIG) and scored on riggability per proposal §5 step 4.',
    );
    process.exit(1);
  }
  // Validate knobs against the documented ranges BEFORE any network thought.
  if (!Number.isFinite(args.targetPolycount) || args.targetPolycount < 100 || args.targetPolycount > 300_000) {
    console.error('[bakeoff] --target-polycount must be within 100–300000 (https://docs.meshy.ai/en/api/remesh)');
    process.exit(1);
  }
  if (!['quad', 'triangle'].includes(args.topology)) {
    console.error(`[bakeoff] unknown topology "${args.topology}" (expected: quad or triangle)`);
    process.exit(1);
  }
  if (!Number.isFinite(args.height) || args.height <= 0) {
    console.error('[bakeoff] --height (height_meters) must be positive (https://docs.meshy.ai/en/api/rigging-and-animation)');
    process.exit(1);
  }

  const opts: FinishOpts = {
    taskRef: args.task ?? '<taskRef>',
    targetPolycount: args.targetPolycount,
    topology: args.topology,
    heightMeters: args.height,
  };

  // Dry-run when asked — or when no real run is fully specified.
  if (args.dryRun || !args.task || !args.provider) {
    if (!args.dryRun && (args.task || args.provider)) {
      console.error(`[bakeoff] a real ${action} needs BOTH --provider meshy and --task <taskRef>; showing the dry-run plan instead.\n`);
    }
    printFinishPlan(action, opts);
    return;
  }

  const key = process.env[meshy.envKey];
  if (!key) {
    console.error(
      `[bakeoff] No key provisioned for meshy — set ${meshy.envKey} in the environment ` +
        '(Founder provisions keys per docs/COST_LEDGER.md D-016 pattern; see tools/bakeoff/README.md). ' +
        'Nothing was called, nothing was spent. Falling back to the dry-run plan:\n',
    );
    printFinishPlan(action, opts);
    process.exit(1);
  }

  // Finish tasks run alongside the original artifacts — locate them (this
  // also recovers the fighter for the ledger entry).
  const located = findMeshyTask(args.task);
  if (!located) {
    console.error(
      `[bakeoff] taskRef "${args.task}" not found under results/meshy/*/ — finish tasks land next to the ` +
        'original artifacts. Check spend-log.jsonl for the right taskRef. Nothing was called, nothing was spent.',
    );
    process.exit(1);
  }

  // ---- HARD SAFETY RAILS ----------------------------------------------
  const finishTotal = loggedFinishTasks();
  if (finishTotal >= TOTAL_FINISH_CAP) {
    console.error(
      `[bakeoff] REFUSING to run: spend-log already records ${finishTotal} finish tasks ` +
        `(cap ${TOTAL_FINISH_CAP} = 2 per possible generation). Get a new Founder gate before raising the cap.`,
    );
    process.exit(1);
  }
  if (action === 'rig' && CHASSIS[located.fighter] !== 'humanoid' && !args.forceNonHumanoid) {
    console.error(
      `[bakeoff] REFUSING to rig ${located.fighter} (${CHASSIS[located.fighter]}): Meshy's docs state ` +
        '"programmatic rigging currently only works well with standard humanoid (bipedal) assets" and list ' +
        'non-humanoid assets as unsupported (https://docs.meshy.ai/en/api/rigging-and-animation). ' +
        'Score razorback/orrin on EXTERNAL riggability (Blender/AccuRIG) per proposal §5 step 4. ' +
        'To spend the 5 credits anyway, pass --force-non-humanoid. Nothing was called, nothing was spent.',
    );
    process.exit(1);
  }

  const plan = action === 'remesh' ? meshyRemeshPlan(opts) : meshyRigPlan(opts, located);
  console.log(`[bakeoff] ONE ${action} task: meshy × ${located.fighter} (input task ${args.task})`);
  console.log(`[bakeoff] estimated spend: ${plan.estimatedCredits}`);
  console.log(`[bakeoff] spend-log before this run: ${finishTotal}/${TOTAL_FINISH_CAP} finish tasks`);

  // Spend record BEFORE the paid call — same conservative direction as generate.
  appendSpend({
    at: new Date().toISOString(),
    provider: 'meshy',
    fighter: located.fighter,
    action,
    taskRef: args.task,
    estimatedCredits: plan.estimatedCredits,
    credits: null,
    artifactPath: null,
  });

  try {
    const result = await (action === 'remesh' ? meshyRemesh : meshyRig)(opts, key, located.dir);
    appendSpend({
      at: new Date().toISOString(),
      provider: 'meshy',
      fighter: located.fighter,
      action: 'artifact',
      taskRef: result.taskRef,
      credits: result.credits,
      artifactPath: result.artifacts[0] ?? null,
      detail: `${action} of ${args.task}: ${result.artifacts.length} file(s)`,
    });
    console.log(`[bakeoff] DONE ${action} for ${located.fighter} (${action} task ${result.taskRef}, input ${args.task})`);
    console.log(`[bakeoff] credits reported: ${result.credits ?? 'not reported — reconcile in provider dashboard'}`);
    for (const aPath of result.artifacts) console.log(`[bakeoff]   artifact: ${aPath}`);
    console.log('[bakeoff] Remember: docs/COST_LEDGER.md is updated by the EP from spend-log.jsonl.');
  } catch (err) {
    appendSpend({
      at: new Date().toISOString(),
      provider: 'meshy',
      fighter: located.fighter,
      action: 'failed',
      taskRef: args.task,
      detail: `${action}: ${(err as Error).message.slice(0, 500)}`,
    });
    console.error(`[bakeoff] FAILED (no auto-retry, by law): ${(err as Error).message}`);
    console.error('[bakeoff] The attempt is logged in spend-log.jsonl; a human decides whether to run again.');
    process.exit(1);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!ACTIONS.includes(args.action)) {
    console.error(`[bakeoff] unknown action "${args.action}" (expected: ${ACTIONS.join(', ')})`);
    process.exit(1);
  }
  if (args.provider && !PROVIDERS.includes(args.provider)) {
    console.error(`[bakeoff] unknown provider "${args.provider}" (expected: ${PROVIDERS.join(', ')})`);
    process.exit(1);
  }
  if (args.fighter && !FIGHTERS.includes(args.fighter)) {
    console.error(`[bakeoff] unknown fighter "${args.fighter}" (expected: ${FIGHTERS.join(', ')})`);
    process.exit(1);
  }
  if (!['image', 'text'].includes(args.mode)) {
    console.error(`[bakeoff] unknown mode "${args.mode}" (expected: image or text)`);
    process.exit(1);
  }

  if (args.action !== 'generate') {
    await runFinishTask(args);
    return;
  }

  // Dry-run when asked — or when no real run is fully specified.
  if (args.dryRun || !args.provider || !args.fighter) {
    if (!args.dryRun && (args.provider || args.fighter)) {
      console.error('[bakeoff] a real run needs BOTH --provider and --fighter; showing the dry-run plan instead.\n');
    }
    printPlan(args.mode, args.fighter, args.brief);
    return;
  }

  const adapter = ADAPTERS[args.provider];
  const key = process.env[adapter.envKey];
  if (!key) {
    console.error(
      `[bakeoff] No key provisioned for ${args.provider} — set ${adapter.envKey} in the environment ` +
        '(Founder provisions keys per docs/COST_LEDGER.md D-016 pattern; see tools/bakeoff/README.md). ' +
        'Nothing was called, nothing was spent. Falling back to the dry-run plan:\n',
    );
    printPlan(args.mode, args.fighter, args.brief);
    process.exit(1);
  }

  // ---- HARD SAFETY RAILS ----------------------------------------------
  const total = loggedGenerations();
  if (total >= TOTAL_GENERATION_CAP) {
    console.error(
      `[bakeoff] REFUSING to run: spend-log already records ${total} generations ` +
        `(cap ${TOTAL_GENERATION_CAP} = 9 pairs × 5 iterations). The protocol budget is exhausted — `
        + 'take results to scoring, or get a new Founder gate before raising the cap.',
    );
    process.exit(1);
  }
  // One generation per invocation, by design; --max-generations is the
  // belt-and-suspenders guard on that invariant (default 1).
  if (!Number.isFinite(args.maxGenerations) || args.maxGenerations < 1) {
    console.error('[bakeoff] --max-generations must be ≥1 (a run performs exactly one generation)');
    process.exit(1);
  }

  const brief = loadBrief(args.fighter, args.brief);
  const outDir = join(RESULTS_DIR, args.provider, args.fighter);
  mkdirSync(outDir, { recursive: true });

  const plan = adapter.plan(brief, args.mode);
  console.log(`[bakeoff] ONE ${args.mode}-to-3D generation: ${args.provider} × ${args.fighter}`);
  console.log(`[bakeoff] brief: ${brief.path}`);
  console.log(`[bakeoff] estimated spend: ${plan.estimatedCredits}`);
  console.log(`[bakeoff] spend-log before this run: ${total}/${TOTAL_GENERATION_CAP} generations`);

  // Commit the spend record BEFORE the paid call — if the process dies midway
  // the ledger still shows the attempt (conservative in the safe direction).
  appendSpend({
    at: new Date().toISOString(),
    provider: args.provider,
    fighter: args.fighter,
    action: 'generation',
    mode: args.mode,
    estimatedCredits: plan.estimatedCredits,
    credits: null,
    artifactPath: null,
    brief: brief.path,
  });

  try {
    const result = await adapter.generate(brief, args.mode, key, outDir);
    appendSpend({
      at: new Date().toISOString(),
      provider: args.provider,
      fighter: args.fighter,
      action: 'artifact',
      mode: args.mode,
      taskRef: result.taskRef,
      credits: result.credits,
      artifactPath: result.artifacts[0] ?? null,
      brief: brief.path,
      detail: `${result.artifacts.length} file(s)`,
    });
    console.log(`[bakeoff] DONE ${args.provider} × ${args.fighter} (task ${result.taskRef})`);
    console.log(`[bakeoff] credits reported: ${result.credits ?? 'not reported — reconcile in provider dashboard'}`);
    for (const aPath of result.artifacts) console.log(`[bakeoff]   artifact: ${aPath}`);
    console.log('[bakeoff] Remember: docs/COST_LEDGER.md is updated by the EP from spend-log.jsonl.');
  } catch (err) {
    appendSpend({
      at: new Date().toISOString(),
      provider: args.provider,
      fighter: args.fighter,
      action: 'failed',
      mode: args.mode,
      detail: (err as Error).message.slice(0, 500),
    });
    console.error(`[bakeoff] FAILED (no auto-retry, by law): ${(err as Error).message}`);
    console.error('[bakeoff] The attempt is logged in spend-log.jsonl; a human decides whether to run again.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`[bakeoff] ${(err as Error).message}`);
  process.exit(1);
});
