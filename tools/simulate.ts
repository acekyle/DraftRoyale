/**
 * Balance harness: runs seeded matchups across the roster and reports win
 * rates, price efficiency, durations, stalemates, and determinism failures.
 *
 * Schedule-confound fix: a single deterministic pairing schedule baked a
 * team-slate confound into per-fighter win rates (who you were scheduled WITH
 * mattered as much as who you fought), and the schedule silently reshuffled
 * whenever prices changed the combo pool. The harness now generates N
 * DIFFERENT deterministic schedules — the pairing offsets are parameterized by
 * the schedule index — aggregates wins/games across all of them, and reports
 * each fighter's cross-schedule spread (min/max per-schedule win rate) so
 * slate-driven artifacts are visible instead of hidden.
 *
 * Usage: npm run simulate [-- --seeds 8 --schedules 6 --healdamp 0.15 --approachguard 0.3]
 *
 * --healdamp overrides RULESET_S0.escalationHealingDamp for this process only
 * (A/B lever for the escalation-vs-sustain experiment; 0 = damp off).
 * --approachguard overrides RULESET_S0.approachGuardReduction the same way
 * (A/B lever for the melee approach-tax experiment; 0 = guard off).
 */
import { RULESET_S0, type TeamSetup } from '@arena/contracts';
import { buildManifest, runManifest, verifyReplay, type SimContent } from '@arena/combat-sim';
import { loadContent } from './load-content';

function intArg(flag: string, fallback: number): number {
  const i = process.argv.indexOf(flag);
  const v = i > -1 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
}
function floatArg(flag: string, fallback: number): number {
  const i = process.argv.indexOf(flag);
  const v = i > -1 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}
const SEEDS = intArg('--seeds', 8); // seeds per matchup
const SCHEDULES = intArg('--schedules', 6); // distinct deterministic schedules
const HEAL_DAMP = floatArg('--healdamp', RULESET_S0.escalationHealingDamp);
RULESET_S0.escalationHealingDamp = HEAL_DAMP; // in-process override; replay path reads the same object
const APPROACH_GUARD = floatArg('--approachguard', RULESET_S0.approachGuardReduction);
RULESET_S0.approachGuardReduction = APPROACH_GUARD;
const APPROACH_SURGE = floatArg('--approachsurge', RULESET_S0.approachSpeedSurge);
RULESET_S0.approachSpeedSurge = APPROACH_SURGE;
const FLIGHT_UPKEEP = floatArg('--flightupkeep', RULESET_S0.flightStaminaUpkeep);
RULESET_S0.flightStaminaUpkeep = FLIGHT_UPKEEP;
if (process.argv.includes('--hover-high')) RULESET_S0.hoverStaysLow = false; // pre-0.3.0 hover behavior
const AMBUSH = floatArg('--ambush', RULESET_S0.stealthAmbushBonus);
RULESET_S0.stealthAmbushBonus = AMBUSH;

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
const MATCHUPS = Math.min(40, combos.length); // per schedule; total sampling comes from SCHEDULES × MATCHUPS

// Distinct co-prime-ish stride pools; schedule k draws different pairing
// offsets so every schedule walks a different slice of the combo space.
const A_STEPS = [11, 13, 17, 19, 23, 29, 31, 37, 41, 43];
const B_STEPS = [7, 5, 3, 19, 13, 17, 23, 11, 29, 31];

/** Deterministic matchup schedule #k with guaranteed per-fighter coverage. */
function buildSchedule(k: number): [string[], string[]][] {
  const aStep = A_STEPS[k % A_STEPS.length] + 2 * Math.floor(k / A_STEPS.length);
  const bStep = B_STEPS[k % B_STEPS.length] + 2 * Math.floor(k / B_STEPS.length);
  const bOff = 3 + 13 * k;

  const schedule: [string[], string[]][] = [];
  const appearances: Record<string, number> = Object.fromEntries(ids.map((id) => [id, 0]));
  const addMatchup = (a: string[], b: string[]) => {
    schedule.push([a, b]);
    for (const id of [...a, ...b]) appearances[id]++;
  };

  for (let i = 0; i < combos.length && schedule.length < MATCHUPS; i++) {
    const a = combos[(i * aStep + k) % combos.length];
    for (let j = 1; j < combos.length; j++) {
      const b = combos[(i * aStep + j * bStep + bOff) % combos.length];
      if (a.some((x) => b.includes(x))) continue;
      addMatchup(a, b);
      break;
    }
  }
  // Top up any fighter that landed fewer than 2 appearances — coverage is
  // guaranteed within EVERY schedule, and the top-up slate rotates with k.
  for (const id of ids) {
    const withId = combos.filter((c) => c.includes(id));
    while ((appearances[id] ?? 0) < 2) {
      const a = withId.length ? withId[k % withId.length] : undefined;
      const b = a && combos.find((c) => !c.some((x) => a.includes(x)));
      if (!a || !b) break;
      addMatchup(a, b);
    }
  }
  return schedule;
}

// ---------------------------------------------------------------------------
// Run all schedules, aggregating globally and per schedule.
// ---------------------------------------------------------------------------

interface ScheduleStats {
  wins: Record<string, number>;
  games: Record<string, number>;
  matches: number;
  decisions: number;
  zeroKoDecisions: number;
  ticks: number;
}

const wins: Record<string, number> = {};
const games: Record<string, number> = {};
const perSchedule: ScheduleStats[] = [];
let stalemates = 0, decisions = 0, eliminations = 0, totalTicks = 0, matches = 0, determinismFailures = 0;
let zeroKoDecisions = 0; // matches that reached the hard decision with zero KOs — the sustain-stall signal
const durations: number[] = [];

for (let k = 0; k < SCHEDULES; k++) {
  const schedule = buildSchedule(k);
  const sw: Record<string, number> = {};
  const sg: Record<string, number> = {};
  const stats: ScheduleStats = { wins: sw, games: sg, matches: 0, decisions: 0, zeroKoDecisions: 0, ticks: 0 };
  perSchedule.push(stats);

  for (const [m, [a, b]] of schedule.entries()) {
    for (let s = 0; s < SEEDS; s++) {
      const manifest = buildManifest({
        matchId: `sim-${k}-${m}-${s}`,
        roomId: 'harness',
        createdAt: '2026-01-01T00:00:00Z',
        ruleset: RULESET_S0,
        arenaId: arena.arenaId,
        arenaVersion: arena.version,
        seed: 1000 + k * 1_000_000 + m * 100 + s,
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
      stats.matches++;
      stats.ticks += run.outcome.finalTick;
      if (run.outcome.reason === 'decision') {
        decisions++;
        stats.decisions++;
        if (!run.events.some((e) => e.type === 'FIGHTER_KNOCKED_OUT')) {
          zeroKoDecisions++;
          stats.zeroKoDecisions++;
        }
      } else eliminations++;
      if (run.outcome.finalTick >= RULESET_S0.hardLimitTicks) stalemates++;
      const winnerRoster = run.outcome.winnerPlayerId === 'A' ? a : b;
      const loserRoster = run.outcome.winnerPlayerId === 'A' ? b : a;
      for (const id of winnerRoster) {
        wins[id] = (wins[id] ?? 0) + 1; games[id] = (games[id] ?? 0) + 1;
        sw[id] = (sw[id] ?? 0) + 1; sg[id] = (sg[id] ?? 0) + 1;
      }
      for (const id of loserRoster) {
        games[id] = (games[id] ?? 0) + 1;
        sg[id] = (sg[id] ?? 0) + 1;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

durations.sort((x, y) => x - y);
const median = durations[Math.floor(durations.length / 2)] ?? 0;
const pct = (r: number) => (r * 100).toFixed(1);
console.log(`\n=== Balance harness: ${matches} matches (${SCHEDULES} schedules × ${SEEDS} seeds/matchup) | escalationHealingDamp=${HEAL_DAMP} | approachGuard=${APPROACH_GUARD} | approachSurge=${APPROACH_SURGE} | flightUpkeep=${FLIGHT_UPKEEP} | hoverStaysLow=${RULESET_S0.hoverStaysLow} ===`);
console.log(`avg duration ${(totalTicks / matches / 4).toFixed(0)}s | median ${(median / 4).toFixed(0)}s | eliminations ${eliminations} | decisions ${decisions} (${pct(decisions / matches)}%) | zero-KO decisions ${zeroKoDecisions} (${pct(zeroKoDecisions / matches)}%) | hard-limit stalemates ${stalemates}`);
console.log(`determinism failures: ${determinismFailures}\n`);
console.log('per schedule:');
for (const [k, s] of perSchedule.entries()) {
  console.log(
    `  schedule ${k}: ${s.matches} matches | decisions ${pct(s.decisions / s.matches)}% | zero-KO decisions ${pct(s.zeroKoDecisions / s.matches)}% | avg ${(s.ticks / s.matches / 4).toFixed(1)}s`,
  );
}
console.log(`\nfighter win rates (aggregate across ${SCHEDULES} schedules ± cross-schedule spread):`);
for (const id of ids) {
  const g = games[id] ?? 0;
  const w = wins[id] ?? 0;
  const price = content.fighters.get(id)!.balance.draftPrice / 1e6;
  const scheduleRates = perSchedule
    .filter(({ games: sg }) => (sg[id] ?? 0) > 0)
    .map(({ wins: sw, games: sg }) => (sw[id] ?? 0) / sg[id]!);
  if (g === 0 || scheduleRates.length === 0) {
    console.log(`  ${id.padEnd(18)}   n/a  (0 games, $${price.toFixed(1)}M)`);
    continue;
  }
  const rate = w / g;
  const min = Math.min(...scheduleRates);
  const max = Math.max(...scheduleRates);
  let flag = '';
  if (min > 0.62) flag = '  <-- OUTLIER (every schedule >62%)';
  else if (max < 0.38) flag = '  <-- OUTLIER (every schedule <38%)';
  else if (rate > 0.62 || rate < 0.38) flag = '  <-- aggregate outlier (schedule-dependent)';
  const perScheduleStr = perSchedule
    .map(({ wins: sw, games: sg }) => ((sg[id] ?? 0) > 0 ? pct((sw[id] ?? 0) / sg[id]!) : ' n/a'))
    .join(' ');
  console.log(
    `  ${id.padEnd(18)} ${pct(rate).padStart(5)}%  [${pct(min).padStart(5)}–${pct(max).padStart(5)}% across schedules]  per-schedule: ${perScheduleStr}  (${g} games, $${price.toFixed(1)}M)${flag}`,
  );
}
if (determinismFailures > 0) process.exit(1);
