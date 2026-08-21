/**
 * Client side of the custom-fighter statue forge (D-029).
 *
 * Talks to the dev-server middleware at /api/forge-custom (see
 * apps/web/vite.config.ts). On the deployed static build the endpoint does
 * not exist — every call resolves to 'unavailable' and the procedural
 * chassis stands, which is the designed fallback, never an error state.
 */
import type { FighterFile } from '@arena/contracts';
import { invalidateHeroModel } from './heroModels';

export type ForgeState = 'idle' | 'running' | 'done' | 'failed' | 'unavailable';

export interface ForgeReply {
  state: ForgeState;
  /** 'no-key' | 'cap' | 'busy' | 'no-forge-service' | … when unavailable. */
  reason?: string;
  error?: string;
}

const API = '/api/forge-custom';

async function parseReply(res: Response): Promise<ForgeReply> {
  const body = (await res.json().catch(() => null)) as Partial<ForgeReply> | null;
  if (!body || typeof body.state !== 'string') {
    return { state: 'unavailable', reason: `no-forge-service` };
  }
  return { state: body.state as ForgeState, reason: body.reason, error: body.error };
}

/** Ask the forge service to generate a statue for a compiled custom fighter. */
export async function requestStatueForge(file: FighterFile): Promise<ForgeReply> {
  try {
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(file),
    });
    return await parseReply(res);
  } catch {
    return { state: 'unavailable', reason: 'no-forge-service' };
  }
}

export async function statueForgeStatus(fighterId: string): Promise<ForgeReply> {
  try {
    const res = await fetch(`${API}?fighterId=${encodeURIComponent(fighterId)}`);
    return await parseReply(res);
  } catch {
    return { state: 'unavailable', reason: 'no-forge-service' };
  }
}

/**
 * Poll a running forge until it settles (Tripo takes ~2–3 minutes). On
 * success the hero-model cache is invalidated so the statue swaps in at the
 * next mount (pedestal inspect, next battle). Returns a cancel function.
 */
export function watchStatueForge(fighterId: string, onSettle: (reply: ForgeReply) => void): () => void {
  const startedAt = Date.now();
  const timer = window.setInterval(() => {
    void statueForgeStatus(fighterId).then((reply) => {
      const timedOut = Date.now() - startedAt > 30 * 60 * 1000;
      if (reply.state === 'running' && !timedOut) return;
      window.clearInterval(timer);
      if (reply.state === 'done') invalidateHeroModel(fighterId);
      onSettle(timedOut && reply.state === 'running' ? { state: 'failed', reason: 'timeout' } : reply);
    });
  }, 15_000);
  return () => window.clearInterval(timer);
}
