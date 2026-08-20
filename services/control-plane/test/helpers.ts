/** Real-ws test client + scripted flows shared by the control-plane suites. */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import type { ClientMessage, RoomSnapshot, ServerMessage } from '@arena/contracts';

export function tmpDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'arena-cp-'));
}

type Waiter = {
  pred: (m: ServerMessage) => boolean;
  resolve: (m: ServerMessage) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class TestClient {
  sessionToken = '';
  guestId = '';
  /** Observers that see every message in arrival order (never consume). */
  readonly hooks: ((m: ServerMessage) => void)[] = [];
  private buf: ServerMessage[] = [];
  private waiters: Waiter[] = [];

  private constructor(readonly ws: WebSocket) {}

  static async connect(port: number): Promise<TestClient> {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const c = new TestClient(ws);
    ws.on('message', (data) => c.onMessage(JSON.parse(data.toString()) as ServerMessage));
    await new Promise<void>((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
    return c;
  }

  private onMessage(m: ServerMessage) {
    for (const h of this.hooks) h(m);
    for (let i = 0; i < this.waiters.length; i++) {
      if (this.waiters[i].pred(m)) {
        const [w] = this.waiters.splice(i, 1);
        clearTimeout(w.timer);
        w.resolve(m);
        return;
      }
    }
    this.buf.push(m);
  }

  send(m: ClientMessage) {
    this.ws.send(JSON.stringify(m));
  }

  /** Send arbitrary JSON (for tamper tests). */
  sendRaw(m: unknown) {
    this.ws.send(JSON.stringify(m));
  }

  /** Send a raw text frame verbatim (malformed-JSON tests). */
  sendText(raw: string) {
    this.ws.send(raw);
  }

  waitFor<T extends ServerMessage = ServerMessage>(
    pred: (m: ServerMessage) => boolean,
    desc = 'message',
    timeoutMs = 20_000,
  ): Promise<T> {
    const idx = this.buf.findIndex(pred);
    if (idx >= 0) return Promise.resolve(this.buf.splice(idx, 1)[0] as T);
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w.timer !== timer);
        reject(new Error(`timed out waiting for ${desc}`));
      }, timeoutMs);
      this.waiters.push({ pred, resolve: resolve as (m: ServerMessage) => void, timer });
    });
  }

  waitType<K extends ServerMessage['t']>(t: K, timeoutMs?: number): Promise<Extract<ServerMessage, { t: K }>> {
    return this.waitFor((m) => m.t === t, `'${t}'`, timeoutMs);
  }

  waitError(code: string, timeoutMs?: number): Promise<Extract<ServerMessage, { t: 'error' }>> {
    return this.waitFor((m) => m.t === 'error' && m.code === code, `error '${code}'`, timeoutMs);
  }

  async waitState(pred: (s: RoomSnapshot) => boolean = () => true, desc = 'room_state', timeoutMs?: number): Promise<RoomSnapshot> {
    const m = await this.waitFor<Extract<ServerMessage, { t: 'room_state' }>>(
      (x) => x.t === 'room_state' && pred(x.state),
      desc,
      timeoutMs,
    );
    return m.state;
  }

  async hello(name: string, token?: string) {
    this.send({ t: 'hello', name, ...(token ? { sessionToken: token } : {}) });
    const w = await this.waitType('welcome');
    this.sessionToken = w.sessionToken;
    this.guestId = w.guestId;
    return w;
  }

  drain() {
    this.buf = [];
  }

  close() {
    this.ws.close();
  }

  terminate() {
    this.ws.terminate();
  }
}

// ---------------------------------------------------------------------------
// Scripted flows
// ---------------------------------------------------------------------------

// p1 takes the three cheapest fighters so that (under current pricing) p1 can
// still afford a fourth after six picks and must lock the roster with an
// explicit draft_pass, while p2 is auto-passed. Prices are content-tuned by a
// parallel workstream, so finishDraft() below adapts to either endgame.
export const P1_PICKS = ['whisper', 'cinder-wisp', 'riptide'];
export const P2_PICKS = ['vex', 'sable-howl', 'orrin'];

export async function createRoomPair(port: number, opts: { experimental?: boolean } = {}) {
  const host = await TestClient.connect(port);
  await host.hello('Alice');
  const p2 = await TestClient.connect(port);
  await p2.hello('Bob');
  host.send({ t: 'create_room', experimental: opts.experimental ?? false });
  const created = await host.waitState((s) => s.phase === 'lobby', 'room created');
  p2.send({ t: 'join_room', roomId: created.roomId, as: 'player' });
  await p2.waitState((s) => s.participants.some((q) => q.guestId === p2.guestId), 'joined room');
  await host.waitState((s) => s.participants.length === 2, 'p2 visible to host');
  return { host, p2, roomId: created.roomId };
}

export async function pickAndWait(c: TestClient, seat: 'p1' | 'p2', fighterId: string, expectLen: number) {
  c.send({ t: 'draft_pick', fighterId });
  await c.waitState((s) => (s.draft?.picks[seat].roster.length ?? 0) >= expectLen, `pick ${fighterId}`);
}

/**
 * After both players hold 3+ fighters, drive the draft to completion no matter
 * how the price sheet is currently tuned: whoever the server still puts on the
 * clock passes explicitly; players the server auto-passed need nothing.
 */
export async function finishDraft(host: TestClient, p2: TestClient) {
  for (let guard = 0; guard < 5; guard++) {
    const st = await host.waitState(
      (s) =>
        s.phase === 'prep' ||
        (s.phase === 'draft' &&
          !!s.draft &&
          s.draft.onClock !== null &&
          s.draft.picks[s.draft.onClock].roster.length >= 3),
      'draft endgame',
    );
    if (st.phase === 'prep') {
      await p2.waitState((s) => s.phase === 'prep', 'draft complete (p2)');
      return st;
    }
    const seat = st.draft!.onClock!;
    (seat === 'p1' ? host : p2).send({ t: 'draft_pass' });
  }
  throw new Error('draft did not complete');
}

/**
 * Legal 3v3 draft: p1 takes P1_PICKS, p2 takes P2_PICKS, then finishDraft
 * completes the endgame (explicit passes and/or server auto-passes).
 * Ends in prep.
 */
export async function runScriptedDraft(host: TestClient, p2: TestClient) {
  host.send({ t: 'start_draft' });
  await Promise.all([
    host.waitState((s) => s.phase === 'draft', 'draft started (host)'),
    p2.waitState((s) => s.phase === 'draft', 'draft started (p2)'),
  ]);
  await pickAndWait(host, 'p1', P1_PICKS[0], 1); // turn 0
  await pickAndWait(p2, 'p2', P2_PICKS[0], 1); // turn 1
  await pickAndWait(p2, 'p2', P2_PICKS[1], 2); // turn 2
  await pickAndWait(host, 'p1', P1_PICKS[1], 2); // turn 3
  await pickAndWait(host, 'p1', P1_PICKS[2], 3); // turn 4
  p2.send({ t: 'draft_pick', fighterId: P2_PICKS[2] }); // turn 5
  return finishDraft(host, p2);
}

export async function submitPreps(
  host: TestClient,
  p2: TestClient,
  p1Actives: string[] = P1_PICKS,
  p2Actives: string[] = P2_PICKS,
) {
  host.send({
    t: 'submit_prep',
    prep: { activeFighterIds: p1Actives, captainId: p1Actives[0], formation: 'balanced', reinforcement: 'ally_ko' },
  });
  p2.send({
    t: 'submit_prep',
    prep: { activeFighterIds: p2Actives, captainId: p2Actives[0], formation: 'spread', reinforcement: 'never_hold_reserve' },
  });
  await Promise.all([
    host.waitState((s) => s.phase === 'wildcard', 'wildcard phase (host)'),
    p2.waitState((s) => s.phase === 'wildcard', 'wildcard phase (p2)'),
  ]);
}

export async function lockWildcards(
  host: TestClient,
  p2: TestClient,
  p1Wc: string | null = 'gravity-well',
  p2Wc: string | null = 'eclipse',
) {
  host.send({ t: 'lock_wildcard', wildcardId: p1Wc });
  await host.waitState((s) => s.wildcard?.locked.p1 === true, 'p1 locked');
  p2.send({ t: 'lock_wildcard', wildcardId: p2Wc });
  const [state] = await Promise.all([
    host.waitState((s) => s.phase === 'battle', 'battle (host)', 30_000),
    p2.waitState((s) => s.phase === 'battle', 'battle (p2)', 30_000),
  ]);
  return state;
}
