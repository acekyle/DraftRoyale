/**
 * Online draft deadlock backstop: after the cap-lock guard (minRosterReserve)
 * a seat below rosterMin with nothing affordable should be near-impossible —
 * but custom-fighter compiled prices could theoretically still create a seat
 * that can neither pick (cannot_afford) nor pass (pass_too_early). The room
 * must NEVER hang: when the on-clock evaluation finds a seat below rosterMin
 * with nothing draftable under even the RAW remaining cap, the draft is voided
 * — the room resets to the lobby (rematch machinery), both clients get the
 * 'draft_voided' notice plus a lobby snapshot, and the event lands in the
 * append-only audit log.
 *
 * The state is forced by direct room-state manipulation (an absurd pricePaid,
 * standing in for a pathological compiled price): the WS validators correctly
 * make it unreachable from the outside, which is exactly why this is a
 * backstop.
 */
import { describe, expect, it } from 'vitest';
import { RULESET_S0, type ClientMessage, type RoomSnapshot, type ServerMessage } from '@arena/contracts';
import { loadContent } from '../../../tools/load-content';
import { Room, type Participant, type RoomDeps } from '../src/room';
import { P1_PICKS, P2_PICKS } from './helpers';

interface Harness {
  room: Room;
  sent: Record<string, ServerMessage[]>;
  audits: Record<string, unknown>[];
}

function makeRoom(): Harness {
  const sent: Record<string, ServerMessage[]> = { g1: [], g2: [] };
  const audits: Record<string, unknown>[] = [];
  const deps: RoomDeps = {
    content: loadContent(),
    tickIntervalMs: 5,
    send: (guestId, msg) => {
      (sent[guestId] ??= []).push(msg);
    },
    persistMatch: () => {},
    persistReport: () => {},
    appendAudit: (r) => {
      audits.push(r as Record<string, unknown>);
    },
  };
  const room = new Room('VOIDRM', 'g1', false, deps);
  const mk = (guestId: string, name: string, role: Participant['role'], seat: Participant['seat']): Participant => ({
    guestId, name, role, seat, connected: true, lastReactionAt: 0, reportsFiled: 0,
  });
  room.addParticipant(mk('g1', 'Alice', 'host', 'p1'));
  room.addParticipant(mk('g2', 'Bob', 'player', 'p2'));
  return { room, sent, audits };
}

const msg = (m: ClientMessage) => m;
const lastState = (frames: ServerMessage[]): RoomSnapshot | undefined =>
  [...frames].reverse().find((f): f is Extract<ServerMessage, { t: 'room_state' }> => f.t === 'room_state')?.state;

describe('control plane — draft deadlock backstop (draft_voided)', () => {
  it('voids an unsalvageable draft back to the lobby for both clients, then plays again', () => {
    const { room, sent, audits } = makeRoom();

    room.handleMessage('g1', msg({ t: 'start_draft' }));
    expect(room.phase).toBe('draft');

    // Turn 0: p1 takes a legal pick.
    room.handleMessage('g1', msg({ t: 'draft_pick', fighterId: P1_PICKS[0] }));

    // Force the theoretical state: p1's pick carried an absurd compiled price
    // that consumed all but 1 credit of the cap — below rosterMin with nothing
    // raw-affordable left. Unreachable through the WS validators by design.
    const internals = room as unknown as {
      draft: { picks: Record<'p1' | 'p2', { roster: { fighterId: string; pricePaid: number }[] }> };
    };
    internals.draft.picks.p1.roster[0].pricePaid = RULESET_S0.salaryCap - 1;

    // Turns 1–2: p2 drafts normally; advancing to turn 3 evaluates p1's seat.
    room.handleMessage('g2', msg({ t: 'draft_pick', fighterId: P2_PICKS[0] }));
    expect(room.phase).toBe('draft'); // p2 still on clock (ABBA) — not voided yet
    room.handleMessage('g2', msg({ t: 'draft_pick', fighterId: P2_PICKS[1] }));

    // The room is back in the lobby — not hung, not in prep.
    expect(room.phase).toBe('lobby');
    expect(room.outcome).toBeNull();

    // Both clients received the dedicated notice AND a lobby snapshot.
    for (const guest of ['g1', 'g2'] as const) {
      const err = sent[guest].find(
        (f): f is Extract<ServerMessage, { t: 'error' }> => f.t === 'error' && f.code === 'draft_voided',
      );
      expect(err, `${guest} draft_voided notice`).toBeDefined();
      expect(err!.message).toContain('Draft voided');
      const snap = lastState(sent[guest]);
      expect(snap?.phase, `${guest} lobby snapshot`).toBe('lobby');
      expect(snap?.draft).toBeNull();
      expect(snap?.participants).toHaveLength(2); // seats and identity survive
    }

    // The void is on the immutable audit trail.
    expect(audits).toContainEqual(
      expect.objectContaining({ type: 'draft_voided', roomId: 'VOIDRM', stuckSeat: 'p1', rosterSize: 1, capRemaining: 1 }),
    );

    // And the room is genuinely playable again: fresh draft, locked prices.
    room.handleMessage('g1', msg({ t: 'start_draft' }));
    expect(room.phase).toBe('draft');
    room.handleMessage('g1', msg({ t: 'draft_pick', fighterId: P1_PICKS[0] }));
    const fresh = lastState(sent.g1)!;
    expect(fresh.phase).toBe('draft');
    expect(fresh.draft!.picks.p1.roster).toHaveLength(1);
    const marketPrice = loadContent().fighters.get(P1_PICKS[0])!.balance.draftPrice;
    expect(fresh.draft!.picks.p1.roster[0].pricePaid).toBe(marketPrice); // tampered price gone
    expect(fresh.draft!.picks.p2.roster).toHaveLength(0);
  });

  it('does not void a healthy endgame: a seat at rosterMin that cannot afford anything is auto-passed', () => {
    const { room, audits } = makeRoom();
    room.handleMessage('g1', msg({ t: 'start_draft' }));

    // Legal 3+3 draft: p1 and p2 alternate per the ABBA order (p1,p2,p2,p1,p1,p2).
    room.handleMessage('g1', msg({ t: 'draft_pick', fighterId: P1_PICKS[0] })); // turn 0
    room.handleMessage('g2', msg({ t: 'draft_pick', fighterId: P2_PICKS[0] })); // turn 1
    room.handleMessage('g2', msg({ t: 'draft_pick', fighterId: P2_PICKS[1] })); // turn 2
    room.handleMessage('g1', msg({ t: 'draft_pick', fighterId: P1_PICKS[1] })); // turn 3
    room.handleMessage('g1', msg({ t: 'draft_pick', fighterId: P1_PICKS[2] })); // turn 4
    room.handleMessage('g2', msg({ t: 'draft_pick', fighterId: P2_PICKS[2] })); // turn 5

    // Drive the endgame: whoever is on the clock with >= rosterMin locks in.
    for (let guard = 0; guard < 6 && room.phase === 'draft'; guard++) {
      const snap = room.snapshot();
      const onClock = snap.draft?.onClock;
      if (!onClock) break;
      expect(snap.draft!.picks[onClock].roster.length).toBeGreaterThanOrEqual(RULESET_S0.rosterMin);
      room.handleMessage(onClock === 'p1' ? 'g1' : 'g2', msg({ t: 'draft_pass' }));
    }

    expect(room.phase).toBe('prep'); // completed normally
    expect(audits.some((a) => a.type === 'draft_voided')).toBe(false);
    room.dispose();
  });
});
