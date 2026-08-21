/** App state machine + local persistence + analytics funnel logging. */
import type {
  ChampionRecord,
  CompiledFighterResult,
  FighterFile,
  MatchManifest,
  MatchOutcome,
  CausalBreakdown,
  TeamSetup,
  FormationId,
  ReinforcementTrigger,
} from '@arena/contracts';
import { queueTelemetry, telemetryClientId, telemetryGroupKey, telemetrySource } from './telemetry';

export type Screen = 'home' | 'reveal' | 'draft' | 'prep' | 'wildcard' | 'battle' | 'breakdown' | 'online' | 'bracket';

export type BracketSlot = 'semi1' | 'semi2' | 'final';

export interface BracketState {
  createdAt: string;
  names: [string, string, string, string];
  winners: Partial<Record<BracketSlot, string>>;
}
export type Mode = 'solo' | 'hotseat' | 'dethrone';

export interface PlayerCfg {
  id: 'p1' | 'p2';
  name: string;
  isAI: boolean;
  /** Frozen champion team when this player is a dethrone-defense AI. */
  frozenTeam?: TeamSetup;
}

export interface DraftPickState {
  roster: { fighterId: string; pricePaid: number }[];
  passed: boolean;
}

export interface PrepState {
  activeFighterIds: string[];
  captainId: string;
  formation: FormationId;
  reinforcement: ReinforcementTrigger;
  wildcardId: string | null;
  /** Experimental typed wildcards compiled by this player (ids into the wildcard index). */
  customWildcardIds?: string[];
  customWildcardUsed?: boolean;
}

export interface MatchRecord {
  manifest: MatchManifest;
  outcome: MatchOutcome;
  breakdownSummary: string;
  winnerName: string;
  playedAt: string;
}

export interface NominationState {
  used: boolean;
  semanticLeft: number;
  visualLeft: number;
  pending: CompiledFighterResult | null;
}

export interface AppState {
  screen: Screen;
  mode: Mode;
  players: [PlayerCfg, PlayerCfg];
  seed: number;
  draft: {
    order: ('p1' | 'p2')[];
    turn: number;
    picks: Record<'p1' | 'p2', DraftPickState>;
    customFighters: { file: FighterFile; nominator: 'p1' | 'p2' }[];
    nominations: Record<'p1' | 'p2', NominationState>;
  } | null;
  prep: Record<'p1' | 'p2', PrepState> | null;
  teams: TeamSetup[] | null;
  lastManifest: MatchManifest | null;
  lastOutcome: MatchOutcome | null;
  lastBreakdown: CausalBreakdown | null;
  replayMode: boolean;
  dethroneTarget: ChampionRecord | null;
  /** Set while a hotseat match is being played as part of a bracket. */
  bracketMatch: BracketSlot | null;
}

const K = {
  profile: 'ia_profile',
  history: 'ia_history',
  champion: 'ia_champion',
  telemetry: 'ia_telemetry',
};

export const state: AppState = {
  screen: 'home',
  mode: 'solo',
  players: [
    { id: 'p1', name: loadProfileName(), isAI: false },
    { id: 'p2', name: 'Architect-7', isAI: true },
  ],
  seed: 0,
  draft: null,
  prep: null,
  teams: null,
  lastManifest: null,
  lastOutcome: null,
  lastBreakdown: null,
  replayMode: false,
  dethroneTarget: null,
  bracketMatch: null,
};

type Renderer = (screen: Screen) => void;
let renderer: Renderer = () => {};
export function bindRenderer(r: Renderer) {
  renderer = r;
}
export function go(screen: Screen) {
  state.screen = screen;
  document.body.style.overflow = '';
  window.scrollTo(0, 0);
  renderer(screen);
}

// ---------------------------------------------------------------------------
// Persistence (guest-local; account upgrade is a later phase)
// ---------------------------------------------------------------------------

function loadProfileName(): string {
  try {
    return localStorage.getItem(K.profile) ?? '';
  } catch {
    return '';
  }
}
export function saveProfileName(name: string) {
  state.players[0].name = name;
  try {
    localStorage.setItem(K.profile, name);
  } catch { /* private mode */ }
}

export function loadHistory(): MatchRecord[] {
  try {
    return JSON.parse(localStorage.getItem(K.history) ?? '[]');
  } catch {
    return [];
  }
}
export function pushHistory(rec: MatchRecord) {
  const h = loadHistory();
  h.unshift(rec);
  try {
    localStorage.setItem(K.history, JSON.stringify(h.slice(0, 40)));
  } catch { /* quota */ }
}

export function loadBracket(): BracketState | null {
  try {
    return JSON.parse(localStorage.getItem('ia_bracket') ?? 'null');
  } catch {
    return null;
  }
}
export function saveBracket(b: BracketState | null) {
  try {
    if (b) localStorage.setItem('ia_bracket', JSON.stringify(b));
    else localStorage.removeItem('ia_bracket');
  } catch { /* quota */ }
}

export function loadChampion(): ChampionRecord | null {
  try {
    return JSON.parse(localStorage.getItem(K.champion) ?? 'null');
  } catch {
    return null;
  }
}
export function saveChampion(c: ChampionRecord) {
  try {
    localStorage.setItem(K.champion, JSON.stringify(c));
  } catch { /* quota */ }
}

// ---------------------------------------------------------------------------
// Analytics funnel — local ring buffer + outbound queue (telemetry.ts ships it
// to the self-hosted control plane when a server URL is configured).
// source is stamped by hostname: 'alpha' only on a deployed origin,
// 'local-dev' on localhost/Playwright — synthetic and human data must stay
// separated (docs/LAUNCH_PLAN.md §5, locked).
// ---------------------------------------------------------------------------

export function track(event: string, props: Record<string, string | number | boolean> = {}) {
  const entry = {
    event,
    props,
    at: new Date().toISOString(),
    source: telemetrySource(),
    clientId: telemetryClientId(),
    groupKey: telemetryGroupKey(),
  };
  try {
    const buf = JSON.parse(localStorage.getItem(K.telemetry) ?? '[]');
    buf.push(entry);
    localStorage.setItem(K.telemetry, JSON.stringify(buf.slice(-500)));
  } catch { /* quota */ }
  queueTelemetry(entry);
  // eslint-disable-next-line no-console
  console.debug('[telemetry]', event, props);
}

export function exportTelemetry(): string {
  try {
    return localStorage.getItem(K.telemetry) ?? '[]';
  } catch {
    return '[]';
  }
}

// ---------------------------------------------------------------------------
// Dethrone links — the champion team travels in the URL fragment, so a plain
// static link works with zero backend. Format: #dethrone=<base64url(JSON)>
// ---------------------------------------------------------------------------

export function encodeDethroneLink(champ: ChampionRecord): string {
  const payload = btoa(unescape(encodeURIComponent(JSON.stringify(champ))))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `${location.origin}${location.pathname}#dethrone=${payload}`;
}

export function decodeDethroneHash(): ChampionRecord | null {
  const m = location.hash.match(/#dethrone=([A-Za-z0-9_-]+)/);
  if (!m) return null;
  try {
    const b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(decodeURIComponent(escape(atob(b64))));
  } catch {
    return null;
  }
}
