import { describe, expect, it } from 'vitest';
import { RULESET_S0, minRosterReserve, validateTeamSetup, validateWildcard, hasErrors } from '../src';
import { makeDna, makeTeam, testWildcard } from '../../../services/combat-sim/test/fixtures';

const dnaById = new Map(['f1', 'f2', 'f3', 'f4', 'f5', 'f6'].map((id) => [id, makeDna(id)]));

describe('draft legality (server-side, never client-trusted)', () => {
  it('accepts a legal 3-fighter roster', () => {
    const issues = validateTeamSetup(makeTeam('p1', ['f1', 'f2', 'f3']), RULESET_S0, dnaById);
    expect(hasErrors(issues)).toBe(false);
  });

  it('rejects salary-cap violations', () => {
    const team = makeTeam('p1', ['f1', 'f2', 'f3', 'f4', 'f5']);
    team.roster = team.roster.map((r) => ({ ...r, pricePaid: 25_000_000 }));
    const issues = validateTeamSetup(team, RULESET_S0, dnaById);
    expect(issues.some((i) => i.path.includes('cap'))).toBe(true);
  });

  it('rejects duplicate exact versions in one draft', () => {
    const team = makeTeam('p1', ['f1', 'f1', 'f3']);
    expect(hasErrors(validateTeamSetup(team, RULESET_S0, dnaById))).toBe(true);
  });

  it('rejects price tampering (client reporting a discounted price)', () => {
    const team = makeTeam('p1', ['f1', 'f2', 'f3']);
    team.roster[0].pricePaid = 1;
    const issues = validateTeamSetup(team, RULESET_S0, dnaById);
    expect(issues.some((i) => i.message.includes('locked price'))).toBe(true);
  });

  it('rejects rosters outside 3–5 and wrong active counts', () => {
    expect(hasErrors(validateTeamSetup(makeTeam('p1', ['f1', 'f2']), RULESET_S0, dnaById))).toBe(true);
    const team = makeTeam('p1', ['f1', 'f2', 'f3']);
    team.activeFighterIds = ['f1', 'f2'];
    expect(hasErrors(validateTeamSetup(team, RULESET_S0, dnaById))).toBe(true);
  });

  it('rejects a captain outside the roster', () => {
    const team = makeTeam('p1', ['f1', 'f2', 'f3'], { captainId: 'f6' });
    expect(hasErrors(validateTeamSetup(team, RULESET_S0, dnaById))).toBe(true);
  });
});

describe('wildcard normalization rules', () => {
  it('every wildcard must have counterplay', () => {
    const w = testWildcard({ counterplay: [] });
    expect(hasErrors(validateWildcard(w))).toBe(true);
  });

  it('object wildcards must be destructible', () => {
    const w = testWildcard({ class: 'object', objectHp: 0 });
    expect(hasErrors(validateWildcard(w))).toBe(true);
  });

  it('wildcards must manifest visibly', () => {
    const w = testWildcard({ visualManifestation: '' });
    expect(hasErrors(validateWildcard(w))).toBe(true);
  });

  it('unbounded durations are rejected', () => {
    const w = testWildcard({ durationTicks: 999999 });
    expect(hasErrors(validateWildcard(w))).toBe(true);
  });
});

describe('minRosterReserve (cap-lock guard)', () => {
  const M = 1_000_000;

  it('regression: the 2026-08-20 live soft-lock — Meridian after Grimspike must be unaffordable', () => {
    // AI holds grimspike ($37.5M, budget $62.5M), human took whisper. Market
    // remaining (excluding candidate captain-meridian): the 9 other fighters.
    const remaining = [21, 24, 28.5, 29, 31, 32.5, 35.5, 36, 37].map((v) => v * M);
    const reserve = minRosterReserve(remaining, 1, 4); // 1 more pick needed; human can snipe
    // Human can take the two cheapest before the AI's next turn → reserve is vex $28.5M.
    expect(reserve).toBe(28.5 * M);
    expect(38.5 * M <= 62.5 * M - reserve).toBe(false); // meridian rejected
    expect(28.5 * M <= 62.5 * M - reserve).toBe(true); // a mid-price pick still fine
  });

  it('no reserve once the minimum roster is reached', () => {
    expect(minRosterReserve([10 * M, 20 * M], 0, 4)).toBe(0);
  });

  it('a passed/full opponent cannot snipe anything', () => {
    expect(minRosterReserve([10 * M, 20 * M, 30 * M], 2, 0)).toBe(30 * M);
  });

  it('snipe bound is min(2×need, opponent capacity)', () => {
    // need 1, capacity 1 → drop only the single cheapest
    expect(minRosterReserve([10 * M, 20 * M, 30 * M], 1, 1)).toBe(20 * M);
  });

  it('Infinity when the market cannot guarantee completion', () => {
    expect(minRosterReserve([10 * M, 20 * M], 2, 2)).toBe(Infinity);
    expect(minRosterReserve([], 1, 0)).toBe(Infinity);
  });
});
