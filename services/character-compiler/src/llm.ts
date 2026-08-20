/**
 * LLM-backed character compilation (Founder Gate 2, approved 2026-08-19).
 *
 * Architecture (ADR-0009): the model performs INTERPRETATION only — it emits a
 * bounded CompileSpec overlay (families, attributes, weaknesses, narrative,
 * disclosures) which is merged onto the deterministic parser's base spec and
 * assembled by the SAME assembler and validators as the rule-based path. The
 * safe-rules law holds mechanically: the LLM never authors runtime mechanics,
 * and any failure falls back to the deterministic compiler.
 *
 * SERVER-ONLY module: imported via the "@arena/character-compiler/llm" subpath
 * by the control plane. The web client must never import this file (it would
 * pull the Anthropic SDK into the browser bundle — and keys never ship to
 * browsers).
 */
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import type { CompiledFighterResult, DamageType, Weakness } from '@arena/contracts';
import { validateFighter, hasErrors } from '@arena/contracts';
import { assemble, parseDescription, type CompileSpec } from './compile';
import { FAMILY_KEYS } from './families';
import { applySemanticCorrection } from './index';

const MODEL = 'claude-opus-5';

export function llmAvailable(): boolean {
  return typeof process !== 'undefined' && !!process.env.ANTHROPIC_API_KEY;
}

// ---------------------------------------------------------------------------
// Spend accounting (constitution §51 unit economics; surfaced in COST_LEDGER)
// ---------------------------------------------------------------------------

const spend = { calls: 0, inputTokens: 0, outputTokens: 0 };
export function llmSpendSummary() {
  const cost = (spend.inputTokens * 5 + spend.outputTokens * 25) / 1_000_000;
  return { ...spend, estimatedUsd: Math.round(cost * 10000) / 10000 };
}
function recordUsage(kind: string, usage: { input_tokens: number; output_tokens: number }) {
  spend.calls += 1;
  spend.inputTokens += usage.input_tokens;
  spend.outputTokens += usage.output_tokens;
  const s = llmSpendSummary();
  console.log(`[llm] ${kind}: in=${usage.input_tokens} out=${usage.output_tokens} | session total ~$${s.estimatedUsd}`);
}

// ---------------------------------------------------------------------------
// Output schema — a bounded interpretation overlay, never raw mechanics.
// ---------------------------------------------------------------------------

const ATTR_KEYS = [
  'forceOutput', 'durability', 'combatSpeed', 'reactionSpeed', 'travelSpeed', 'precision',
  'mobility', 'recovery', 'perception', 'combatSkill', 'tacticalIntelligence', 'teamwork', 'resolve',
] as const;
const DAMAGE_TYPES = ['kinetic', 'energy', 'thermal', 'psychic', 'magic', 'toxic', 'sonic'] as const;
const CONSTRAINTS = [
  'never_abandons_allies', 'never_retreats', 'protects_captain', 'avoids_lethal_force', 'hunts_strongest', 'reckless',
] as const;

const FighterSpecSchema = z.object({
  displayName: z.string(),
  summary: z.string(),
  familyKeys: z.array(z.string()).min(1).max(2),
  chassis: z.enum(['humanoid', 'heavy', 'quadruped', 'floating']),
  scale: z.number(),
  role: z.enum(['vanguard', 'defender', 'bruiser', 'skirmisher', 'artillery', 'controller', 'support', 'tactician']),
  movement: z.array(z.enum(['ground', 'flight', 'hover', 'leap', 'blink', 'sprint'])).min(1).max(3),
  attrs: z.object(Object.fromEntries(ATTR_KEYS.map((k) => [k, z.number()])) as Record<(typeof ATTR_KEYS)[number], z.ZodNumber>),
  weaknesses: z.array(z.object({
    description: z.string(),
    severity: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    damageTypes: z.array(z.enum(DAMAGE_TYPES)),
    abilityTags: z.array(z.string()),
    envTags: z.array(z.string()),
  })).min(2).max(4),
  constraints: z.array(z.enum(CONSTRAINTS)).max(3),
  transformed: z.boolean(),
  creatorFacts: z.array(z.string()),
  assumptions: z.array(z.string()),
  normalizations: z.array(z.string()),
  confidence: z.enum(['high', 'medium', 'low']),
});
type LlmFighterSpec = z.infer<typeof FighterSpecSchema>;

function systemPrompt(): string {
  return `You are the character compiler for Infinite Arena, a deterministic draft-battle game. A creator typed a fighter description; you interpret it faithfully into a bounded compile spec. Accuracy to the creator's fiction is your highest duty — never silently change what they described.

Rules:
- familyKeys: choose 1-2 from exactly this list (primary first): ${FAMILY_KEYS.join(', ')}. These select the authored ability kit.
- attrs: thirteen integers 1-10. 5-6 is a trained human; 8+ is elite. The Enhanced division caps the total at 78 — distribute to match the fiction's emphasis, not everything high.
- weaknesses: at least 2 REAL counterplay vectors derived from the fiction (elemental opposition, structural frailty, dependency). Use damageTypes/abilityTags/envTags as trigger vectors; use [] for unused vectors. abilityTags/envTags should be lowercase single words (e.g. "hydro", "sonic", "emp", "darkness", "water_present").
- Unbounded claims ("invincible", "instantly kills", "always wins") are NEVER granted: compile the closest bounded version and record what you changed in normalizations.
- Protected characters (any recognizable IP) and real people: set transformed=true, create an ORIGINAL inspired archetype with a new name, and state plainly in normalizations that this is an original transformed interpretation, not the requested character.
- creatorFacts: facts the creator explicitly stated. assumptions: everything you inferred. Be exhaustive — this is the provenance record.
- summary: 2-3 sentences of canon written from the creator's description, treating it as primary-source lore.
- displayName: honor an explicit name ("named X", "called X"); otherwise invent one fitting the fiction.
- constraints: only when the fiction clearly implies them.`;
}

// ---------------------------------------------------------------------------

function makeClient(): Anthropic {
  return new Anthropic({ timeout: 45_000, maxRetries: 1 });
}

function overlayToSpec(base: CompileSpec, llm: LlmFighterSpec): CompileSpec {
  const familyKeys = llm.familyKeys.filter((k) => FAMILY_KEYS.includes(k)).slice(0, 2);
  // Attribute clamp + division soft-cap (sum ≤ 78), enforced regardless of model output.
  const attrs: Record<string, number> = {};
  for (const k of ATTR_KEYS) attrs[k] = Math.max(1, Math.min(10, Math.round(llm.attrs[k] ?? 5)));
  const sum = Object.values(attrs).reduce((a, b) => a + b, 0);
  const normalizations = [...llm.normalizations];
  if (sum > 78) {
    const f = 78 / sum;
    for (const k of ATTR_KEYS) attrs[k] = Math.max(1, Math.min(10, Math.round(attrs[k] * f)));
    normalizations.push('attribute total normalized to the Enhanced division cap (78)');
  }
  const weaknesses: Weakness[] = llm.weaknesses.map((w, i) => ({
    id: `llm-weakness-${i + 1}`,
    description: w.description,
    severity: w.severity,
    trigger: {
      ...(w.damageTypes.length ? { damageTypes: w.damageTypes as DamageType[] } : {}),
      ...(w.abilityTags.length ? { abilityTags: w.abilityTags } : {}),
      ...(w.envTags.length ? { envTags: w.envTags } : {}),
    },
    effect: {},
    evidence: 'creator description (LLM interpretation)',
  })).filter((w) => w.trigger.damageTypes || w.trigger.abilityTags || w.trigger.envTags);

  return {
    ...base,
    displayName: llm.displayName.slice(0, 40) || base.displayName,
    familyKeys: familyKeys.length ? familyKeys : base.familyKeys,
    chassis: llm.chassis,
    scale: Math.max(0.8, Math.min(1.6, llm.scale)),
    role: llm.role,
    movement: [...new Set(llm.movement)],
    attrs: attrs as CompileSpec['attrs'],
    weaknesses: weaknesses.length >= 2 ? weaknesses : base.weaknesses,
    constraints: [...llm.constraints],
    transformed: llm.transformed || base.transformed,
    notes: [
      'Compiled by the LLM interpreter (Claude) — mechanics assembled and bounded by the deterministic pipeline.',
      ...llm.normalizations.map((n) => `Normalized: ${n}`),
    ],
    assumptions: llm.assumptions,
    normalizations,
    creatorFacts: llm.creatorFacts,
    confidence: llm.confidence,
  };
}

/**
 * LLM-first compile with deterministic fallback. Never throws: any model,
 * network, schema, or validation failure returns the rule-based result with a
 * disclosure note.
 */
export async function compileFighterSmart(
  description: string,
  opts?: { seed?: number },
): Promise<CompiledFighterResult> {
  const seed = opts?.seed ?? 0;
  const base = parseDescription(description ?? '', seed);
  if (!llmAvailable()) return assemble(base);

  try {
    const client = makeClient();
    const response = await client.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      system: systemPrompt(),
      messages: [{ role: 'user', content: `Creator description:\n"""${description.slice(0, 1200)}"""` }],
      output_config: { format: zodOutputFormat(FighterSpecSchema) },
    });
    recordUsage('fighter_compile', response.usage);
    const parsed = response.parsed_output;
    if (!parsed) throw new Error('unparseable model output');

    const result = assemble(overlayToSpec(base, parsed));
    // Narrative enrichment (safe: non-mechanical field), then final validation gate.
    result.fighter.contract.canon.summary = parsed.summary.slice(0, 600);
    if (hasErrors(validateFighter(result.fighter))) throw new Error('assembled fighter failed validation');
    return result;
  } catch (e) {
    const fallback = assemble(base);
    fallback.notes.unshift(
      `LLM interpretation unavailable (${(e as Error).message?.slice(0, 80) ?? 'error'}) — deterministic compiler used instead.`,
    );
    return fallback;
  }
}

/** Semantic correction: LLM re-interprets with the prior spec as context; deterministic fallback. */
export async function applySemanticCorrectionSmart(
  prev: CompiledFighterResult,
  instruction: string,
): Promise<CompiledFighterResult> {
  if (!llmAvailable()) return applySemanticCorrection(prev, instruction);
  const contract = prev.fighter.contract;
  const description =
    `${contract.canon.summary}\n(Existing compiled fighter: ${contract.identity.displayName}, ` +
    `${prev.fighter.dna.identity.role} on a ${prev.fighter.dna.identity.chassis} chassis.)\n` +
    `Creator correction: ${instruction}`;
  try {
    const seedHex = parseInt(contract.identity.fighterId.slice(-4), 16) || 0;
    const result = await compileFighterSmart(description, { seed: seedHex });
    // Preserve correction bookkeeping.
    result.fighter.contract.approval.semanticRevisionCount = contract.approval.semanticRevisionCount + 1;
    result.fighter.contract.approval.visualRevisionCount = contract.approval.visualRevisionCount;
    return result;
  } catch {
    return applySemanticCorrection(prev, instruction);
  }
}
