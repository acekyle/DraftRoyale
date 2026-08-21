/**
 * The server is the referee: illegal drafts, tampered prices, and over-budget
 * battle inputs are rejected server-side no matter what the client claims.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadContent } from '../../../tools/load-content';
import { createControlPlane, type ControlPlane } from '../src/server';
import { TestClient, createRoomPair, pickAndWait, tmpDataDir } from './helpers';

const content = loadContent();
const price = (id: string) => content.fighters.get(id)!.balance.draftPrice;

describe('control plane — server-side rejection of illegal actions', () => {
  let cp: ControlPlane;
  let host: TestClient;
  let p2: TestClient;

  beforeAll(async () => {
    cp = await createControlPlane({ port: 0, dataDir: tmpDataDir(), tickIntervalMs: 10 });
    ({ host, p2 } = await createRoomPair(cp.port, { experimental: true }));
  });
  afterAll(async () => {
    host.close();
    p2.close();
    await cp.close();
  });

  it('rejects draft cheating: out-of-turn, tampered price, over-cap, duplicates, early pass', async () => {
    // Only the host can start; spectators/players can't.
    p2.send({ t: 'start_draft' });
    await p2.waitError('not_host');
    host.send({ t: 'start_draft' });
    await host.waitState((s) => s.phase === 'draft', 'draft started');
    await p2.waitState((s) => s.phase === 'draft', 'draft started (p2)');

    // Out-of-turn pick (turn 0 belongs to p1).
    p2.send({ t: 'draft_pick', fighterId: 'aegis-9' });
    await p2.waitError('not_your_turn');

    // Compiler wiring: a parallel workstream is replacing the compiler stub
    // behind the same signatures, so accept either outcome. Stub → the server
    // maps the thrown CompilerUnavailableError to a compiler_unavailable error
    // and does NOT consume the nomination. Live compiler → private
    // nomination_result, correction limits enforced, decline discards.
    host.send({ t: 'nominate_custom', description: 'a glassblown golem that weaponizes heat shimmer' });
    const nomResp = await host.waitFor(
      (m) =>
        m.t === 'nomination_result' ||
        (m.t === 'error' && (m.code === 'compiler_unavailable' || m.code === 'compiler_failed')),
      'nomination response',
    );
    if (nomResp.t === 'nomination_result') {
      expect(nomResp.fighter.dna.identity.fighterId).toBeTruthy();
      expect(nomResp.semanticLeft).toBe(1);
      // One semantic correction allowed…
      host.send({ t: 'custom_correction', kind: 'semantic', instruction: 'less heat, more glass shrapnel' });
      const corr = await host.waitType('nomination_result');
      expect(corr.semanticLeft).toBe(0);
      // …a second is refused.
      host.send({ t: 'custom_correction', kind: 'semantic', instruction: 'even less heat' });
      await host.waitError('correction_limit');
      // Rev-2: declining puts nothing in the market AND hands the nomination
      // right back. (drain() so stale pre-nomination snapshots with
      // used === false cannot satisfy the wait.)
      host.drain();
      host.send({ t: 'custom_resolve', accept: false });
      const afterDecline = await host.waitState(
        (s) => s.phase === 'draft' && s.draft!.nominations.p1.used === false,
        'decline frees the nomination right',
      );
      expect(afterDecline.draft!.customFighters).toEqual([]);
      // Second bite at the apple now succeeds — with a fresh per-nomination
      // correction budget…
      host.send({ t: 'nominate_custom', description: 'second bite at the apple: a chalk-dust duelist' });
      const second = await host.waitType('nomination_result');
      expect(second.semanticLeft).toBe(1);
      // …and we decline again so the market stays untouched for the rest of
      // this suite (custom entries would perturb the affordability endgame).
      host.drain();
      host.send({ t: 'custom_resolve', accept: false });
      const clean = await host.waitState(
        (s) => s.phase === 'draft' && s.draft!.nominations.p1.used === false,
        'second decline',
      );
      expect(clean.draft!.customFighters).toEqual([]);
    } else {
      host.send({ t: 'resync' });
      const afterNom = await host.waitState((s) => s.phase === 'draft', 'resync');
      expect(afterNom.draft!.nominations.p1.used).toBe(false);
      host.send({ t: 'custom_correction', kind: 'semantic', instruction: 'less heat' });
      await host.waitError('no_nomination');
    }

    // Tampered price: the wire message carries fake price fields — the server
    // ignores them entirely and charges the locked content price.
    host.sendRaw({ t: 'draft_pick', fighterId: 'captain-meridian', price: 1, pricePaid: 1 });
    const t1 = await host.waitState((s) => (s.draft?.picks.p1.roster.length ?? 0) >= 1, 'tampered pick');
    expect(t1.draft!.picks.p1.roster[0]).toEqual({ fighterId: 'captain-meridian', pricePaid: price('captain-meridian') });

    // Unknown fighter.
    p2.send({ t: 'draft_pick', fighterId: 'totally-invented' });
    await p2.waitError('unknown_fighter');

    await pickAndWait(p2, 'p2', 'aegis-9', 1); // turn 1

    // Pass with roster < rosterMin.
    p2.send({ t: 'draft_pass' });
    await p2.waitError('pass_too_early');

    await pickAndWait(p2, 'p2', 'cinder-wisp', 2); // turn 2

    // Cap-lock guard (min-roster budget rule against the LIVE market):
    // grimspike after captain-meridian would leave $24M while the opponent can
    // still snipe both remaining cheap fighters — the exact soft-lock that hit
    // a live draft on 2026-08-20. The server must reject the gamble.
    host.send({ t: 'draft_pick', fighterId: 'grimspike' });
    await host.waitError('cannot_afford');
    await pickAndWait(host, 'p1', 'whisper', 2); // turn 3 — reserve satisfied
    await pickAndWait(host, 'p1', 'grimspike', 3); // turn 4 — min roster reached, raw budget applies

    // Duplicate fighter.
    p2.send({ t: 'draft_pick', fighterId: 'captain-meridian' });
    await p2.waitError('fighter_taken');

    // Turn 5: p2's third pick. Afterwards neither side can afford anything at
    // roster >= min, so the server auto-passes both and the draft completes.
    p2.send({ t: 'draft_pick', fighterId: 'orrin' });
    const prep = await host.waitState((s) => s.phase === 'prep', 'prep');
    await p2.waitState((s) => s.phase === 'prep', 'prep (p2)');
    expect(prep.draft!.picks.p1.passed).toBe(true);
    expect(prep.draft!.picks.p2.passed).toBe(true);

    // Every price in both rosters equals the locked content price.
    for (const seat of ['p1', 'p2'] as const)
      for (const r of prep.draft!.picks[seat].roster) expect(r.pricePaid).toBe(price(r.fighterId));
  }, 60_000);

  it('rejects invalid prep and unknown wildcards; wires the wildcard compiler', async () => {
    // Captain not in roster.
    host.send({
      t: 'submit_prep',
      prep: {
        activeFighterIds: ['captain-meridian', 'grimspike', 'whisper'],
        captainId: 'aegis-9', // p2's fighter
        formation: 'balanced',
        reinforcement: 'ally_ko',
      },
    });
    await host.waitError('invalid_prep');
    // Wrong active count.
    host.send({
      t: 'submit_prep',
      prep: { activeFighterIds: ['captain-meridian'], captainId: 'captain-meridian', formation: 'balanced', reinforcement: 'ally_ko' },
    });
    await host.waitError('invalid_prep');

    host.send({
      t: 'submit_prep',
      prep: {
        activeFighterIds: ['captain-meridian', 'grimspike', 'whisper'],
        captainId: 'captain-meridian',
        formation: 'protect_captain',
        reinforcement: 'ally_ko',
      },
    });
    p2.send({
      t: 'submit_prep',
      prep: {
        activeFighterIds: ['aegis-9', 'cinder-wisp', 'orrin'],
        captainId: 'aegis-9',
        formation: 'ambush',
        reinforcement: 'one_enemy_remains',
      },
    });
    await Promise.all([
      host.waitState((s) => s.phase === 'wildcard', 'wildcard'),
      p2.waitState((s) => s.phase === 'wildcard', 'wildcard (p2)'),
    ]);

    // Wildcard compiler wiring — stub or live, the server answers coherently.
    p2.send({ t: 'custom_wildcard', description: 'a localized time-dilation bubble' });
    const wcResp = await p2.waitFor(
      (m) =>
        m.t === 'custom_wildcard_result' ||
        (m.t === 'error' && (m.code === 'compiler_unavailable' || m.code === 'compiler_failed')),
      'custom wildcard response',
    );
    if (wcResp.t === 'custom_wildcard_result') {
      expect(wcResp.wildcard.wildcardId).toBeTruthy();
      // One per player.
      p2.send({ t: 'custom_wildcard', description: 'another one' });
      await p2.waitError('wildcard_nomination_used');
    }

    // Unknown wildcard id.
    host.send({ t: 'lock_wildcard', wildcardId: 'not-a-wildcard' });
    await host.waitError('unknown_wildcard');

    host.send({ t: 'lock_wildcard', wildcardId: 'emp-spire' });
    await host.waitState((s) => s.wildcard?.locked.p1 === true, 'p1 locked');
    p2.send({ t: 'lock_wildcard', wildcardId: null }); // locking "no wildcard" is legal
    await Promise.all([
      host.waitState((s) => s.phase === 'battle', 'battle', 30_000),
      p2.waitState((s) => s.phase === 'battle', 'battle (p2)', 30_000),
    ]);
  }, 60_000);

  it('rejects a third tactical command and a second wildcard deployment', async () => {
    // Third tactical command (2 tokens in RULESET_S0).
    host.send({ t: 'battle_command', command: 'press_attack' });
    host.send({ t: 'battle_command', command: 'spread_out' });
    host.send({ t: 'battle_command', command: 'regroup' });
    await host.waitFor((m) => m.t === 'battle_input' && m.input.kind === 'command' && m.input.command === 'press_attack', 'cmd 1');
    await host.waitFor((m) => m.t === 'battle_input' && m.input.kind === 'command' && m.input.command === 'spread_out', 'cmd 2');
    const third = await host.waitError('no_tokens');
    expect(third.message).toContain('token');

    // Malformed command / unknown target.
    host.send({ t: 'battle_command', command: 'focus_target' });
    await host.waitError('bad_message');
    p2.send({ t: 'battle_command', command: 'focus_target', targetFighterId: 'ghost-fighter' });
    await p2.waitError('unknown_fighter');

    // Rev-2: battle_wildcard names the wildcard. A foreign/unknown id (host
    // locked emp-spire) is rejected without consuming anything…
    host.send({ t: 'battle_wildcard', wildcardId: 'gravity-well', x: 0, z: 0 });
    await host.waitError('unknown_wildcard');
    // …and an id-less legacy frame is malformed.
    host.sendRaw({ t: 'battle_wildcard', x: 0, z: 0 });
    await host.waitError('bad_message');

    // The correct id deploys exactly as before; a second deployment is refused.
    host.send({ t: 'battle_wildcard', wildcardId: 'emp-spire', x: 0, z: 0 });
    const deployed = await host.waitFor((m) => m.t === 'battle_input' && m.input.kind === 'wildcard', 'wildcard deploy');
    if (deployed.t === 'battle_input' && deployed.input.kind === 'wildcard')
      expect(deployed.input.wildcardId).toBe('emp-spire');
    host.send({ t: 'battle_wildcard', wildcardId: 'emp-spire', x: 10, z: 10 });
    await host.waitError('wildcard_used');

    // p2 locked null — no wildcard to deploy at all, whatever id it names.
    p2.send({ t: 'battle_wildcard', wildcardId: 'eclipse', x: 0, z: 0 });
    await p2.waitError('no_wildcard');
  }, 60_000);

  it('accepted custom fighters enter the market at compiled price, draftable by the nominator only', async () => {
    const pair = await createRoomPair(cp.port, { experimental: true });
    const { host: h, p2: q } = pair;
    h.send({ t: 'start_draft' });
    await Promise.all([
      h.waitState((s) => s.phase === 'draft', 'draft'),
      q.waitState((s) => s.phase === 'draft', 'draft (p2)'),
    ]);

    h.send({ t: 'nominate_custom', description: 'a tide-caller who bends harbor water into shields and spears' });
    const resp = await h.waitFor(
      (m) =>
        m.t === 'nomination_result' ||
        (m.t === 'error' && (m.code === 'compiler_unavailable' || m.code === 'compiler_failed')),
      'nomination response',
    );
    if (resp.t !== 'nomination_result') {
      // Compiler workstream still offline — the wiring path is covered above.
      h.close();
      q.close();
      return;
    }
    const customId = resp.fighter.dna.identity.fighterId;
    const customPrice = resp.fighter.dna.balance.draftPrice;
    h.send({ t: 'custom_resolve', accept: true });
    const withCustom = await h.waitState((s) => (s.draft?.customFighters.length ?? 0) === 1, 'custom in market');
    expect(withCustom.draft!.customFighters[0].dna.identity.fighterId).toBe(customId);
    expect(withCustom.draft!.nominations.p1.used).toBe(true);

    // Approval consumed the one-per-player right — a second nomination is refused.
    h.send({ t: 'nominate_custom', description: 'a second custom the same draft' });
    await h.waitError('nomination_used');

    // Non-nominator cannot draft it (on their own turn).
    await pickAndWait(h, 'p1', 'whisper', 1); // turn 0
    q.send({ t: 'draft_pick', fighterId: customId }); // turn 1 belongs to p2
    await q.waitError('not_your_custom');
    await pickAndWait(q, 'p2', 'riptide', 1); // turn 1
    await pickAndWait(q, 'p2', 'vex', 2); // turn 2

    // The nominator drafts it at the compiled (server-locked) price.
    h.sendRaw({ t: 'draft_pick', fighterId: customId, pricePaid: 1 }); // tamper ignored
    const st = await h.waitState((s) => (s.draft?.picks.p1.roster.length ?? 0) >= 2, 'custom drafted');
    expect(st.draft!.picks.p1.roster[1]).toEqual({ fighterId: customId, pricePaid: customPrice });

    h.close();
    q.close();
  }, 60_000);
});
