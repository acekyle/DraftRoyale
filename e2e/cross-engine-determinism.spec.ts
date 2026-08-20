/**
 * Cross-engine lockstep determinism measurement (risk R-5, ADR-0004/0007).
 *
 * The lockstep online model assumes the browser's JS engine reproduces the
 * Node/V8 simulation bit-for-bit. This spec MEASURES that instead of assuming:
 * it runs the same MatchManifests through the page's engine (Chromium/V8 and,
 * when installed, WebKit/JavaScriptCore — the Safari engine) via the dev-only
 * `__replayHash` hook and compares event hashes against Node's.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { RULESET_S0, type ArenaDef, type CombatDNA, type FighterFile, type TeamSetup, type WildcardContract } from '@arena/contracts';
import { buildManifest, runManifest, type SimContent } from '@arena/combat-sim';

// CJS-safe content loader (tools/load-content.ts uses import.meta, which the
// Playwright transform rejects without a module-type package root).
const root = process.cwd();
const readDir = <T>(dir: string): T[] =>
  readdirSync(join(root, dir))
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(root, dir, f), 'utf8')) as T);
const fighters = new Map<string, CombatDNA>(readDir<FighterFile>('content/fighters').map((f) => [f.dna.identity.fighterId, f.dna]));
const wildcards = new Map<string, WildcardContract>(readDir<WildcardContract>('content/wildcards').map((w) => [w.wildcardId, w]));
const arena = readDir<ArenaDef>('content/arenas').find((a) => a.arenaId === 'meridian-plaza')!;
const simContent: SimContent = { fighters, wildcards, arena };
const priceOf = (id: string) => fighters.get(id)!.balance.draftPrice;

function team(playerId: string, roster: string[], wildcardId: string | null): TeamSetup {
  return {
    playerId,
    displayName: playerId,
    roster: roster.map((fighterId) => ({ fighterId, pricePaid: priceOf(fighterId) })),
    activeFighterIds: roster.slice(0, 3),
    reserveOrder: roster.slice(3),
    captainId: roster[0],
    formation: 'balanced',
    reinforcementPlan: { trigger: 'ally_ko', description: 'relay' },
    wildcardId,
  };
}

// Three manifests chosen to sweep mechanics: wildcards, commands, reserves, customs-free.
const MANIFESTS = [1, 2, 3].map((n) => {
  const manifest = buildManifest({
    matchId: `xengine-${n}`,
    roomId: 'qa',
    createdAt: '2026-01-01T00:00:00Z',
    ruleset: RULESET_S0,
    arenaId: arena.arenaId,
    arenaVersion: arena.version,
    seed: 424200 + n,
    teams: [
      team('A', ['whisper', 'cinder-wisp', 'riptide', 'orrin'], 'eclipse'),
      team('B', ['vex', 'sable-howl', 'grimspike'], 'aegis-beacon'),
    ],
    content: simContent,
  });
  manifest.commandTimeline = [
    { kind: 'press_attack', playerId: 'A', issuedTick: 60 + n },
    { kind: 'focus_target', playerId: 'B', targetFighterId: 'whisper', issuedTick: 120 + n },
  ];
  manifest.wildcardTimeline = [
    { playerId: 'A', wildcardId: 'eclipse', x: 0, z: 0, issuedTick: 80 },
    { playerId: 'B', wildcardId: 'aegis-beacon', x: 10, z: 2, issuedTick: 100 + n },
  ];
  return manifest;
});

test('browser JS engine reproduces Node/V8 simulation hashes exactly', async ({ page, browserName }) => {
  test.setTimeout(180_000);
  await page.goto('/');
  await page.waitForFunction(() => typeof (window as never as { __replayHash?: unknown }).__replayHash === 'function', {
    timeout: 30_000,
  });
  for (const manifest of MANIFESTS) {
    const nodeHash = runManifest(manifest, simContent).hash;
    const browserHash = await page.evaluate(
      (m) => (window as never as { __replayHash: (x: unknown) => string }).__replayHash(m),
      manifest as unknown,
    );
    expect(browserHash, `engine=${browserName} manifest=${manifest.matchId}`).toBe(nodeHash);
  }
});
