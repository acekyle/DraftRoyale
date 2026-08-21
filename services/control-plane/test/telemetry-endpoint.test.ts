/** POST /telemetry intake — batches, malformed-event dropping, caps, CORS. */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createControlPlane, type ControlPlane } from '../src/server';
import { tmpDataDir } from './helpers';

describe('control plane — telemetry intake', () => {
  let cp: ControlPlane;
  let dataDir: string;
  let base: string;

  beforeAll(async () => {
    dataDir = tmpDataDir();
    cp = await createControlPlane({ port: 0, dataDir, tickIntervalMs: 5 });
    base = `http://127.0.0.1:${cp.port}`;
  });
  afterAll(async () => {
    await cp.close();
  });

  const jsonlLines = () => {
    const p = join(dataDir, 'telemetry.jsonl');
    if (!existsSync(p)) return [];
    return readFileSync(p, 'utf8').split('\n').filter((l) => l.trim().length > 0).map((l) => JSON.parse(l));
  };

  const ev = (event: string, extra: Record<string, unknown> = {}) => ({
    event,
    at: '2026-08-20T18:00:00.000Z',
    source: 'alpha',
    clientId: 'c-1',
    groupKey: 'ROOM42',
    props: { mode: 'online' },
    ...extra,
  });

  it('accepts a valid batch, appends one JSONL line per event with receivedAt', async () => {
    const res = await fetch(`${base}/telemetry`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ events: [ev('guest_joined'), ev('match_completed')] }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(await res.json()).toEqual({ ok: true, accepted: 2 });

    const lines = jsonlLines();
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ event: 'guest_joined', source: 'alpha', clientId: 'c-1', groupKey: 'ROOM42' });
    expect(typeof lines[0].receivedAt).toBe('string');
    expect(Number.isFinite(Date.parse(lines[0].receivedAt))).toBe(true);
    expect(lines[1].event).toBe('match_completed');
  });

  it('drops malformed events individually instead of rejecting the batch', async () => {
    const before = jsonlLines().length;
    const res = await fetch(`${base}/telemetry`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        events: [
          ev('breakdown_opened'),
          null, // not an object
          42, // not an object
          { at: '2026-08-20T18:00:00.000Z', source: 'alpha' }, // missing event
          { event: 'x', source: 'alpha' }, // missing at
          { event: 'x', at: '2026-08-20T18:00:00.000Z' }, // missing source
          { event: 'x', at: '2026-08-20T18:00:00.000Z', source: 'alpha', props: [] }, // props not an object
          { event: 'x', at: '2026-08-20T18:00:00.000Z', source: 'alpha', clientId: 7 }, // clientId not a string
          ev('run_it_back'),
        ],
      }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, accepted: 2 });
    const lines = jsonlLines();
    expect(lines.length).toBe(before + 2);
    expect(lines.slice(-2).map((l) => l.event)).toEqual(['breakdown_opened', 'run_it_back']);
  });

  it('rejects unparseable JSON with 400', async () => {
    const res = await fetch(`${base}/telemetry`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    expect(res.status).toBe(400);
    expect((await res.json()).ok).toBe(false);
  });

  it('rejects a body whose events field is not an array with 400', async () => {
    const res = await fetch(`${base}/telemetry`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ events: 'nope' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects more than 500 events with 413', async () => {
    const events = Array.from({ length: 501 }, () => ev('guest_joined'));
    const before = jsonlLines().length;
    const res = await fetch(`${base}/telemetry`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ events }),
    });
    expect(res.status).toBe(413);
    expect(jsonlLines().length).toBe(before); // nothing persisted
  });

  it('rejects a body over 256 KB with 413', async () => {
    const big = JSON.stringify({ events: [ev('guest_joined', { props: { pad: 'x'.repeat(300 * 1024) } })] });
    const before = jsonlLines().length;
    const res = await fetch(`${base}/telemetry`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: big,
    });
    expect(res.status).toBe(413);
    expect(jsonlLines().length).toBe(before);
  });

  it('answers the CORS preflight for the GitHub Pages client', async () => {
    const res = await fetch(`${base}/telemetry`, {
      method: 'OPTIONS',
      headers: {
        origin: 'https://example.github.io',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('access-control-allow-methods')).toContain('POST');
    expect(res.headers.get('access-control-allow-headers')).toContain('content-type');
  });

  it('parses a sendBeacon-style text/plain body (no preflight path)', async () => {
    const before = jsonlLines().length;
    const res = await fetch(`${base}/telemetry`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({ events: [ev('client_crash')] }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, accepted: 1 });
    expect(jsonlLines().length).toBe(before + 1);
  });

  it('leaves /health untouched', async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });
});
