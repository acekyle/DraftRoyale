/**
 * Custom-fighter statue forge (D-029) — on-the-spot statue parity for
 * compiled custom nominations with the Season-0 heroforge pass.
 *
 * The Season-0 heroes get a Tripo text-to-3D GLB statue (D-026) in a
 * per-realm register (D-028); custom fighters compiled live in a draft only
 * had the procedural chassis. This module gives a compiled FighterFile the
 * same treatment at nomination time: a brief is derived from its Character
 * Contract (canon summary + compiler silhouette + palette + a hash-picked
 * realm register), one Tripo generation runs, and the accepted GLB+portrait
 * land in apps/web/public/custom-heroes/ where the client swaps them in
 * exactly like season statues. No rubric pass — customs are experimental and
 * the procedural chassis remains the guaranteed floor everywhere.
 *
 * Deliberately mirrors the Tripo client in run.ts instead of refactoring it:
 * the production CLI is frozen post-D-028; the ~60 duplicated lines are the
 * cheaper risk. Keep the two in sync if the Tripo API shape ever changes.
 *
 * SPENDING LAWS (constitution §Spending, same as run.ts):
 *  - Key ONLY from env var TRIPO_API_KEY. No key → ForgeError('no-key').
 *  - Exactly ONE paid call per forge. Spend logged BEFORE the call.
 *  - Paid calls are NEVER auto-retried; failures are logged, a human decides.
 *  - HARD cap: 12 custom generations (~$2.40 at ~20 cr ≈ $0.20 each),
 *    counted from the shared spend log (fighter field `custom:<id>`).
 */
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const SPEND_LOG = join(HERE, 'spend-log.jsonl');
const RESULTS_DIR = join(HERE, 'results', 'custom');
const PUBLIC_DIR = join(ROOT, 'apps', 'web', 'public', 'custom-heroes');

export const CUSTOM_GENERATION_CAP = 12;
const POLL_TIMEOUT_MS = 25 * 60 * 1000;
const FIGHTER_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Structural subset of @arena/contracts FighterFile — kept local so this
 *  module bundles into vite.config without workspace alias resolution. */
export interface ForgeFighterFile {
  contract: { identity: { displayName: string }; canon: { summary: string } };
  dna: {
    identity: { fighterId: string; chassis: string; scale?: number };
    presentation: { primaryColor: string; secondaryColor: string; energyColor: string; silhouette?: string };
  };
}

export class ForgeError extends Error {
  constructor(public reason: 'no-key' | 'cap' | 'bad-fighter' | 'provider', message: string) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Brief derivation — Character Contract → Tripo prompt in a D-028 register
// ---------------------------------------------------------------------------

/** Same FNV-1a as apps/web heroMeshes.hashFighterId — one identity, one roll. */
function hashFighterId(id: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** The four D-028 realm registers — style sentences verbatim from the
 *  accepted styleprobe briefs so customs land inside a proven register. */
const REALMS = [
  { key: 'comic', from: 'a bold comic-book universe', style: 'Bold comic-book superhero style: strong graphic shapes, confident heroic proportions, crisp cel-inked panel look with clean PBR materials, saturated colors.' },
  { key: 'animated', from: 'a whimsical animated-film universe', style: 'Feature-animation style: soft appealing rounded forms, expressive shape language, warm clean PBR materials, animated-film charm.' },
  { key: 'anime', from: 'a dark anime universe', style: 'Anime action style: sharp stylized forms, clean cel-shaded look with PBR accents, dynamic heroic proportions, expressive silhouette.' },
  { key: 'cinematic', from: 'a dark cinematic fantasy universe', style: 'Cinematic film-CG style: detailed grounded materials, dramatic wear, moody presence, realistic-stylized proportions.' },
] as const;

const CHASSIS_STANCE: Record<string, string> = {
  humanoid: 'Athletic humanoid superhero build, upright heroic stance',
  heavy: 'Massive heavy biped bruiser, broad shoulders, long heavy arms, upright stance',
  quadruped: 'Powerful quadruped, heavy chest, low head, four-legged predatory stance',
  floating: 'Levitating figure floating upright with no ground contact, no legs touching down',
};

const NEGATIVE = 'style drift, photoreal, flat toon, text, logos, watermark, base, pedestal, background, extra limbs, duplicate figures';

/** First sentence(s) of the canon summary, capped without cutting a word. */
function summaryLead(summary: string, cap = 300): string {
  const sentences = summary.split(/(?<=[.!?])\s+/);
  let out = '';
  for (const s of sentences) {
    if (out && (out + ' ' + s).length > cap) break;
    out = out ? `${out} ${s}` : s;
    if (out.length > cap) break;
  }
  return out.slice(0, cap + 40);
}

export function realmForFighter(fighterId: string) {
  return REALMS[hashFighterId(fighterId) % REALMS.length];
}

export function briefFromFighter(file: ForgeFighterFile): { prompt: string; negative: string; realm: string } {
  const { dna, contract } = file;
  const realm = realmForFighter(dna.identity.fighterId);
  const stance = CHASSIS_STANCE[dna.identity.chassis] ?? CHASSIS_STANCE.humanoid;
  const p = dna.presentation;
  const parts = [
    `${contract.identity.displayName}, from ${realm.from}. ${summaryLead(contract.canon.summary)}`,
    p.silhouette ? `${p.silhouette}.` : '',
    `${stance}.`,
    `Colors: primary ${p.primaryColor}, secondary ${p.secondaryColor}, energy glow ${p.energyColor}.`,
    realm.style,
    'Game-ready, full body, single figure, strong black-profile silhouette.',
  ];
  let prompt = parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  if (prompt.length > 1024) prompt = `${prompt.slice(0, 1021)}...`; // Tripo hard limit
  return { prompt, negative: NEGATIVE, realm: realm.key };
}

// ---------------------------------------------------------------------------
// Spend log (shared with run.ts — same file, same entry shape)
// ---------------------------------------------------------------------------

interface SpendEntry {
  at: string;
  provider: 'tripo';
  fighter: string;
  action: 'generation' | 'artifact' | 'failed';
  taskRef?: string;
  credits?: number | null;
  estimatedCredits?: string;
  artifactPath?: string | null;
  brief?: string;
  detail?: string;
}

const appendSpend = (e: SpendEntry) => appendFileSync(SPEND_LOG, `${JSON.stringify(e)}\n`);

function customGenerationCount(): number {
  if (!existsSync(SPEND_LOG)) return 0;
  return readFileSync(SPEND_LOG, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .flatMap((l) => {
      try { return [JSON.parse(l) as SpendEntry]; } catch { return []; }
    })
    .filter((e) => e.action === 'generation' && e.fighter.startsWith('custom:')).length;
}

// ---------------------------------------------------------------------------
// Tripo client (mirrors run.ts — see header)
// ---------------------------------------------------------------------------

const TRIPO_BASE = 'https://api.tripo3d.ai/v2/openapi';
const GEN_ESTIMATE = '~20 cr (text+texture, triangle topology; developers.tripo3d.ai/en/pricing) ≈ $0.20 at API rate';

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
// Availability + manifest
// ---------------------------------------------------------------------------

export function customForgeAvailability(): { hasKey: boolean; remaining: number } {
  return {
    hasKey: !!process.env.TRIPO_API_KEY,
    remaining: Math.max(0, CUSTOM_GENERATION_CAP - customGenerationCount()),
  };
}

export function hasCustomStatue(fighterId: string): boolean {
  return FIGHTER_ID_RE.test(fighterId) && existsSync(join(PUBLIC_DIR, `${fighterId}.glb`));
}

function rebuildCustomManifest(): void {
  mkdirSync(PUBLIC_DIR, { recursive: true });
  const ids = readdirSync(PUBLIC_DIR)
    .filter((n) => n.endsWith('.glb'))
    .map((n) => n.replace(/\.glb$/, ''))
    .sort();
  writeFileSync(join(PUBLIC_DIR, 'manifest.json'), `${JSON.stringify(ids, null, 2)}\n`);
}

// ---------------------------------------------------------------------------
// Forge — one paid generation, artifacts promoted straight to the client
// ---------------------------------------------------------------------------

export async function forgeCustomStatue(
  file: ForgeFighterFile,
  log: (msg: string) => void = (m) => console.log(m),
): Promise<{ taskRef: string; glbPath: string; realm: string }> {
  const id = file?.dna?.identity?.fighterId;
  if (!id || !FIGHTER_ID_RE.test(id)) throw new ForgeError('bad-fighter', `invalid fighterId: ${JSON.stringify(id)}`);
  if (typeof file.contract?.canon?.summary !== 'string' || typeof file.contract?.identity?.displayName !== 'string') {
    throw new ForgeError('bad-fighter', `${id}: fighter file is missing contract canon/identity`);
  }
  const key = process.env.TRIPO_API_KEY;
  if (!key) throw new ForgeError('no-key', 'TRIPO_API_KEY not set — forge disabled, procedural chassis stands');
  if (customGenerationCount() >= CUSTOM_GENERATION_CAP) {
    throw new ForgeError('cap', `custom generation cap reached (${CUSTOM_GENERATION_CAP}) — raise via Founder gate only`);
  }

  const brief = briefFromFighter(file);
  const outDir = join(RESULTS_DIR, id);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'brief.json'), JSON.stringify(brief, null, 2));

  // Spend logged BEFORE the paid call, by law.
  appendSpend({
    at: new Date().toISOString(),
    provider: 'tripo',
    fighter: `custom:${id}`,
    action: 'generation',
    estimatedCredits: GEN_ESTIMATE,
    credits: null,
    artifactPath: null,
    brief: join(outDir, 'brief.json'),
    detail: `custom nomination, realm ${brief.realm}`,
  });

  const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  let taskRef: string;
  let task: any;
  try {
    const created = await oneShotJson(`${TRIPO_BASE}/task`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        type: 'text_to_model',
        prompt: brief.prompt,
        negative_prompt: brief.negative,
        model_version: 'v3.1-20260211',
        texture: true,
        pbr: true,
        texture_quality: 'standard',
        face_limit: 40000,
      }),
    });
    taskRef = created.data?.task_id;
    if (!taskRef) throw new Error(`tripo create returned no task_id: ${JSON.stringify(created).slice(0, 300)}`);

    const start = Date.now();
    for (;;) {
      const res = await pollJson(() => oneShotJson(`${TRIPO_BASE}/task/${taskRef}`, { headers }));
      task = res.data;
      log(`[custom-forge] tripo ${taskRef}: ${task.status} ${task.progress ?? 0}%`);
      if (task.status === 'success') break;
      if (['failed', 'banned', 'expired', 'cancelled', 'unknown'].includes(task.status)) {
        throw new Error(`tripo task ${taskRef} ended ${task.status}`);
      }
      if (Date.now() - start > POLL_TIMEOUT_MS) throw new Error(`tripo task ${taskRef} poll timeout`);
      await sleep(10_000);
    }
  } catch (err) {
    appendSpend({
      at: new Date().toISOString(),
      provider: 'tripo',
      fighter: `custom:${id}`,
      action: 'failed',
      detail: String(err instanceof Error ? err.message : err).slice(0, 400),
    });
    throw err instanceof ForgeError ? err : new ForgeError('provider', String(err instanceof Error ? err.message : err));
  }

  // Output URLs expire in ~5 minutes — download immediately, meta last.
  const out = task.output ?? {};
  const modelUrl: string | undefined = out.pbr_model ?? out.model ?? out.base_model;
  if (!modelUrl) throw new ForgeError('provider', `tripo task ${taskRef} succeeded but returned no model URL`);
  const resultGlb = join(outDir, `${taskRef}.glb`);
  await downloadTo(modelUrl, resultGlb);
  const artifacts = [resultGlb];
  if (out.rendered_image) {
    const render = join(outDir, `${taskRef}.render.webp`);
    await downloadTo(out.rendered_image, render);
    artifacts.push(render);
  }
  writeFileSync(join(outDir, `${taskRef}.meta.json`), JSON.stringify(task, null, 2));

  // Auto-promote (no rubric — experimental content, procedural floor stands).
  mkdirSync(PUBLIC_DIR, { recursive: true });
  const glbPath = join(PUBLIC_DIR, `${id}.glb`);
  copyFileSync(resultGlb, glbPath);
  const render = join(outDir, `${taskRef}.render.webp`);
  if (existsSync(render)) copyFileSync(render, join(PUBLIC_DIR, `${id}.webp`));
  rebuildCustomManifest();

  appendSpend({
    at: new Date().toISOString(),
    provider: 'tripo',
    fighter: `custom:${id}`,
    action: 'artifact',
    taskRef,
    credits: null,
    artifactPath: glbPath,
    detail: `${artifacts.length + 1} file(s), promoted to custom-heroes`,
  });
  log(`[custom-forge] ${id}: statue live at ${glbPath}`);
  return { taskRef, glbPath, realm: brief.realm };
}
