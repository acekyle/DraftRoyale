/**
 * Character compiler — deterministic rule-based in Season 0 (ADR-0008).
 * STUB: real implementation lands with the compiler workstream; the control
 * plane treats a thrown CompilerUnavailableError as "compiler offline".
 */
import type { CompiledFighterResult } from '@arena/contracts';

export class CompilerUnavailableError extends Error {
  constructor() {
    super('character compiler not yet available');
  }
}

export function compileFighterFromText(_description: string, _opts?: { seed?: number }): CompiledFighterResult {
  throw new CompilerUnavailableError();
}

export function applySemanticCorrection(_prev: CompiledFighterResult, _instruction: string): CompiledFighterResult {
  throw new CompilerUnavailableError();
}

export function applyVisualCorrection(_prev: CompiledFighterResult, _instruction: string): CompiledFighterResult {
  throw new CompilerUnavailableError();
}
