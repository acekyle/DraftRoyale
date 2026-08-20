/**
 * Room state machine — server-authoritative lobby → draft → prep → wildcard →
 * battle → finished.
 *
 * The server never trusts the client: every pick, prep, lock, and battle input
 * is validated against locked content and the authoritative MatchSim before it
 * is relayed. Battles are lockstep-deterministic: the server steps the
 * authoritative sim on a wall-clock interval and broadcasts only validated
 * inputs (`battle_input`) plus tick authorizations (`tick_advance`); every
 * client replays the identical sim locally.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import {
  PROTOCOL_VERSION,
  PRICE_MIN,
  REACTION_EMOTES,
  RULESET_S0,
  hasErrors,
  validateTeamSetup,
  type BattleInput,
  type ClientMessage,
  type CombatDNA,
  type CompiledFighterResult,
  type Division,
  type FighterFile,
  type FormationId,
  type MatchManifest,
  type MatchOutcome,
  type PrivatePrep,
  type ReinforcementTrigger,
  type RoomPhase,
  type RoomSnapshot,
  type ServerMessage,
  type TacticalCommandKind,
  type TeamSetup,
  type WildcardContract,
} from '@arena/contracts';
import { MatchSim, buildManifest, fnv1a, hashRun, type SimContent } from '@arena/combat-sim';
import {
  CompilerUnavailableError,
  applySemanticCorrection,
  applyVisualCorrection,
  compileFighterFromText,
} from '@arena/character-compiler';
import { WildcardCompilerUnavailableError, compileWildcardFromText } from '@arena/wildcard-compiler';
import type { LoadedContent } from '../../../tools/load-content';

export type Seat = 'p1' | 'p2';
const SEATS: Seat[] = ['p1', 'p2'];

const FORMATIONS: FormationId[] = ['balanced', 'protect_captain', 'spread', 'ambush'];
const TRIGGERS: ReinforcementTrigger[] = [
  'ally_ko',
  'ally_below_35',
  'enemy_wildcard_deployed',
  'one_enemy_remains',
  'never_hold_reserve',
];
const COMMAND_KINDS: TacticalCommandKind[] = [
  'focus_target',
  'protect_ally',
  'press_attack',
  'disengage',
  'regroup',
  'spread_out',
];
const TRIGGER_DESC: Record<ReinforcementTrigger, string> = {
  ally_ko: 'Send the next reserve in when a teammate goes down.',
  ally_below_35: 'Rotate out any active fighter who falls below 35% vitality.',
  enemy_wildcard_deployed: 'React to an enemy wildcard by rotating the weakest fighter out.',
  one_enemy_remains: 'Hold the reserve until only one enemy is left standing.',
  never_hold_reserve: 'Never hold a reserve back — replace losses immediately.',
};
const MAX_TEXT_LEN = 4000;

export interface Participant {
  guestId: string;
  name: string;
  role: 'host' | 'player' | 'spectator';
  seat: Seat | null;
  connected: boolean;
  lastReactionAt: number;
}

export interface RoomDeps {
  content: LoadedContent;
  tickIntervalMs: number;
  send(guestId: string, msg: ServerMessage): void;
  persistMatch(record: unknown): void;
}

interface DraftState {
  order: Seat[];
  turn: number;
  picks: Record<Seat, { roster: { fighterId: string; pricePaid: number }[]; passed: boolean }>;
  customFighters: FighterFile[];
  nominations: Record<Seat, { used: boolean; semanticCorrections: number; visualCorrections: number }>;
}

interface BattleState {
  sim: MatchSim;
  matchId: string;
  seed: number;
  teams: TeamSetup[];
  /** Wire-stamped validated inputs, in broadcast order (issuedTick = tick they take effect before). */
  inputs: BattleInput[];
  /** Validated inputs waiting for their issuedTick's interval. */
  queued: BattleInput[];
  queuedTokens: Record<Seat, number>;
  queuedWildcard: Record<Seat, boolean>;
  manifest: MatchManifest;
  startedAtIso: string;
  interval: ReturnType<typeof setInterval> | null;
}

export class Room {
  readonly id: string;
  readonly experimental: boolean;
  readonly arenaId: string;
  hostGuestId: string;
  phase: RoomPhase = 'lobby';
  participants: Participant[] = [];
  outcome: MatchOutcome | null = null;

  private rev = 0;
  private onClock: Seat | null = null;
  private draft: DraftState | null = null;
  private pendingNominations: Record<Seat, CompiledFighterResult | null> = { p1: null, p2: null };
  private customOwners = new Map<string, Seat>();
  private preps: Record<Seat, PrivatePrep | null> = { p1: null, p2: null };
  private prepReady: Record<Seat, boolean> = { p1: false, p2: false };
  private prepEntered = false;
  private wildcardEntered = false;
  /** undefined = not locked yet; null = locked "no wildcard". */
  private wcChoices: Record<Seat, string | null | undefined> = { p1: undefined, p2: undefined };
  private customWildcards: { contract: WildcardContract; owner: Seat }[] = [];
  private customWcUsed: Record<Seat, boolean> = { p1: false, p2: false };
  private revealed = false;
  private battle: BattleState | null = null;

  constructor(id: string, hostGuestId: string, experimental: boolean, private deps: RoomDeps) {
    this.id = id;
    this.hostGuestId = hostGuestId;
    this.experimental = experimental;
    const firstArena = [...deps.content.arenas.keys()].sort()[0];
    if (!firstArena) throw new Error('no arenas loaded');
    this.arenaId = firstArena;
  }

  // -------------------------------------------------------------------------
  // Membership (server drives adds/removes; the room owns the list)
  // -------------------------------------------------------------------------

  findParticipant(guestId: string): Participant | undefined {
    return this.participants.find((p) => p.guestId === guestId);
  }

  seatOf(guestId: string): Seat | null {
    return this.findParticipant(guestId)?.seat ?? null;
  }

  seatFree(seat: Seat): boolean {
    return !this.participants.some((p) => p.seat === seat);
  }

  spectatorCount(): number {
    return this.participants.filter((p) => p.role === 'spectator').length;
  }

  addParticipant(p: Participant) {
    this.participants.push(p);
  }

  removeParticipant(guestId: string) {
    this.participants = this.participants.filter((p) => p.guestId !== guestId);
  }

  markDisconnected(guestId: string) {
    const p = this.findParticipant(guestId);
    if (p) p.connected = false;
  }

  markConnected(guestId: string) {
    const p = this.findParticipant(guestId);
    if (p) p.connected = true;
  }

  connectedCount(): number {
    return this.participants.filter((p) => p.connected).length;
  }

  dispose() {
    if (this.battle?.interval) {
      clearInterval(this.battle.interval);
      this.battle.interval = null;
    }
  }

  // -------------------------------------------------------------------------
  // Snapshots — full idempotent room_state; the resync mechanism
  // -------------------------------------------------------------------------

  snapshot(): RoomSnapshot {
    this.rev += 1;
    return {
      protocolVersion: PROTOCOL_VERSION,
      roomId: this.id,
      phase: this.phase,
      hostGuestId: this.hostGuestId,
      participants: this.participants.map((p) => ({
        guestId: p.guestId,
        name: p.name,
        role: p.role,
        connected: p.connected,
        seat: p.seat,
        ready: this.readyOf(p),
      })),
      rulesetVersion: RULESET_S0.version,
      arenaId: this.arenaId,
      division: RULESET_S0.division,
      experimental: this.experimental,
      draft: this.draft
        ? {
            order: [...this.draft.order],
            turn: this.draft.turn,
            onClock: this.onClock,
            picks: {
              p1: { roster: this.draft.picks.p1.roster.map((r) => ({ ...r })), passed: this.draft.picks.p1.passed },
              p2: { roster: this.draft.picks.p2.roster.map((r) => ({ ...r })), passed: this.draft.picks.p2.passed },
            },
            customFighters: this.draft.customFighters,
            nominations: {
              p1: { ...this.draft.nominations.p1 },
              p2: { ...this.draft.nominations.p2 },
            },
          }
        : null,
      prep: this.prepEntered ? { ready: { ...this.prepReady } } : null,
      wildcard: this.wildcardEntered
        ? {
            locked: { p1: this.wcChoices.p1 !== undefined, p2: this.wcChoices.p2 !== undefined },
            revealed: this.revealed
              ? { p1: this.wcChoices.p1 ?? null, p2: this.wcChoices.p2 ?? null }
              : null,
            customWildcards: this.revealed ? this.customWildcards.map((c) => c.contract) : [],
          }
        : null,
      battle: this.battle
        ? {
            matchId: this.battle.matchId,
            seed: this.battle.seed,
            arenaId: this.arenaId,
            teams: this.battle.teams,
            authorizedTick: this.battle.sim.tick,
            inputs: [...this.battle.inputs],
            startedAtIso: this.battle.startedAtIso,
          }
        : null,
      outcome: this.outcome,
      rev: this.rev,
    };
  }

  private readyOf(p: Participant): boolean {
    if (!p.seat) return false;
    if (this.phase === 'prep') return this.prepReady[p.seat];
    if (this.phase === 'wildcard') return this.wcChoices[p.seat] !== undefined;
    return false;
  }

  broadcastState() {
    this.broadcast({ t: 'room_state', state: this.snapshot() });
  }

  sendState(guestId: string) {
    this.deps.send(guestId, { t: 'room_state', state: this.snapshot() });
  }

  private broadcast(msg: ServerMessage) {
    for (const p of this.participants) if (p.connected) this.deps.send(p.guestId, msg);
  }

  private err(guestId: string, code: string, message: string) {
    this.deps.send(guestId, { t: 'error', code, message });
  }

  // -------------------------------------------------------------------------
  // Message routing (game-scoped messages; server routes session/room mgmt)
  // -------------------------------------------------------------------------

  handleMessage(guestId: string, msg: ClientMessage) {
    const p = this.findParticipant(guestId);
    if (!p) return this.err(guestId, 'not_in_room', 'you are not a participant of this room');
    switch (msg.t) {
      case 'start_draft': return this.onStartDraft(p);
      case 'draft_pick': return this.onDraftPick(p, msg.fighterId);
      case 'draft_pass': return this.onDraftPass(p);
      case 'nominate_custom': return this.onNominateCustom(p, msg.description);
      case 'custom_correction': return this.onCustomCorrection(p, msg.kind, msg.instruction);
      case 'custom_resolve': return this.onCustomResolve(p, msg.accept);
      case 'submit_prep': return this.onSubmitPrep(p, msg.prep);
      case 'lock_wildcard': return this.onLockWildcard(p, msg.wildcardId);
      case 'custom_wildcard': return this.onCustomWildcard(p, msg.description);
      case 'battle_command': return this.onBattleCommand(p, msg.command, msg.targetFighterId);
      case 'battle_wildcard': return this.onBattleWildcard(p, msg.x, msg.z);
      case 'reaction': return this.onReaction(p, msg.emote);
      case 'resync': return this.sendState(guestId);
      default:
        return this.err(guestId, 'bad_message', `message ${String((msg as { t?: unknown }).t)} not valid here`);
    }
  }

  private requireSeat(p: Participant): Seat | null {
    if (!p.seat) {
      this.err(p.guestId, 'not_a_player', 'spectators cannot perform this action');
      return null;
    }
    return p.seat;
  }

  // -------------------------------------------------------------------------
  // Draft — mirrors the client's ABBA order and auto-skip logic exactly
  // -------------------------------------------------------------------------

  private onStartDraft(p: Participant) {
    if (p.guestId !== this.hostGuestId) return this.err(p.guestId, 'not_host', 'only the host can start the draft');
    if (this.phase !== 'lobby' && this.phase !== 'finished')
      return this.err(p.guestId, 'bad_phase', `cannot start draft during ${this.phase}`);
    const seated = SEATS.map((s) => this.participants.find((q) => q.seat === s));
    if (!seated.every((q) => q && q.connected))
      return this.err(p.guestId, 'need_players', 'draft needs 2 seated, connected players');

    // Run it back (same room): a finished room resets to a completely fresh
    // draft — the previous match's immutable record is already persisted.
    if (this.phase === 'finished') this.resetForRematch();

    const order: Seat[] = [];
    for (let round = 0; round < RULESET_S0.rosterMax; round++) {
      const pair: Seat[] = round % 2 === 0 ? ['p1', 'p2'] : ['p2', 'p1'];
      order.push(...pair);
    }
    this.draft = {
      order,
      turn: 0,
      picks: {
        p1: { roster: [], passed: false },
        p2: { roster: [], passed: false },
      },
      customFighters: [],
      nominations: {
        p1: { used: false, semanticCorrections: 0, visualCorrections: 0 },
        p2: { used: false, semanticCorrections: 0, visualCorrections: 0 },
      },
    };
    this.phase = 'draft';
    this.advanceDraft();
    this.broadcastState();
  }

  /** Fresh-draft reset: everything match-scoped clears; participants, seats, and room identity stay. */
  private resetForRematch() {
    this.outcome = null;
    this.onClock = null;
    this.draft = null;
    this.pendingNominations = { p1: null, p2: null };
    this.customOwners = new Map();
    this.preps = { p1: null, p2: null };
    this.prepReady = { p1: false, p2: false };
    this.prepEntered = false;
    this.wildcardEntered = false;
    this.wcChoices = { p1: undefined, p2: undefined };
    this.customWildcards = [];
    this.customWcUsed = { p1: false, p2: false };
    this.revealed = false;
    if (this.battle?.interval) clearInterval(this.battle.interval);
    this.battle = null;
    this.phase = 'lobby';
  }

  private spent(seat: Seat): number {
    return this.draft!.picks[seat].roster.reduce((s, r) => s + r.pricePaid, 0);
  }

  private takenIds(): Set<string> {
    const d = this.draft!;
    return new Set([...d.picks.p1.roster, ...d.picks.p2.roster].map((r) => r.fighterId));
  }

  /** Locked market entry for a fighter id, from the seat's point of view. */
  private marketEntry(seat: Seat, fighterId: string): { price: number; division: Division } | 'not_yours' | null {
    const base = this.deps.content.fighters.get(fighterId);
    if (base) return { price: base.balance.draftPrice, division: base.identity.division };
    const custom = this.draft?.customFighters.find((f) => f.dna.identity.fighterId === fighterId);
    if (!custom) return null;
    if (this.customOwners.get(fighterId) !== seat) return 'not_yours';
    return { price: custom.dna.balance.draftPrice, division: custom.dna.identity.division };
  }

  /** All fighters this seat could still legally draft price-wise (affordability sweep). */
  private draftableEntries(seat: Seat): { id: string; price: number }[] {
    const out: { id: string; price: number }[] = [];
    for (const dna of this.deps.content.fighters.values())
      out.push({ id: dna.identity.fighterId, price: dna.balance.draftPrice });
    for (const f of this.draft?.customFighters ?? [])
      if (this.customOwners.get(f.dna.identity.fighterId) === seat)
        out.push({ id: f.dna.identity.fighterId, price: f.dna.balance.draftPrice });
    return out;
  }

  private canAfford(seat: Seat, price: number): boolean {
    const roster = this.draft!.picks[seat].roster;
    const budget = RULESET_S0.salaryCap - this.spent(seat);
    const need = Math.max(0, RULESET_S0.rosterMin - roster.length - 1);
    return price <= budget - need * PRICE_MIN;
  }

  /**
   * Identical to the client's currentPlayer(): advances past passed/full
   * players and auto-passes a player (roster >= min) who can afford nothing.
   * Mutates draft state, as the client does.
   */
  private currentPlayer(): Seat | null {
    const d = this.draft!;
    while (d.turn < d.order.length) {
      const seat = d.order[d.turn];
      const ps = d.picks[seat];
      if (ps.passed || ps.roster.length >= RULESET_S0.rosterMax) {
        d.turn++;
        continue;
      }
      const taken = this.takenIds();
      const anyAffordable = this.draftableEntries(seat).some(
        (e) => !taken.has(e.id) && this.canAfford(seat, e.price),
      );
      if (!anyAffordable && ps.roster.length >= RULESET_S0.rosterMin) {
        ps.passed = true;
        d.turn++;
        continue;
      }
      return seat;
    }
    return null;
  }

  private advanceDraft() {
    this.onClock = this.currentPlayer();
    if (this.onClock === null && this.phase === 'draft') {
      this.phase = 'prep';
      this.prepEntered = true;
      this.preps = { p1: null, p2: null };
      this.prepReady = { p1: false, p2: false };
    }
  }

  private onDraftPick(p: Participant, fighterId: unknown) {
    const seat = this.requireSeat(p);
    if (!seat) return;
    if (this.phase !== 'draft') return this.err(p.guestId, 'bad_phase', `cannot pick during ${this.phase}`);
    if (typeof fighterId !== 'string') return this.err(p.guestId, 'bad_message', 'fighterId must be a string');
    if (this.onClock !== seat) return this.err(p.guestId, 'not_your_turn', 'it is not your turn to pick');

    const entry = this.marketEntry(seat, fighterId);
    if (entry === null) return this.err(p.guestId, 'unknown_fighter', `no such fighter in this room's market: ${fighterId}`);
    if (entry === 'not_yours')
      return this.err(p.guestId, 'not_your_custom', 'only the nominating player may draft this custom fighter');
    if (RULESET_S0.division !== ('open' as Division) && entry.division !== RULESET_S0.division)
      return this.err(p.guestId, 'not_eligible', `${fighterId} is not eligible for the ${RULESET_S0.division} division`);
    if (this.takenIds().has(fighterId)) return this.err(p.guestId, 'fighter_taken', `${fighterId} is already drafted`);
    if (this.draft!.picks[seat].roster.length >= RULESET_S0.rosterMax)
      return this.err(p.guestId, 'roster_full', 'roster is full');
    if (!this.canAfford(seat, entry.price))
      return this.err(p.guestId, 'cannot_afford', `cannot afford ${fighterId} under the min-roster budget rule`);

    // The price is ALWAYS the locked content price — clients cannot set it.
    this.draft!.picks[seat].roster.push({ fighterId, pricePaid: entry.price });
    this.draft!.turn++;
    this.advanceDraft();
    this.broadcastState();
  }

  private onDraftPass(p: Participant) {
    const seat = this.requireSeat(p);
    if (!seat) return;
    if (this.phase !== 'draft') return this.err(p.guestId, 'bad_phase', `cannot pass during ${this.phase}`);
    if (this.onClock !== seat) return this.err(p.guestId, 'not_your_turn', 'it is not your turn');
    if (this.draft!.picks[seat].roster.length < RULESET_S0.rosterMin)
      return this.err(p.guestId, 'pass_too_early', `need at least ${RULESET_S0.rosterMin} fighters before locking the roster`);
    this.draft!.picks[seat].passed = true;
    this.draft!.turn++;
    this.advanceDraft();
    this.broadcastState();
  }

  // -------------------------------------------------------------------------
  // Custom nomination (experimental rooms) — compiler-backed
  // -------------------------------------------------------------------------

  private nominationSeed(guestId: string, salt: string): number {
    return parseInt(fnv1a(`${this.id}:${guestId}${salt}`), 16) >>> 0;
  }

  private onNominateCustom(p: Participant, description: unknown) {
    const seat = this.requireSeat(p);
    if (!seat) return;
    if (!this.experimental)
      return this.err(p.guestId, 'experimental_only', 'custom nominations are only allowed in experimental rooms');
    if (this.phase !== 'draft') return this.err(p.guestId, 'bad_phase', 'nominations are only allowed during the draft');
    if (typeof description !== 'string' || description.trim().length === 0 || description.length > MAX_TEXT_LEN)
      return this.err(p.guestId, 'bad_message', 'description must be a non-empty string');
    const nom = this.draft!.nominations[seat];
    if (nom.used) return this.err(p.guestId, 'nomination_used', 'you already used your custom nomination');

    let result: CompiledFighterResult;
    try {
      result = compileFighterFromText(description, { seed: this.nominationSeed(p.guestId, '') });
    } catch (e) {
      if (e instanceof CompilerUnavailableError)
        return this.err(p.guestId, 'compiler_unavailable', 'the character compiler is not available yet');
      return this.err(p.guestId, 'compiler_failed', 'the character compiler rejected this description');
    }
    nom.used = true;
    this.pendingNominations[seat] = result;
    this.sendNominationResult(p.guestId, seat, result);
    this.broadcastState(); // nomination usage is public
  }

  private sendNominationResult(guestId: string, seat: Seat, result: CompiledFighterResult) {
    const nom = this.draft!.nominations[seat];
    this.deps.send(guestId, {
      t: 'nomination_result',
      fighter: result.fighter,
      notes: result.notes,
      semanticLeft: Math.max(0, 1 - nom.semanticCorrections),
      visualLeft: Math.max(0, 1 - nom.visualCorrections),
    });
  }

  private onCustomCorrection(p: Participant, kind: unknown, instruction: unknown) {
    const seat = this.requireSeat(p);
    if (!seat) return;
    if (this.phase !== 'draft') return this.err(p.guestId, 'bad_phase', 'corrections are only allowed during the draft');
    if (kind !== 'semantic' && kind !== 'visual') return this.err(p.guestId, 'bad_message', 'kind must be semantic|visual');
    if (typeof instruction !== 'string' || instruction.length === 0 || instruction.length > MAX_TEXT_LEN)
      return this.err(p.guestId, 'bad_message', 'instruction must be a non-empty string');
    const pending = this.pendingNominations[seat];
    if (!pending) return this.err(p.guestId, 'no_nomination', 'no pending custom fighter to correct');
    const nom = this.draft!.nominations[seat];
    if (kind === 'semantic' && nom.semanticCorrections >= 1)
      return this.err(p.guestId, 'correction_limit', 'semantic correction already used');
    if (kind === 'visual' && nom.visualCorrections >= 1)
      return this.err(p.guestId, 'correction_limit', 'visual correction already used');

    let result: CompiledFighterResult;
    try {
      result = kind === 'semantic' ? applySemanticCorrection(pending, instruction) : applyVisualCorrection(pending, instruction);
    } catch (e) {
      if (e instanceof CompilerUnavailableError)
        return this.err(p.guestId, 'compiler_unavailable', 'the character compiler is not available yet');
      return this.err(p.guestId, 'compiler_failed', 'the character compiler rejected this correction');
    }
    if (kind === 'semantic') nom.semanticCorrections += 1;
    else nom.visualCorrections += 1;
    this.pendingNominations[seat] = result;
    this.sendNominationResult(p.guestId, seat, result);
    this.broadcastState(); // correction counters are public
  }

  private onCustomResolve(p: Participant, accept: unknown) {
    const seat = this.requireSeat(p);
    if (!seat) return;
    if (this.phase !== 'draft') return this.err(p.guestId, 'bad_phase', 'resolve is only allowed during the draft');
    if (typeof accept !== 'boolean') return this.err(p.guestId, 'bad_message', 'accept must be a boolean');
    const pending = this.pendingNominations[seat];
    if (!pending) return this.err(p.guestId, 'no_nomination', 'no pending custom fighter to resolve');
    this.pendingNominations[seat] = null;
    if (accept) {
      const id = pending.fighter.dna.identity.fighterId;
      if (this.marketEntry(seat, id) !== null && !this.customOwners.has(id))
        return this.err(p.guestId, 'invalid_fighter', `custom fighter id collides with market fighter ${id}`);
      this.draft!.customFighters.push(pending.fighter);
      this.customOwners.set(id, seat);
    }
    this.broadcastState();
  }

  // -------------------------------------------------------------------------
  // Prep — stored privately; only readiness is public
  // -------------------------------------------------------------------------

  private onSubmitPrep(p: Participant, prep: unknown) {
    const seat = this.requireSeat(p);
    if (!seat) return;
    if (this.phase !== 'prep') return this.err(p.guestId, 'bad_phase', `cannot submit prep during ${this.phase}`);
    const parsed = this.validatePrep(seat, prep);
    if (typeof parsed === 'string') return this.err(p.guestId, 'invalid_prep', parsed);
    this.preps[seat] = parsed;
    this.prepReady[seat] = true;
    if (this.prepReady.p1 && this.prepReady.p2) {
      this.phase = 'wildcard';
      this.wildcardEntered = true;
      this.wcChoices = { p1: undefined, p2: undefined };
      this.revealed = false;
    }
    this.broadcastState();
  }

  private validatePrep(seat: Seat, prep: unknown): PrivatePrep | string {
    if (typeof prep !== 'object' || prep === null) return 'prep must be an object';
    const q = prep as Record<string, unknown>;
    const actives = q.activeFighterIds;
    if (!Array.isArray(actives) || actives.length !== RULESET_S0.activeCount || !actives.every((a) => typeof a === 'string'))
      return `activeFighterIds must list exactly ${RULESET_S0.activeCount} fighters`;
    if (new Set(actives).size !== actives.length) return 'activeFighterIds must be distinct';
    const rosterIds = new Set(this.draft!.picks[seat].roster.map((r) => r.fighterId));
    for (const id of actives as string[]) if (!rosterIds.has(id)) return `active fighter ${id} is not in your roster`;
    if (typeof q.captainId !== 'string' || !rosterIds.has(q.captainId)) return 'captain must be in your roster';
    if (typeof q.formation !== 'string' || !FORMATIONS.includes(q.formation as FormationId))
      return `formation must be one of ${FORMATIONS.join(', ')}`;
    if (typeof q.reinforcement !== 'string' || !TRIGGERS.includes(q.reinforcement as ReinforcementTrigger))
      return `reinforcement must be one of ${TRIGGERS.join(', ')}`;
    return {
      activeFighterIds: [...(actives as string[])],
      captainId: q.captainId,
      formation: q.formation as FormationId,
      reinforcement: q.reinforcement as ReinforcementTrigger,
    };
  }

  // -------------------------------------------------------------------------
  // Wildcard — locks are private until BOTH have locked (reveal rule)
  // -------------------------------------------------------------------------

  private onCustomWildcard(p: Participant, description: unknown) {
    const seat = this.requireSeat(p);
    if (!seat) return;
    if (!this.experimental)
      return this.err(p.guestId, 'experimental_only', 'custom wildcards are only allowed in experimental rooms');
    if (this.phase !== 'wildcard') return this.err(p.guestId, 'bad_phase', 'custom wildcards are compiled in the wildcard phase');
    if (typeof description !== 'string' || description.trim().length === 0 || description.length > MAX_TEXT_LEN)
      return this.err(p.guestId, 'bad_message', 'description must be a non-empty string');
    if (this.customWcUsed[seat]) return this.err(p.guestId, 'wildcard_nomination_used', 'you already compiled a custom wildcard');

    let result;
    try {
      result = compileWildcardFromText(description, { seed: this.nominationSeed(p.guestId, ':wc') });
    } catch (e) {
      if (e instanceof WildcardCompilerUnavailableError)
        return this.err(p.guestId, 'compiler_unavailable', 'the wildcard compiler is not available yet');
      return this.err(p.guestId, 'compiler_failed', 'the wildcard compiler rejected this description');
    }
    this.customWcUsed[seat] = true;
    if (result.wildcard.moderation === 'approved')
      this.customWildcards.push({ contract: result.wildcard, owner: seat });
    this.deps.send(p.guestId, { t: 'custom_wildcard_result', wildcard: result.wildcard, notes: result.notes });
    // Nothing public changes until reveal — no broadcast needed.
  }

  private onLockWildcard(p: Participant, wildcardId: unknown) {
    const seat = this.requireSeat(p);
    if (!seat) return;
    if (this.phase !== 'wildcard') return this.err(p.guestId, 'bad_phase', `cannot lock a wildcard during ${this.phase}`);
    if (wildcardId !== null && typeof wildcardId !== 'string')
      return this.err(p.guestId, 'bad_message', 'wildcardId must be a string or null');
    if (this.revealed) return this.err(p.guestId, 'bad_phase', 'wildcards already revealed');
    if (wildcardId !== null) {
      const template = this.deps.content.wildcards.get(wildcardId);
      const custom = this.customWildcards.find((c) => c.contract.wildcardId === wildcardId);
      if (!template && !custom)
        return this.err(p.guestId, 'unknown_wildcard', `no such wildcard: ${wildcardId}`);
      if (custom && custom.owner !== seat)
        return this.err(p.guestId, 'not_your_custom', 'only the compiling player may lock this custom wildcard');
      if (custom && custom.contract.moderation !== 'approved')
        return this.err(p.guestId, 'not_approved', 'this custom wildcard was not approved by moderation');
    }
    this.wcChoices[seat] = wildcardId;
    if (this.wcChoices.p1 !== undefined && this.wcChoices.p2 !== undefined) {
      this.revealed = true;
      this.tryStartBattle();
      return; // tryStartBattle broadcasts
    }
    this.broadcastState();
  }

  // -------------------------------------------------------------------------
  // Battle — server-authoritative lockstep host
  // -------------------------------------------------------------------------

  /** Base content plus this room's accepted custom fighters/wildcards. */
  private roomDna(): Map<string, CombatDNA> {
    const map = new Map(this.deps.content.fighters);
    for (const f of this.draft?.customFighters ?? []) map.set(f.dna.identity.fighterId, f.dna);
    return map;
  }

  private roomContent(): SimContent {
    const arena = this.deps.content.arenas.get(this.arenaId);
    if (!arena) throw new Error(`arena ${this.arenaId} missing`);
    const wildcards = new Map(this.deps.content.wildcards);
    for (const c of this.customWildcards) wildcards.set(c.contract.wildcardId, c.contract);
    return { fighters: this.roomDna(), wildcards, arena };
  }

  private buildTeams(): TeamSetup[] {
    return SEATS.map((seat) => {
      const participant = this.participants.find((q) => q.seat === seat);
      const prep = this.preps[seat]!;
      const roster = this.draft!.picks[seat].roster.map((r) => ({ ...r }));
      const actives = prep.activeFighterIds;
      return {
        playerId: seat,
        displayName: participant?.name ?? seat,
        roster,
        activeFighterIds: [...actives],
        reserveOrder: roster.map((r) => r.fighterId).filter((id) => !actives.includes(id)),
        captainId: prep.captainId,
        formation: prep.formation,
        reinforcementPlan: { trigger: prep.reinforcement, description: TRIGGER_DESC[prep.reinforcement] },
        wildcardId: this.wcChoices[seat] ?? null,
      };
    });
  }

  private tryStartBattle() {
    const teams = this.buildTeams();
    const dnaById = this.roomDna();
    const issues = teams.flatMap((t) => validateTeamSetup(t, RULESET_S0, dnaById));
    if (hasErrors(issues)) {
      const detail = issues
        .filter((i) => i.severity === 'error')
        .map((i) => `${i.path}: ${i.message}`)
        .join('; ');
      this.broadcast({ t: 'error', code: 'invalid_team', message: `team validation failed — returning to prep: ${detail}` });
      this.phase = 'prep';
      this.prepReady = { p1: false, p2: false };
      this.wcChoices = { p1: undefined, p2: undefined };
      this.revealed = false;
      this.broadcastState();
      return;
    }
    this.startBattle(teams);
  }

  private startBattle(teams: TeamSetup[]) {
    const content = this.roomContent();
    const arena = content.arena;
    const seed = randomBytes(4).readUInt32LE(0);
    const matchId = randomUUID();
    const startedAtIso = new Date().toISOString();
    const manifest = buildManifest({
      matchId,
      roomId: this.id,
      createdAt: startedAtIso,
      ruleset: RULESET_S0,
      arenaId: arena.arenaId,
      arenaVersion: arena.version,
      seed,
      teams,
      content,
    });
    const sim = new MatchSim({ matchId, seed, ruleset: RULESET_S0, teams }, content);
    this.battle = {
      sim,
      matchId,
      seed,
      teams,
      inputs: [],
      queued: [],
      queuedTokens: { p1: 0, p2: 0 },
      queuedWildcard: { p1: false, p2: false },
      manifest,
      startedAtIso,
      interval: null,
    };
    this.phase = 'battle';
    this.broadcastState();
    this.battle.interval = setInterval(() => this.battleTick(), this.deps.tickIntervalMs);
  }

  /**
   * One wall-clock interval: apply queued validated inputs stamped for the
   * tick about to run, step the authoritative sim, authorize clients.
   * Clients do the identical dance: apply inputs with issuedTick == tick+1,
   * then step — so RNG consumption stays aligned bit-for-bit.
   */
  private battleTick() {
    const b = this.battle;
    if (!b || this.phase !== 'battle' || b.sim.over) return;
    const nextTick = b.sim.tick + 1;
    while (b.queued.length > 0 && b.queued[0].issuedTick <= nextTick) {
      const input = b.queued.shift()!;
      this.applyInput(input);
    }
    b.sim.step();
    this.broadcast({ t: 'tick_advance', tick: b.sim.tick });
    if (b.sim.over) this.finishBattle();
  }

  private applyInput(input: BattleInput) {
    const b = this.battle!;
    // Manifest timelines use the sim's replay convention: an input recorded at
    // tick T is applied when sim.tick === T, before the step to T+1 — exactly
    // where we are applying it now. (Wire issuedTick = T + 1; see report.)
    const appliedAt = b.sim.tick;
    if (input.kind === 'command') {
      b.queuedTokens[input.playerId as Seat] -= 1;
      const cmd = {
        kind: input.command,
        playerId: input.playerId,
        targetFighterId: input.targetFighterId,
        issuedTick: appliedAt,
      };
      b.sim.applyCommand(cmd);
      b.manifest.commandTimeline.push(cmd);
    } else {
      b.queuedWildcard[input.playerId as Seat] = false; // consumed; sim now tracks usage
      const dep = {
        playerId: input.playerId,
        wildcardId: input.wildcardId,
        x: input.x,
        z: input.z,
        issuedTick: appliedAt,
      };
      b.sim.deployWildcard(dep);
      b.manifest.wildcardTimeline.push(dep);
    }
  }

  private queueInput(input: BattleInput) {
    const b = this.battle!;
    b.inputs.push(input);
    b.queued.push(input);
    // Broadcast IMMEDIATELY — the relay must precede the tick_advance that
    // authorizes issuedTick, so clients always hold the input before stepping.
    this.broadcast({ t: 'battle_input', input });
  }

  private onBattleCommand(p: Participant, command: unknown, targetFighterId: unknown) {
    const seat = this.requireSeat(p);
    if (!seat) return;
    if (this.phase !== 'battle' || !this.battle)
      return this.err(p.guestId, 'bad_phase', `cannot command during ${this.phase}`);
    const b = this.battle;
    if (b.sim.over) return this.err(p.guestId, 'bad_phase', 'the match is over');
    if (typeof command !== 'string' || !COMMAND_KINDS.includes(command as TacticalCommandKind))
      return this.err(p.guestId, 'bad_message', `command must be one of ${COMMAND_KINDS.join(', ')}`);
    const kind = command as TacticalCommandKind;
    let target: string | undefined;
    if (kind === 'focus_target' || kind === 'protect_ally') {
      if (typeof targetFighterId !== 'string')
        return this.err(p.guestId, 'bad_message', `${kind} requires targetFighterId`);
      const known = b.teams.some((t) => t.roster.some((r) => r.fighterId === targetFighterId));
      if (!known) return this.err(p.guestId, 'unknown_fighter', `no such fighter in this match: ${targetFighterId}`);
      target = targetFighterId;
    }
    if (b.sim.tokensRemaining(seat) - b.queuedTokens[seat] <= 0)
      return this.err(p.guestId, 'no_tokens', 'no tactical tokens left');

    b.queuedTokens[seat] += 1;
    const input: BattleInput = {
      kind: 'command',
      playerId: seat,
      command: kind,
      ...(target !== undefined ? { targetFighterId: target } : {}),
      issuedTick: b.sim.tick + 1,
    };
    this.queueInput(input);
  }

  private onBattleWildcard(p: Participant, x: unknown, z: unknown) {
    const seat = this.requireSeat(p);
    if (!seat) return;
    if (this.phase !== 'battle' || !this.battle)
      return this.err(p.guestId, 'bad_phase', `cannot deploy during ${this.phase}`);
    const b = this.battle;
    if (b.sim.over) return this.err(p.guestId, 'bad_phase', 'the match is over');
    if (typeof x !== 'number' || typeof z !== 'number' || !Number.isFinite(x) || !Number.isFinite(z))
      return this.err(p.guestId, 'bad_message', 'x and z must be finite numbers');
    const team = b.teams.find((t) => t.playerId === seat)!;
    if (!team.wildcardId) return this.err(p.guestId, 'no_wildcard', 'you locked no wildcard for this match');
    if (!b.sim.wildcardAvailable(seat) || b.queuedWildcard[seat])
      return this.err(p.guestId, 'wildcard_used', 'your wildcard was already deployed');

    b.queuedWildcard[seat] = true;
    const input: BattleInput = {
      kind: 'wildcard',
      playerId: seat,
      wildcardId: team.wildcardId,
      x,
      z,
      issuedTick: b.sim.tick + 1,
    };
    this.queueInput(input);
  }

  private finishBattle() {
    const b = this.battle!;
    if (b.interval) {
      clearInterval(b.interval);
      b.interval = null;
    }
    const outcome = b.sim.outcome!;
    const eventHash = hashRun(b.sim.events, outcome);
    this.outcome = outcome;
    this.phase = 'finished';
    this.broadcast({ t: 'battle_over', outcome, eventHash, finalTick: b.sim.tick });
    try {
      this.deps.persistMatch({
        roomId: this.id,
        matchId: b.matchId,
        finishedAt: new Date().toISOString(),
        outcome,
        eventHash,
        manifest: b.manifest,
        // Replay Original (constitution SS28 / Product Law 4.6): experimental
        // compiled content must travel WITH the record, or historical replays
        // of rooms that used custom fighters/wildcards become irreproducible.
        customContent: {
          fighters: this.draft?.customFighters ?? [],
          wildcards: this.customWildcards.map((c) => c.contract),
        },
      });
    } catch (e) {
      // Persistence failure must never take the room down.
      console.error('[control-plane] failed to persist match record:', e);
    }
    this.broadcastState();
  }

  // -------------------------------------------------------------------------
  // Reactions
  // -------------------------------------------------------------------------

  private onReaction(p: Participant, emote: unknown) {
    if (typeof emote !== 'string' || !(REACTION_EMOTES as readonly string[]).includes(emote))
      return this.err(p.guestId, 'invalid_emote', 'unknown reaction emote');
    const now = Date.now();
    if (now - p.lastReactionAt < 1000) return this.err(p.guestId, 'rate_limited', 'one reaction per second');
    p.lastReactionAt = now;
    this.broadcast({ t: 'reaction', from: p.guestId, name: p.name, emote });
  }
}
