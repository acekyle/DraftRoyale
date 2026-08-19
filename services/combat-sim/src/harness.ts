/**
 * Headless harness: run a MatchManifest to completion, verify exact replay
 * reproduction, and provide the balance-simulation entry point.
 */
import type { MatchManifest, MatchEvent, MatchOutcome, Ruleset, TeamSetup } from '@arena/contracts';
import { MATCH_SCHEMA_VERSION } from '@arena/contracts';
import { MatchSim, type SimContent } from './sim';
import { fnv1a } from './rng';

export interface RunResult {
  outcome: MatchOutcome;
  events: MatchEvent[];
  hash: string;
  sim: MatchSim;
}

export function buildManifest(opts: {
  matchId: string;
  roomId: string;
  createdAt: string;
  ruleset: Ruleset;
  arenaId: string;
  arenaVersion: string;
  seed: number;
  teams: TeamSetup[];
  content: SimContent;
}): MatchManifest {
  const fighterContractVersions: Record<string, string> = {};
  const combatDnaVersions: Record<string, string> = {};
  const priceVersions: Record<string, string> = {};
  const wildcardVersions: Record<string, string> = {};
  for (const team of opts.teams) {
    for (const pick of team.roster) {
      const dna = opts.content.fighters.get(pick.fighterId);
      if (!dna) continue;
      fighterContractVersions[pick.fighterId] = dna.identity.contractVersion;
      combatDnaVersions[pick.fighterId] = dna.identity.combatVersion;
      priceVersions[pick.fighterId] = dna.balance.priceVersion;
    }
    if (team.wildcardId) {
      const wc = opts.content.wildcards.get(team.wildcardId);
      if (wc) wildcardVersions[team.wildcardId] = wc.version;
    }
  }
  return {
    schemaVersion: MATCH_SCHEMA_VERSION,
    matchId: opts.matchId,
    roomId: opts.roomId,
    createdAt: opts.createdAt,
    rulesetVersion: opts.ruleset.version,
    arenaId: opts.arenaId,
    arenaVersion: opts.arenaVersion,
    randomSeed: opts.seed,
    teams: opts.teams,
    fighterContractVersions,
    combatDnaVersions,
    priceVersions,
    wildcardVersions,
    commandTimeline: [],
    wildcardTimeline: [],
  };
}

/** Deterministically replay a manifest (including its command/wildcard timelines). */
export function runManifest(manifest: MatchManifest, content: SimContent): RunResult {
  const sim = new MatchSim(
    { matchId: manifest.matchId, seed: manifest.randomSeed, ruleset: rulesetFor(manifest), teams: manifest.teams },
    content,
  );
  const cmds = [...manifest.commandTimeline].sort((a, b) => a.issuedTick - b.issuedTick);
  const wcs = [...manifest.wildcardTimeline].sort((a, b) => a.issuedTick - b.issuedTick);
  let ci = 0, wi = 0;
  const maxTicks = rulesetFor(manifest).hardLimitTicks + 10;
  while (!sim.over && sim.tick < maxTicks) {
    // Apply timeline items scheduled for the tick that is about to run.
    while (ci < cmds.length && cmds[ci].issuedTick === sim.tick) sim.applyCommand(cmds[ci++]);
    while (wi < wcs.length && wcs[wi].issuedTick === sim.tick) sim.deployWildcard(wcs[wi++]);
    sim.step();
  }
  if (!sim.outcome) throw new Error('manifest replay did not terminate');
  return { outcome: sim.outcome, events: sim.events, hash: hashRun(sim.events, sim.outcome), sim };
}

/** Replay-verification gate: the same manifest must reproduce the same hash. */
export function verifyReplay(manifest: MatchManifest, content: SimContent): { ok: boolean; hashA: string; hashB: string } {
  const a = runManifest(manifest, content);
  const b = runManifest(manifest, content);
  return { ok: a.hash === b.hash, hashA: a.hash, hashB: b.hash };
}

export function hashRun(events: MatchEvent[], outcome: MatchOutcome): string {
  const payload = JSON.stringify({ e: events.map((e) => [e.seq, e.tick, e.type, e.data]), o: outcome });
  return fnv1a(payload);
}

import { RULESET_S0 } from '@arena/contracts';
function rulesetFor(manifest: MatchManifest): Ruleset {
  // Single ruleset in Season 0; versioned lookup grows with the ruleset registry.
  if (manifest.rulesetVersion !== RULESET_S0.version)
    throw new Error(`unknown ruleset version ${manifest.rulesetVersion}`);
  return RULESET_S0;
}
