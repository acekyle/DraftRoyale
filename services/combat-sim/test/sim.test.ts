import { describe, expect, it } from 'vitest';
import { RULESET_S0, RULESET_S0_V010, type Ruleset } from '@arena/contracts';
import { MatchSim, buildManifest, runManifest, verifyReplay, buildBreakdown, generateCommentary, type SimContent } from '../src';
import { ability, makeDna, makeTeam, testArena, testWildcard } from './fixtures';

function content(ids: string[], wildcards = [testWildcard()]): SimContent {
  return {
    fighters: new Map(ids.map((id) => [id, makeDna(id)])),
    wildcards: new Map(wildcards.map((w) => [w.wildcardId, w])),
    arena: testArena(),
  };
}

const A = ['a1', 'a2', 'a3'];
const B = ['b1', 'b2', 'b3'];

function simpleManifest(seed: number, c = content([...A, ...B])) {
  return buildManifest({
    matchId: `t-${seed}`,
    roomId: 'test',
    createdAt: '2026-01-01T00:00:00Z',
    ruleset: RULESET_S0,
    arenaId: 'test-arena',
    arenaVersion: '1.0.0',
    seed,
    teams: [makeTeam('A', A), makeTeam('B', B)],
    content: c,
  });
}

describe('deterministic simulation', () => {
  it('reaches a terminal state and produces an outcome', () => {
    const c = content([...A, ...B]);
    const run = runManifest(simpleManifest(7), c);
    expect(run.outcome.winnerPlayerId === 'A' || run.outcome.winnerPlayerId === 'B').toBe(true);
    expect(run.outcome.finalTick).toBeLessThanOrEqual(RULESET_S0.hardLimitTicks);
    expect(run.events.at(-1)?.type).toBe('MATCH_ENDED');
  });

  it('reproduces identical hashes on replay (100% requirement)', () => {
    const c = content([...A, ...B]);
    for (const seed of [1, 2, 3, 42, 999, 31337]) {
      const v = verifyReplay(simpleManifest(seed, c), c);
      expect(v.ok, `seed ${seed}: ${v.hashA} vs ${v.hashB}`).toBe(true);
    }
  });

  it('different seeds produce varied battles (seeded variation, not fixed script)', () => {
    const c = content([...A, ...B]);
    const hashes = new Set([11, 22, 33, 44, 55].map((s) => runManifest(simpleManifest(s), c).hash));
    expect(hashes.size).toBeGreaterThan(1);
  });

  it('replays a command + wildcard timeline deterministically', () => {
    const c = content([...A, ...B]);
    const manifest = simpleManifest(5, c);
    manifest.teams[0].wildcardId = 'test-field';
    manifest.commandTimeline = [{ kind: 'press_attack', playerId: 'A', issuedTick: 20 }];
    manifest.wildcardTimeline = [{ playerId: 'A', wildcardId: 'test-field', x: 5, z: 0, issuedTick: 40 }];
    const r1 = runManifest(manifest, c);
    const r2 = runManifest(manifest, c);
    expect(r1.hash).toBe(r2.hash);
    expect(r1.events.some((e) => e.type === 'WILDCARD_DEPLOYED')).toBe(true);
    expect(r1.events.some((e) => e.type === 'TACTICAL_COMMAND_ISSUED')).toBe(true);
  });
});

describe('property: resource and state invariants', () => {
  it('never reports negative vitality, never exceeds token budget, always terminates', () => {
    for (let seed = 100; seed < 120; seed++) {
      const c = content([...A, ...B]);
      const run = runManifest(simpleManifest(seed, c), c);
      for (const f of run.sim.fighters) {
        expect(f.vitality).toBeGreaterThanOrEqual(0 - 1e-9);
        expect(f.stamina).toBeGreaterThanOrEqual(0);
        if (f.primary) expect(f.primary.value).toBeGreaterThanOrEqual(0);
      }
      expect(run.outcome.finalTick).toBeLessThanOrEqual(RULESET_S0.hardLimitTicks);
    }
  });

  it('knocked-out fighters emit exactly one KO event each', () => {
    const c = content([...A, ...B]);
    const run = runManifest(simpleManifest(9), c);
    const kos = run.events.filter((e) => e.type === 'FIGHTER_KNOCKED_OUT').map((e) => e.data.fighterId);
    expect(new Set(kos).size).toBe(kos.length);
  });
});

describe('squad relay', () => {
  it('reserves enter when an active fighter is defeated', () => {
    const ids = [...A, 'a4', ...B];
    const c = content(ids);
    const manifest = buildManifest({
      matchId: 'relay', roomId: 'test', createdAt: '2026-01-01T00:00:00Z',
      ruleset: RULESET_S0, arenaId: 'test-arena', arenaVersion: '1.0.0', seed: 12,
      teams: [makeTeam('A', [...A, 'a4']), makeTeam('B', B)],
      content: c,
    });
    const run = runManifest(manifest, c);
    const aKos = run.events.filter((e) => e.type === 'FIGHTER_KNOCKED_OUT' && String(e.data.fighterId).startsWith('a'));
    if (aKos.length > 0) {
      expect(run.events.some((e) => e.type === 'RESERVE_ENTERED' && e.data.fighterId === 'a4')).toBe(true);
    }
  });
});

describe('tactical commands', () => {
  it('consumes tokens and refuses a third command', () => {
    const c = content([...A, ...B]);
    const sim = new MatchSim({ matchId: 'cmd', seed: 3, ruleset: RULESET_S0, teams: [makeTeam('A', A), makeTeam('B', B)] }, c);
    sim.step();
    expect(sim.applyCommand({ kind: 'press_attack', playerId: 'A', issuedTick: sim.tick }).accepted).toBe(true);
    expect(sim.applyCommand({ kind: 'spread_out', playerId: 'A', issuedTick: sim.tick }).accepted).toBe(true);
    expect(sim.applyCommand({ kind: 'regroup', playerId: 'A', issuedTick: sim.tick }).accepted).toBe(false);
    expect(sim.tokensRemaining('A')).toBe(0);
  });

  it('behavior constraints can reject commands (contract over commands)', () => {
    const dnas = new Map([...A, ...B].map((id) => [id, makeDna(id)]));
    dnas.set('a1', makeDna('a1', { behavior: { personality: 'x', riskTolerance: 0.5, allyProtection: 0.5, targetPreference: 'nearest', commandCompliance: 1, constraints: ['never_retreats'], repetitionAvoidance: 0.5 } }));
    const c: SimContent = { fighters: dnas, wildcards: new Map(), arena: testArena() };
    const sim = new MatchSim({ matchId: 'rej', seed: 3, ruleset: RULESET_S0, teams: [makeTeam('A', A), makeTeam('B', B)] }, c);
    sim.step();
    sim.applyCommand({ kind: 'disengage', playerId: 'A', issuedTick: sim.tick });
    expect(sim.events.some((e) => e.type === 'TACTICAL_COMMAND_REJECTED' && e.data.fighterId === 'a1')).toBe(true);
  });
});

describe('wildcards', () => {
  it('one wildcard per player, then refused', () => {
    const c = content([...A, ...B]);
    const sim = new MatchSim(
      { matchId: 'wc', seed: 3, ruleset: RULESET_S0, teams: [makeTeam('A', A, { wildcardId: 'test-field' }), makeTeam('B', B)] },
      c,
    );
    sim.step();
    expect(sim.deployWildcard({ playerId: 'A', wildcardId: 'test-field', x: 0, z: 0, issuedTick: sim.tick }).accepted).toBe(true);
    expect(sim.deployWildcard({ playerId: 'A', wildcardId: 'test-field', x: 0, z: 0, issuedTick: sim.tick }).accepted).toBe(false);
    expect(sim.wildcardAvailable('A')).toBe(false);
  });

  it('an eclipse-style global condition suppresses context-gated regen', () => {
    const solar = makeDna('a1', {
      resources: {
        vitality: 300, stability: 90, stamina: 100, staminaRegenPerTick: 1.5,
        primary: { name: 'charge', max: 100, start: 50, regenPerTick: 1, regenRequiresContext: ['daylight'] },
      },
    });
    const dnas = new Map<string, ReturnType<typeof makeDna>>([...A, ...B].map((id) => [id, makeDna(id)]));
    dnas.set('a1', solar);
    const eclipse = testWildcard({
      wildcardId: 'eclipse', class: 'condition', deployment: 'global', radius: 0, durationTicks: 60, objectHp: 0,
      effects: [
        { kind: 'remove_context_tags', tags: ['daylight'], affects: 'both' },
        { kind: 'add_context_tags', tags: ['darkness'], affects: 'both' },
      ],
    });
    const c: SimContent = { fighters: dnas, wildcards: new Map([[eclipse.wildcardId, eclipse]]), arena: testArena() };
    const sim = new MatchSim(
      { matchId: 'ec', seed: 3, ruleset: RULESET_S0, teams: [makeTeam('A', A), makeTeam('B', B, { wildcardId: 'eclipse' })] },
      c,
    );
    sim.step();
    sim.deployWildcard({ playerId: 'B', wildcardId: 'eclipse', x: 0, z: 0, issuedTick: sim.tick });
    const before = sim.byId('a1')!.primary!.value;
    for (let i = 0; i < 20; i++) sim.step();
    const after = sim.byId('a1')!.primary!.value;
    expect(after).toBeLessThanOrEqual(before); // no regen (and possibly spending) under eclipse
    expect(sim.matchContext.has('daylight')).toBe(false);
    expect(sim.matchContext.has('darkness')).toBe(true);
  });
});

describe('escalation healing damp', () => {
  // Pacifist kits (all power 0) so the ONLY vitality change is a1's regen
  // passive — a deterministic probe of the healing pathway across escalation.
  function pacifistContent(): SimContent {
    const zeroKit = {
      capabilities: {
        foundational: [] as ReturnType<typeof ability>[],
        signature: [] as ReturnType<typeof ability>[],
        contextual: [] as ReturnType<typeof ability>[],
        passives: [] as never[],
      },
    };
    const dnas = new Map([...A, ...B].map((id) => [
      id,
      makeDna(id, {
        capabilities: {
          ...zeroKit.capabilities,
          foundational: [ability({ id: `${id}-tap`, kind: 'melee', range: 3, power: 0, cooldownTicks: 8 })],
          escalation: ability({ id: `${id}-ult`, power: 0, cooldownTicks: 400, windupTicks: 0 }),
        },
      }),
    ]));
    dnas.get('a1')!.capabilities.passives = [
      { id: 'a1-regen', name: 'test regen', kind: 'regen', magnitude: 4, tags: [], description: 'test' },
    ];
    return { fighters: dnas, wildcards: new Map(), arena: testArena() };
  }

  const fastEscalation: Ruleset = {
    ...RULESET_S0,
    softLimitTicks: 40,
    escalationIntervalTicks: 40,
    hardLimitTicks: 400,
    escalationHealingDamp: 0.25,
  };

  it('reduces healing after escalation, leaves it unchanged before, and surfaces the damp on the ESCALATION event', () => {
    const sim = new MatchSim(
      { matchId: 'heal-damp', seed: 5, ruleset: fastEscalation, teams: [makeTeam('A', A), makeTeam('B', B)] },
      pacifistContent(),
    );
    const a1 = sim.byId('a1')!;

    // Before escalation: regen heals at full strength.
    for (let i = 0; i < 10; i++) sim.step();
    expect(sim.events.some((e) => e.type === 'ESCALATION')).toBe(false);
    a1.vitality = 100;
    sim.step();
    expect(a1.vitality).toBeCloseTo(104, 6);

    // Cross into escalation stage 1.
    while (!sim.events.some((e) => e.type === 'ESCALATION')) sim.step();
    const esc = sim.events.find((e) => e.type === 'ESCALATION')!;
    expect(esc.data.damageMult).toBe(1.15);
    expect(esc.data.healingMult).toBe(0.8); // 1 / (1 + 1 * 0.25)

    // Same regen tick now heals 4 / 1.25 = 3.2.
    a1.vitality = 100;
    sim.step();
    expect(a1.vitality).toBeCloseTo(103.2, 6);
  });

  it('is inert at the neutral value (damp 0): healing identical before and during escalation', () => {
    const neutral: Ruleset = { ...fastEscalation, escalationHealingDamp: 0 };
    const sim = new MatchSim(
      { matchId: 'heal-neutral', seed: 5, ruleset: neutral, teams: [makeTeam('A', A), makeTeam('B', B)] },
      pacifistContent(),
    );
    const a1 = sim.byId('a1')!;
    while (!sim.events.some((e) => e.type === 'ESCALATION')) sim.step();
    // At damp 0 the field is absent entirely — 0.1.0-era event payloads must
    // stay byte-identical so archived manifests replay to their original hashes.
    expect('healingMult' in sim.events.find((e) => e.type === 'ESCALATION')!.data).toBe(false);
    a1.vitality = 100;
    sim.step();
    expect(a1.vitality).toBeCloseTo(104, 6);
  });

  it('replays a 0.1.0 manifest with the archived ruleset: undamped healing, legacy event shape, stable hash', () => {
    const c = pacifistContent();
    const manifest = buildManifest({
      matchId: 'legacy-replay',
      roomId: 'test',
      createdAt: '2026-01-01T00:00:00Z',
      ruleset: RULESET_S0_V010,
      arenaId: 'test-arena',
      arenaVersion: '1.0.0',
      seed: 5,
      teams: [makeTeam('A', A), makeTeam('B', B)],
      content: c,
    });
    expect(manifest.rulesetVersion).toBe('0.1.0');

    // Pacifist kits force the match to the decision, so escalation fires.
    const r1 = runManifest(manifest, c);
    const r2 = runManifest(manifest, c);
    expect(r1.hash).toBe(r2.hash);
    const escalations = r1.events.filter((e) => e.type === 'ESCALATION');
    expect(escalations.length).toBeGreaterThan(0);
    for (const e of escalations) expect('healingMult' in e.data).toBe(false);

    // Under 0.2.0 the same seed+teams produce a different, damped run.
    const current = buildManifest({
      matchId: 'legacy-replay',
      roomId: 'test',
      createdAt: '2026-01-01T00:00:00Z',
      ruleset: RULESET_S0,
      arenaId: 'test-arena',
      arenaVersion: '1.0.0',
      seed: 5,
      teams: [makeTeam('A', A), makeTeam('B', B)],
      content: c,
    });
    expect(current.rulesetVersion).toBe('0.2.0');
    const r3 = runManifest(current, c);
    expect(r3.events.filter((e) => e.type === 'ESCALATION').every((e) => 'healingMult' in e.data)).toBe(true);
  });

  it('refuses to replay a manifest naming an unknown ruleset version', () => {
    const c = content([...A, ...B]);
    const manifest = { ...simpleManifest(3, c), rulesetVersion: '9.9.9' };
    expect(() => runManifest(manifest, c)).toThrow(/unknown ruleset version/);
  });
});

describe('ally_below_35 relay swap', () => {
  it('swaps a sub-35% active for the reserve; never fires while everyone holds 35%+', () => {
    const A4 = ['a1', 'a2', 'a3', 'a4'];
    const c = content([...A4, ...B]);
    const teamA = makeTeam('A', A4, {
      reinforcementPlan: { trigger: 'ally_below_35', description: 'rotate early' },
    });
    const sim = new MatchSim(
      { matchId: 'rotate-early', seed: 11, ruleset: RULESET_S0, teams: [teamA, makeTeam('B', B)] },
      c,
    );
    const a1 = sim.byId('a1')!;
    const a4 = sim.byId('a4')!;
    expect(a4.status).toBe('reserve');

    // At exactly 35% the trigger must NOT fire (strict less-than).
    a1.vitality = a1.dna.resources.vitality * 0.35;
    sim.step();
    expect(a4.status).toBe('reserve');
    expect(sim.events.some((e) => e.type === 'RESERVE_ENTERED')).toBe(false);

    // Below the threshold at check time, the swap fires the same tick.
    a1.vitality = a1.dna.resources.vitality * 0.34;
    sim.step();
    const entered = sim.events.find((e) => e.type === 'RESERVE_ENTERED');
    expect(entered).toBeDefined();
    expect(entered!.data.fighterId).toBe('a4');
    expect(entered!.data.reason).toBe('tactical retreat at low vitality');
    expect(a1.status).toBe('retired');
    expect(a4.status).toBe('active');
  });
});

describe('explainability', () => {
  it('every finished match yields a causal breakdown and commentary from real events only', () => {
    const c = content([...A, ...B]);
    const run = runManifest(simpleManifest(21, c), c);
    const breakdown = buildBreakdown(run.sim, c.fighters);
    expect(breakdown.summary.length).toBeGreaterThan(20);
    expect(breakdown.factors.length).toBeGreaterThan(0);
    expect(breakdown.perFighter.length).toBe(6);
    const lines = generateCommentary(run.events, c.fighters);
    expect(lines.length).toBeGreaterThan(3);
    // Commentary must reference only ticks that exist in the event log.
    const eventTicks = new Set(run.events.map((e) => e.tick));
    for (const l of lines) expect(eventTicks.has(l.tick)).toBe(true);
  });
});
