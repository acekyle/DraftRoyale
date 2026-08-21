import { describe, expect, it } from 'vitest';
import { RULESET_S0, RULESET_S0_V020 } from '@arena/contracts';
import { MatchSim, type SimContent } from '../src';
import { ability, makeDna, makeTeam, testArena, testWildcard } from './fixtures';

/**
 * Approach guard (ruleset 0.3.0): a fighter in approach movement takes
 * reduced ranged/area damage from attackers beyond its own maximum kit
 * range — the engine-level counterweight to the melee approach tax
 * (razorback ~27% / ember-ronin ~30% across every schedule, D-014 follow-up).
 */

function meleeOnlyDna(id: string) {
  return makeDna(id, {
    capabilities: {
      foundational: [ability({ id: `${id}-jab`, kind: 'melee', range: 3, power: 10, cooldownTicks: 4 })],
      signature: [ability({ id: `${id}-s1`, kind: 'melee', range: 3, power: 26, cooldownTicks: 28 })],
      contextual: [],
      escalation: ability({ id: `${id}-ult`, kind: 'melee', range: 3, power: 50, cooldownTicks: 200 }),
      passives: [],
    },
  });
}

function sniperDna(id: string) {
  return makeDna(id, {
    capabilities: {
      foundational: [ability({ id: `${id}-shot`, kind: 'ranged', range: 20, power: 12, cooldownTicks: 4 })],
      signature: [],
      contextual: [],
      escalation: ability({ id: `${id}-ult`, kind: 'ranged', range: 20, power: 50, cooldownTicks: 200 }),
      passives: [],
    },
  });
}

function duelContent(): SimContent {
  return {
    fighters: new Map([
      ['closer', meleeOnlyDna('closer')],
      ['sniper', sniperDna('sniper')],
    ]),
    wildcards: new Map([[testWildcard().wildcardId, testWildcard()]]),
    arena: testArena(),
  };
}

function duelSim(ruleset: typeof RULESET_S0) {
  const sim = new MatchSim(
    {
      matchId: 'approach-guard',
      seed: 11,
      ruleset,
      teams: [makeTeam('A', ['closer']), makeTeam('B', ['sniper'])],
    },
    duelContent(),
  );
  const closer = sim.byId('closer')!;
  const sniper = sim.byId('sniper')!;
  // Sniper fires from 15 — beyond the closer's 3-range kit, inside its own 20.
  closer.x = 0; closer.z = 0;
  sniper.x = 15; sniper.z = 0;
  closer.moveIntent = { mode: 'approach', targetId: 'sniper', desiredRange: 3 };
  return { sim, closer, sniper };
}

const shot = sniperDna('sniper').capabilities.foundational[0];

describe('approach guard (ruleset 0.3.0)', () => {
  it('reduces ranged damage on an out-gunned approaching fighter and tags the event', () => {
    const guarded = duelSim({ ...RULESET_S0, approachGuardReduction: 0.3 });
    const before = guarded.closer.vitality;
    (guarded.sim as any).applyHit(guarded.sniper, shot, guarded.closer);
    const guardedDmg = before - guarded.closer.vitality;

    const off = duelSim(RULESET_S0_V020); // archived: guard 0
    const before2 = off.closer.vitality;
    (off.sim as any).applyHit(off.sniper, shot, off.closer);
    const openDmg = before2 - off.closer.vitality;

    expect(guardedDmg).toBeCloseTo(openDmg * 0.7, 6);
    const tagged = guarded.sim.events.filter((e) => e.type === 'DAMAGE_APPLIED' && e.data.approachGuarded === true);
    expect(tagged.length).toBe(1);
    // Pre-0.3.0 event payloads must stay byte-identical — no field at guard 0.
    const legacy = off.sim.events.filter((e) => e.type === 'DAMAGE_APPLIED');
    expect(legacy.length).toBe(1);
    expect('approachGuarded' in legacy[0].data).toBe(false);
  });

  it('does not guard inside the fighter\'s own kit range', () => {
    const a = duelSim({ ...RULESET_S0, approachGuardReduction: 0.3 });
    a.sniper.x = 2.5; // inside the closer's 3-range jab — no longer out-gunned
    const before = a.closer.vitality;
    (a.sim as any).applyHit(a.sniper, shot, a.closer);
    const dmg = before - a.closer.vitality;

    const b = duelSim(RULESET_S0_V020);
    b.sniper.x = 2.5;
    const before2 = b.closer.vitality;
    (b.sim as any).applyHit(b.sniper, shot, b.closer);
    expect(dmg).toBeCloseTo(before2 - b.closer.vitality, 6);
  });

  it('does not guard a fighter that is not approaching', () => {
    const a = duelSim({ ...RULESET_S0, approachGuardReduction: 0.3 });
    a.closer.moveIntent = { mode: 'hold' };
    const before = a.closer.vitality;
    (a.sim as any).applyHit(a.sniper, shot, a.closer);
    const dmg = before - a.closer.vitality;

    const b = duelSim(RULESET_S0_V020);
    b.closer.moveIntent = { mode: 'hold' };
    const before2 = b.closer.vitality;
    (b.sim as any).applyHit(b.sniper, shot, b.closer);
    expect(dmg).toBeCloseTo(before2 - b.closer.vitality, 6);
  });

  it('never guards melee hits', () => {
    const jab = meleeOnlyDna('closer').capabilities.foundational[0];
    const a = duelSim({ ...RULESET_S0, approachGuardReduction: 0.3 });
    // Sniper walks in and jabs (hypothetical melee swing) while closer approaches.
    a.sniper.x = 2;
    const before = a.closer.vitality;
    (a.sim as any).applyHit(a.sniper, jab, a.closer);
    const dmg = before - a.closer.vitality;

    const b = duelSim(RULESET_S0_V020);
    b.sniper.x = 2;
    const before2 = b.closer.vitality;
    (b.sim as any).applyHit(b.sniper, jab, b.closer);
    expect(dmg).toBeCloseTo(before2 - b.closer.vitality, 6);
  });
});
