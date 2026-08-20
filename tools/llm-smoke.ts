/**
 * LLM compiler smoke test (Founder Gate 2). Run after setting ANTHROPIC_API_KEY:
 *
 *   ANTHROPIC_API_KEY=sk-... npm run compiler:smoke
 *
 * Without a key it demonstrates the deterministic fallback path. With a key it
 * makes exactly 3 live calls (two fighters, one wildcard) and prints the
 * estimated spend.
 */
import { validateFighter, validateWildcard, hasErrors } from '@arena/contracts';
import { compileFighterSmart, llmAvailable, llmSpendSummary } from '@arena/character-compiler/llm';
import { compileWildcardSmart } from '@arena/wildcard-compiler/llm';

const FIGHTERS = [
  'A weary clockwork duelist named Tessaline who fences with a rapier of wound springtime, moves in sudden bursts between frozen instants, and winds down badly when her mainspring is struck',
  'superman',
];
const WILDCARD = 'a slow rolling bank of grave-cold mist that muffles sound and hides whoever stands inside it';

async function main() {
  console.log(`LLM credentials: ${llmAvailable() ? 'PRESENT — live compilation' : 'absent — deterministic fallback path'}\n`);
  
  for (const desc of FIGHTERS) {
    const r = await compileFighterSmart(desc, { seed: 7 });
    const issues = validateFighter(r.fighter);
    console.log(`■ "${desc.slice(0, 60)}..."`);
    console.log(`  → ${r.fighter.contract.identity.displayName} | ${r.fighter.dna.identity.role} / ${r.fighter.dna.identity.chassis} | $${(r.fighter.dna.balance.draftPrice / 1e6).toFixed(1)}M | transformed=${r.transformed} | valid=${!hasErrors(issues)}`);
    console.log(`  summary: ${r.fighter.contract.canon.summary.slice(0, 140)}`);
    for (const n of r.notes.slice(0, 3)) console.log(`  note: ${n}`);
    console.log();
  }
  
  const w = await compileWildcardSmart(WILDCARD, { seed: 7 });
  console.log(`■ wildcard "${WILDCARD.slice(0, 50)}..."`);
  console.log(`  → ${w.wildcard.normalizedName} | ${w.wildcard.class} | valid=${!hasErrors(validateWildcard(w.wildcard))}`);
  for (const n of w.notes.slice(0, 3)) console.log(`  note: ${n}`);
  
  console.log('\nSession LLM spend:', JSON.stringify(llmSpendSummary()));
}

void main();
