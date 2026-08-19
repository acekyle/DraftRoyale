/**
 * Deterministic hashing + seeded PRNG for the rule-based compilers.
 * All variation flows from fnv1a32(description + seed); no Math.random, no Date.
 */

export function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 — same generator family the sim uses; seeded, repeatable. */
export function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A labeled sub-stream so unrelated sections never share rng state. */
export function rngFor(hash: number, label: string): () => number {
  return mulberry(fnv1a32(`${hash.toString(16)}::${label}`));
}

export const hex4 = (hash: number): string => (hash >>> 16).toString(16).padStart(4, '0');

export function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length) % arr.length];
}

/** Integer in [min, max] inclusive. */
export function irange(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

/** Float in [min, max], rounded to 2 decimals. */
export function frange(rng: () => number, min: number, max: number): number {
  return Math.round((min + rng() * (max - min)) * 100) / 100;
}

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'fighter'
  );
}

export const round2 = (n: number): number => Math.round(n * 100) / 100;

export const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));
