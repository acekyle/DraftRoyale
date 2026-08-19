import { describe, expect, it } from 'vitest';
import { RULESET_S0, validateTeamSetup, validateWildcard, hasErrors } from '../src';
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
