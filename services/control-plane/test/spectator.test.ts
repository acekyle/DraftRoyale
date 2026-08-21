/**
 * Spectators: receive room_state and every battle broadcast, can react,
 * but can never pick, prep, lock, or command.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createControlPlane, type ControlPlane } from '../src/server';
import {
  TestClient,
  createRoomPair,
  lockWildcards,
  runScriptedDraft,
  submitPreps,
  tmpDataDir,
} from './helpers';

describe('control plane — spectators', () => {
  let cp: ControlPlane;

  beforeAll(async () => {
    cp = await createControlPlane({ port: 0, dataDir: tmpDataDir(), tickIntervalMs: 10 });
  });
  afterAll(async () => {
    await cp.close();
  });

  it('spectator sees everything, controls nothing', async () => {
    const { host, p2, roomId } = await createRoomPair(cp.port);

    const spec = await TestClient.connect(cp.port);
    await spec.hello('Watcher');
    spec.send({ t: 'join_room', roomId, as: 'spectator' });
    const joined = await spec.waitState((s) => s.participants.some((q) => q.guestId === spec.guestId), 'spectator joined');
    const me = joined.participants.find((q) => q.guestId === spec.guestId)!;
    expect(me.role).toBe('spectator');
    expect(me.seat).toBeNull();

    // Cannot start the draft.
    spec.send({ t: 'start_draft' });
    await spec.waitError('not_host');

    await runScriptedDraft(host, p2);
    // Spectator observed the draft via broadcasts.
    await spec.waitState((s) => s.phase === 'prep', 'spectator sees prep');

    // Cannot pick (draft is over anyway — role check fires first) or prep or lock.
    spec.send({ t: 'draft_pick', fighterId: 'ember-ronin' });
    await spec.waitError('not_a_player');
    spec.send({
      t: 'submit_prep',
      prep: { activeFighterIds: ['aegis-9', 'cinder-wisp', 'orrin'], captainId: 'aegis-9', formation: 'balanced', reinforcement: 'ally_ko' },
    });
    await spec.waitError('not_a_player');

    await submitPreps(host, p2);
    spec.send({ t: 'lock_wildcard', wildcardId: 'eclipse' });
    await spec.waitError('not_a_player');

    await lockWildcards(host, p2, 'aegis-beacon', 'flash-flood');
    await spec.waitState((s) => s.phase === 'battle', 'spectator sees battle start');

    // Battle broadcasts reach the spectator: ticks and relayed inputs.
    await spec.waitType('tick_advance', 20_000);
    host.send({ t: 'battle_command', command: 'press_attack' });
    const relay = await spec.waitFor((m) => m.t === 'battle_input', 'battle_input reaches spectator');
    expect(relay.t).toBe('battle_input');

    // Cannot command or deploy.
    spec.send({ t: 'battle_command', command: 'press_attack' });
    await spec.waitError('not_a_player');
    spec.send({ t: 'battle_wildcard', wildcardId: 'aegis-beacon', x: 0, z: 0 });
    await spec.waitError('not_a_player');

    // Reactions are for everyone — valid emote relayed with the sender's name…
    spec.send({ t: 'reaction', emote: '🔥' });
    const r = await host.waitType('reaction');
    expect(r.name).toBe('Watcher');
    expect(r.emote).toBe('🔥');
    // …but only emotes from the allowed set.
    spec.send({ t: 'reaction', emote: '💣' });
    await spec.waitError('invalid_emote');

    host.close();
    p2.close();
    spec.close();
  }, 90_000);
});
