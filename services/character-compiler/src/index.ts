/**
 * Character compiler — deterministic rule-based in Season 0 (ADR-0008).
 *
 * Same description + seed → byte-identical output. No Math.random, no Date;
 * every piece of variation is seeded from an fnv-1a hash of (description, seed).
 * LLM-backed providers are Founder-gated and will slot in behind these exact
 * signatures later; the control plane and client depend on nothing else.
 */
import type { CompiledFighterResult } from '@arena/contracts';
import { assemble, parseDescription } from './compile';
import { semanticCorrection, visualCorrection } from './corrections';

/**
 * Kept for API compatibility: the control plane treats a thrown
 * CompilerUnavailableError as "compiler offline". The Season 0 rule-based
 * compiler never throws it, but the class must remain importable.
 */
export class CompilerUnavailableError extends Error {
  constructor() {
    super('character compiler not yet available');
  }
}

/** Compile a free-text fighter description into a validated experimental fighter. */
export function compileFighterFromText(description: string, opts?: { seed?: number }): CompiledFighterResult {
  return assemble(parseDescription(description ?? '', opts?.seed ?? 0));
}

/**
 * Re-parse a correction instruction and adjust MECHANICS (families, role,
 * weaknesses, name). Deterministic; returns a complete new result.
 */
export function applySemanticCorrection(prev: CompiledFighterResult, instruction: string): CompiledFighterResult {
  return semanticCorrection(prev, instruction ?? '');
}

/**
 * Adjust PRESENTATION only (colors, scale within chassis bounds, silhouette,
 * energy color). Mechanics are untouched. Deterministic.
 */
export function applyVisualCorrection(prev: CompiledFighterResult, instruction: string): CompiledFighterResult {
  return visualCorrection(prev, instruction ?? '');
}
