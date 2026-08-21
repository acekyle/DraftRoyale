/**
 * Moderation basics (protocol 0.3.0, docs/SECURITY_AND_MODERATION.md §5,
 * alpha scope: guest sessions, no accounts):
 *   - `report` files one JSONL line with full room context and is acked;
 *   - audit.jsonl receives report_filed / room_closed events, append-only;
 *   - abuse guard: at most MAX_REPORTS_PER_ROOM per session per room;
 *   - malformed reports are rejected with typed errors;
 *   - tools/moderation-queue.ts groups the queue most-reported first.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAX_REPORTS_PER_ROOM } from '@arena/contracts';
import { buildQueueReport, groupByTarget, parseReports } from '../../../tools/moderation-queue';
import { createControlPlane, type ControlPlane } from '../src/server';
import { TestClient, createRoomPair, tmpDataDir } from './helpers';

function readJsonl(path: string): Record<string, unknown>[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

describe('control plane — moderation basics', () => {
  let cp: ControlPlane;
  let dataDir: string;

  beforeAll(async () => {
    dataDir = tmpDataDir();
    cp = await createControlPlane({ port: 0, dataDir, tickIntervalMs: 5 });
  });
  afterAll(async () => {
    await cp.close();
  });

  it('files a report with full room context, acks it, and lands it in the audit log', async () => {
    const { host, p2, roomId } = await createRoomPair(cp.port);

    host.send({ t: 'report', targetGuestId: p2.guestId, reason: 'inappropriate_name', note: '  rude name  ' });
    const ack = await host.waitType('report_ack');
    expect(ack.targetGuestId).toBe(p2.guestId);

    const reports = readJsonl(join(dataDir, 'reports.jsonl'));
    const rec = reports.find((r) => r.reporterGuestId === host.guestId && r.targetGuestId === p2.guestId)!;
    expect(rec).toMatchObject({
      roomId,
      phase: 'lobby',
      matchId: null,
      reporterGuestId: host.guestId,
      targetGuestId: p2.guestId,
      targetName: 'Bob',
      targetRole: 'player',
      reason: 'inappropriate_name',
      note: 'rude name', // trimmed
    });
    expect(typeof rec.at).toBe('string');
    expect(Number.isFinite(Date.parse(rec.at as string))).toBe(true);

    const audit = readJsonl(join(dataDir, 'audit.jsonl'));
    expect(audit.some(
      (a) => a.type === 'report_filed' && a.roomId === roomId
        && a.reporterGuestId === host.guestId && a.targetGuestId === p2.guestId
        && a.reason === 'inappropriate_name',
    )).toBe(true);

    host.close();
    p2.close();
  }, 30_000);

  it('spectators can report, and the report is invisible to everyone but the reporter', async () => {
    const { host, p2, roomId } = await createRoomPair(cp.port);
    const spec = await TestClient.connect(cp.port);
    await spec.hello('Watcher');
    spec.send({ t: 'join_room', roomId, as: 'spectator' });
    await spec.waitState((s) => s.participants.some((q) => q.guestId === spec.guestId), 'spectator joined');

    // The target must never learn about the report.
    const p2Frames: string[] = [];
    p2.hooks.push((m) => p2Frames.push(m.t));

    spec.send({ t: 'report', targetGuestId: p2.guestId, reason: 'harassment' });
    await spec.waitType('report_ack');
    await new Promise((r) => setTimeout(r, 100));
    expect(p2Frames).not.toContain('report_ack');

    const reports = readJsonl(join(dataDir, 'reports.jsonl'));
    expect(reports.some((r) => r.reporterGuestId === spec.guestId && r.targetGuestId === p2.guestId)).toBe(true);

    host.close();
    p2.close();
    spec.close();
  }, 30_000);

  it('rejects malformed reports with typed errors', async () => {
    const { host, p2 } = await createRoomPair(cp.port);

    host.send({ t: 'report', targetGuestId: 'no-such-guest', reason: 'other' });
    await host.waitError('unknown_target');

    host.send({ t: 'report', targetGuestId: host.guestId, reason: 'other' });
    await host.waitError('bad_message'); // self-report

    host.sendRaw({ t: 'report', targetGuestId: p2.guestId, reason: 'because-i-lost' });
    await host.waitError('bad_message'); // reason outside the closed enum

    host.send({ t: 'report', targetGuestId: p2.guestId, reason: 'other', note: 'x'.repeat(281) });
    await host.waitError('bad_message'); // note over 280 chars

    host.close();
    p2.close();
  }, 30_000);

  it(`rate-limits report abuse: at most ${MAX_REPORTS_PER_ROOM} per session per room`, async () => {
    const { host, p2 } = await createRoomPair(cp.port);
    for (let i = 0; i < MAX_REPORTS_PER_ROOM; i++) {
      host.send({ t: 'report', targetGuestId: p2.guestId, reason: 'other', note: `spam ${i}` });
      await host.waitType('report_ack');
    }
    host.send({ t: 'report', targetGuestId: p2.guestId, reason: 'other' });
    await host.waitError('report_limit');
    host.close();
    p2.close();
  }, 30_000);

  it('room teardown lands room_closed in the audit log', async () => {
    const host = await TestClient.connect(cp.port);
    await host.hello('Hana');
    host.send({ t: 'create_room', experimental: false });
    const created = await host.waitState((s) => s.phase === 'lobby', 'room created');
    host.send({ t: 'leave_room' });
    // The audit append happens synchronously while handling leave_room — a
    // short beat lets the server process the frame.
    await new Promise((r) => setTimeout(r, 150));
    const audit = readJsonl(join(dataDir, 'audit.jsonl'));
    expect(audit.some((a) => a.type === 'room_closed' && a.roomId === created.roomId)).toBe(true);
    host.close();
  }, 30_000);

  it('moderation queue tool groups by target, most-reported first', () => {
    const mk = (target: string, name: string, reason: string, reporter: string, at: string, note?: string) =>
      JSON.stringify({
        at, roomId: 'ROOM1', phase: 'lobby', matchId: null,
        reporterGuestId: reporter, targetGuestId: target, targetName: name, reason,
        ...(note ? { note } : {}),
      });
    const text = [
      mk('g-bob', 'Bob', 'harassment', 'r1', '2026-08-20T10:00:00Z'),
      mk('g-bob', 'Bob', 'harassment', 'r2', '2026-08-20T10:01:00Z'),
      mk('g-bob', 'BobRenamed', 'cheating_suspected', 'r1', '2026-08-20T10:02:00Z', 'sus'),
      mk('g-eve', 'Eve', 'other', 'r3', '2026-08-20T11:00:00Z'),
      'not json at all',
      '{"at":"2026-08-20T11:01:00Z"}', // missing essentials — skipped
    ].join('\n');

    const rows = parseReports(text);
    expect(rows).toHaveLength(4);

    const groups = groupByTarget(rows);
    expect(groups.map((g) => g.targetGuestId)).toEqual(['g-bob', 'g-eve']); // most-reported first
    expect(groups[0]).toMatchObject({
      total: 3,
      uniqueReporters: 2,
      lastKnownName: 'BobRenamed', // name at time of most recent report
      byReason: { harassment: 2, cheating_suspected: 1 },
      rooms: ['ROOM1'],
      notes: ['sus'],
    });

    const report = buildQueueReport(rows, ['test.jsonl']);
    expect(report).toContain('BobRenamed');
    expect(report).toContain('harassment×2');
    expect(buildQueueReport([], ['test.jsonl'])).toContain('Queue is empty');
  });
});
