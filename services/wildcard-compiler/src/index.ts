/**
 * Wildcard compiler — deterministic rule-based in Season 0 (ADR-0008).
 * Same description + seed → byte-identical output; no Math.random, no Date.
 * LLM-backed providers are Founder-gated and will slot behind this signature.
 */
import type { CompiledWildcardResult } from '@arena/contracts';
import { compileWildcard } from './compile';

/**
 * Kept for API compatibility: the control plane treats a thrown
 * WildcardCompilerUnavailableError as "compiler offline". The Season 0
 * rule-based compiler never throws it, but the class must remain importable.
 */
export class WildcardCompilerUnavailableError extends Error {
  constructor() {
    super('wildcard compiler not yet available');
  }
}

/** Compile a free-text wildcard description into a validated experimental wildcard. */
export function compileWildcardFromText(description: string, opts?: { seed?: number }): CompiledWildcardResult {
  return compileWildcard(description ?? '', opts?.seed ?? 0);
}
