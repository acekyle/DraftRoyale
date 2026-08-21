import { defineConfig, type Plugin } from 'vite';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  customForgeAvailability, forgeCustomStatue, hasCustomStatue, ForgeError,
  type ForgeFighterFile,
} from '../../tools/heroforge/custom';

/**
 * Custom-fighter statue forge service (D-029) — dev-server only.
 *
 * POST /api/forge-custom          body: FighterFile → starts one Tripo forge
 * GET  /api/forge-custom?fighterId=<id> → { state, available, remaining }
 *
 * The deployed static build has no middleware, so the client's fetch misses
 * and custom fighters stay procedural — that is the designed fallback. All
 * spending laws live in tools/heroforge/custom.ts; this layer only adds
 * "one forge task at a time" and request validation.
 */
function customForgePlugin(): Plugin {
  type JobState = 'running' | 'done' | 'failed';
  const jobs = new Map<string, { state: JobState; error?: string }>();
  let active = 0;

  const respond = (res: ServerResponse, code: number, body: unknown) => {
    res.statusCode = code;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(body));
  };

  const readBody = (req: IncomingMessage): Promise<string> =>
    new Promise((resolvePromise, reject) => {
      let data = '';
      req.on('data', (c) => {
        data += c;
        if (data.length > 1_000_000) reject(new Error('body too large'));
      });
      req.on('end', () => resolvePromise(data));
      req.on('error', reject);
    });

  return {
    name: 'ia-custom-forge',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/forge-custom', (req, res) => {
        void (async () => {
          const avail = customForgeAvailability();
          if (req.method === 'GET') {
            const id = new URL(req.url ?? '/', 'http://localhost').searchParams.get('fighterId') ?? '';
            const job = jobs.get(id);
            const state = job?.state ?? (hasCustomStatue(id) ? 'done' : 'idle');
            respond(res, 200, {
              state,
              error: job?.error,
              available: avail.hasKey && avail.remaining > 0,
              remaining: avail.remaining,
            });
            return;
          }
          if (req.method !== 'POST') {
            respond(res, 405, { state: 'unavailable', reason: 'method' });
            return;
          }
          let file: ForgeFighterFile;
          try {
            file = JSON.parse(await readBody(req));
          } catch {
            respond(res, 400, { state: 'unavailable', reason: 'bad-json' });
            return;
          }
          const id = file?.dna?.identity?.fighterId;
          if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) {
            respond(res, 400, { state: 'unavailable', reason: 'bad-fighter' });
            return;
          }
          if (jobs.get(id)?.state === 'running') { respond(res, 200, { state: 'running' }); return; }
          if (hasCustomStatue(id)) { respond(res, 200, { state: 'done' }); return; }
          if (!avail.hasKey) { respond(res, 503, { state: 'unavailable', reason: 'no-key' }); return; }
          if (avail.remaining <= 0) { respond(res, 503, { state: 'unavailable', reason: 'cap' }); return; }
          if (active > 0) { respond(res, 429, { state: 'unavailable', reason: 'busy' }); return; }

          active++;
          jobs.set(id, { state: 'running' });
          forgeCustomStatue(file, (m) => server.config.logger.info(m))
            .then(() => jobs.set(id, { state: 'done' }))
            .catch((err) => {
              const reason = err instanceof ForgeError ? err.reason : 'provider';
              server.config.logger.error(`[custom-forge] ${id} failed (${reason}): ${err?.message ?? err}`);
              jobs.set(id, { state: 'failed', error: String(err?.message ?? err).slice(0, 300) });
            })
            .finally(() => { active--; });
          respond(res, 202, { state: 'running' });
        })().catch((err) => respond(res, 500, { state: 'unavailable', reason: String(err?.message ?? err).slice(0, 200) }));
      });
    },
  };
}

export default defineConfig({
  // GitHub Pages serves from /<repo>/ — CI sets BASE_PATH=/DraftRoyale/.
  base: process.env.BASE_PATH ?? '/',
  plugins: [customForgePlugin()],
  resolve: {
    alias: {
      '@arena/contracts': fileURLToPath(new URL('../../packages/contracts/src/index.ts', import.meta.url)),
      '@arena/combat-sim': fileURLToPath(new URL('../../services/combat-sim/src/index.ts', import.meta.url)),
    },
  },
  server: {
    fs: { allow: [fileURLToPath(new URL('../..', import.meta.url))] },
  },
});
