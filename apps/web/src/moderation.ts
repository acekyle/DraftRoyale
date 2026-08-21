/**
 * Client-side moderation: the local blocklist (docs/SECURITY_AND_MODERATION.md §5).
 *
 * Blocking is PURELY PRESENTATIONAL — a localStorage set of guest ids whose
 * social surfaces (reactions are the only one today) are hidden on THIS
 * client. It never touches gameplay or the lockstep sim: a blocked opponent's
 * picks, preps, and battle inputs apply exactly as before, or every replay
 * hash would diverge. Guest ids are stable across reconnects (session-token
 * resume), so the list keeps working after a refresh.
 */

const BLOCKLIST_KEY = 'ia_blocklist';

export function loadBlocklist(): Set<string> {
  try {
    const v = JSON.parse(localStorage.getItem(BLOCKLIST_KEY) ?? '[]');
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

export function isBlocked(guestId: string): boolean {
  return loadBlocklist().has(guestId);
}

export function setBlocked(guestId: string, blocked: boolean) {
  const set = loadBlocklist();
  if (blocked) set.add(guestId);
  else set.delete(guestId);
  try {
    localStorage.setItem(BLOCKLIST_KEY, JSON.stringify([...set]));
  } catch { /* private mode — block lasts for this page life only */ }
}

/** Human labels for the closed report-reason enum (order = display order). */
export const REPORT_REASON_LABELS: Record<string, string> = {
  harassment: 'Harassment',
  inappropriate_name: 'Inappropriate name',
  inappropriate_content: 'Inappropriate content',
  cheating_suspected: 'Suspected cheating',
  other: 'Other',
};
