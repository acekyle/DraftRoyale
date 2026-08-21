/**
 * Telemetry uploader — Stage 1 friend-group metrics (docs/LAUNCH_PLAN.md §3–5).
 *
 * state.ts keeps its local ring buffer as the source of truth for the export
 * button; this module stamps every event (source / clientId / groupKey),
 * maintains a separate unsent outbound queue, and ships batches to the
 * self-hosted control plane (POST /telemetry, derived from the stored
 * ia_server_url by swapping ws→http / wss→https). No server URL stored →
 * completely silent. Failures keep events queued; nothing here may ever
 * throw into app code or block gameplay.
 *
 * Locked synthetic/real separation (LAUNCH_PLAN §5): source derives from the
 * hostname — localhost/127.0.0.1 (dev servers, Playwright) is 'local-dev';
 * only a real deployed origin produces 'alpha'. Unknown hosts err synthetic.
 */
import { net } from './net';

export interface TelemetryEvent {
  event: string;
  at: string;
  props: Record<string, string | number | boolean>;
  source: string;
  clientId: string;
  groupKey: string;
}

const OUTBOX_KEY = 'ia_telemetry_outbox';
const CLIENT_ID_KEY = 'ia_client_id';
const SERVER_URL_KEY = 'ia_server_url';
const OUTBOX_CAP = 800;
const MAX_BATCH = 500; // the server accepts at most 500 events per POST
const FLUSH_INTERVAL_MS = 20_000;

export function telemetrySource(): 'alpha' | 'local-dev' {
  try {
    const h = location.hostname;
    const isLocal = !h || h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]';
    return isLocal ? 'local-dev' : 'alpha';
  } catch {
    return 'local-dev';
  }
}

let memClientId: string | null = null;

/** Stable anonymous client id (random UUID, persisted; no PII). */
export function telemetryClientId(): string {
  if (memClientId) return memClientId;
  try {
    let id = localStorage.getItem(CLIENT_ID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(CLIENT_ID_KEY, id);
    }
    memClientId = id;
  } catch {
    // Private mode: keep a per-session id in memory.
    memClientId = crypto.randomUUID();
  }
  return memClientId;
}

/**
 * The unit of analysis is the friend group (LAUNCH_PLAN §3): the online room
 * id when connected, else 'local'. Read lazily at event time — net.ts imports
 * nothing from state/telemetry, so this direction is cycle-free.
 */
export function telemetryGroupKey(): string {
  try {
    return (net.status === 'open' && net.snapshot?.roomId) || 'local';
  } catch {
    return 'local';
  }
}

function loadOutbox(): TelemetryEvent[] {
  try {
    const v = JSON.parse(localStorage.getItem(OUTBOX_KEY) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function saveOutbox(events: TelemetryEvent[]) {
  try {
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(events.slice(-OUTBOX_CAP)));
  } catch { /* quota / private mode — telemetry is best-effort */ }
}

/** Queue a stamped event for upload. Never throws. */
export function queueTelemetry(entry: TelemetryEvent) {
  try {
    const outbox = loadOutbox();
    outbox.push(entry);
    saveOutbox(outbox);
  } catch { /* best-effort */ }
}

/** http(s) POST endpoint derived from the stored ws(s) server URL, or null. */
export function telemetryEndpoint(): string | null {
  try {
    const url = localStorage.getItem(SERVER_URL_KEY);
    if (!url) return null;
    const base = url.trim().replace(/^ws:/i, 'http:').replace(/^wss:/i, 'https:').replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(base)) return null;
    return `${base}/telemetry`;
  } catch {
    return null;
  }
}

let inFlight = false;

/** Flush the outbound queue. Failures keep events queued for the next tick. */
export async function flushTelemetry(): Promise<void> {
  if (inFlight) return;
  const endpoint = telemetryEndpoint();
  if (!endpoint) return; // no server configured — stay silent
  const batch = loadOutbox().slice(0, MAX_BATCH);
  if (batch.length === 0) return;
  inFlight = true;
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ events: batch }),
    });
    // Drop exactly what we sent; events queued mid-flight stay for next time.
    if (res.ok) saveOutbox(loadOutbox().slice(batch.length));
  } catch {
    /* offline / server down — events stay queued */
  } finally {
    inFlight = false;
  }
}

/** Tab going hidden: hand the batch to the browser via sendBeacon. */
function flushViaBeacon() {
  try {
    const endpoint = telemetryEndpoint();
    if (!endpoint || typeof navigator.sendBeacon !== 'function') return;
    const batch = loadOutbox().slice(0, MAX_BATCH);
    if (batch.length === 0) return;
    // Plain string body → text/plain simple request (sendBeacon cannot run a
    // CORS preflight); the server parses the body as JSON regardless.
    if (navigator.sendBeacon(endpoint, JSON.stringify({ events: batch }))) {
      saveOutbox(loadOutbox().slice(batch.length));
    }
  } catch { /* never throw into app code */ }
}

let started = false;

/** Install the periodic flush + hidden-tab beacon. Idempotent. */
export function initTelemetry() {
  if (started || typeof window === 'undefined') return;
  started = true;
  window.setInterval(() => {
    void flushTelemetry();
  }, FLUSH_INTERVAL_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushViaBeacon();
  });
}
