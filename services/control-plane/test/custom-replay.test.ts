/**
 * Replay Original for experimental content (Product Law 4.6 / constitution §28):
 * a match played with a COMPILED custom wildcard must be exactly reproducible
 * from its persisted record alone — the record therefore carries the compiled
 * contracts, and merging them into base content replays to the server's hash.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ServerMessage, WildcardContract } from '@arena/contracts';
import { runManifest, type SimContent } from '@arena/combat-sim';
import { loadContent } from '../../../tools/load-content';
import { createControlPlane, type ControlPlane } from '../src/server';
import { createRoomPair, runScriptedDraft, submitPreps, tmpDataDir } from './helpers';

describe('control plane — Replay Original with custom compiled content', () => {
  let cp: ControlPlane;
  let dataDir: string;

  beforeAll(async () => {
    dataDir = tmpDataDir();
    cp = await createControlPlane({ port: 0, dataDir, tickIntervalMs: 5 });
  });
  afterAll(async () => {
    await cp.close();
  });

  it('persists compiled custom wildcards and replays to the exact server hash', async () => {
    const { host, p2 } = await createRoomPair(cp.port, { experimental: true });
    await runScriptedDraft(host, p2);
    await submitPreps(host, p2);

    // p2 compiles a custom wildcard and locks it.
    p2.send({ t: 'custom_wildcard', description: 'a humming resonance obelisk that rattles armor apart' });
    const result = (await p2.waitType('custom_wildcard_result', 10_000)) as Extract<
      ServerMessage,
      { t: 'custom_wildcard_result' }
    >;
    const customId = result.wildcard.wildcardId;
    expect(result.wildcard.eligibility).toBe('experimental');

    host.send({ t: 'lock_wildcard', wildcardId: 'gravity-well' });
    await host.waitState((s) => s.wildcard?.locked.p1 === true, 'p1 locked');
    p2.send({ t: 'lock_wildcard', wildcardId: customId });
    await Promise.all([
      host.waitState((s) => s.phase === 'battle', 'battle (host)', 30_000),
      p2.waitState((s) => s.phase === 'battle', 'battle (p2)', 30_000),
    ]);

    // Deploy the custom wildcard mid-battle so its effects are in the event stream.
    await p2.waitType('tick_advance', 15_000);
    p2.send({ t: 'battle_wildcard', wildcardId: customId, x: 0, z: 0 });
    const over = (await p2.waitType('battle_over', 60_000)) as Extract<ServerMessage, { t: 'battle_over' }>;

    // Replay purely from the persisted record.
    const line = readFileSync(join(dataDir, 'matches.jsonl'), 'utf8').trim().split('\n').pop()!;
    const rec = JSON.parse(line) as {
      eventHash: string;
      manifest: Parameters<typeof runManifest>[0];
      customContent: { wildcards: WildcardContract[]; fighters: unknown[] };
    };
    expect(rec.customContent.wildcards.map((w) => w.wildcardId)).toContain(customId);

    const base = loadContent();
    for (const w of rec.customContent.wildcards) base.wildcards.set(w.wildcardId, w);
    const simContent: SimContent = {
      fighters: base.fighters,
      wildcards: base.wildcards,
      arena: base.arenas.get(rec.manifest.arenaId)!,
    };
    const replay = runManifest(rec.manifest, simContent);
    expect(replay.hash).toBe(rec.eventHash);
    expect(replay.hash).toBe(over.eventHash);
    // The custom wildcard actually fired in the authoritative record.
    expect(replay.events.some((e) => e.type === 'WILDCARD_DEPLOYED' && e.data.wildcardId === customId)).toBe(true);
  }, 90_000);
});
