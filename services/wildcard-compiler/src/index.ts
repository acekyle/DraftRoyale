/**
 * Wildcard compiler — deterministic rule-based in Season 0 (ADR-0008).
 * STUB: real implementation lands with the compiler workstream.
 */
import type { CompiledWildcardResult } from '@arena/contracts';

export class WildcardCompilerUnavailableError extends Error {
  constructor() {
    super('wildcard compiler not yet available');
  }
}

export function compileWildcardFromText(_description: string, _opts?: { seed?: number }): CompiledWildcardResult {
  throw new WildcardCompilerUnavailableError();
}
