/** Unit tests for the funnel/gate aggregation (tools/funnel-report.ts). */
import { describe, expect, it } from 'vitest';
import {
  approvalWithinOneCorrection,
  buildReport,
  completions,
  comprehensionRate,
  computeFunnel,
  crashFreeRate,
  dethroneUsage,
  draftStartMoments,
  friendGroupCount,
  gateTable,
  parseJsonl,
  runItBackRate,
  sevenDayReturnCount,
  splitRealSynthetic,
  type TelemetryRow,
} from '../../../tools/funnel-report';

const T0 = Date.parse('2026-08-01T18:00:00.000Z');
const iso = (offsetMin: number) => new Date(T0 + offsetMin * 60_000).toISOString();

function ev(event: string, atMin: number, extra: Partial<TelemetryRow> = {}): TelemetryRow {
  return { event, at: iso(atMin), source: 'alpha', clientId: 'c1', groupKey: 'ROOM1', props: {}, ...extra };
}

describe('funnel-report — parsing & separation', () => {
  it('parses JSONL and skips malformed lines', () => {
    const text = [
      JSON.stringify(ev('guest_joined', 0)),
      'not json at all',
      '{"event": 42, "at": "2026-08-01T00:00:00Z"}', // event not a string
      '',
      JSON.stringify(ev('match_completed', 5)),
    ].join('\n');
    const rows = parseJsonl(text);
    expect(rows.map((r) => r.event)).toEqual(['guest_joined', 'match_completed']);
  });

  it("separates real (source==='alpha') from everything else, never mixing", () => {
    const rows = [
      ev('guest_joined', 0),
      ev('guest_joined', 1, { source: 'local-dev' }),
      ev('guest_joined', 2, { source: undefined }),
      ev('guest_joined', 3, { source: 'weird' }),
    ];
    const { real, synthetic } = splitRealSynthetic(rows);
    expect(real).toHaveLength(1);
    expect(synthetic).toHaveLength(3);
  });
});

describe('funnel-report — run-it-back rate (§4)', () => {
  it('counts a run_it_back event within 30 minutes', () => {
    const rows = [ev('match_completed', 0), ev('run_it_back', 10)];
    expect(runItBackRate(rows)).toEqual({ rate: 1, numerator: 1, denominator: 1 });
  });

  it('counts a new draft start within 30 minutes', () => {
    const rows = [ev('match_completed', 0), ev('draft_started', 29)];
    expect(runItBackRate(rows).rate).toBe(1);
  });

  it('does not count a draft start after the 30-minute window', () => {
    const rows = [ev('match_completed', 0), ev('draft_started', 31)];
    expect(runItBackRate(rows)).toEqual({ rate: 0, numerator: 0, denominator: 1 });
  });

  it('infers online draft starts from the first draft_pick after a completion', () => {
    const rows = [
      ev('draft_pick', -60), // first pick of the initial draft — not a rematch
      ev('draft_pick', -59),
      ev('match_completed', 0),
      ev('draft_pick', 5), // first pick since completion → inferred fresh draft
      ev('draft_pick', 6),
    ];
    const starts = draftStartMoments(rows);
    expect(starts).toHaveLength(2);
    expect(starts[1].via).toBe('first_online_pick');
    expect(runItBackRate(rows).rate).toBe(1);
  });

  it('scopes the window to the same group unit', () => {
    const rows = [
      ev('match_completed', 0, { groupKey: 'ROOM1' }),
      ev('draft_started', 5, { groupKey: 'ROOM2' }), // other room — no credit
    ];
    expect(runItBackRate(rows).rate).toBe(0);
  });

  it("keeps 'local' groups separated per device", () => {
    const rows = [
      ev('match_completed', 0, { groupKey: 'local', clientId: 'device-a' }),
      ev('draft_started', 5, { groupKey: 'local', clientId: 'device-b' }), // other laptop
    ];
    expect(runItBackRate(rows).rate).toBe(0);
  });

  it('dedupes both online clients reporting the same completion', () => {
    const rows = [
      ev('match_completed', 0, { clientId: 'c1' }),
      ev('match_completed', 0.1, { clientId: 'c2' }), // 6s later, same room
      ev('run_it_back', 3),
    ];
    expect(completions(rows)).toHaveLength(1);
    expect(runItBackRate(rows)).toEqual({ rate: 1, numerator: 1, denominator: 1 });
  });
});

describe('funnel-report — comprehension & crash-free', () => {
  it('computes comprehension % from understood flags', () => {
    const rows = [
      ev('comprehension_response', 0, { props: { understood: true } }),
      ev('comprehension_response', 1, { props: { understood: true } }),
      ev('comprehension_response', 2, { props: { understood: false } }),
    ];
    const r = comprehensionRate(rows);
    expect(r.numerator).toBe(2);
    expect(r.denominator).toBe(3);
    expect(r.rate).toBeCloseTo(2 / 3);
  });

  it('crash-free % = clean clientId-days with a completed match ÷ all such days', () => {
    const rows = [
      // c1 day one: match + crash → dirty day
      ev('match_completed', 0, { clientId: 'c1' }),
      ev('client_crash', 30, { clientId: 'c1' }),
      // c1 day two: match, no crash → clean
      ev('match_completed', 24 * 60, { clientId: 'c1' }),
      // c2 day one: match, no crash → clean
      ev('match_completed', 10, { clientId: 'c2' }),
      // c3: crash but no match that day → not a denominator day
      ev('client_crash', 20, { clientId: 'c3' }),
    ];
    const r = crashFreeRate(rows);
    expect(r.denominator).toBe(3);
    expect(r.numerator).toBe(2);
    expect(r.rate).toBeCloseTo(2 / 3);
  });
});

describe('funnel-report — approval within one semantic correction', () => {
  it('approval after ≤1 semantic correction counts; >1 does not', () => {
    const rows = [
      // nomination A: one semantic correction → within one
      ev('custom_nomination', 0),
      ev('custom_correction', 1, { props: { kind: 'semantic' } }),
      ev('fighter_approved', 2),
      // nomination B: two semantic corrections → not within one
      ev('custom_nomination', 10),
      ev('custom_correction', 11, { props: { kind: 'semantic' } }),
      ev('custom_correction', 12, { props: { kind: 'semantic' } }),
      ev('fighter_approved', 13),
      // nomination C: visual corrections do not count against the limit
      ev('custom_nomination', 20),
      ev('custom_correction', 21, { props: { kind: 'visual' } }),
      ev('custom_correction', 22, { props: { kind: 'visual' } }),
      ev('fighter_approved', 23),
    ];
    const r = approvalWithinOneCorrection(rows);
    expect(r.denominator).toBe(3);
    expect(r.numerator).toBe(2);
  });

  it('tracks correction counts per client', () => {
    const rows = [
      ev('custom_nomination', 0, { clientId: 'a' }),
      ev('custom_nomination', 0, { clientId: 'b' }),
      ev('custom_correction', 1, { clientId: 'a', props: { kind: 'semantic' } }),
      ev('custom_correction', 2, { clientId: 'a', props: { kind: 'semantic' } }),
      ev('fighter_approved', 3, { clientId: 'b' }), // b made zero corrections
      ev('fighter_approved', 4, { clientId: 'a' }), // a made two
    ];
    const r = approvalWithinOneCorrection(rows);
    expect(r.denominator).toBe(2);
    expect(r.numerator).toBe(1);
  });
});

describe('funnel-report — dethrone usage & group counts', () => {
  it('dethrone usage = groups that used a link ÷ groups with a completed match', () => {
    const rows = [
      ev('match_completed', 0, { groupKey: 'A' }),
      ev('dethrone_link_created', 1, { groupKey: 'A' }),
      ev('match_completed', 0, { groupKey: 'B' }), // no link usage
      ev('challenge_link_opened', 0, { groupKey: 'C' }), // opened but never completed → not counted
    ];
    const r = dethroneUsage(rows);
    expect(r.denominator).toBe(2);
    expect(r.numerator).toBe(1);
    expect(r.rate).toBeCloseTo(0.5);
  });

  it('friend groups = distinct groupKeys with a completed match', () => {
    const rows = [
      ev('match_completed', 0, { groupKey: 'A' }),
      ev('match_completed', 1, { groupKey: 'A' }),
      ev('match_completed', 0, { groupKey: 'B' }),
      ev('guest_joined', 0, { groupKey: 'C' }), // never completed
    ];
    expect(friendGroupCount(rows)).toBe(2);
  });

  it('7-day return: two active UTC days within 7 days', () => {
    const rows = [
      ev('match_completed', 0, { groupKey: 'A' }),
      ev('match_completed', 3 * 24 * 60, { groupKey: 'A' }), // +3 days → return
      ev('match_completed', 0, { groupKey: 'B' }),
      ev('match_completed', 9 * 24 * 60, { groupKey: 'B' }), // +9 days → no
    ];
    expect(sevenDayReturnCount(rows)).toBe(1);
  });
});

describe('funnel-report — report posture (§5 locked rule)', () => {
  it("prints exactly 'no human data yet' when there are zero real events, but still shows synthetic counts", () => {
    const rows = [
      ev('guest_joined', 0, { source: 'local-dev' }),
      ev('match_completed', 5, { source: 'local-dev' }),
    ];
    const report = buildReport(rows);
    expect(report).toContain('no human data yet');
    expect(report).toContain('ENGINEERING DATA');
    expect(report).toContain('match_completed');
    // No human gate table when there is no human data.
    expect(report).not.toContain('PASS');
  });

  it('renders the §2 gate table for real data with PASS/FAIL/NO DATA statuses', () => {
    const rows = [
      ev('match_completed', 0),
      ev('run_it_back', 5),
      ev('comprehension_response', 6, { props: { understood: true } }),
    ];
    const report = buildReport(rows);
    expect(report).toContain('Gate table');
    expect(report).toContain('PASS'); // run-it-back 1/1, comprehension 1/1, crash-free 1/1
    expect(report).toContain('FAIL'); // friend groups 1 < 10
    expect(report).toContain('NO DATA'); // approval: no nominations yet

    const gates = gateTable(rows);
    expect(gates.find((g) => g.gate.includes('run-it-back'))?.status).toBe('PASS');
    expect(gates.find((g) => g.gate.includes('Friend groups'))?.status).toBe('FAIL');
    expect(gates.find((g) => g.gate.includes('semantic correction'))?.status).toBe('NO DATA');
  });

  it('computes the 12-step funnel with the documented mapping', () => {
    const rows = [
      ev('challenge_link_opened', 0),
      ev('guest_joined', 1),
      ev('draft_started', 2),
      ev('fighter_inspected', 3),
      ev('draft_completed', 4),
      ev('wildcard_locked', 5),
      ev('match_completed', 6),
      ev('breakdown_opened', 7),
      ev('champion_card_shared', 8),
      ev('dethrone_link_created', 9),
      ev('run_it_back', 10),
      ev('draft_started', 11),
    ];
    const funnel = computeFunnel(rows);
    expect(funnel).toHaveLength(12);
    expect(funnel[0].count).toBe(1); // challenge_link_opened
    expect(funnel[2].count).toBe(2); // two draft starts
    expect(funnel[6].count).toBe(1); // one deduped completion
    expect(funnel[9].count).toBe(2); // dethrone created + challenge opened
    expect(funnel[10].count).toBe(1); // completion followed by run-it-back
  });
});
