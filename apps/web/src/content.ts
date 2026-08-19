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

export const ROLE_COLORS: Record<string, string> = {
  vanguard: '#e8a41f',
  defender: '#4a7bd0',
  bruiser: '#e0524a',
  skirmisher: '#3ecfb2',
  artillery: '#f57a3c',
  controller: '#9b6ef3',
  support: '#58c470',
  tactician: '#e8d44f',
};

export function displayName(fighterId: string): string {
  return FILE_BY_ID.get(fighterId)?.contract.identity.displayName ?? fighterId;
}
export function money(v: number): string {
  return `$${(v / 1e6).toFixed(1)}M`;
}
