import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RULESET_S0 } from '@arena/contracts';
import { runManifest } from '@arena/combat-sim';
import { loadContent } from '../../../tools/load-content';
import { createControlPlane, type ControlPlane } from '../src/server';
import {
  P1_PICKS,
  P2_PICKS,
  TestClient,
  createRoomPair,
  lockWildcards,
  runScriptedDraft,
  submitPreps,
  tmpDataDir,
} from './helpers';

const content = loadContent();

describe('control plane — full happy path', () => {
  let cp: ControlPlane;
  let dataDir: string;

  beforeAll(async () => {
    dataDir = tmpDataDir();
    cp = await createControlPlane({ port: 0, dataDir, tickIntervalMs: 5 });
  });
  afterAll(async () => {
    await cp.close();
  });

  it('create → join → draft → prep → wildcard → battle → battle_over, with persistence', async () => {
    const { host, p2, roomId } = await createRoomPair(cp.port);
    expect(roomId).toMatch(/^[A-HJ-NP-Z2-9]{6}$/); // unambiguous alphabet, no 0/O/1/I

    // --- draft ---
    const prepState = await runScriptedDraft(host, p2);
    expect(prepState.draft!.order).toEqual(['p1', 'p2', 'p2', 'p1', 'p1', 'p2', 'p2', 'p1', 'p1', 'p2']);
    expect(prepState.draft!.picks.p1.roster.map((r) => r.fighterId)).toEqual(P1_PICKS);
    expect(prepState.draft!.picks.p2.roster.map((r) => r.fighterId)).toEqual(P2_PICKS);
    // Prices are always the locked content prices.
    for (const r of [...prepState.draft!.picks.p1.roster, ...prepState.draft!.picks.p2.roster])
      expect(r.pricePaid).toBe(content.fighters.get(r.fighterId)!.balance.draftPrice);
    // Prep public state exposes readiness only — never the contents.
    expect(Object.keys(prepState.prep!)).toEqual(['ready']);
    expect(prepState.prep!.ready).toEqual({ p1: false, p2: false });

    // --- prep ---
    await submitPreps(host, p2);

    // --- wildcard: reveal only after BOTH locks ---
    host.send({ t: 'lock_wildcard', wildcardId: 'gravity-well' });
    const lockedOne = await p2.waitState((s) => s.wildcard?.locked.p1 === true, 'p1 locked, seen by p2');
    expect(lockedOne.wildcard!.revealed).toBeNull(); // p2 must NOT see p1's choice yet
    p2.send({ t: 'lock_wildcard', wildcardId: 'eclipse' });
    const [battleState] = await Promise.all([
      host.waitState((s) => s.phase === 'battle', 'battle (host)', 30_000),
      p2.waitState((s) => s.phase === 'battle', 'battle (p2)', 30_000),
    ]);
    expect(battleState.wildcard!.revealed).toEqual({ p1: 'gravity-well', p2: 'eclipse' });

    // --- battle snapshot ---
    const b = battleState.battle!;
    expect(b.teams.map((t) => t.playerId)).toEqual(['p1', 'p2']);
    expect(b.teams[0].wildcardId).toBe('gravity-well');
    expect(b.teams[1].wildcardId).toBe('eclipse');
    expect(b.teams[0].activeFighterIds).toEqual(P1_PICKS);
    expect(typeof b.seed).toBe('number');
    expect(b.arenaId).toBe('meridian-plaza');

    // --- battle runs to completion, both clients get identical results ---
    const [overHost, overP2] = await Promise.all([
      host.waitType('battle_over', 60_000),
      p2.waitType('battle_over', 60_000),
    ]);
    expect(overHost.eventHash).toBe(overP2.eventHash);
    expect(overHost.finalTick).toBe(overP2.finalTick);
    expect(['p1', 'p2']).toContain(overHost.outcome.winnerPlayerId);
    expect(overHost.finalTick).toBeLessThanOrEqual(RULESET_S0.hardLimitTicks);

    const finished = await host.waitState((s) => s.phase === 'finished', 'finished state');
    expect(finished.outcome).toEqual(overHost.outcome);

    // --- persistence: one JSONL record whose manifest replays to the same hash ---
    const lines = readFileSync(join(dataDir, 'matches.jsonl'), 'utf8').trim().split('\n');
    expect(lines.length).toBe(1);
    const record = JSON.parse(lines[0]);
    expect(record.roomId).toBe(roomId);
    expect(record.eventHash).toBe(overHost.eventHash);
    expect(record.outcome).toEqual(overHost.outcome);
    const replay = runManifest(record.manifest, {
      fighters: content.fighters,
      wildcards: content.wildcards,
      arena: content.arenas.get('meridian-plaza')!,
    });
    expect(replay.hash).toBe(overHost.eventHash);
    expect(replay.outcome).toEqual(overHost.outcome);

    host.close();
    p2.close();
  }, 90_000);

  it('non-experimental rooms refuse custom nominations', async () => {
    const { host, p2 } = await createRoomPair(cp.port);
    host.send({ t: 'start_draft' });
    await host.waitState((s) => s.phase === 'draft', 'draft');
    host.send({ t: 'nominate_custom', description: 'a chrome duelist with mirror blades' });
    const err = await host.waitError('experimental_only');
    expect(err.message).toContain('experimental');
    host.close();
    p2.close();

    // Ping/pong hardening check rides along here.
    const c = await TestClient.connect(cp.port);
    c.send({ t: 'ping' });
    await c.waitType('pong');
    c.sendText('{not json');
    await c.waitError('bad_json');
    c.close();
  }, 30_000);
});
