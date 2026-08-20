/**
 * LLM-backed wildcard compilation (Founder Gate 2, ADR-0009). Interpretation
 * only: the model proposes a bounded wildcard draft; every field is clamped to
 * the closed WildcardEffectKind DSL and validator bounds, normalization rules
 * (broad → symmetric) are re-applied mechanically, and any failure falls back
 * to the deterministic compiler. SERVER-ONLY module ("/llm" subpath).
 */
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import type { CompiledWildcardResult, WildcardContract, WildcardEffect } from '@arena/contracts';
import { WILDCARD_SCHEMA_VERSION, validateWildcard, hasErrors } from '@arena/contracts';
import { compileWildcardFromText } from './index';

const MODEL = 'claude-opus-5';

export function wildcardLlmAvailable(): boolean {
  return typeof process !== 'undefined' && !!process.env.ANTHROPIC_API_KEY;
}

const EFFECT_KINDS = [
  'suppress_tags', 'dot', 'hot', 'speed_mult', 'accuracy_delta', 'ground_flight',
  'stealth_bonus', 'add_context_tags', 'remove_context_tags',
] as const;
const DAMAGE_TYPES = ['kinetic', 'energy', 'thermal', 'psychic', 'magic', 'toxic', 'sonic'] as const;

const WildcardSpecSchema = z.object({
  normalizedName: z.string(),
  class: z.enum(['object', 'field', 'condition', 'terrain']),
  deployment: z.enum(['placed', 'global']),
  radius: z.number(),
  durationSeconds: z.number(),
  objectHp: z.number(),
  effects: z.array(z.object({
    kind: z.enum(EFFECT_KINDS),
    magnitude: z.number(),
    tags: z.array(z.string()),
    damageType: z.enum([...DAMAGE_TYPES, 'none']),
    affects: z.enum(['enemies', 'allies', 'both']),
  })).min(1).max(3),
  counterplay: z.array(z.string()).min(2).max(4),
  sideEffects: z.array(z.string()),
  environmentalInteractions: z.array(z.string()),
  visualManifestation: z.string(),
  audioManifestation: z.string(),
  notes: z.array(z.string()),
  rejectedClauses: z.array(z.string()),
  confidence: z.enum(['high', 'medium', 'low']),
});
type LlmWildcardSpec = z.infer<typeof WildcardSpecSchema>;

const SYSTEM = `You are the wildcard compiler for Infinite Arena. A player typed a wildcard idea; compile it into bounded, counterable mechanics. Rules:
- class: object = destructible thing (needs objectHp 40-80, radius 5-10); field = area effect (radius 8-14, no hp); condition = arena-wide state (deployment global); terrain = permanent arena transformation (deployment global, durationSeconds 0).
- durationSeconds: object 60-100, field 40-70, condition ≤70, terrain 0 (permanent). Nothing else may be permanent.
- effects use ONLY the provided kinds. suppress_tags needs lowercase power-family tags (fire, water, lightning, stone, wind, light, solar, shadow, psychic, magic, tech, sonic, toxic, spirit, blade, beast, hydro). dot/hot magnitude 0.4-1.5 per tick. speed_mult 0.6-0.9 (slows). accuracy_delta -0.2..-0.1. add/remove_context_tags for battlefield states (water_present, darkness, daylight, emp_field). Set damageType "none" when not applicable; use [] for unused tags.
- BROAD power must cost something: global conditions, multi-family suppression, or 3-effect wildcards must affect BOTH teams — record this tradeoff in notes.
- Unbounded requests (instant wins, invincibility, deleting fighters) are stripped into rejectedClauses and the closest bounded version is compiled.
- counterplay: at least 2 genuine paths matched to the class (destroy the object, leave the radius, wait it out, exploit it harder than the opponent).
- Name it evocatively; describe visual + audio manifestation vividly but briefly.`;

function clampEffects(spec: LlmWildcardSpec): { effects: WildcardEffect[]; notes: string[] } {
  const notes: string[] = [];
  const effects: WildcardEffect[] = spec.effects.map((e) => {
    const out: WildcardEffect = { kind: e.kind, affects: e.affects };
    if (e.kind === 'dot' || e.kind === 'hot') out.magnitude = Math.max(0.4, Math.min(1.5, e.magnitude));
    if (e.kind === 'speed_mult') out.magnitude = Math.max(0.6, Math.min(0.9, e.magnitude));
    if (e.kind === 'accuracy_delta') out.magnitude = Math.max(-0.2, Math.min(-0.05, e.magnitude));
    if (e.kind === 'stealth_bonus') out.magnitude = Math.max(0.05, Math.min(0.2, Math.abs(e.magnitude)));
    if (e.tags.length) out.tags = e.tags.map((t) => t.toLowerCase()).slice(0, 3);
    if (e.kind === 'dot' && e.damageType !== 'none') out.damageType = e.damageType;
    return out;
  });
  // Mechanical broadness rule (never trust the model to self-normalize).
  const suppressedTags = effects.filter((e) => e.kind === 'suppress_tags').flatMap((e) => e.tags ?? []);
  const broad = spec.deployment === 'global' || suppressedTags.length >= 2 || effects.length >= 3;
  if (broad) {
    for (const e of effects) {
      if (e.affects !== 'both' && e.kind !== 'hot' && e.kind !== 'stealth_bonus') {
        e.affects = 'both';
        notes.push('Broad effect normalized to affect both teams (specificity rule).');
      }
    }
  }
  return { effects, notes: [...new Set(notes)] };
}

export async function compileWildcardSmart(
  description: string,
  opts?: { seed?: number },
): Promise<CompiledWildcardResult> {
  const seed = opts?.seed ?? 0;
  if (!wildcardLlmAvailable()) return compileWildcardFromText(description, { seed });

  try {
    const client = new Anthropic({ timeout: 45_000, maxRetries: 1 });
    const response = await client.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      messages: [{ role: 'user', content: `Player wildcard request:\n"""${description.slice(0, 600)}"""` }],
      output_config: { format: zodOutputFormat(WildcardSpecSchema) },
    });
    console.log(`[llm] wildcard_compile: in=${response.usage.input_tokens} out=${response.usage.output_tokens}`);
    const parsed = response.parsed_output;
    if (!parsed) throw new Error('unparseable model output');

    const { effects, notes: normNotes } = clampEffects(parsed);
    const isTerrain = parsed.class === 'terrain';
    const isObject = parsed.class === 'object';
    const durationTicks = isTerrain ? 0 : Math.max(80, Math.min(400, Math.round(parsed.durationSeconds * 4)));
    const deployment = parsed.class === 'condition' || isTerrain ? 'global' as const : 'placed' as const;
    const hex = ((seed >>> 0) ^ 0x9e3779b9).toString(16).slice(0, 4);
    const wildcard: WildcardContract = {
      schemaVersion: WILDCARD_SCHEMA_VERSION,
      wildcardId: `${parsed.normalizedName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32)}-x${hex}`,
      version: '1.0.0',
      creator: 'player (LLM-compiled)',
      inputDescription: description.slice(0, 240),
      normalizedName: parsed.normalizedName.slice(0, 48),
      class: parsed.class,
      radius: deployment === 'global' ? 0 : Math.max(5, Math.min(isObject ? 10 : 14, Math.round(parsed.radius))),
      durationTicks,
      objectHp: isObject ? Math.max(40, Math.min(80, Math.round(parsed.objectHp))) : 0,
      deployment,
      effects,
      environmentalInteractions: parsed.environmentalInteractions.slice(0, 4),
      sideEffects: parsed.sideEffects.slice(0, 4),
      counterplay: parsed.counterplay.slice(0, 4),
      visualManifestation: parsed.visualManifestation.slice(0, 240),
      audioManifestation: parsed.audioManifestation.slice(0, 160),
      confidence: parsed.confidence,
      provenance: 'LLM-compiled from player description; mechanics clamped to the closed DSL and re-normalized deterministically.',
      moderation: 'approved',
      eligibility: 'experimental',
    };
    const result: CompiledWildcardResult = {
      wildcard,
      notes: [
        'Compiled by the LLM interpreter (Claude) — effects bounded by the closed wildcard DSL.',
        ...parsed.notes.slice(0, 4),
        ...normNotes,
      ],
      rejectedClauses: parsed.rejectedClauses.slice(0, 4),
    };
    if (hasErrors(validateWildcard(wildcard))) throw new Error('compiled wildcard failed validation');
    return result;
  } catch (e) {
    const fallback = compileWildcardFromText(description, { seed });
    fallback.notes.unshift(
      `LLM interpretation unavailable (${(e as Error).message?.slice(0, 80) ?? 'error'}) — deterministic compiler used instead.`,
    );
    return fallback;
  }
}
