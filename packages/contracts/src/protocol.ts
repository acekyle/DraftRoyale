/**
 * Online room protocol — Season 0 (LAN/private alpha).
 *
 * Architecture (ADR-0006/0007): a lightweight custom control plane over WebSocket.
 * Battles run LOCKSTEP-DETERMINISTIC: the server runs the authoritative MatchSim
 * and relays only validated inputs + tick authorizations; every client steps an
 * identical local sim (same engine, same seed, same input timeline), so the
 * renderer consumes rich local sim state unchanged. The server's outcome and
 * event hash are authoritative; a divergent client resyncs to the server result.
 *
 * All messages are JSON. The server never trusts client-reported results.
 */
import type {
  FighterFile,
  FormationId,
  MatchOutcome,
  ReinforcementTrigger,
  TacticalCommandKind,
  TeamSetup,
  WildcardContract,
} from './types';

export const PROTOCOL_VERSION = '0.1.0';
export const DEFAULT_SERVER_PORT = 8790;
export const MAX_SPECTATORS = 20;

export type RoomPhase =
  | 'lobby'
  | 'draft'
  | 'prep'
  | 'wildcard'
  | 'battle'
  | 'finished';

export interface RoomParticipantInfo {
  guestId: string;
  name: string;
  role: 'host' | 'player' | 'spectator';
  connected: boolean;
  /** playerId slot ('p1' | 'p2') when role is host/player and seated. */
  seat: 'p1' | 'p2' | null;
  ready: boolean;
}

export interface DraftPublicState {
  order: ('p1' | 'p2')[];
  turn: number;
  /** Whose turn right now (null when draft complete). */
  onClock: 'p1' | 'p2' | null;
  picks: Record<'p1' | 'p2', { roster: { fighterId: string; pricePaid: number }[]; passed: boolean }>;
  /** Custom fighters nominated this draft (experimental), visible to all. */
  customFighters: FighterFile[];
  /** Per-player custom-nomination state. */
  nominations: Record<'p1' | 'p2', { used: boolean; semanticCorrections: number; visualCorrections: number }>;
}

export interface PrepPublicState {
  /** Only readiness is public; prep contents stay private until battle. */
  ready: Record<'p1' | 'p2', boolean>;
}

export interface WildcardPublicState {
  locked: Record<'p1' | 'p2', boolean>;
  /** Populated only after BOTH locks (reveal rule). */
  revealed: Record<'p1' | 'p2', string | null> | null;
  /** Custom wildcards compiled this room (experimental), visible after reveal. */
  customWildcards: WildcardContract[];
}

export interface BattlePublicState {
  matchId: string;
  seed: number;
  arenaId: string;
  /** Complete team setups — sent at battle start so clients can build the sim. */
  teams: TeamSetup[];
  /** Highest tick clients are authorized to step to. */
  authorizedTick: number;
  /** Full validated input timeline so far — reconnecting clients fast-forward with it. */
  inputs: BattleInput[];
  startedAtIso: string;
}

export interface RoomSnapshot {
  protocolVersion: string;
  roomId: string;
  phase: RoomPhase;
  hostGuestId: string;
  participants: RoomParticipantInfo[];
  rulesetVersion: string;
  arenaId: string;
  division: string;
  experimental: boolean;
  draft: DraftPublicState | null;
  prep: PrepPublicState | null;
  wildcard: WildcardPublicState | null;
  battle: BattlePublicState | null;
  outcome: MatchOutcome | null;
  /** Snapshot sequence number — clients ignore stale snapshots. */
  rev: number;
}

/** A validated battle input relayed to all clients for lockstep application. */
export type BattleInput =
  | { kind: 'command'; playerId: string; command: TacticalCommandKind; targetFighterId?: string; issuedTick: number }
  | { kind: 'wildcard'; playerId: string; wildcardId: string; x: number; z: number; issuedTick: number };

export interface PrivatePrep {
  activeFighterIds: string[];
  captainId: string;
  formation: FormationId;
  reinforcement: ReinforcementTrigger;
}

// ---------------------------------------------------------------------------
// Client → Server
// ---------------------------------------------------------------------------

export type ClientMessage =
  | { t: 'hello'; name: string; sessionToken?: string }
  | { t: 'create_room'; experimental: boolean }
  | { t: 'join_room'; roomId: string; as: 'player' | 'spectator' }
  | { t: 'leave_room' }
  | { t: 'start_draft' } // host only, needs 2 seated players
  | { t: 'draft_pick'; fighterId: string }
  | { t: 'draft_pass' }
  | { t: 'nominate_custom'; description: string } // experimental rooms only
  | { t: 'custom_correction'; kind: 'semantic' | 'visual'; instruction: string }
  | { t: 'custom_resolve'; accept: boolean }
  | { t: 'submit_prep'; prep: PrivatePrep }
  | { t: 'lock_wildcard'; wildcardId: string | null }
  | { t: 'custom_wildcard'; description: string } // experimental rooms only
  | { t: 'battle_command'; command: TacticalCommandKind; targetFighterId?: string }
  | { t: 'battle_wildcard'; x: number; z: number }
  | { t: 'reaction'; emote: string }
  | { t: 'resync' }
  | { t: 'ping' };

// ---------------------------------------------------------------------------
// Server → Client
// ---------------------------------------------------------------------------

export type ServerMessage =
  | { t: 'welcome'; sessionToken: string; guestId: string; protocolVersion: string }
  | { t: 'room_state'; state: RoomSnapshot }
  /** Private to one player: their own compiled custom fighter awaiting corrections/accept. */
  | { t: 'nomination_result'; fighter: FighterFile; notes: string[]; semanticLeft: number; visualLeft: number }
  /** Private to one player: their compiled custom wildcard (auto-added to their choices). */
  | { t: 'custom_wildcard_result'; wildcard: WildcardContract; notes: string[] }
  /** Private team readout data is client-computed; server only confirms stored prep. */
  | { t: 'battle_input'; input: BattleInput }
  | { t: 'tick_advance'; tick: number }
  | { t: 'battle_over'; outcome: MatchOutcome; eventHash: string; finalTick: number }
  | { t: 'reaction'; from: string; name: string; emote: string }
  | { t: 'error'; code: string; message: string }
  | { t: 'pong' };

export const REACTION_EMOTES = ['🔥', '😂', '😱', '👏', '💀', '🤯', '🛡️', '⚡'] as const;

// ---------------------------------------------------------------------------
// Compiler APIs (implemented by services/character-compiler and
// services/wildcard-compiler; deterministic rule-based in Season 0, designed to
// be swapped for LLM-backed providers behind the same signatures — ADR-0008)
// ---------------------------------------------------------------------------

export interface CompiledFighterResult {
  fighter: FighterFile; // validation.eligibility === 'experimental'
  /** Honest compiler notes: assumptions, normalizations, rejected clauses. */
  notes: string[];
  confidence: 'high' | 'medium' | 'low';
  /** True when the request targeted protected IP / a real person and was transformed or blocked. */
  transformed: boolean;
}

export interface CompiledWildcardResult {
  wildcard: WildcardContract; // eligibility 'experimental', moderation 'approved' only if safe
  notes: string[];
  rejectedClauses: string[];
}
