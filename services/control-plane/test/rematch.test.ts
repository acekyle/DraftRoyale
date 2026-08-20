/** Online run-it-back: a finished room resets into a fresh draft, same room id. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createControlPlane, type ControlPlane } from '../src/server';
import { P1_PICKS, createRoomPair, lockWildcards, runScriptedDraft, submitPreps, tmpDataDir } from './helpers';

describe('control plane — run it back (same-room rematch)', () => {
  let cp: ControlPlane;

  beforeAll(async () => {
    cp = await createControlPlane({ port: 0, dataDir: tmpDataDir(), tickIntervalMs: 5 });
  });
  afterAll(async () => {
    await cp.close();
  });

  it('host restarts a finished room into a completely fresh draft', async () => {
    const { host, p2, roomId } = await createRoomPair(cp.port);
    await runScriptedDraft(host, p2);
    await submitPreps(host, p2);
    await lockWildcards(host, p2);
    await Promise.all([host.waitType('battle_over', 60_000), p2.waitType('battle_over', 60_000)]);
    const finished = await host.waitState((s) => s.phase === 'finished', 'finished');

    // Non-host cannot restart.
    p2.send({ t: 'start_draft' });
    await p2.waitType('error', 5_000);

    // Host runs it back: same room id, clean slate. Rev-guard the waits so
    // buffered snapshots from the FIRST match can never satisfy them.
    host.send({ t: 'start_draft' });
    const fresh = await host.waitState(
      (s) => s.rev > finished.rev && s.phase === 'draft' && s.draft!.picks.p1.roster.length === 0,
      'fresh draft',
      10_000,
    );
    expect(fresh.roomId).toBe(roomId);
    expect(fresh.outcome).toBeNull();
    expect(fresh.battle).toBeNull();
    expect(fresh.draft!.picks.p2.roster).toEqual([]);
    expect(fresh.draft!.customFighters).toEqual([]);
    expect(fresh.wildcard).toBeNull();

    // And it is actually playable: first pick of the rematch lands.
    host.send({ t: 'draft_pick', fighterId: P1_PICKS[0] });
    const afterPick = await host.waitState(
      (s) => s.rev > fresh.rev && (s.draft?.picks.p1.roster.length ?? 0) === 1,
      'rematch pick',
      10_000,
    );
    expect(afterPick.draft!.picks.p1.roster[0].fighterId).toBe(P1_PICKS[0]);
  }, 90_000);
});
