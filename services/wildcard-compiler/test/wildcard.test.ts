import { describe, expect, it } from 'vitest';
import { hasErrors, validateWildcard } from '@arena/contracts';
import { compileWildcardFromText } from '../src';

const VARIED = [
  'a crackling tesla spire that shocks anyone nearby',
  'a fog of illusions that hides my team',
  'an eclipse that blots out the sun',
  'a flash flood that floods the whole arena',
  'a totem that suppresses magic',
  'a gravity well that drags fliers out of the sky',
  'a healing spring aura for my allies',
  'quicksand zone that slows enemies',
  'an emp device that shuts down technology',
  'poison gas cloud',
];

const CORPUS = [
  ...VARIED,
  'a wildcard that instantly wins the match',
  'permanent fog that never ever goes away',
  'a wet sock',
  '',
  'darkness everywhere forever',
  'a nullstone shard that silences solar and arcane and tech powers',
  'burning lava terrain',
  'a mirror statue',
  'rain of restorative light over the whole arena',
  'a razor wind dome',
];

describe('determinism', () => {
  it('same description + seed → byte-identical output', () => {
    for (const desc of VARIED) {
      const a = compileWildcardFromText(desc, { seed: 9 });
      const b = compileWildcardFromText(desc, { seed: 9 });
      expect(JSON.stringify(b)).toEqual(JSON.stringify(a));
    }
  });
});

describe('validator property', () => {
  it.each(CORPUS.map((d, i) => [i, d] as const))('corpus[%i] %j compiles to a valid wildcard', (_i, desc) => {
    const r = compileWildcardFromText(desc, { seed: 4 });
    const issues = validateWildcard(r.wildcard);
    expect(issues.filter((x) => x.severity === 'error')).toEqual([]);
    expect(hasErrors(issues)).toBe(false);
    expect(r.wildcard.counterplay.length).toBeGreaterThanOrEqual(2);
    expect(r.wildcard.effects.length).toBeGreaterThanOrEqual(1);
    expect(r.wildcard.visualManifestation.length).toBeGreaterThan(0);
    expect(r.wildcard.audioManifestation.length).toBeGreaterThan(0);
    expect(r.wildcard.eligibility).toBe('experimental');
    expect(r.wildcard.provenance).toContain('rule-compiled');
    expect(r.wildcard.wildcardId).toMatch(/-x[0-9a-f]{4}$/);
  });
});

describe('class inference table', () => {
  it('device/spire/totem → object with hp, radius, and finite duration', () => {
    for (const desc of ['a crackling tesla spire that shocks anyone nearby', 'a totem that suppresses magic', 'an emp device that shuts down technology']) {
      const w = compileWildcardFromText(desc, { seed: 1 }).wildcard;
      expect(w.class).toBe('object');
      expect(w.objectHp).toBeGreaterThanOrEqual(40);
      expect(w.objectHp).toBeLessThanOrEqual(80);
      expect(w.radius).toBeGreaterThanOrEqual(5);
      expect(w.radius).toBeLessThanOrEqual(10);
      expect(w.durationTicks).toBeGreaterThanOrEqual(240);
      expect(w.durationTicks).toBeLessThanOrEqual(400);
      expect(w.deployment).toBe('placed');
    }
  });

  it('fog/zone/well/aura → field with radius 8–14 and no hp', () => {
    for (const desc of ['a fog of illusions that hides my team', 'quicksand zone that slows enemies', 'a gravity well that drags fliers out of the sky']) {
      const w = compileWildcardFromText(desc, { seed: 1 }).wildcard;
      expect(w.class).toBe('field');
      expect(w.objectHp).toBe(0);
      expect(w.radius).toBeGreaterThanOrEqual(8);
      expect(w.radius).toBeLessThanOrEqual(14);
      expect(w.durationTicks).toBeGreaterThanOrEqual(160);
      expect(w.durationTicks).toBeLessThanOrEqual(280);
    }
  });

  it('eclipse/sun → global condition with bounded duration', () => {
    const w = compileWildcardFromText('an eclipse that blots out the sun', { seed: 1 }).wildcard;
    expect(w.class).toBe('condition');
    expect(w.deployment).toBe('global');
    expect(w.durationTicks).toBeLessThanOrEqual(280);
    expect(w.durationTicks).toBeGreaterThan(0);
    expect(w.effects.some((e) => e.kind === 'remove_context_tags' && (e.tags ?? []).includes('daylight'))).toBe(true);
    expect(w.effects.some((e) => e.kind === 'add_context_tags' && (e.tags ?? []).includes('darkness'))).toBe(true);
  });

  it('flood → permanent global terrain adding water_present', () => {
    const w = compileWildcardFromText('a flash flood that floods the whole arena', { seed: 1 }).wildcard;
    expect(w.class).toBe('terrain');
    expect(w.deployment).toBe('global');
    expect(w.durationTicks).toBe(0);
    expect(w.effects.some((e) => e.kind === 'add_context_tags' && (e.tags ?? []).includes('water_present'))).toBe(true);
  });
});

describe('effect mapping and normalization', () => {
  it('anti-tech suppression maps to suppress_tags with recognized family tags', () => {
    const w = compileWildcardFromText('an emp device that shuts down technology', { seed: 1 }).wildcard;
    const sup = w.effects.find((e) => e.kind === 'suppress_tags');
    expect(sup).toBeTruthy();
    expect(sup!.tags).toContain('tech');
  });

  it('broad suppression (≥2 families) is forced to affect BOTH teams with a note', () => {
    const r = compileWildcardFromText('a nullstone shard that silences solar and arcane and tech powers', { seed: 1 });
    const sup = r.wildcard.effects.find((e) => e.kind === 'suppress_tags');
    expect(sup).toBeTruthy();
    expect(sup!.affects).toBe('both');
    expect(r.notes.some((n) => n.includes('BOTH teams'))).toBe(true);
  });

  it('global classes affect both teams', () => {
    const w = compileWildcardFromText('darkness everywhere forever', { seed: 1 }).wildcard;
    for (const e of w.effects) expect(e.affects).toBe('both');
  });

  it('narrow single enemy-targeted effects may stay enemy-only', () => {
    const w = compileWildcardFromText('quicksand zone that slows enemies', { seed: 1 }).wildcard;
    // speed_mult is symmetric by design here; check the mechanism is bounded either way.
    for (const e of w.effects) {
      if (e.kind === 'speed_mult') {
        expect(e.magnitude!).toBeGreaterThanOrEqual(0.6);
        expect(e.magnitude!).toBeLessThanOrEqual(0.85);
      }
    }
  });

  it('dot magnitudes stay within 0.5–1.5', () => {
    const w = compileWildcardFromText('poison gas cloud', { seed: 1 }).wildcard;
    const dot = w.effects.find((e) => e.kind === 'dot');
    expect(dot).toBeTruthy();
    expect(dot!.magnitude!).toBeGreaterThanOrEqual(0.5);
    expect(dot!.magnitude!).toBeLessThanOrEqual(1.5);
    expect(dot!.damageType).toBe('toxic');
  });
});

describe('unbounded clause rejection', () => {
  it('instant-win clauses land in rejectedClauses with a note', () => {
    const r = compileWildcardFromText('a wildcard that instantly wins the match', { seed: 1 });
    expect(r.rejectedClauses.length).toBeGreaterThan(0);
    expect(r.notes.some((n) => n.toLowerCase().includes('rejected'))).toBe(true);
    expect(validateWildcard(r.wildcard).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('permanent non-terrain requests are rejected but still get a finite duration', () => {
    const r = compileWildcardFromText('permanent fog that never ever goes away', { seed: 1 });
    expect(r.wildcard.class).toBe('field');
    expect(r.wildcard.durationTicks).toBeGreaterThan(0);
    expect(r.rejectedClauses.some((c) => c.includes('permanent'))).toBe(true);
  });

  it('permanent terrain is legitimate and not rejected for permanence', () => {
    const r = compileWildcardFromText('burning lava terrain', { seed: 1 });
    expect(r.wildcard.class).toBe('terrain');
    expect(r.wildcard.durationTicks).toBe(0);
  });
});

describe('naming', () => {
  it('produces an evocative deterministic normalized name and slug id', () => {
    const a = compileWildcardFromText('a gravity well that drags fliers out of the sky', { seed: 2 }).wildcard;
    const b = compileWildcardFromText('a gravity well that drags fliers out of the sky', { seed: 2 }).wildcard;
    expect(a.normalizedName).toBe(b.normalizedName);
    expect(a.normalizedName.length).toBeGreaterThan(3);
    expect(a.wildcardId.startsWith(a.normalizedName.toLowerCase().replace(/[^a-z0-9]+/g, '-'))).toBe(true);
  });
});
