/**
 * Protocol rev-2 (0.2.0) — closes the frictions recorded in ADR-0006:
 * a dedicated `room_closed` server message (was an error frame),
 * `battle_wildcard` names the wildcard it deploys (was implied by
 * wildcardsPerPlayer: 1), and a declined custom nomination hands the
 * one-per-player right back instead of consuming it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '@arena/contracts';
import { createControlPlane, type ControlPlane } from '../src/server';
import {
  TestClient,
  createRoomPair,
  lockWildcards,
  runScriptedDraft,
  submitPreps,
  tmpDataDir,
} from './helpers';

describe('control plane — protocol rev-2', () => {
  let cp: ControlPlane;

  beforeAll(async () => {
    cp = await createControlPlane({ port: 0, dataDir: tmpDataDir(), tickIntervalMs: 10 });
  });
  afterAll(async () => {
    await cp.close();
  });

  it('handshake and snapshots carry protocol 0.3.0', async () => {
    // 0.3.0 = rev-2 + moderation basics (report/report_ack, draft_voided).
    expect(PROTOCOL_VERSION).toBe('0.3.0');
    const c = await TestClient.connect(cp.port);
    const w = await c.hello('Vera');
    expect(w.protocolVersion).toBe('0.3.0');
    c.send({ t: 'create_room', experimental: false });
    const snap = await c.waitState((s) => s.phase === 'lobby', 'room created');
    expect(snap.protocolVersion).toBe('0.3.0');
    c.close();
  }, 30_000);

  it('destroying a room sends the typed room_closed message, not an error frame', async () => {
    const host = await TestClient.connect(cp.port);
    await host.hello('Hana');
    host.send({ t: 'create_room', experimental: false });
    const created = await host.waitState((s) => s.phase === 'lobby', 'room created');

    const spec = await TestClient.connect(cp.port);
    await spec.hello('Watcher');
    spec.send({ t: 'join_room', roomId: created.roomId, as: 'spectator' });
    await spec.waitState((s) => s.participants.some((p) => p.guestId === spec.guestId), 'spectator joined');

    // Reject any error frame from here on — rev-2 rooms close with the typed
    // message only.
    const errors: string[] = [];
    spec.hooks.push((m) => {
      if (m.t === 'error') errors.push(m.code);
    });

    // The host leaves the lobby; no other seated player remains, so the room
    // is destroyed and the survivor receives room_closed with the reason.
    host.send({ t: 'leave_room' });
    const closed = await spec.waitType('room_closed');
    expect(closed.reason).toBe('the host left the lobby');
    expect(errors).toEqual([]);

    // The survivor's session is fully detached — free to host a new room.
    spec.send({ t: 'create_room', experimental: false });
    await spec.waitState((s) => s.phase === 'lobby' && s.hostGuestId === spec.guestId, 'ex-spectator hosts anew');

    host.close();
    spec.close();
  }, 30_000);

  it("battle_wildcard must name the deployer's own locked wildcard", async () => {
    const { host, p2 } = await createRoomPair(cp.port);
    await runScriptedDraft(host, p2);
    await submitPreps(host, p2);
    await lockWildcards(host, p2, 'gravity-well', 'eclipse');
    await host.waitType('tick_advance', 20_000);

    // The opponent's locked id and a fabricated id are both rejected…
    host.send({ t: 'battle_wildcard', wildcardId: 'eclipse', x: 0, z: 0 });
    await host.waitError('unknown_wildcard');
    host.send({ t: 'battle_wildcard', wildcardId: 'not-a-wildcard', x: 0, z: 0 });
    await host.waitError('unknown_wildcard');
    // …and a rev-1 id-less frame is malformed.
    host.sendRaw({ t: 'battle_wildcard', x: 0, z: 0 });
    await host.waitError('bad_message');

    // The correct id deploys exactly as before: validated, stamped, relayed.
    host.send({ t: 'battle_wildcard', wildcardId: 'gravity-well', x: 2, z: 3 });
    const relayed = await p2.waitFor(
      (m) => m.t === 'battle_input' && m.input.kind === 'wildcard',
      'wildcard relayed to opponent',
      20_000,
    );
    if (relayed.t === 'battle_input' && relayed.input.kind === 'wildcard') {
      expect(relayed.input.wildcardId).toBe('gravity-well');
      expect(relayed.input.playerId).toBe('p1');
      expect(relayed.input.x).toBe(2);
      expect(relayed.input.z).toBe(3);
    }

    // The earlier rejections consumed nothing: only the successful deployment
    // spends the wildcard.
    host.send({ t: 'battle_wildcard', wildcardId: 'gravity-well', x: 0, z: 0 });
    await host.waitError('wildcard_used');

    host.close();
    p2.close();
  }, 90_000);

  it('decline hands the nomination right back; approval consumes it', async () => {
    const { host, p2 } = await createRoomPair(cp.port, { experimental: true });
    host.send({ t: 'start_draft' });
    await Promise.all([
      host.waitState((s) => s.phase === 'draft', 'draft (host)'),
      p2.waitState((s) => s.phase === 'draft', 'draft (p2)'),
    ]);

    host.send({ t: 'nominate_custom', description: 'a moth-winged lantern keeper who blinds with bursts of light' });
    const first = await host.waitFor(
      (m) =>
        m.t === 'nomination_result' ||
        (m.t === 'error' && (m.code === 'compiler_unavailable' || m.code === 'compiler_failed')),
      'first nomination',
    );
    if (first.t !== 'nomination_result') {
      // Compiler workstream offline — the wiring path is covered in rejections.
      host.close();
      p2.close();
      return;
    }

    // Decline → the right returns in the SAME draft. (drain() so stale
    // pre-nomination snapshots with used === false cannot satisfy the wait.)
    host.drain();
    host.send({ t: 'custom_resolve', accept: false });
    const afterDecline = await host.waitState(
      (s) => s.phase === 'draft' && s.draft!.nominations.p1.used === false,
      'right returned after decline',
    );
    expect(afterDecline.draft!.customFighters).toEqual([]);

    // Nominating again succeeds, with a fresh per-nomination correction budget.
    host.send({ t: 'nominate_custom', description: 'a barnacle-armored tide hermit swinging an anchor flail' });
    const second = await host.waitType('nomination_result');
    expect(second.semanticLeft).toBe(1);
    expect(second.visualLeft).toBe(1);

    // Approval resolves the fighter into the draft and spends the right.
    host.send({ t: 'custom_resolve', accept: true });
    const approved = await host.waitState(
      (s) => (s.draft?.customFighters.length ?? 0) === 1 && s.draft!.nominations.p1.used === true,
      'custom approved',
    );
    expect(approved.draft!.customFighters[0].dna.identity.fighterId).toBe(second.fighter.dna.identity.fighterId);
    // p2's own right is untouched throughout.
    expect(approved.draft!.nominations.p2.used).toBe(false);

    host.send({ t: 'nominate_custom', description: 'a third fighter the same draft' });
    await host.waitError('nomination_used');

    host.close();
    p2.close();
  }, 60_000);
});
