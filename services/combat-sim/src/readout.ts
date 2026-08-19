/**
 * Team Readout — explains the player's OWN team (never a matchup win probability,
 * and never analysis of the opponent's draft).
 */
import type { ArenaDef, CombatDNA, TeamReadout, TeamSetup } from '@arena/contracts';

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = (v: number, max: number) => Math.round(Math.min(100, (v / max) * 100));

export function computeTeamReadout(team: TeamSetup, dnaById: Map<string, CombatDNA>, arena: ArenaDef): TeamReadout {
  const dnas = team.roster.map((r) => dnaById.get(r.fighterId)).filter((d): d is CombatDNA => !!d);
  const allAbilities = dnas.flatMap((d) => [
    ...d.capabilities.foundational,
    ...d.capabilities.signature,
    ...d.capabilities.contextual,
    d.capabilities.escalation,
  ]);

  const offense = pct(avg(dnas.map((d) => d.attributes.forceOutput * 0.6 + d.attributes.precision * 0.4)), 9);
  const endurance = pct(avg(dnas.map((d) => d.resources.vitality * 0.7 + d.attributes.durability * 30)), 420);
  const mobility = pct(avg(dnas.map((d) => d.attributes.travelSpeed * 0.5 + d.attributes.mobility * 0.5)), 9);
  const range = pct(Math.max(...allAbilities.map((a) => a.range), 3), 34);
  const control = pct(
    allAbilities.filter((a) => a.kind === 'control' || (a.effects ?? []).some((e) => ['stun', 'root', 'slow', 'suppress', 'grounded'].includes(e.kind))).length,
    7,
  );
  const support = pct(allAbilities.filter((a) => a.kind === 'support' || a.kind === 'summon').length, 5);
  const recovery = pct(
    avg(dnas.map((d) => d.attributes.recovery)) +
      allAbilities.filter((a) => (a.effects ?? []).some((e) => e.kind === 'regen' || e.kind === 'shield')).length * 2,
    14,
  );

  // Environment fit vs the revealed arena.
  let envScore = 50;
  const notes: string[] = [];
  for (const d of dnas) {
    for (const rule of d.interactions.environmental) {
      if (!arena.contextTags.includes(rule.contextTag)) continue;
      const e = rule.effect;
      const positive =
        (e.damageMult ?? 1) > 1 || (e.resourceRegenMult ?? 1) > 1 || (e.speedMult ?? 1) > 1 || !!e.unlockContext;
      const negative =
        (e.damageMult ?? 1) < 1 || (e.resourceRegenMult ?? 1) < 1 || (e.speedMult ?? 1) < 1 ||
        (e.damageTakenMult ?? 1) > 1 || (e.suppressTags?.length ?? 0) > 0;
      if (positive) { envScore += 8; notes.push(`${d.identity.fighterId}: ${rule.description}`); }
      if (negative) { envScore -= 8; notes.push(`${d.identity.fighterId} (caution): ${rule.description}`); }
    }
  }
  const environmentFit = Math.max(0, Math.min(100, envScore));

  // Synergy: how many synergy rules actually fire on this roster.
  const tagPool = new Set(dnas.flatMap((d) => d.interactions.powerTags));
  let synCount = 0;
  for (const d of dnas) for (const s of d.interactions.synergies) if (tagPool.has(s.allyTag)) synCount++;
  const synergy = pct(synCount + 1, 5);

  const reliability = pct(avg(dnas.map((d) => d.balance.reliabilityScore)), 100);
  const reserveDepth = pct(team.roster.length - 3 + 1, 3);

  // Counter coverage: distinct damage types + suppression tools available.
  const dmgTypes = new Set(allAbilities.map((a) => a.damageType).filter(Boolean));
  const suppression = allAbilities.filter((a) => (a.effects ?? []).some((e) => e.kind === 'suppress')).length;
  const counterCoverage = pct(dmgTypes.size + suppression, 8);

  const axes = {
    offense, endurance, mobility, range, control, support, recovery,
    environmentFit, synergy, reliability, reserveDepth, counterCoverage,
  };

  const ranked = Object.entries(axes).sort((a, b) => b[1] - a[1]);
  const archetype = archetypeName(ranked[0][0], ranked[1][0]);
  const weakest = ranked[ranked.length - 1];
  const tagline =
    `Strong ${axisPhrase(ranked[0][0])} backed by ${axisPhrase(ranked[1][0])}. ` +
    `Limited ${axisPhrase(weakest[0])} — expect trouble if the fight goes there.`;

  return { archetype, tagline, axes, notes: notes.slice(0, 6) };
}

function axisPhrase(axis: string): string {
  const map: Record<string, string> = {
    offense: 'raw offensive pressure',
    endurance: 'defensive endurance',
    mobility: 'battlefield mobility',
    range: 'long-range reach',
    control: 'battlefield control',
    support: 'team support',
    recovery: 'recovery tools',
    environmentFit: 'arena compatibility',
    synergy: 'team synergy',
    reliability: 'consistent output',
    reserveDepth: 'reserve depth',
    counterCoverage: 'counter coverage',
  };
  return map[axis] ?? axis;
}

function archetypeName(top: string, second: string): string {
  const names: Record<string, string> = {
    offense: 'Assault', endurance: 'Fortress', mobility: 'High-Mobility', range: 'Long-Range',
    control: 'Control', support: 'Support-Core', recovery: 'Attrition', environmentFit: 'Home-Turf',
    synergy: 'Combo', reliability: 'Reliable', reserveDepth: 'Deep-Bench', counterCoverage: 'Toolbox',
  };
  const roles: Record<string, string> = {
    offense: 'Strike Team', endurance: 'Wall', mobility: 'Skirmish Squad', range: 'Artillery Line',
    control: 'Lockdown Unit', support: 'Sustain Squad', recovery: 'Attrition Engine', environmentFit: 'Terrain Specialists',
    synergy: 'Combo Engine', reliability: 'Workhorse Crew', reserveDepth: 'Relay Team', counterCoverage: 'Answer Squad',
  };
  return `${names[top] ?? 'Balanced'} ${roles[second] ?? 'Squad'}`;
}
