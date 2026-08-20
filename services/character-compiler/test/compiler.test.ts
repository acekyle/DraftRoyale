import { describe, expect, it } from 'vitest';
import { hasErrors, validateFighter } from '@arena/contracts';
import { applySemanticCorrection, applyVisualCorrection, compileFighterFromText } from '../src';

const VARIED = [
  'A fire monk named Kaelen who punches with burning fists and never retreats',
  'a giant stone golem, slow but tough, protects his allies',
  'ghost witch who hexes enemies and floats',
  'lightning speedster assassin, quick and precise',
  'a wolf with metal claws, weak to fire',
  'holy paladin with a sword of light who heals allies',
  'toxic swamp creature that spits venom',
  'a tech sniper with a railgun and drones',
  'sonic screamer, huge and reckless',
  'psychic tactician who binds foes with her mind, weak against sonic attacks',
];

const CORPUS = [
  ...VARIED,
  'an invincible god who instantly kills everyone',
  'superman',
  'a wet sock',
  'fighter',
  '',
  '   ',
  'batman but underwater',
  'goku with unlimited power and infinite energy',
  'president lincoln with laser eyes',
  'elon musk in a mech suit',
  'the fastest being in the universe, unstoppable and immortal',
  'a shadow dragon that breathes dark flame and flies',
  'ice queen who freezes everything and cannot lose',
  'a tiny fairy healer, frail but brave',
  'grizzled war veteran commander with a plasma cannon',
  'spider mech with emp mines',
  'a levitating orb of pure magic',
  'storm witch with wind and lightning, afraid of stone',
  'blade dancer, agile duelist called Mirren',
  'colossal iron juggernaut that smashes through walls',
  'a whispering ghost that drains life',
  'venomous viper assassin, sneaky and clumsy',
  'radiant phoenix that soars and burns, vulnerable to water',
  'an ancient wise turtle sage of the deep ocean',
  'nano-swarm robot that repairs itself',
  'a knight',
  'the moon',
  '!!!???',
  'a very very very mighty strong powerful tough armored fast genius fighter',
  'reality-warping omnipotent demon king of the void',
];

describe('determinism', () => {
  it('same description + seed → byte-identical output (10 varied descriptions × twice)', () => {
    for (const desc of VARIED) {
      const a = compileFighterFromText(desc, { seed: 7 });
      const b = compileFighterFromText(desc, { seed: 7 });
      expect(JSON.stringify(b)).toEqual(JSON.stringify(a));
      expect(b).toEqual(a);
    }
  });

  it('different seeds vary the output id', () => {
    const a = compileFighterFromText(VARIED[0], { seed: 1 });
    const b = compileFighterFromText(VARIED[0], { seed: 2 });
    expect(a.fighter.dna.identity.fighterId).not.toEqual(b.fighter.dna.identity.fighterId);
  });

  it('omitting opts is deterministic too', () => {
    const a = compileFighterFromText('a fire ninja');
    const b = compileFighterFromText('a fire ninja');
    expect(b).toEqual(a);
  });
});

describe('validator property (corpus of adversarial + normal descriptions)', () => {
  it.each(CORPUS.map((d, i) => [i, d] as const))('corpus[%i] %j compiles to a fully valid fighter', (_i, desc) => {
    const r = compileFighterFromText(desc, { seed: 3 });
    const issues = validateFighter(r.fighter);
    expect(issues.filter((x) => x.severity === 'error')).toEqual([]);
    expect(hasErrors(issues)).toBe(false);

    const dna = r.fighter.dna;
    expect(dna.balance.draftPrice).toBeGreaterThanOrEqual(8_000_000);
    expect(dna.balance.draftPrice).toBeLessThanOrEqual(50_000_000);
    expect(dna.weaknesses.length).toBeGreaterThanOrEqual(2);
    expect(dna.capabilities.signature.length).toBe(4);
    expect(dna.capabilities.contextual.length).toBeLessThanOrEqual(2);
    for (const c of dna.capabilities.contextual) expect(c.requiresContext?.length).toBeGreaterThan(0);
    expect(dna.capabilities.escalation).toBeTruthy();
    expect(dna.capabilities.foundational.length).toBeGreaterThanOrEqual(1);

    // Contract obligations.
    expect(r.fighter.contract.provenance.claims.length).toBeGreaterThanOrEqual(2);
    expect(r.fighter.contract.approval.eligibility).toBe('experimental');
    expect(r.fighter.contract.approval.creatorApproved).toBe(false);
    expect(dna.validation.eligibility).toBe('experimental');
    expect(dna.identity.fighterId).toMatch(/-x[0-9a-f]{4}$/);

    // Attribute soft cap: never above the strongest curated fighter.
    const sum = Object.values(dna.attributes).reduce((s, v) => s + v, 0);
    expect(sum).toBeLessThanOrEqual(78);
  });
});

describe('unbounded-clause normalization', () => {
  it('strips invincibility/instant-kill and says so in the notes', () => {
    const r = compileFighterFromText('an invincible god who instantly kills everyone', { seed: 1 });
    expect(r.notes.some((n) => n.includes('invincible'))).toBe(true);
    expect(r.notes.some((n) => n.includes('40-point shield'))).toBe(true);
    expect(r.notes.some((n) => n.toLowerCase().includes('instantly kill'))).toBe(true);
    // The invincible normalization forces the defensive signature: a 40-point shield.
    const shield = r.fighter.dna.capabilities.signature.find((s) =>
      (s.effects ?? []).some((e) => e.kind === 'shield' && e.magnitude === 40),
    );
    expect(shield).toBeTruthy();
    expect(r.fighter.contract.provenance.mechanicalNormalizations.length).toBeGreaterThan(0);
  });

  it('superlative-stuffed descriptions get capped with a normalization note', () => {
    const r = compileFighterFromText('a very very very mighty strong powerful tough armored fast genius fighter', { seed: 1 });
    const sum = Object.values(r.fighter.dna.attributes).reduce((s, v) => s + v, 0);
    expect(sum).toBeLessThanOrEqual(78);
    expect(r.notes.some((n) => n.includes('normalized to Enhanced division'))).toBe(true);
  });
});

describe('IP and real-person guards', () => {
  it('"superman" → transformed original fighter, not Superman', () => {
    const r = compileFighterFromText('superman', { seed: 5 });
    expect(r.transformed).toBe(true);
    expect(r.fighter.contract.identity.displayName.toLowerCase()).not.toContain('superman');
    expect(r.fighter.dna.identity.fighterId).not.toContain('superman');
    expect(r.notes.some((n) => n.includes('original transformed interpretation'))).toBe(true);
    expect(validateFighter(r.fighter).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('real-person references are transformed with a likeness note', () => {
    const r = compileFighterFromText('elon musk in a mech suit', { seed: 5 });
    expect(r.transformed).toBe(true);
    expect(r.fighter.contract.identity.displayName.toLowerCase()).not.toContain('musk');
    expect(r.notes.some((n) => n.toLowerCase().includes('likeness'))).toBe(true);
  });

  it('honorific pattern triggers the person guard', () => {
    const r = compileFighterFromText('president lincoln with laser eyes', { seed: 5 });
    expect(r.transformed).toBe(true);
  });

  it('non-blocked descriptions are not transformed', () => {
    const r = compileFighterFromText('a fire monk named Kaelen', { seed: 5 });
    expect(r.transformed).toBe(false);
  });
});

describe('corrections', () => {
  const base = () => compileFighterFromText('a fire monk who punches with burning fists', { seed: 11 });

  it('semantic corrections change mechanics deterministically', () => {
    const prev = base();
    const a = applySemanticCorrection(prev, 'add ice powers');
    const b = applySemanticCorrection(prev, 'add ice powers');
    expect(JSON.stringify(b)).toEqual(JSON.stringify(a));
    // Mechanics actually changed: the hydro tag entered the kit.
    expect(a.fighter.dna.interactions.powerTags).toContain('hydro');
    expect(prev.fighter.dna.interactions.powerTags).not.toContain('hydro');
    expect(a.fighter.contract.approval.semanticRevisionCount).toBe(1);
    expect(validateFighter(a.fighter).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('semantic rename via "call it X" renames fighter and id consistently', () => {
    const prev = base();
    const r = applySemanticCorrection(prev, 'call it Ashenfist');
    expect(r.fighter.contract.identity.displayName).toBe('Ashenfist');
    expect(r.fighter.dna.identity.fighterId).toMatch(/^ashenfist-x[0-9a-f]{4}$/);
    expect(r.fighter.contract.identity.fighterId).toBe(r.fighter.dna.identity.fighterId);
  });

  it('semantic role shift works', () => {
    const prev = base();
    const r = applySemanticCorrection(prev, 'make him a defender who protects the team');
    expect(r.fighter.dna.identity.role).toBe('defender');
    expect(validateFighter(r.fighter).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('semantic weakness addition works and keeps ≥2 weaknesses on removal attempts', () => {
    const prev = base();
    const r = applySemanticCorrection(prev, 'make him weak to sonic attacks');
    expect(r.fighter.dna.weaknesses.some((w) => w.id === 'declared-sonic')).toBe(true);
    const r2 = applySemanticCorrection(prev, 'remove the weakness');
    expect(r2.fighter.dna.weaknesses.length).toBeGreaterThanOrEqual(2);
  });

  it('visual corrections change ONLY presentation (dna minus presentation deep-equal)', () => {
    const prev = base();
    const r = applyVisualCorrection(prev, 'make her armor crimson and gold with a glowing halo');
    const stripped = (x: typeof prev) => {
      const d = JSON.parse(JSON.stringify(x.fighter.dna));
      delete d.presentation;
      return d;
    };
    expect(stripped(r)).toEqual(stripped(prev));
    expect(r.fighter.dna.presentation).not.toEqual(prev.fighter.dna.presentation);
    expect(r.fighter.dna.presentation.primaryColor).toBe('#a71d31'); // crimson
    expect(r.fighter.contract.approval.visualRevisionCount).toBe(1);
    // Deterministic.
    expect(JSON.stringify(applyVisualCorrection(prev, 'make her armor crimson and gold with a glowing halo'))).toEqual(
      JSON.stringify(r),
    );
  });

  it('visual scale change stays within chassis bounds and touches nothing else mechanical', () => {
    const prev = base();
    let cur = prev;
    for (let i = 0; i < 10; i++) cur = applyVisualCorrection(cur, 'make him bigger');
    const [wLo, wHi] = [0.85, 1.2]; // humanoid bounds
    expect(cur.fighter.dna.identity.scale).toBeGreaterThanOrEqual(wLo);
    expect(cur.fighter.dna.identity.scale).toBeLessThanOrEqual(wHi);
    const strip = (x: typeof prev) => {
      const d = JSON.parse(JSON.stringify(x.fighter.dna));
      delete d.presentation;
      delete d.identity.scale;
      return d;
    };
    expect(strip(cur)).toEqual(strip(prev));
  });

  it('correction results still price inside the season band', () => {
    const prev = base();
    const r = applySemanticCorrection(prev, 'replace fire with lightning');
    expect(r.fighter.dna.interactions.powerTags).toContain('lightning');
    expect(r.fighter.dna.balance.draftPrice).toBeGreaterThanOrEqual(8_000_000);
    expect(r.fighter.dna.balance.draftPrice).toBeLessThanOrEqual(50_000_000);
  });
});

describe('taxonomy + chassis/role/movement inference', () => {
  it('recognizes families, chassis, and movement from keywords', () => {
    const heavy = compileFighterFromText('a giant stone golem, slow but tough', { seed: 2 });
    expect(heavy.fighter.dna.identity.chassis).toBe('heavy');
    expect(heavy.fighter.dna.identity.scale).toBeGreaterThanOrEqual(1.3);
    expect(heavy.fighter.dna.movementModes).toContain('leap');

    const wolf = compileFighterFromText('a wolf with metal claws, weak to fire', { seed: 2 });
    expect(wolf.fighter.dna.identity.chassis).toBe('quadruped');
    expect(wolf.fighter.dna.weaknesses.some((w) => w.id === 'declared-fire')).toBe(true);

    const ghost = compileFighterFromText('ghost witch who hexes enemies and floats', { seed: 2 });
    expect(ghost.fighter.dna.identity.chassis).toBe('floating');
    expect(ghost.fighter.dna.movementModes).toContain('hover');

    const flier = compileFighterFromText('winged fire hawk that flies', { seed: 2 });
    expect(flier.fighter.dna.movementModes).toContain('flight');

    const blinker = compileFighterFromText('a mage who can teleport behind enemies', { seed: 2 });
    expect(blinker.fighter.dna.movementModes).toContain('blink');
  });

  it('opposing-family weakness is auto-derived (fire → water counterplay)', () => {
    const r = compileFighterFromText('a fire monk', { seed: 2 });
    expect(r.fighter.dna.weaknesses.some((w) => w.id === 'opposed-water')).toBe(true);
  });

  it('tech fighters carry the EMP structural weakness', () => {
    const r = compileFighterFromText('a tech sniper with a railgun and drones', { seed: 2 });
    expect(r.fighter.dna.weaknesses.some((w) => (w.trigger.abilityTags ?? []).includes('emp'))).toBe(true);
  });

  it('role inference: healer → support with a healing signature', () => {
    const r = compileFighterFromText('a kind medic who heals allies', { seed: 2 });
    expect(r.fighter.dna.identity.role).toBe('support');
    expect(r.fighter.dna.capabilities.signature.some((s) => s.kind === 'support' && s.targeting === 'ally')).toBe(true);
  });
});
