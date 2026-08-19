/**
 * Combat-variety analyzer — constitution gate: "authored atoms, unpredictable
 * battles" requires automated variety tests, not vibes.
 *
 * Runs ~12 seeded matches over varied real-content matchups and reports:
 *   (a) per-fighter ability-usage distribution — flags any fighter whose single
 *       most-used ability exceeds 55% of their total casts (all casts count;
 *       foundational share is reported separately since jab filler is expected),
 *   (b) exact repeated 3-action loops — AAA runs and ABAB alternations of the
 *       same ability ids,
 *   (c) abilities never used across the whole sample (unused kits),
 *   (d) commentary repetition — any exact line appearing >4× in one match.
 *
 * Exit code is non-zero ONLY on a catastrophic finding: a fighter with a
 * meaningful sample (≥12 casts) leaning on one ability for >80% of casts.
 *
 * Usage: npm run variety
 */
import { RULESET_S0, type CombatDNA, type MatchEvent, type TeamSetup } from '@arena/contracts';
import { buildManifest, generateCommentary, runManifest, type SimContent } from '@arena/combat-sim';
import { loadContent } from './load-content';

const MATCHES = 12;
const TOP_SHARE_FLAG = 0.55;
const TOP_SHARE_CATASTROPHIC = 0.8;
const MIN_CASTS_FOR_CATASTROPHIC = 12;
const COMMENTARY_REPEAT_LIMIT = 4; // flag lines appearing MORE than this in one match

const content = loadContent();
const arena = content.arenas.get('meridian-plaza')!;
const simContent: SimContent = { fighters: content.fighters, wildcards: content.wildcards, arena };
const ids = [...content.fighters.keys()].sort();

if (ids.length < 6) {
  console.log(`Only ${ids.length} fighters in content — need at least 6 for variety sampling. Skipping.`);
  process.exit(0);
}

// --- Matchup construction (same pattern as the balance harness) --------------

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
const matchups: [string[], string[]][] = [];
const appearances: Record<string, number> = Object.fromEntries(ids.map((id) => [id, 0]));
const addMatchup = (a: string[], b: string[]) => {
  matchups.push([a, b]);
  for (const id of [...a, ...b]) appearances[id]++;
};
for (let i = 0; i < combos.length && matchups.length < MATCHES; i++) {
  const a = combos[(i * 13 + 5) % combos.length];
  for (let j = 1; j < combos.length; j++) {
    const b = combos[(i * 13 + j * 7 + 11) % combos.length];
    if (a.some((x) => b.includes(x))) continue;
    addMatchup(a, b);
    break;
  }
}
// Coverage top-up: every fighter appears in the sample at least once.
for (const id of ids) {
  if ((appearances[id] ?? 0) > 0) continue;
  const a = combos.find((c) => c.includes(id));
  const b = a && combos.find((c) => !c.some((x) => a.includes(x)));
  if (a && b) addMatchup(a, b);
}

// --- Kit metadata ------------------------------------------------------------

interface KitInfo {
  allIds: string[];
  names: Map<string, string>;
  foundational: Set<string>;
}
function kitOf(dna: CombatDNA): KitInfo {
  const abilities = [
    ...dna.capabilities.foundational,
    ...dna.capabilities.signature,
    ...dna.capabilities.contextual,
    dna.capabilities.escalation,
  ];
  return {
    allIds: abilities.map((a) => a.id),
    names: new Map(abilities.map((a) => [a.id, a.name])),
    foundational: new Set(dna.capabilities.foundational.map((a) => a.id)),
  };
}
const kits = new Map(ids.map((id) => [id, kitOf(content.fighters.get(id)!)]));

// --- Run the sample ----------------------------------------------------------

const castsByFighter = new Map<string, Map<string, number>>(); // fighter -> abilityId -> count
const seqPerMatch = new Map<string, string[][]>(); // fighter -> per-match cast sequences
const loopsByFighter = new Map<string, { aaa: number; abab: number; foundationalOnly: number }>();
const commentaryFlags: { match: string; text: string; count: number }[] = [];
const participated = new Set<string>();

for (const [m, [a, b]] of matchups.entries()) {
  const seed = 4242 + m * 37;
  const matchId = `variety-${m}`;
  const manifest = buildManifest({
    matchId,
    roomId: 'variety',
    createdAt: '2026-01-01T00:00:00Z',
    ruleset: RULESET_S0,
    arenaId: arena.arenaId,
    arenaVersion: arena.version,
    seed,
    teams: [makeTeam('A', a), makeTeam('B', b)],
    content: simContent,
  });
  const run = runManifest(manifest, simContent);
  for (const id of [...a, ...b]) participated.add(id);

  // Per-fighter cast counts and per-match sequences.
  const seqThisMatch = new Map<string, string[]>();
  for (const e of run.events as MatchEvent[]) {
    if (e.type !== 'ABILITY_RESOLVED') continue;
    const fid = String(e.data.fighterId);
    const aid = String(e.data.abilityId);
    if (!castsByFighter.has(fid)) castsByFighter.set(fid, new Map());
    const counts = castsByFighter.get(fid)!;
    counts.set(aid, (counts.get(aid) ?? 0) + 1);
    if (!seqThisMatch.has(fid)) seqThisMatch.set(fid, []);
    seqThisMatch.get(fid)!.push(aid);
  }
  for (const [fid, seq] of seqThisMatch) {
    if (!seqPerMatch.has(fid)) seqPerMatch.set(fid, []);
    seqPerMatch.get(fid)!.push(seq);
    const loops = loopsByFighter.get(fid) ?? { aaa: 0, abab: 0, foundationalOnly: 0 };
    const foundational = kits.get(fid)?.foundational ?? new Set<string>();
    for (let i = 0; i + 2 < seq.length; i++) {
      if (seq[i] === seq[i + 1] && seq[i] === seq[i + 2]) {
        loops.aaa++;
        if (foundational.has(seq[i])) loops.foundationalOnly++;
      }
    }
    for (let i = 0; i + 3 < seq.length; i++) {
      if (seq[i] === seq[i + 2] && seq[i + 1] === seq[i + 3] && seq[i] !== seq[i + 1]) {
        loops.abab++;
        if (foundational.has(seq[i]) && foundational.has(seq[i + 1])) loops.foundationalOnly++;
      }
    }
    loopsByFighter.set(fid, loops);
  }

  // Commentary repetition within this match.
  const lines = generateCommentary(run.events, content.fighters);
  const lineCounts = new Map<string, number>();
  for (const l of lines) lineCounts.set(l.text, (lineCounts.get(l.text) ?? 0) + 1);
  for (const [text, count] of lineCounts) {
    if (count > COMMENTARY_REPEAT_LIMIT) commentaryFlags.push({ match: matchId, text, count });
  }
}

// --- Report ------------------------------------------------------------------

const pct = (r: number) => `${(r * 100).toFixed(1)}%`;
let catastrophic = 0;
let flagged = 0;

console.log(`\n=== Combat-variety analyzer: ${matchups.length} seeded matches, ${participated.size}/${ids.length} fighters sampled ===`);

console.log('\n(a) Ability-usage concentration (all casts; foundational share shown separately):');
for (const id of ids) {
  if (!participated.has(id)) continue;
  const counts = castsByFighter.get(id);
  const total = counts ? [...counts.values()].reduce((s, c) => s + c, 0) : 0;
  if (!counts || total === 0) {
    console.log(`  ${id.padEnd(18)} 0 casts — never acted in the sample  <-- INVESTIGATE`);
    flagged++;
    continue;
  }
  const kit = kits.get(id)!;
  const [topId, topCount] = [...counts.entries()].sort((x, y) => y[1] - x[1])[0];
  const topShare = topCount / total;
  const foundationalCasts = [...counts.entries()]
    .filter(([aid]) => kit.foundational.has(aid))
    .reduce((s, [, c]) => s + c, 0);
  let flag = '';
  if (topShare > TOP_SHARE_CATASTROPHIC && total >= MIN_CASTS_FOR_CATASTROPHIC) {
    flag = '  <-- CATASTROPHIC (>80% one ability)';
    catastrophic++;
  } else if (topShare > TOP_SHARE_FLAG) {
    flag = '  <-- FLAG (>55% one ability)';
    flagged++;
  }
  console.log(
    `  ${id.padEnd(18)} ${String(total).padStart(4)} casts | top: ${(kit.names.get(topId) ?? topId).padEnd(22)} ${pct(topShare).padStart(6)} | foundational ${pct(total ? foundationalCasts / total : 0).padStart(6)}${flag}`,
  );
}

console.log('\n(b) Exact repeated 3-action loops (AAA runs / ABAB alternations per fighter, summed over the sample):');
let anyLoops = false;
for (const id of ids) {
  const loops = loopsByFighter.get(id);
  if (!loops || (loops.aaa === 0 && loops.abab === 0)) continue;
  anyLoops = true;
  const matchCount = seqPerMatch.get(id)?.length ?? 1;
  console.log(
    `  ${id.padEnd(18)} AAA×${String(loops.aaa).padStart(3)}  ABAB×${String(loops.abab).padStart(3)}  (${loops.foundationalOnly} purely-foundational, across ${matchCount} matches)  <-- repeated loop`,
  );
}
if (!anyLoops) console.log('  none detected — no fighter repeated an exact 3-action pattern.');

console.log('\n(c) Abilities NEVER used across all sample matches (unused kits):');
let anyUnused = false;
for (const id of ids) {
  if (!participated.has(id)) continue;
  const kit = kits.get(id)!;
  const counts = castsByFighter.get(id) ?? new Map<string, number>();
  const unused = kit.allIds.filter((aid) => !counts.has(aid));
  if (unused.length === 0) continue;
  anyUnused = true;
  console.log(`  ${id.padEnd(18)} ${unused.map((aid) => `${kit.names.get(aid) ?? aid} [${aid}]`).join(', ')}`);
}
if (!anyUnused) console.log('  none — every authored ability fired at least once in the sample.');

console.log(`\n(d) Commentary repetition (exact line >${COMMENTARY_REPEAT_LIMIT}× in one match):`);
if (commentaryFlags.length === 0) {
  console.log('  none — no exact line exceeded the repetition limit in any match.');
} else {
  for (const f of commentaryFlags) {
    console.log(`  ${f.match}: ${f.count}× "${f.text}"  <-- repetitive commentary`);
  }
}

console.log(`\nSummary: ${catastrophic} catastrophic, ${flagged} flagged, ${commentaryFlags.length} repetitive-commentary findings.`);
if (catastrophic > 0) {
  console.log('CATASTROPHIC variety failure — a fighter leans on one ability for >80% of casts. Failing.');
  process.exit(1);
}
