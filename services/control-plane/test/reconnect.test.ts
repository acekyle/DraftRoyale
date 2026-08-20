/**
 * Reconnect: a dropped socket + hello with the old sessionToken restores
 * identity AND room membership, with a full snapshot to resume from —
 * including, mid-battle, the complete input timeline + authorizedTick that a
 * client needs to fast-forward its local sim.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createControlPlane, type ControlPlane } from '../src/server';
import {
  P1_PICKS,
  P2_PICKS,
  TestClient,
  createRoomPair,
  finishDraft,
  lockWildcards,
  pickAndWait,
  submitPreps,
  tmpDataDir,
} from './helpers';

describe('control plane — reconnect', () => {
  let cp: ControlPlane;

  beforeAll(async () => {
    cp = await createControlPlane({ port: 0, dataDir: tmpDataDir(), tickIntervalMs: 10 });
  });
  afterAll(async () => {
    await cp.close();
  });

  it('mid-draft drop → hello(token) → snapshot → keep picking; then mid-battle reconnect', async () => {
    const { host, p2 } = await createRoomPair(cp.port);
    const token = p2.sessionToken;
    const guestId = p2.guestId;

    host.send({ t: 'start_draft' });
    await host.waitState((s) => s.phase === 'draft', 'draft');
    await pickAndWait(host, 'p1', P1_PICKS[0], 1); // turn 0

    // Hard drop, no leave_room.
    p2.terminate();
    await host.waitState(
      (s) => s.participants.some((q) => q.seat === 'p2' && !q.connected),
      'p2 marked disconnected',
    );

    // Reconnect with the old token.
    const p2b = await TestClient.connect(cp.port);
    const welcome = await p2b.hello('Bob', token);
    expect(welcome.guestId).toBe(guestId); // same identity restored
    const snap = await p2b.waitState((s) => s.phase === 'draft', 'reconnect snapshot');
    expect(snap.draft!.picks.p1.roster.map((r) => r.fighterId)).toEqual([P1_PICKS[0]]);
    expect(snap.draft!.onClock).toBe('p2'); // it's still p2's turn
    await host.waitState((s) => s.participants.every((q) => q.seat === null || q.connected), 'p2 back online');

    // The reconnected client can continue picking.
    await pickAndWait(p2b, 'p2', P2_PICKS[0], 1); // turn 1
    await pickAndWait(p2b, 'p2', P2_PICKS[1], 2); // turn 2
    await pickAndWait(host, 'p1', P1_PICKS[1], 2); // turn 3
    await pickAndWait(host, 'p1', P1_PICKS[2], 3); // turn 4
    p2b.send({ t: 'draft_pick', fighterId: P2_PICKS[2] }); // turn 5
    await finishDraft(host, p2b);

    await submitPreps(host, p2b);
    await lockWildcards(host, p2b, 'hex-dampener', 'mirage-veil');

    // Put a validated input on the timeline, then drop p2 again mid-battle.
    host.send({ t: 'battle_command', command: 'press_attack' });
    const relayed = await host.waitFor(
      (m) => m.t === 'battle_input' && m.input.kind === 'command',
      'battle_input relay',
    );
    const issuedTick = relayed.t === 'battle_input' ? relayed.input.issuedTick : -1;

    // Let the authoritative sim advance past the input before dropping p2, so
    // the reconnect snapshot demonstrably carries a non-trivial authorizedTick.
    await host.waitFor((m) => m.t === 'tick_advance' && m.tick >= issuedTick + 2, 'sim advanced');

    p2b.terminate();
    await host.waitState(
      (s) => s.participants.some((q) => q.seat === 'p2' && !q.connected),
      'p2 dropped mid-battle',
    );

    const p2c = await TestClient.connect(cp.port);
    await p2c.hello('Bob', token);
    const battleSnap = await p2c.waitState((s) => s.phase === 'battle' && s.battle !== null, 'battle snapshot');
    const b = battleSnap.battle!;
    // Full inputs timeline + authorizedTick — everything a client needs to fast-forward.
    expect(b.inputs.length).toBeGreaterThanOrEqual(1);
    expect(b.inputs.some((i) => i.kind === 'command' && i.playerId === 'p1' && i.issuedTick === issuedTick)).toBe(true);
    expect(b.authorizedTick).toBeGreaterThanOrEqual(issuedTick);
    expect(b.teams.length).toBe(2);
    expect(typeof b.seed).toBe('number');

    // And the battle is still live for the reconnected client.
    const tick = await p2c.waitType('tick_advance', 20_000);
    expect(tick.tick).toBeGreaterThan(b.authorizedTick);

    host.close();
    p2c.close();
  }, 90_000);

  it('an unknown session token gets a fresh identity, not someone else’s room', async () => {
    const c = await TestClient.connect(cp.port);
    const w = await c.hello('Mallory', 'not-a-real-token');
    expect(w.guestId).toBeTruthy();
    expect(w.sessionToken).not.toBe('not-a-real-token');
    c.send({ t: 'draft_pick', fighterId: 'aegis-9' });
    await c.waitError('not_in_room');
    c.close();
  }, 30_000);
});
