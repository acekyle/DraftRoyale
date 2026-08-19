/**
 * Causal breakdown — every completed match must support a causal explanation
 * showing why the winner won (Product Law 4.7). Built only from the authoritative
 * event log and simulation state; nothing here invents facts.
 */
import type { CausalBreakdown, CausalFactor, CombatDNA, MatchEvent } from '@arena/contracts';
import type { MatchSim } from './sim';
import { formatTick } from './sim';

export function buildBreakdown(sim: MatchSim, dnaById: Map<string, CombatDNA>): CausalBreakdown {
  if (!sim.outcome) throw new Error('match not finished');
  const outcome = sim.outcome;
  const events = sim.events;
  const winner = sim.teams.find((t) => t.playerId === outcome.winnerPlayerId)!;
  const loser = sim.teams.find((t) => t.playerId !== outcome.winnerPlayerId)!;
  const display = (id: string) => {
    const dna = dnaById.get(id);
    return dna ? prettyName(dna.identity.fighterId) : id;
  };

  const factors: CausalFactor[] = [];

  // Draft value: damage output per salary dollar.
  for (const team of sim.teams) {
    const spent = team.roster.reduce((s, r) => s + r.pricePaid, 0);
    const dmg = sim.fighters.filter((f) => f.teamId === team.playerId).reduce((s, f) => s + f.damageDealt, 0);
    if (team.playerId === outcome.winnerPlayerId) {
      factors.push({
        kind: 'draft_value',
        headline: `${team.displayName}'s draft delivered ${Math.round(dmg)} damage from $${(spent / 1e6).toFixed(1)}M of cap`,
        detail: `Efficiency ${(dmg / (spent / 1e6)).toFixed(1)} damage per $M — the roster construction did its job.`,
        magnitude: dmg,
      });
    }
  }

  // Weakness exploitation.
  const weaknessDmg = sim.weaknessDamageMap();
  const topWeakness = Object.entries(weaknessDmg).sort((a, b) => b[1] - a[1])[0];
  if (topWeakness && topWeakness[1] > 5) {
    const [key, bonus] = topWeakness;
    const [fighterId, weaknessId] = key.split(':');
    const w = dnaById.get(fighterId)?.weaknesses.find((x) => x.id === weaknessId);
    factors.push({
      kind: 'weakness_exploited',
      headline: `${display(fighterId)}'s weakness was exploited for ${Math.round(bonus)} bonus damage`,
      detail: w ? `${w.description} (severity ${w.severity}).` : `Weakness ${weaknessId} was triggered repeatedly.`,
      magnitude: bonus,
    });
  }

  // Wildcard impact.
  for (const inst of sim.wildcardInstances) {
    const impact = inst.damageDone + inst.healingDone + inst.suppressionFighterTicks * 0.15 + inst.groundedFighterTicks * 0.3;
    if (impact < 5) continue;
    const ownerTeam = sim.teams.find((t) => t.playerId === inst.ownerTeamId)!;
    const bits: string[] = [];
    if (inst.damageDone > 0) bits.push(`${Math.round(inst.damageDone)} damage`);
    if (inst.healingDone > 0) bits.push(`${Math.round(inst.healingDone)} healing`);
    if (inst.suppressionFighterTicks > 0) bits.push('sustained power suppression');
    if (inst.groundedFighterTicks > 0) bits.push('grounded fliers');
    const fate = inst.destroyed ? ' before being destroyed' : inst.expired ? ' before expiring' : '';
    factors.push({
      kind: 'wildcard_impact',
      headline: `${ownerTeam.displayName}'s wildcard ${inst.contract.normalizedName} changed the field`,
      detail: `It produced ${bits.join(', ')}${fate}.`,
      magnitude: impact,
    });
  }

  // Tactical commands.
  const cmdDamage = sim.commandDamageByTeam();
  for (const [teamId, cmds] of Object.entries(cmdDamage)) {
    const team = sim.teams.find((t) => t.playerId === teamId)!;
    for (const c of cmds) {
      if (c.damage < 20) continue;
      factors.push({
        kind: 'tactical_command',
        headline: `${team.displayName}'s "${c.kind.replace(/_/g, ' ')}" call produced ${Math.round(c.damage)} team damage`,
        detail: `Damage dealt while the command window was live.`,
        magnitude: c.damage * 0.6,
      });
    }
  }

  // Reserve entries.
  const reserveEvents = events.filter((e) => e.type === 'RESERVE_ENTERED');
  for (const e of reserveEvents) {
    factors.push({
      kind: 'reserve_entry',
      headline: `${display(String(e.data.fighterId))} entered from reserve at ${formatTick(e.tick, sim.ruleset.tickMs)}`,
      detail: String(e.data.reason ?? 'squad relay'),
      magnitude: 15,
    });
  }

  // Arena interaction: resource depletions and destroyed features.
  const depletions = events.filter((e) => e.type === 'RESOURCE_DEPLETED');
  for (const e of depletions) {
    factors.push({
      kind: 'arena_interaction',
      headline: `${display(String(e.data.fighterId))} ran dry on ${e.data.resource}`,
      detail: 'Power-source dependency became a liability under these battlefield conditions.',
      magnitude: 25,
    });
  }
  const destroyed = events.filter((e) => e.type === 'FEATURE_DESTROYED').length;
  if (destroyed > 0) {
    factors.push({
      kind: 'arena_interaction',
      headline: `${destroyed} arena structure${destroyed > 1 ? 's were' : ' was'} destroyed`,
      detail: 'Lost cover changed the value of ranged attacks in the late fight.',
      magnitude: destroyed * 8,
    });
  }

  // Decisive swing.
  const tp = sim.turningPoint() ?? { tick: outcome.finalTick, description: 'The fight stayed close until the end.' };
  factors.push({
    kind: 'decisive_swing',
    headline: `Turning point at ${formatTick(tp.tick, sim.ruleset.tickMs)}`,
    detail: tp.description,
    magnitude: 40,
  });

  factors.sort((a, b) => b.magnitude - a.magnitude);

  const kos = events.filter((e) => e.type === 'FIGHTER_KNOCKED_OUT' || e.type === 'FIGHTER_CONTAINED');
  const lastKo = kos[kos.length - 1];
  const reasonBit =
    outcome.reason === 'elimination'
      ? `finishing the fight when ${lastKo ? display(String(lastKo.data.fighterId)) : 'the last opponent'} went down`
      : `winning on a decision with ${Math.round((outcome.teamVitalityPct[winner.playerId] ?? 0) * 100)}% team vitality against ${Math.round((outcome.teamVitalityPct[loser.playerId] ?? 0) * 100)}%`;
  const summary =
    `${winner.displayName} defeated ${loser.displayName} by ${outcome.reason}, ${reasonBit}. ` +
    factors.slice(0, 3).map((f) => f.headline).join('. ') + '.';

  return {
    winnerPlayerId: outcome.winnerPlayerId,
    summary,
    turningPoint: tp,
    factors,
    perFighter: sim.fighters.map((f) => ({
      fighterId: f.fighterId,
      teamId: f.teamId,
      damageDealt: Math.round(f.damageDealt),
      damageTaken: Math.round(f.damageTaken),
      healingDone: Math.round(f.healingDone),
      weaknessesTriggeredAgainst: f.weaknessesTriggeredAgainst,
      koTick: f.koTick,
      survived: f.status === 'active' || f.status === 'reserve',
    })),
  };
}

export function prettyName(fighterId: string): string {
  return fighterId
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
