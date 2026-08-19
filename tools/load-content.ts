/** Node-side content loader for tools/tests (the web client uses import.meta.glob instead). */
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ArenaDef, CombatDNA, FighterFile, WildcardContract } from '@arena/contracts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function readJsonDir<T>(dir: string): { file: string; data: T }[] {
  const full = join(ROOT, dir);
  return readdirSync(full)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => ({ file: join(full, f), data: JSON.parse(readFileSync(join(full, f), 'utf8')) as T }));
}

export interface LoadedContent {
  fighterFiles: { file: string; data: FighterFile }[];
  wildcardFiles: { file: string; data: WildcardContract }[];
  arenaFiles: { file: string; data: ArenaDef }[];
  fighters: Map<string, CombatDNA>;
  wildcards: Map<string, WildcardContract>;
  arenas: Map<string, ArenaDef>;
}

export function loadContent(): LoadedContent {
  const fighterFiles = readJsonDir<FighterFile>('content/fighters');
  const wildcardFiles = readJsonDir<WildcardContract>('content/wildcards');
  const arenaFiles = readJsonDir<ArenaDef>('content/arenas');
  return {
    fighterFiles,
    wildcardFiles,
    arenaFiles,
    fighters: new Map(fighterFiles.map((f) => [f.data.dna.identity.fighterId, f.data.dna])),
    wildcards: new Map(wildcardFiles.map((w) => [w.data.wildcardId, w.data])),
    arenas: new Map(arenaFiles.map((a) => [a.data.arenaId, a.data])),
  };
}
