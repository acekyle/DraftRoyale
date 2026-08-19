/**
 * Balance harness: runs seeded round-robin matchups across the roster and reports
 * win rates, price efficiency, durations, stalemates, and determinism failures.
 *
 * Usage: npm run simulate [-- --seeds 20]
 */
import { RULESET_S0, type TeamSetup } from '@arena/contracts';
import { buildManifest, runManifest, verifyReplay, type SimContent } from '@arena/combat-sim';
import { loadContent } from './load-content';

const seedsArg = process.argv.indexOf('--seeds');
const SEEDS = seedsArg > -1 ? Number(process.argv[seedsArg + 1]) : 8;

const content = loadContent();
const arena = content.arenas.get('meridian-plaza')!;
const simContent: SimContent = { fighters: content.fighters, wildcards: content.wildcards, arena };
const ids = [...content.fighters.keys()].sort();

if (ids.length < 6) {
  console.log(`Only ${ids.length} fighters in content — need at least 6 for team round-robin. Skipping.`);
  process.exit(0);
}

// Build all 3-fighter teams within cap from a rotating pool (bounded sample for tractability).
function teamsOf3(): string[][] {
  const combos: string[][] = [];
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++)
      for (let k = j + 1; k < ids.length; k++) {
        const cost = [ids[i], ids[j], ids[k]].reduce((s, id) => s + content.fighters.get(id)!.balance.draftPrice, 0);
        if (cost <= RULESET_S0.salaryCap) combos.push([ids[i], ids[j], ids[k]]);
      }
  return combos;
}

function makeTeam(playerId: string, roster: string[]): TeamSetup {
  return {
    playerId,
    displayName: playerId,
    roster: roster.map((fighterId) => ({ fighterId, pricePaid: content.fighters.get(fighterId)!.balance.draftPrice })),
    activeFighterIds: roster.slice(0, 3),
    reserveOrder: roster.slice(3),
    captainId: roster[0],
    formation: 'balanced',
    reinforcementPlan: { trigger: 'ally_ko', description: 'relay on defeat' },
    wildcardId: null,
  };
}

const combos = teamsOf3();
// Deterministic matchup schedule with guaranteed coverage: sample disjoint pairs,
// then top up any fighter that landed zero appearances.
const wins: Record<string, number> = {};
const games: Record<string, number> = {};
let stalemates = 0, decisions = 0, eliminations = 0, totalTicks = 0, matches = 0, determinismFailures = 0;
const durations: number[] = [];

const MATCHUPS = Math.min(60, combos.length);
const schedule: [string[], string[]][] = [];
const appearances: Record<string, number> = Object.fromEntries(ids.map((id) => [id, 0]));
const addMatchup = (a: string[], b: string[]) => {
  schedule.push([a, b]);
  for (const id of [...a, ...b]) appearances[id]++;
};
for (let i = 0; i < combos.length && schedule.length < MATCHUPS; i++) {
  const a = combos[(i * 11) % combos.length];
  for (let j = 1; j < combos.length; j++) {
    const b = combos[(i * 11 + j * 7 + 3) % combos.length];
    if (a.some((x) => b.includes(x))) continue;
    addMatchup(a, b);
    break;
  }
}
for (const id of ids) {
  while ((appearances[id] ?? 0) < 2) {
    const a = combos.find((c) => c.includes(id));
    const b = a && combos.find((c) => !c.some((x) => a.includes(x)));
    if (!a || !b) break;
    addMatchup(a, b);
  }
}

for (const [m, [a, b]] of schedule.entries()) {
  for (let s = 0; s < SEEDS; s++) {
    const manifest = buildManifest({
      matchId: `sim-${m}-${s}`,
      roomId: 'harness',
      createdAt: '2026-01-01T00:00:00Z',
      ruleset: RULESET_S0,
      arenaId: arena.arenaId,
      arenaVersion: arena.version,
      seed: 1000 + m * 100 + s,
      teams: [makeTeam('A', a), makeTeam('B', b)],
      content: simContent,
    });
    const run = runManifest(manifest, simContent);
    if (s === 0) {
      const v = verifyReplay(manifest, simContent);
      if (!v.ok) determinismFailures++;
    }
    matches++;
    totalTicks += run.outcome.finalTick;
    durations.push(run.outcome.finalTick);
    if (run.outcome.reason === 'decision') decisions++;
    else eliminations++;
    if (run.outcome.finalTick >= RULESET_S0.hardLimitTicks) stalemates++;
    const winnerRoster = run.outcome.winnerPlayerId === 'A' ? a : b;
    const loserRoster = run.outcome.winnerPlayerId === 'A' ? b : a;
    for (const id of winnerRoster) { wins[id] = (wins[id] ?? 0) + 1; games[id] = (games[id] ?? 0) + 1; }
    for (const id of loserRoster) games[id] = (games[id] ?? 0) + 1;
  }
}

durations.sort((x, y) => x - y);
const median = durations[Math.floor(durations.length / 2)] ?? 0;
console.log(`\n=== Balance harness: ${matches} matches ===`);
console.log(`avg duration ${(totalTicks / matches / 4).toFixed(0)}s | median ${(median / 4).toFixed(0)}s | eliminations ${eliminations} | decisions ${decisions} | hard-limit stalemates ${stalemates}`);
console.log(`determinism failures: ${determinismFailures}\n`);
console.log('fighter win rates (participation-weighted):');
for (const id of ids) {
  const g = games[id] ?? 0;
  const w = wins[id] ?? 0;
  const price = content.fighters.get(id)!.balance.draftPrice / 1e6;
  const rate = g ? ((w / g) * 100).toFixed(1) : ' n/a';
  const flag = g && (w / g > 0.62 || w / g < 0.38) ? '  <-- OUTLIER' : '';
  console.log(`  ${id.padEnd(18)} ${String(rate).padStart(5)}%  (${g} games, $${price.toFixed(1)}M)${flag}`);
}
if (determinismFailures > 0) process.exit(1);
