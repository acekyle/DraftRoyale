/**
 * Funnel & vertical-slice gate report (docs/LAUNCH_PLAN.md §2–5).
 *
 * Reads telemetry JSONL written by the control plane's POST /telemetry intake
 * and prints, for REAL data only (source === 'alpha' — stamped by the client
 * from its hostname):
 *   - the 12-step §3 funnel (event-name mapping documented in the output)
 *   - Run-It-Back Rate (§4), comprehension %, crash-free %, character
 *     approval within one semantic correction, dethrone usage
 *   - the §2 gate table (threshold / measured / PASS-FAIL-NO DATA).
 *
 * Synthetic/dev data (any source ≠ 'alpha') is only ever shown under a
 * separate engineering heading and is never mixed into human metrics
 * (LAUNCH_PLAN §5, locked). Zero real events → the human section prints the
 * locked posture "no human data yet".
 *
 * Usage: npm run funnel [-- path/to/telemetry.jsonl ...]
 * Default input: services/control-plane/data/telemetry.jsonl
 *
 * All aggregation lives in exported pure functions so tests can import them.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export interface TelemetryRow {
  event: string;
  at: string;
  props?: Record<string, unknown>;
  source?: string;
  clientId?: string;
  groupKey?: string;
  receivedAt?: string;
}

const MIN_MS = 60_000;
const DAY_MS = 86_400_000;
export const RUN_IT_BACK_WINDOW_MS = 30 * MIN_MS;
/** Both clients of an online match report match_completed — collapse window. */
export const COMPLETION_DEDUPE_MS = 2 * MIN_MS;

// ---------------------------------------------------------------------------
// Parsing & separation
// ---------------------------------------------------------------------------

/** Parse JSONL, skipping blank/malformed lines and rows missing event/at. */
export function parseJsonl(text: string): TelemetryRow[] {
  const rows: TelemetryRow[] = [];
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try {
      const v = JSON.parse(s) as TelemetryRow | null;
      if (v && typeof v === 'object' && typeof v.event === 'string' && typeof v.at === 'string') rows.push(v);
    } catch { /* skip malformed line */ }
  }
  return rows;
}

/**
 * Locked rule (LAUNCH_PLAN §5): real human data is source === 'alpha' exactly;
 * everything else — 'local-dev', missing, unknown — is engineering data.
 */
export function splitRealSynthetic(rows: TelemetryRow[]): { real: TelemetryRow[]; synthetic: TelemetryRow[] } {
  const real: TelemetryRow[] = [];
  const synthetic: TelemetryRow[] = [];
  for (const r of rows) (r.source === 'alpha' ? real : synthetic).push(r);
  return { real, synthetic };
}

// ---------------------------------------------------------------------------
// Shared building blocks
// ---------------------------------------------------------------------------

function ts(r: TelemetryRow): number {
  return Date.parse(r.at);
}

export function sortByTime(rows: TelemetryRow[]): TelemetryRow[] {
  return rows.filter((r) => Number.isFinite(Date.parse(r.at))).sort((a, b) => ts(a) - ts(b));
}

/**
 * Group scope for per-session computations: the online room id when present;
 * otherwise per-device (clientId), so one device's local play can never
 * satisfy another device's metrics through the shared 'local' groupKey.
 */
export function groupUnit(r: TelemetryRow): string {
  const g = r.groupKey ?? 'local';
  return g !== 'local' ? `room:${g}` : `device:${r.clientId ?? 'unknown'}`;
}

export interface DraftStart {
  at: number;
  unit: string;
  via: 'draft_started' | 'first_online_pick';
}

/**
 * A "draft start" is a draft_started event, or — online rooms emit no
 * draft_started event today — the first draft_pick in a group unit since the
 * last match_completed (episode boundary). draft_picks inside an already
 * started draft never double-count.
 */
export function draftStartMoments(rows: TelemetryRow[]): DraftStart[] {
  const inDraft = new Map<string, boolean>();
  const out: DraftStart[] = [];
  for (const r of sortByTime(rows)) {
    const unit = groupUnit(r);
    if (r.event === 'match_completed') {
      inDraft.set(unit, false);
    } else if (r.event === 'draft_started') {
      out.push({ at: ts(r), unit, via: 'draft_started' });
      inDraft.set(unit, true);
    } else if (r.event === 'draft_pick' && !inDraft.get(unit)) {
      out.push({ at: ts(r), unit, via: 'first_online_pick' });
      inDraft.set(unit, true);
    }
  }
  return out;
}

export interface Completion {
  at: number;
  unit: string;
  groupKey: string;
}

/**
 * Events deduped per group unit: near-simultaneous reports of the same named
 * event from multiple clients of the same online room collapse into one.
 */
export function dedupedEvents(rows: TelemetryRow[], event: string, windowMs = COMPLETION_DEDUPE_MS): Completion[] {
  const out: Completion[] = [];
  const lastByUnit = new Map<string, number>();
  for (const r of sortByTime(rows)) {
    if (r.event !== event) continue;
    const unit = groupUnit(r);
    const t = ts(r);
    const last = lastByUnit.get(unit);
    lastByUnit.set(unit, t);
    if (last !== undefined && t - last < windowMs) continue;
    out.push({ at: t, unit, groupKey: r.groupKey ?? 'local' });
  }
  return out;
}

/** match_completed deduped per group unit (both online clients report it). */
export function completions(rows: TelemetryRow[], windowMs = COMPLETION_DEDUPE_MS): Completion[] {
  return dedupedEvents(rows, 'match_completed', windowMs);
}

// ---------------------------------------------------------------------------
// Metrics (definitions in each doc comment are the written-down definitions
// required by LAUNCH_PLAN §3 — they are printed in the report output too)
// ---------------------------------------------------------------------------

export interface RateResult {
  rate: number | null; // null = no data
  numerator: number;
  denominator: number;
}

/**
 * Run-It-Back Rate (§4 north star): completed sessions followed, in the same
 * group unit within 30 minutes, by a run_it_back click or a new draft start
 * ÷ all completed sessions (deduped match_completed).
 */
export function runItBackRate(rows: TelemetryRow[], windowMs = RUN_IT_BACK_WINDOW_MS): RateResult {
  const comps = completions(rows);
  const ribs = sortByTime(rows)
    .filter((r) => r.event === 'run_it_back')
    .map((r) => ({ at: ts(r), unit: groupUnit(r) }));
  const starts = draftStartMoments(rows);
  let qualifying = 0;
  for (const c of comps) {
    const followed =
      ribs.some((e) => e.unit === c.unit && e.at > c.at && e.at <= c.at + windowMs) ||
      starts.some((s) => s.unit === c.unit && s.at > c.at && s.at <= c.at + windowMs);
    if (followed) qualifying++;
  }
  return { rate: comps.length ? qualifying / comps.length : null, numerator: qualifying, denominator: comps.length };
}

/** Comprehension %: comprehension_response with understood=true ÷ all responses. */
export function comprehensionRate(rows: TelemetryRow[]): RateResult {
  const resp = rows.filter((r) => r.event === 'comprehension_response');
  const yes = resp.filter((r) => r.props?.understood === true).length;
  return { rate: resp.length ? yes / resp.length : null, numerator: yes, denominator: resp.length };
}

/**
 * Crash-free %: clientId-days (UTC day of the event's `at`) with ≥1
 * match_completed and 0 client_crash ÷ clientId-days with ≥1 match_completed.
 */
export function crashFreeRate(rows: TelemetryRow[]): RateResult {
  const dayKey = (r: TelemetryRow) => `${r.clientId ?? 'unknown'}|${r.at.slice(0, 10)}`;
  const matchDays = new Set(rows.filter((r) => r.event === 'match_completed').map(dayKey));
  const crashDays = new Set(rows.filter((r) => r.event === 'client_crash').map(dayKey));
  let clean = 0;
  for (const d of matchDays) if (!crashDays.has(d)) clean++;
  return { rate: matchDays.size ? clean / matchDays.size : null, numerator: clean, denominator: matchDays.size };
}

/**
 * Character approval within one semantic correction: fighter_approved events
 * whose nomination episode (same clientId, since that client's last
 * custom_nomination or previous approval) contains ≤1 custom_correction with
 * kind='semantic' ÷ all fighter_approved events.
 */
export function approvalWithinOneCorrection(rows: TelemetryRow[]): RateResult {
  const semSince = new Map<string, number>();
  let approved = 0;
  let withinOne = 0;
  for (const r of sortByTime(rows)) {
    const c = r.clientId ?? 'unknown';
    if (r.event === 'custom_nomination') {
      semSince.set(c, 0);
    } else if (r.event === 'custom_correction' && r.props?.kind === 'semantic') {
      semSince.set(c, (semSince.get(c) ?? 0) + 1);
    } else if (r.event === 'fighter_approved') {
      approved++;
      if ((semSince.get(c) ?? 0) <= 1) withinOne++;
      semSince.set(c, 0);
    }
  }
  return { rate: approved ? withinOne / approved : null, numerator: withinOne, denominator: approved };
}

/**
 * Dethrone usage: distinct groupKeys with ≥1 match_completed that also have a
 * dethrone_link_created or challenge_link_opened ÷ distinct groupKeys with
 * ≥1 match_completed. (Local play collapses into the single 'local' groupKey —
 * only online rooms identify friend groups today.)
 */
export function dethroneUsage(rows: TelemetryRow[]): RateResult {
  const used = new Set(
    rows.filter((r) => r.event === 'dethrone_link_created' || r.event === 'challenge_link_opened').map((r) => r.groupKey ?? 'local'),
  );
  const played = new Set(rows.filter((r) => r.event === 'match_completed').map((r) => r.groupKey ?? 'local'));
  let hit = 0;
  for (const g of played) if (used.has(g)) hit++;
  return { rate: played.size ? hit / played.size : null, numerator: hit, denominator: played.size };
}

/** Friend groups tested: distinct groupKeys with ≥1 match_completed. */
export function friendGroupCount(rows: TelemetryRow[]): number {
  return new Set(rows.filter((r) => r.event === 'match_completed').map((r) => r.groupKey ?? 'local')).size;
}

/** 7-day group return: groupKeys active on ≥2 distinct UTC days ≤7 days apart. */
export function sevenDayReturnCount(rows: TelemetryRow[]): number {
  const daysByGroup = new Map<string, Set<string>>();
  for (const r of rows) {
    const g = r.groupKey ?? 'local';
    if (!daysByGroup.has(g)) daysByGroup.set(g, new Set());
    daysByGroup.get(g)!.add(r.at.slice(0, 10));
  }
  let returned = 0;
  for (const days of daysByGroup.values()) {
    const sorted = [...days].sort();
    for (let i = 1; i < sorted.length; i++) {
      if (Date.parse(sorted[i]) - Date.parse(sorted[i - 1]) <= 7 * DAY_MS) {
        returned++;
        break;
      }
    }
  }
  return returned;
}

// ---------------------------------------------------------------------------
// The 12-step funnel (§3), mapped onto the event names that exist today
// ---------------------------------------------------------------------------

export interface FunnelStep {
  step: number;
  label: string;
  mapping: string;
  count: number;
  units: number; // distinct group units (room / device)
}

export function computeFunnel(rows: TelemetryRow[]): FunnelStep[] {
  const pick = (...events: string[]) => rows.filter((r) => events.includes(r.event));
  const unitsOf = (rs: TelemetryRow[]) => new Set(rs.map(groupUnit)).size;
  const fromRows = (step: number, label: string, mapping: string, rs: TelemetryRow[]): FunnelStep => ({
    step, label, mapping, count: rs.length, units: unitsOf(rs),
  });

  const starts = draftStartMoments(rows);
  const comps = completions(rows);

  // Rematch signals for step 11: completions followed within 30 min by a
  // run_it_back or a new draft start in the same unit (same rule as §4).
  const rematchUnits = new Set<string>();
  const ribEvents = sortByTime(rows).filter((r) => r.event === 'run_it_back').map((r) => ({ at: ts(r), unit: groupUnit(r) }));
  let rematchCount = 0;
  for (const c of comps) {
    const followed =
      ribEvents.some((e) => e.unit === c.unit && e.at > c.at && e.at <= c.at + RUN_IT_BACK_WINDOW_MS) ||
      starts.some((s) => s.unit === c.unit && s.at > c.at && s.at <= c.at + RUN_IT_BACK_WINDOW_MS);
    if (followed) {
      rematchCount++;
      rematchUnits.add(c.unit);
    }
  }

  const returns = sevenDayReturnCount(rows);

  return [
    fromRows(1, 'Challenge-link opens', 'challenge_link_opened', pick('challenge_link_opened')),
    fromRows(2, 'Guest joins', 'guest_joined', pick('guest_joined')),
    {
      step: 3,
      label: 'Draft starts',
      mapping: "draft_started, plus first online draft_pick per group since last match_completed (online drafts emit no draft_started event yet)",
      count: starts.length,
      units: new Set(starts.map((s) => s.unit)).size,
    },
    (() => {
      const dc = dedupedEvents(rows, 'draft_completed');
      return {
        step: 4,
        label: 'Draft completions',
        mapping: 'draft_completed, deduped: both online clients report it; reports from the same room within 2 min collapse to one',
        count: dc.length,
        units: new Set(dc.map((c) => c.unit)).size,
      };
    })(),
    fromRows(5, 'Fighter/arena inspections during draft', 'fighter_inspected (no arena-inspection event exists yet)', pick('fighter_inspected')),
    fromRows(6, 'Wildcard locks', 'wildcard_locked', pick('wildcard_locked')),
    {
      step: 7,
      label: 'Match completions',
      mapping: 'match_completed, deduped: reports from clients of the same room within 2 min collapse to one match',
      count: comps.length,
      units: new Set(comps.map((c) => c.unit)).size,
    },
    fromRows(8, 'Post-match breakdown opens', 'breakdown_opened', pick('breakdown_opened')),
    fromRows(9, 'Champion shares', 'champion_card_shared', pick('champion_card_shared')),
    fromRows(10, 'Dethrone-link usage', 'dethrone_link_created + challenge_link_opened', pick('dethrone_link_created', 'challenge_link_opened')),
    {
      step: 11,
      label: 'Rematch / fresh-draft starts',
      mapping: 'completions followed ≤30 min by run_it_back or a new draft start in the same group unit (§4 rule)',
      count: rematchCount,
      units: rematchUnits.size,
    },
    {
      step: 12,
      label: '7-day group return',
      mapping: 'same groupKey active on ≥2 distinct UTC days ≤7 days apart',
      count: returns,
      units: returns,
    },
  ];
}

// ---------------------------------------------------------------------------
// §2 gate table
// ---------------------------------------------------------------------------

export interface GateLine {
  gate: string;
  threshold: string;
  measured: string;
  status: 'PASS' | 'FAIL' | 'NO DATA';
}

function pct(r: number | null): string {
  return r === null ? '—' : `${(r * 100).toFixed(1)}%`;
}

function rateLine(gate: string, threshold: string, min: number, r: RateResult, detail: string): GateLine {
  return {
    gate,
    threshold,
    measured: r.rate === null ? `no observations (${detail})` : `${pct(r.rate)} (${r.numerator}/${r.denominator} ${detail})`,
    status: r.rate === null ? 'NO DATA' : r.rate >= min ? 'PASS' : 'FAIL',
  };
}

/** The §2 vertical-slice gate table, computed on REAL rows only. */
export function gateTable(real: TelemetryRow[]): GateLine[] {
  const groups = friendGroupCount(real);
  return [
    {
      gate: 'Friend groups tested',
      threshold: '≥ 10',
      measured: `${groups} distinct groupKey(s) with a completed match (local play collapses into 'local')`,
      status: real.length === 0 ? 'NO DATA' : groups >= 10 ? 'PASS' : 'FAIL',
    },
    rateLine('Immediate run-it-back after a completed session', '≥ 60%', 0.6, runItBackRate(real), 'completed sessions'),
    rateLine('Character approval within one semantic correction', '≥ 85%', 0.85, approvalWithinOneCorrection(real), 'approvals'),
    rateLine('Players can articulate why the winner won', '≥ 85%', 0.85, comprehensionRate(real), 'comprehension responses'),
    rateLine('Crash-free match completion', '≥ 95%', 0.95, crashFreeRate(real), 'clientId-days with a completed match'),
    {
      gate: 'Replay reproduction in automated tests',
      threshold: '100%',
      measured: 'not derived from telemetry — enforced by the replay test suites in CI (docs/QA_PLAN.md)',
      status: 'NO DATA',
    },
    {
      gate: 'Performance baseline (720p30 / 1080p60)',
      threshold: 'met',
      measured: 'not instrumented in telemetry — manual/QA measurement (docs/TECHNICAL_ARCHITECTURE.md §10)',
      status: 'NO DATA',
    },
    rateLine('Groups use or share the Dethrone challenge link', '≥ 50%', 0.5, dethroneUsage(real), 'groups with a completed match'),
  ];
}

// ---------------------------------------------------------------------------
// Report rendering
// ---------------------------------------------------------------------------

function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join('  ');
  return [line(headers), line(widths.map((w) => '-'.repeat(w))), ...rows.map(line)].join('\n');
}

export function buildReport(rows: TelemetryRow[], meta: { files?: string[]; notes?: string[] } = {}): string {
  const { real, synthetic } = splitRealSynthetic(rows);
  const out: string[] = [];

  out.push('INFINITE ARENA — FUNNEL & VERTICAL-SLICE GATE REPORT (LAUNCH_PLAN §2–§5)');
  out.push(`Generated: ${new Date().toISOString()}`);
  if (meta.files?.length) out.push(`Input: ${meta.files.join(', ')}`);
  for (const n of meta.notes ?? []) out.push(n);
  out.push('');
  out.push('Definitions (written down before any dashboard — LAUNCH_PLAN §3):');
  out.push("  real data       = events with source === 'alpha' (stamped client-side from the hostname;");
  out.push("                    localhost/Playwright always stamps 'local-dev'). Never mixed with synthetic (§5, locked).");
  out.push("  group unit      = online room id when present, else per-device clientId (local play cannot");
  out.push('                    cross-satisfy metrics between devices).');
  out.push('  completed match = match_completed, deduped within 2 min per group unit (both online clients report it).');
  out.push('  run-it-back     = completed match followed ≤30 min, same group unit, by run_it_back or a new draft start (§4).');
  out.push('  crash-free %    = clientId-days (UTC) with ≥1 match_completed and 0 client_crash ÷ clientId-days with ≥1 match_completed.');
  out.push('  approval within one semantic correction = fighter_approved whose episode since that client’s custom_nomination');
  out.push("                    has ≤1 custom_correction kind='semantic' ÷ all fighter_approved.");
  out.push('  dethrone usage  = groupKeys with dethrone_link_created or challenge_link_opened ÷ groupKeys with ≥1 completed match.');
  out.push('');

  out.push('=== HUMAN DATA (real friend groups — source=alpha) ===');
  if (real.length === 0) {
    out.push('no human data yet');
  } else {
    out.push('');
    out.push('12-step funnel (§3) — event mapping shown per step:');
    out.push(table(
      ['#', 'Step', 'Count', 'Group units', 'Mapped from'],
      computeFunnel(real).map((s) => [String(s.step), s.label, String(s.count), String(s.units), s.mapping]),
    ));
    out.push('');
    out.push('Gate table (§2):');
    out.push(table(
      ['Gate', 'Threshold', 'Measured', 'Status'],
      gateTable(real).map((g) => [g.gate, g.threshold, g.measured, g.status]),
    ));
  }
  out.push('');

  out.push('=== ENGINEERING DATA (synthetic / dev — source≠alpha; never reported as human metrics, §5) ===');
  if (synthetic.length === 0) {
    out.push('no synthetic events in input');
  } else {
    const counts = new Map<string, number>();
    for (const r of synthetic) counts.set(r.event, (counts.get(r.event) ?? 0) + 1);
    out.push(`${synthetic.length} event(s) from ${new Set(synthetic.map((r) => r.clientId ?? 'unknown')).size} client(s)`);
    out.push('');
    out.push('Synthetic funnel (engineering smoke signal only):');
    out.push(table(
      ['#', 'Step', 'Count', 'Group units'],
      computeFunnel(synthetic).map((s) => [String(s.step), s.label, String(s.count), String(s.units)]),
    ));
    out.push('');
    out.push('Synthetic event counts:');
    out.push(table(
      ['Event', 'Count'],
      [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([e, c]) => [e, String(c)]),
    ));
  }
  out.push('');
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  const defaultPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'services', 'control-plane', 'data', 'telemetry.jsonl');
  const paths = args.length > 0 ? args : [defaultPath];
  const rows: TelemetryRow[] = [];
  const notes: string[] = [];
  for (const p of paths) {
    if (!existsSync(p)) {
      notes.push(`Note: ${p} does not exist (treated as empty)`);
      continue;
    }
    rows.push(...parseJsonl(readFileSync(p, 'utf8')));
  }
  // eslint-disable-next-line no-console
  console.log(buildReport(rows, { files: paths, notes }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
