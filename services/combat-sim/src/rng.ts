/**
 * Deterministic seeded RNG (mulberry32). All match randomness flows through one
 * instance so identical manifests reproduce identical outcomes bit-for-bit.
 */
export interface Rng {
  next(): number; // [0, 1)
  pick<T>(arr: T[]): T;
  chance(p: number): boolean;
  range(min: number, max: number): number;
}

export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
    range: (min, max) => min + next() * (max - min),
  };
}

/** FNV-1a over a string — stable outcome hashing for replay verification. */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
