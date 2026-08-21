/**
 * Moderation review queue (docs/SECURITY_AND_MODERATION.md §5 — alpha scope).
 *
 * Reads the append-only reports.jsonl written by the control plane's `report`
 * message handler and prints the review queue: reports grouped by TARGET,
 * most-reported first, with per-reason counts, distinct-reporter counts, the
 * rooms involved, and any reporter notes. The files are never modified here —
 * history is immutable; review actions (when they exist) will be new audit
 * lines, not edits.
 *
 * Usage:  npm run moderation [-- path/to/reports.jsonl ...] [--json]
 * Default input: services/control-plane/data/reports.jsonl
 * --json prints the grouped queue as machine-readable JSON instead of a table.
 *
 * Zero dependencies (node:fs / node:path / node:url only); aggregation lives
 * in exported pure functions so tests can import them.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export interface ReportRow {
  at: string;
  roomId: string;
  phase?: string;
  matchId?: string | null;
  reporterGuestId: string;
  targetGuestId: string;
  targetName?: string;
  targetRole?: string;
  reason: string;
  note?: string;
}

/** Parse reports JSONL, skipping blank/malformed lines and rows missing the essentials. */
export function parseReports(text: string): ReportRow[] {
  const rows: ReportRow[] = [];
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try {
      const v = JSON.parse(s) as ReportRow | null;
      if (
        v &&
        typeof v === 'object' &&
        typeof v.at === 'string' &&
        typeof v.targetGuestId === 'string' &&
        typeof v.reporterGuestId === 'string' &&
        typeof v.reason === 'string'
      )
        rows.push(v);
    } catch { /* skip malformed line */ }
  }
  return rows;
}

export interface TargetQueueEntry {
  targetGuestId: string;
  /** Display name from the most recent report (names are per-session, guest alpha). */
  lastKnownName: string;
  total: number;
  uniqueReporters: number;
  byReason: Record<string, number>;
  rooms: string[];
  firstAt: string;
  lastAt: string;
  notes: string[];
}

/** Group reports by target, most-reported first (ties: most recent first). */
export function groupByTarget(rows: ReportRow[]): TargetQueueEntry[] {
  const byTarget = new Map<string, ReportRow[]>();
  for (const r of rows) {
    const list = byTarget.get(r.targetGuestId) ?? [];
    list.push(r);
    byTarget.set(r.targetGuestId, list);
  }
  const entries: TargetQueueEntry[] = [];
  for (const [targetGuestId, list] of byTarget) {
    const sorted = [...list].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const byReason: Record<string, number> = {};
    for (const r of sorted) byReason[r.reason] = (byReason[r.reason] ?? 0) + 1;
    const last = sorted[sorted.length - 1];
    entries.push({
      targetGuestId,
      lastKnownName: last.targetName ?? '(unknown)',
      total: sorted.length,
      uniqueReporters: new Set(sorted.map((r) => r.reporterGuestId)).size,
      byReason,
      rooms: [...new Set(sorted.map((r) => r.roomId))],
      firstAt: sorted[0].at,
      lastAt: last.at,
      notes: sorted.filter((r) => typeof r.note === 'string' && r.note.length > 0).map((r) => r.note!),
    });
  }
  return entries.sort((a, b) => b.total - a.total || Date.parse(b.lastAt) - Date.parse(a.lastAt));
}

export function buildQueueReport(rows: ReportRow[], files: string[]): string {
  const groups = groupByTarget(rows);
  const out: string[] = [];
  out.push('MODERATION REVIEW QUEUE — reports grouped by target, most-reported first');
  out.push(`Input: ${files.join(', ')}`);
  out.push(`Reports: ${rows.length} · Targets: ${groups.length}`);
  out.push('');
  if (groups.length === 0) {
    out.push('Queue is empty — no reports filed.');
    return out.join('\n');
  }
  for (const [i, g] of groups.entries()) {
    out.push(`${i + 1}. ${g.lastKnownName}  (guest ${g.targetGuestId})`);
    out.push(`   reports: ${g.total} · distinct reporters: ${g.uniqueReporters} · rooms: ${g.rooms.join(', ')}`);
    out.push(
      `   reasons: ${Object.entries(g.byReason)
        .sort((a, b) => b[1] - a[1])
        .map(([r, c]) => `${r}×${c}`)
        .join(', ')}`,
    );
    out.push(`   first: ${g.firstAt} · last: ${g.lastAt}`);
    for (const n of g.notes) out.push(`   note: ${n}`);
    out.push('');
  }
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const paths = args.filter((a) => a !== '--json');
  const defaultPath = join(
    dirname(fileURLToPath(import.meta.url)), '..', 'services', 'control-plane', 'data', 'reports.jsonl',
  );
  const files = paths.length > 0 ? paths : [defaultPath];
  const rows: ReportRow[] = [];
  for (const p of files) {
    if (!existsSync(p)) continue; // no reports yet — empty queue
    rows.push(...parseReports(readFileSync(p, 'utf8')));
  }
  /* eslint-disable no-console */
  if (json) {
    console.log(JSON.stringify(
      { generatedAt: new Date().toISOString(), files, totalReports: rows.length, targets: groupByTarget(rows) },
      null,
      2,
    ));
  } else {
    console.log(buildQueueReport(rows, files));
  }
  /* eslint-enable no-console */
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
