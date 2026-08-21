/**
 * Control plane — lightweight custom WebSocket service for online rooms
 * (ADR-0006/0007: bake-off winner over Colyseus/Nakama; see project records).
 *
 * Owns: guest sessions (token reconnect), room lifecycle, and transport
 * hardening (JSON guards, 64KB payload cap, per-connection rate limits).
 * Game rules live in room.ts; the deterministic engine in @arena/combat-sim.
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomInt, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, WebSocket } from 'ws';
import {
  DEFAULT_SERVER_PORT,
  MAX_SPECTATORS,
  PROTOCOL_VERSION,
  RULESET_S0,
  type ClientMessage,
  type ServerMessage,
} from '@arena/contracts';
import { loadContent, type LoadedContent } from '../../../tools/load-content';
import { Room, type Participant, type Seat } from './room';

const MAX_PAYLOAD_BYTES = 64 * 1024;
const TELEMETRY_MAX_BODY_BYTES = 256 * 1024;
const TELEMETRY_MAX_EVENTS = 500;
// CORS: the alpha client is served from GitHub Pages while telemetry lands on
// this self-hosted server (Cloudflare tunnel) — cross-origin, no credentials,
// no cookies, so a wildcard origin is safe here.
const CORS_HEADERS = { 'access-control-allow-origin': '*' } as const;
const RATE_CAPACITY = 40; // burst
const RATE_REFILL_PER_SEC = 20; // sustained ~20 msg/sec
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
const ROOM_CODE_LEN = 6;
const MAX_NAME_LEN = 24;

export interface ControlPlaneOptions {
  port?: number;
  dataDir?: string;
  /**
   * Internal: wall-clock ms between authoritative sim steps. Game time is
   * always RULESET_S0.tickMs (250ms) per tick; tests shrink this to run
   * battles faster than real time.
   */
  tickIntervalMs?: number;
}

export interface ControlPlane {
  port: number;
  close(): Promise<void>;
}

interface Session {
  token: string;
  guestId: string;
  name: string;
  roomId: string | null;
}

interface ConnState {
  session: Session | null;
  rateTokens: number;
  rateLast: number;
  lastRateErrAt: number;
}

export async function createControlPlane(opts: ControlPlaneOptions = {}): Promise<ControlPlane> {
  const content: LoadedContent = loadContent();
  const dataDir = opts.dataDir ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
  const tickIntervalMs = opts.tickIntervalMs ?? RULESET_S0.tickMs;

  const sessions = new Map<string, Session>(); // token -> session
  const sessionsByGuest = new Map<string, Session>();
  const rooms = new Map<string, Room>();
  const conns = new Map<WebSocket, ConnState>();
  const socketByGuest = new Map<string, WebSocket>();

  // HTTP wrapper: /health for PaaS health checks and tunnel probes, /telemetry
  // for the Stage 1 metrics pipeline; WS upgrades ride the same port.
  const httpServer = createHttpServer((req, res) => {
    const path = (req.url ?? '').split('?')[0];
    if (req.method === 'OPTIONS') {
      // CORS preflight — the alpha client POSTs JSON from another origin.
      res.writeHead(204, {
        ...CORS_HEADERS,
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-allow-headers': 'content-type',
        'access-control-max-age': '86400',
      });
      res.end();
      return;
    }
    if (req.method === 'POST' && path === '/telemetry') {
      onTelemetryPost(req, res);
      return;
    }
    if (path === '/health' || path === '/') {
      res.writeHead(200, { 'content-type': 'application/json', ...CORS_HEADERS });
      res.end(JSON.stringify({ ok: true, service: 'infinite-arena-control-plane', rooms: rooms.size }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  const wss = new WebSocketServer({ server: httpServer, maxPayload: MAX_PAYLOAD_BYTES });
  httpServer.listen(opts.port ?? DEFAULT_SERVER_PORT);
  await once(httpServer, 'listening');
  const port = (httpServer.address() as AddressInfo).port;

  function send(guestId: string, msg: ServerMessage) {
    const ws = socketByGuest.get(guestId);
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  function sendWs(ws: WebSocket, msg: ServerMessage) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  function persistMatch(record: unknown) {
    mkdirSync(dataDir, { recursive: true });
    appendFileSync(join(dataDir, 'matches.jsonl'), `${JSON.stringify(record)}\n`, 'utf8');
  }

  // ---------------------------------------------------------------------------
  // Telemetry intake (POST /telemetry) — Stage 1 friend-group metrics pipeline.
  // Events are appended verbatim (plus a server receivedAt) to telemetry.jsonl;
  // aggregation lives in tools/funnel-report.ts. Malformed events are dropped
  // individually rather than failing the whole batch.
  // ---------------------------------------------------------------------------

  function isTelemetryEvent(e: unknown): e is Record<string, unknown> {
    if (typeof e !== 'object' || e === null || Array.isArray(e)) return false;
    const ev = e as Record<string, unknown>;
    if (typeof ev.event !== 'string' || ev.event.length === 0 || ev.event.length > 200) return false;
    if (typeof ev.at !== 'string') return false;
    if (typeof ev.source !== 'string') return false;
    if (ev.props !== undefined && (typeof ev.props !== 'object' || ev.props === null || Array.isArray(ev.props))) return false;
    if (ev.clientId !== undefined && typeof ev.clientId !== 'string') return false;
    if (ev.groupKey !== undefined && typeof ev.groupKey !== 'string') return false;
    return true;
  }

  function persistTelemetry(events: Record<string, unknown>[]) {
    mkdirSync(dataDir, { recursive: true });
    const receivedAt = new Date().toISOString();
    const lines = events.map((e) => `${JSON.stringify({ ...e, receivedAt })}\n`).join('');
    appendFileSync(join(dataDir, 'telemetry.jsonl'), lines, 'utf8');
  }

  function respondJson(res: ServerResponse, status: number, body: unknown) {
    res.writeHead(status, { 'content-type': 'application/json', ...CORS_HEADERS });
    res.end(JSON.stringify(body));
  }

  function onTelemetryPost(req: IncomingMessage, res: ServerResponse) {
    const chunks: Buffer[] = [];
    let size = 0;
    let rejected = false;
    req.on('data', (chunk: Buffer) => {
      if (rejected) return;
      size += chunk.length;
      if (size > TELEMETRY_MAX_BODY_BYTES) {
        // Answer 413 immediately and drain the rest so the client still gets
        // the status instead of a reset connection.
        rejected = true;
        chunks.length = 0;
        respondJson(res, 413, { ok: false, error: 'body_too_large' });
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (rejected) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        return respondJson(res, 400, { ok: false, error: 'bad_json' });
      }
      const events = (parsed as { events?: unknown } | null)?.events;
      if (!Array.isArray(events)) return respondJson(res, 400, { ok: false, error: 'events_must_be_array' });
      if (events.length > TELEMETRY_MAX_EVENTS) return respondJson(res, 413, { ok: false, error: 'too_many_events' });
      const accepted = events.filter(isTelemetryEvent);
      if (accepted.length > 0) persistTelemetry(accepted);
      respondJson(res, 200, { ok: true, accepted: accepted.length });
    });
    req.on('error', () => {
      /* client went away mid-upload; nothing to do */
    });
  }

  const roomDeps = { content, tickIntervalMs, send, persistMatch };

  function newRoomCode(): string {
    for (;;) {
      let code = '';
      for (let i = 0; i < ROOM_CODE_LEN; i++) code += ROOM_ALPHABET[randomInt(ROOM_ALPHABET.length)];
      if (!rooms.has(code)) return code;
    }
  }

  function destroyRoom(room: Room, reason: string) {
    room.dispose();
    rooms.delete(room.id);
    for (const p of room.participants) {
      const session = sessionsByGuest.get(p.guestId);
      if (session && session.roomId === room.id) session.roomId = null;
      if (p.connected) send(p.guestId, { t: 'room_closed', reason });
    }
    room.participants = [];
  }

  /** Remove a participant entirely (lobby leave, spectator departure). */
  function removeFromRoom(room: Room, guestId: string) {
    const p = room.findParticipant(guestId);
    if (!p) return;
    room.removeParticipant(guestId);
    const session = sessionsByGuest.get(guestId);
    if (session && session.roomId === room.id) session.roomId = null;
    if (p.guestId === room.hostGuestId) {
      const nextHost = room.participants.find((q) => q.seat !== null);
      if (nextHost) {
        room.hostGuestId = nextHost.guestId;
        nextHost.role = 'host';
      } else {
        destroyRoom(room, 'the host left the lobby');
        return;
      }
    }
    if (room.participants.length === 0) {
      destroyRoom(room, 'room empty');
      return;
    }
    room.broadcastState();
  }

  // -------------------------------------------------------------------------
  // Message handlers
  // -------------------------------------------------------------------------

  function onHello(ws: WebSocket, conn: ConnState, msg: { name?: unknown; sessionToken?: unknown }) {
    let name = typeof msg.name === 'string' ? msg.name.trim().slice(0, MAX_NAME_LEN) : '';
    if (name.length === 0) name = 'Guest';

    let session: Session | undefined;
    if (typeof msg.sessionToken === 'string') session = sessions.get(msg.sessionToken);
    if (!session) {
      session = { token: randomUUID(), guestId: randomUUID(), name, roomId: null };
      sessions.set(session.token, session);
      sessionsByGuest.set(session.guestId, session);
    } else if (!session.roomId) {
      session.name = name; // renames only outside a room — names are stable mid-game
    }

    // One live socket per session: replace any previous connection.
    const prev = socketByGuest.get(session.guestId);
    if (prev && prev !== ws) {
      const prevConn = conns.get(prev);
      if (prevConn) prevConn.session = null;
      prev.close(4001, 'session resumed elsewhere');
    }
    conn.session = session;
    socketByGuest.set(session.guestId, ws);

    sendWs(ws, { t: 'welcome', sessionToken: session.token, guestId: session.guestId, protocolVersion: PROTOCOL_VERSION });

    if (session.roomId) {
      const room = rooms.get(session.roomId);
      const participant = room?.findParticipant(session.guestId);
      if (room && participant) {
        room.markConnected(session.guestId);
        // Fresh snapshot for the reconnecting client (includes full battle
        // input timeline + authorizedTick for local-sim fast-forward), then
        // tell everyone else the participant is back.
        room.broadcastState();
      } else {
        session.roomId = null;
      }
    }
  }

  function onCreateRoom(ws: WebSocket, session: Session, msg: { experimental?: unknown }) {
    if (session.roomId && rooms.has(session.roomId))
      return sendWs(ws, { t: 'error', code: 'already_in_room', message: 'leave your current room first' });
    session.roomId = null;
    const experimental = msg.experimental === true;
    const room = new Room(newRoomCode(), session.guestId, experimental, roomDeps);
    const participant: Participant = {
      guestId: session.guestId,
      name: session.name,
      role: 'host',
      seat: 'p1',
      connected: true,
      lastReactionAt: 0,
    };
    room.addParticipant(participant);
    rooms.set(room.id, room);
    session.roomId = room.id;
    room.broadcastState();
  }

  function onJoinRoom(ws: WebSocket, session: Session, msg: { roomId?: unknown; as?: unknown }) {
    if (session.roomId && rooms.has(session.roomId))
      return sendWs(ws, { t: 'error', code: 'already_in_room', message: 'leave your current room first' });
    session.roomId = null;
    if (typeof msg.roomId !== 'string')
      return sendWs(ws, { t: 'error', code: 'bad_message', message: 'roomId must be a string' });
    if (msg.as !== 'player' && msg.as !== 'spectator')
      return sendWs(ws, { t: 'error', code: 'bad_message', message: "as must be 'player' or 'spectator'" });
    const room = rooms.get(msg.roomId.trim().toUpperCase());
    if (!room) return sendWs(ws, { t: 'error', code: 'room_not_found', message: 'no room with that code' });

    let participant: Participant;
    if (msg.as === 'player') {
      const seat: Seat | null = room.seatFree('p1') ? 'p1' : room.seatFree('p2') ? 'p2' : null;
      if (!seat || room.phase !== 'lobby')
        return sendWs(ws, {
          t: 'error',
          code: seat ? 'bad_phase' : 'room_full',
          message: seat ? 'the match already started — join as a spectator' : 'both player seats are taken',
        });
      participant = { guestId: session.guestId, name: session.name, role: 'player', seat, connected: true, lastReactionAt: 0 };
    } else {
      if (room.spectatorCount() >= MAX_SPECTATORS)
        return sendWs(ws, { t: 'error', code: 'room_full', message: `spectator limit (${MAX_SPECTATORS}) reached` });
      participant = { guestId: session.guestId, name: session.name, role: 'spectator', seat: null, connected: true, lastReactionAt: 0 };
    }
    room.addParticipant(participant);
    session.roomId = room.id;
    room.broadcastState();
  }

  function onLeaveRoom(ws: WebSocket, session: Session) {
    const room = session.roomId ? rooms.get(session.roomId) : undefined;
    if (!room) {
      session.roomId = null;
      return sendWs(ws, { t: 'error', code: 'not_in_room', message: 'you are not in a room' });
    }
    const participant = room.findParticipant(session.guestId);
    if (!participant) {
      session.roomId = null;
      return;
    }
    if (room.phase === 'lobby' || participant.role === 'spectator') {
      removeFromRoom(room, session.guestId);
    } else {
      // In-progress rooms are never destroyed by departure; fighters are
      // autonomous, the battle continues, and the seat stays reserved for a
      // token reconnect.
      room.markDisconnected(session.guestId);
      room.broadcastState();
    }
  }

  function onSocketClosed(ws: WebSocket) {
    const conn = conns.get(ws);
    conns.delete(ws);
    const session = conn?.session;
    if (!session) return;
    if (socketByGuest.get(session.guestId) === ws) socketByGuest.delete(session.guestId);
    const room = session.roomId ? rooms.get(session.roomId) : undefined;
    if (!room) return;
    const participant = room.findParticipant(session.guestId);
    if (!participant) return;
    if (room.phase === 'lobby' || participant.role === 'spectator') {
      removeFromRoom(room, session.guestId);
    } else {
      room.markDisconnected(session.guestId);
      if (room.phase === 'finished' && room.connectedCount() === 0) {
        destroyRoom(room, 'match finished, everyone left');
        return;
      }
      room.broadcastState();
    }
  }

  // -------------------------------------------------------------------------
  // Transport
  // -------------------------------------------------------------------------

  const ROOM_SCOPED = new Set<ClientMessage['t']>([
    'start_draft', 'draft_pick', 'draft_pass', 'nominate_custom', 'custom_correction',
    'custom_resolve', 'submit_prep', 'lock_wildcard', 'custom_wildcard',
    'battle_command', 'battle_wildcard', 'reaction', 'resync',
  ]);

  wss.on('connection', (ws) => {
    const conn: ConnState = { session: null, rateTokens: RATE_CAPACITY, rateLast: Date.now(), lastRateErrAt: 0 };
    conns.set(ws, conn);

    ws.on('message', (data, isBinary) => {
      if (isBinary) return sendWs(ws, { t: 'error', code: 'bad_message', message: 'binary frames are not accepted' });

      // Token-bucket rate limit (~20 msg/sec sustained, small burst).
      const now = Date.now();
      conn.rateTokens = Math.min(RATE_CAPACITY, conn.rateTokens + ((now - conn.rateLast) / 1000) * RATE_REFILL_PER_SEC);
      conn.rateLast = now;
      if (conn.rateTokens < 1) {
        if (now - conn.lastRateErrAt > 1000) {
          conn.lastRateErrAt = now;
          sendWs(ws, { t: 'error', code: 'rate_limited', message: 'slow down' });
        }
        return;
      }
      conn.rateTokens -= 1;

      let msg: ClientMessage;
      try {
        msg = JSON.parse(data.toString('utf8')) as ClientMessage;
      } catch {
        return sendWs(ws, { t: 'error', code: 'bad_json', message: 'message must be valid JSON' });
      }
      if (typeof msg !== 'object' || msg === null || typeof (msg as { t?: unknown }).t !== 'string')
        return sendWs(ws, { t: 'error', code: 'bad_message', message: 'message must have a string t field' });

      if (msg.t === 'ping') return sendWs(ws, { t: 'pong' });
      if (msg.t === 'hello') return onHello(ws, conn, msg);

      const session = conn.session;
      if (!session)
        return sendWs(ws, { t: 'error', code: 'not_authenticated', message: 'send hello first' });

      if (msg.t === 'create_room') return onCreateRoom(ws, session, msg);
      if (msg.t === 'join_room') return onJoinRoom(ws, session, msg);
      if (msg.t === 'leave_room') return onLeaveRoom(ws, session);

      if (ROOM_SCOPED.has(msg.t)) {
        const room = session.roomId ? rooms.get(session.roomId) : undefined;
        if (!room) return sendWs(ws, { t: 'error', code: 'not_in_room', message: 'join a room first' });
        return room.handleMessage(session.guestId, msg);
      }
      return sendWs(ws, { t: 'error', code: 'unknown_type', message: `unknown message type ${(msg as { t: string }).t}` });
    });

    ws.on('close', () => onSocketClosed(ws));
    ws.on('error', () => {
      /* close follows; never let a socket error crash the server */
    });
  });

  return {
    port,
    async close() {
      for (const room of rooms.values()) room.dispose();
      rooms.clear();
      for (const ws of wss.clients) ws.terminate();
      await new Promise<void>((resolve, reject) => wss.close((err) => (err ? reject(err) : resolve())));
      await new Promise<void>((resolve, reject) => httpServer.close((err) => (err ? reject(err) : resolve())));
    },
  };
}
