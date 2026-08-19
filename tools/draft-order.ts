/**
 * Draft-order fairness simulation (feeds ADR-0003).
 *
 * Simulates value-greedy drafters with noise over the real fighter market and
 * compares first-picker advantage under plain alternating (ABAB) vs snake/ABBA
 * (A B B A A B B A) pick orders. Metric: mean roster-value delta (picker A minus
 * picker B) — closer to zero is fairer.
 */
import { createRng } from '@arena/combat-sim';
import { loadContent } from './load-content';

const content = loadContent();
const ids = [...content.fighters.keys()].sort();
const value = (id: string) => content.fighters.get(id)!.balance.draftPrice / 1e6;

function draft(order: ('A' | 'B')[], seed: number): { A: number; B: number } {
  const rng = createRng(seed);
  const pool = new Set(ids);
  const totals = { A: 0, B: 0 };
  const budgets = { A: 100, B: 100 };
  const counts = { A: 0, B: 0 };
  for (const who of order) {
    const remainingPicks = order.filter((w, i) => w === who && i >= order.indexOf(who)).length;
    // pick highest (noisy) value that keeps the rest of the roster affordable (min price 8)
    const affordable = [...pool].filter((id) => {
      const priceLeft = budgets[who] - value(id);
      const picksLeft = 3 - counts[who] - 1;
      return priceLeft >= picksLeft * 8;
    });
    if (affordable.length === 0) continue;
    const scored = affordable
      .map((id) => ({ id, v: value(id) * (0.85 + rng.next() * 0.3) }))
      .sort((a, b) => b.v - a.v);
    const pick = scored[0].id;
    pool.delete(pick);
    totals[who] += value(pick);
    budgets[who] -= value(pick);
    counts[who]++;
    void remainingPicks;
  }
  return totals;
}

const N = 2000;
const orders: Record<string, ('A' | 'B')[]> = {
  'ABAB (alternating)': ['A', 'B', 'A', 'B', 'A', 'B'],
  'ABBA (snake)': ['A', 'B', 'B', 'A', 'A', 'B'],
};
console.log(`Draft-order fairness over ${N} seeded drafts, 3-pick rosters, real Season 0 market:\n`);
for (const [name, order] of Object.entries(orders)) {
  let deltaSum = 0, absSum = 0;
  for (let s = 0; s < N; s++) {
    const t = draft(order, 42 + s);
    deltaSum += t.A - t.B;
    absSum += Math.abs(t.A - t.B);
  }
  console.log(`${name.padEnd(20)} mean A-advantage ${(deltaSum / N).toFixed(2)}M | mean |gap| ${(absSum / N).toFixed(2)}M`);
}
console.log('\nLower |mean A-advantage| = fairer. Result recorded in docs/adr/0003-draft-order.md');
