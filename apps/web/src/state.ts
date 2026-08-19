/** App state machine + local persistence + analytics funnel logging. */
import type {
  ChampionRecord,
  MatchManifest,
  MatchOutcome,
  CausalBreakdown,
  TeamSetup,
  FormationId,
  ReinforcementTrigger,
} from '@arena/contracts';

export type Screen = 'home' | 'reveal' | 'draft' | 'prep' | 'wildcard' | 'battle' | 'breakdown';
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
}

export interface MatchRecord {
  manifest: MatchManifest;
  outcome: MatchOutcome;
  breakdownSummary: string;
  winnerName: string;
  playedAt: string;
}

export interface AppState {
  screen: Screen;
  mode: Mode;
  players: [PlayerCfg, PlayerCfg];
  seed: number;
  draft: { order: ('p1' | 'p2')[]; turn: number; picks: Record<'p1' | 'p2', DraftPickState> } | null;
  prep: Record<'p1' | 'p2', PrepState> | null;
  teams: TeamSetup[] | null;
  lastManifest: MatchManifest | null;
  lastOutcome: MatchOutcome | null;
  lastBreakdown: CausalBreakdown | null;
  replayMode: boolean;
  dethroneTarget: ChampionRecord | null;
}

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
};

type Renderer = (screen: Screen) => void;
let renderer: Renderer = () => {};
export function bindRenderer(r: Renderer) {
  renderer = r;
}
export function go(screen: Screen) {
  state.screen = screen;
  window.scrollTo(0, 0);
  renderer(screen);
}

// ---------------------------------------------------------------------------
// Persistence (guest-local; account upgrade is a later phase)
// ---------------------------------------------------------------------------

const K = {
  profile: 'ia_profile',
  history: 'ia_history',
  champion: 'ia_champion',
  telemetry: 'ia_telemetry',
};

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
// Analytics funnel (local only — real player data collection needs the
// deployed alpha + disclosure; synthetic and QA data must stay separated)
// ---------------------------------------------------------------------------

export function track(event: string, props: Record<string, string | number | boolean> = {}) {
  const entry = { event, props, at: new Date().toISOString(), source: 'local-dev' };
  try {
    const buf = JSON.parse(localStorage.getItem(K.telemetry) ?? '[]');
    buf.push(entry);
    localStorage.setItem(K.telemetry, JSON.stringify(buf.slice(-500)));
  } catch { /* quota */ }
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
