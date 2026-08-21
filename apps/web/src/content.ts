/** Client-side content index (Vite glob imports over /content). */
import type { ArenaDef, CombatDNA, FighterFile, WildcardContract } from '@arena/contracts';
import type { SimContent } from '@arena/combat-sim';

const fighterModules = import.meta.glob('../../../content/fighters/*.json', { eager: true }) as Record<
  string,
  { default: FighterFile }
>;
const wildcardModules = import.meta.glob('../../../content/wildcards/*.json', { eager: true }) as Record<
  string,
  { default: WildcardContract }
>;
const arenaModules = import.meta.glob('../../../content/arenas/*.json', { eager: true }) as Record<
  string,
  { default: ArenaDef }
>;

export const FIGHTERS: FighterFile[] = Object.values(fighterModules)
  .map((m) => m.default)
  .sort((a, b) => a.dna.balance.draftPrice - b.dna.balance.draftPrice || a.dna.identity.fighterId.localeCompare(b.dna.identity.fighterId));

export const DNA_BY_ID = new Map<string, CombatDNA>(FIGHTERS.map((f) => [f.dna.identity.fighterId, f.dna]));
export const FILE_BY_ID = new Map<string, FighterFile>(FIGHTERS.map((f) => [f.dna.identity.fighterId, f]));

export const WILDCARDS: WildcardContract[] = Object.values(wildcardModules)
  .map((m) => m.default)
  .sort((a, b) => a.wildcardId.localeCompare(b.wildcardId));
export const WILDCARD_BY_ID = new Map(WILDCARDS.map((w) => [w.wildcardId, w]));

export const ARENAS: ArenaDef[] = Object.values(arenaModules).map((m) => m.default);
export const ARENA: ArenaDef = ARENAS.find((a) => a.arenaId === 'meridian-plaza') ?? ARENAS[0];

export const SIM_CONTENT: SimContent = { fighters: DNA_BY_ID, wildcards: WILDCARD_BY_ID, arena: ARENA };

// Role colors now live in roleTheme.ts (Art Bible §3 families, shared with
// role icons and pedestal name plates); re-exported to keep existing imports.
export { ROLE_COLORS } from './roleTheme';

export function displayName(fighterId: string): string {
  return FILE_BY_ID.get(fighterId)?.contract.identity.displayName ?? fighterId;
}
export function money(v: number): string {
  return `$${(v / 1e6).toFixed(1)}M`;
}

// ---------------------------------------------------------------------------
// Experimental custom content (compiler output). Registered into the same
// indexes the sim/renderer read, persisted locally so replays keep working.
// ---------------------------------------------------------------------------

const CUSTOM_FIGHTERS_KEY = 'ia_custom_fighters';
const CUSTOM_WILDCARDS_KEY = 'ia_custom_wildcards';

export function registerCustomFighter(file: FighterFile, persist = true) {
  const id = file.dna.identity.fighterId;
  DNA_BY_ID.set(id, file.dna);
  FILE_BY_ID.set(id, file);
  if (persist) {
    try {
      const all = JSON.parse(localStorage.getItem(CUSTOM_FIGHTERS_KEY) ?? '[]') as FighterFile[];
      if (!all.some((f) => f.dna.identity.fighterId === id)) {
        all.push(file);
        localStorage.setItem(CUSTOM_FIGHTERS_KEY, JSON.stringify(all.slice(-40)));
      }
    } catch { /* quota */ }
  }
}

export function registerCustomWildcard(contract: WildcardContract, persist = true) {
  if (!WILDCARD_BY_ID.has(contract.wildcardId)) {
    WILDCARD_BY_ID.set(contract.wildcardId, contract);
  }
  if (persist) {
    try {
      const all = JSON.parse(localStorage.getItem(CUSTOM_WILDCARDS_KEY) ?? '[]') as WildcardContract[];
      if (!all.some((w) => w.wildcardId === contract.wildcardId)) {
        all.push(contract);
        localStorage.setItem(CUSTOM_WILDCARDS_KEY, JSON.stringify(all.slice(-40)));
      }
    } catch { /* quota */ }
  }
}

// Re-register persisted customs at boot so historical replays resolve.
try {
  for (const f of JSON.parse(localStorage.getItem(CUSTOM_FIGHTERS_KEY) ?? '[]') as FighterFile[])
    registerCustomFighter(f, false);
  for (const w of JSON.parse(localStorage.getItem(CUSTOM_WILDCARDS_KEY) ?? '[]') as WildcardContract[])
    registerCustomWildcard(w, false);
} catch { /* corrupted storage — ignore */ }
