/**
 * Scripted opponent for solo and dethrone-defense play. Deterministic given its
 * seed; every action it takes goes through the same public sim API as a human
 * (commands + wildcard deployment are recorded into the manifest timelines).
 */
import type { TeamSetup, WildcardContract } from '@arena/contracts';
import { RULESET_S0 } from '@arena/contracts';
import { createRng, type MatchSim, type Rng } from '@arena/combat-sim';
import { DNA_BY_ID, WILDCARDS } from './content';
import type { PrepState } from './state';

const MIN_PRICE = 8_000_000;

export function aiDraftPick(
  availableIds: string[],
  budget: number,
  myRoster: string[],
  rng: Rng,
): string | 'pass' {
  const picksMade = myRoster.length;
  const mustPick = picksMade < RULESET_S0.rosterMin;
  const affordable = availableIds.filter((id) => {
    const price = DNA_BY_ID.get(id)!.balance.draftPrice;
    const picksStillNeeded = Math.max(0, RULESET_S0.rosterMin - picksMade - 1);
    return price <= budget - picksStillNeeded * MIN_PRICE;
  });
  if (affordable.length === 0) {
    if (!mustPick) return 'pass';
    // Never pass below the minimum roster: the feasibility reserve assumed a
    // MIN_PRICE floor that the real market may not offer. Take the cheapest
    // fighter that fits the raw budget instead of soft-locking the draft.
    const fallback = availableIds
      .filter((id) => DNA_BY_ID.get(id)!.balance.draftPrice <= budget)
      .sort((a, b) => DNA_BY_ID.get(a)!.balance.draftPrice - DNA_BY_ID.get(b)!.balance.draftPrice)[0];
    return fallback ?? 'pass';
  }
  if (!mustPick) {
    // Roster is legal — only extend for cheap depth.
    const cheap = affordable.filter((id) => DNA_BY_ID.get(id)!.balance.draftPrice <= budget * 0.8);
    if (cheap.length === 0 || rng.chance(0.45)) return 'pass';
  }
  const myTags = new Set(myRoster.flatMap((id) => DNA_BY_ID.get(id)!.interactions.powerTags));
  const myRoles = new Set(myRoster.map((id) => DNA_BY_ID.get(id)!.identity.role));
  const scored = affordable.map((id) => {
    const dna = DNA_BY_ID.get(id)!;
    let v = dna.balance.draftPrice / 1e6;
    for (const s of dna.interactions.synergies) if (myTags.has(s.allyTag)) v += 4;
    if (!myRoles.has(dna.identity.role)) v += 3; // role diversity
    v *= 0.85 + rng.next() * 0.3;
    return { id, v };
  });
  scored.sort((a, b) => b.v - a.v);
  return scored[0].id;
}

export function aiPrep(roster: string[], rng: Rng): PrepState {
  const byPrice = [...roster].sort(
    (a, b) => DNA_BY_ID.get(b)!.balance.draftPrice - DNA_BY_ID.get(a)!.balance.draftPrice,
  );
  const supportLast = [...roster].sort((a, b) => {
    const sa = DNA_BY_ID.get(a)!.identity.role === 'support' ? 1 : 0;
    const sb = DNA_BY_ID.get(b)!.identity.role === 'support' ? 1 : 0;
    return sa - sb;
  });
  const active = supportLast.slice(0, 3);
  const captain = byPrice[0];
  const wc = WILDCARDS[Math.floor(rng.next() * WILDCARDS.length)];
  return {
    activeFighterIds: active,
    captainId: captain,
    formation: rng.chance(0.5) ? 'balanced' : 'protect_captain',
    reinforcement: roster.length > 3 ? (rng.chance(0.5) ? 'ally_ko' : 'ally_below_35') : 'ally_ko',
    wildcardId: wc?.wildcardId ?? null,
  };
}

/** Per-tick battle brain for an AI-controlled team. */
export class AiBattleController {
  private rng: Rng;
  private wildcardDeployed = false;
  private lastCommandTick = -999;
  private onAction: (kind: 'command' | 'wildcard', detail: string) => void;

  constructor(
    private sim: MatchSim,
    private team: TeamSetup,
    seed: number,
    onAction?: (kind: 'command' | 'wildcard', detail: string) => void,
  ) {
    this.rng = createRng(seed ^ 0x5f3759df);
    this.onAction = onAction ?? (() => {});
  }

  onTick() {
    const sim = this.sim;
    const me = this.team.playerId;
    if (sim.over) return;
    const myPct = sim.teamVitalityPct(me);
    const foePct = sim.teamVitalityPct(sim.opponentOf(me));

    // Wildcard timing by class.
    if (!this.wildcardDeployed && this.team.wildcardId && sim.wildcardAvailable(me)) {
      const wc = wildcardById(this.team.wildcardId);
      const deployTick = wc && (wc.class === 'condition' || wc.class === 'terrain') ? 60 : 90;
      const losing = myPct < foePct - 0.08;
      if (sim.tick >= deployTick || (losing && sim.tick > 40)) {
        const pos = this.wildcardPosition(wc);
        const res = sim.deployWildcard({ playerId: me, wildcardId: this.team.wildcardId, x: pos.x, z: pos.z, issuedTick: sim.tick });
        if (res.accepted) {
          this.wildcardDeployed = true;
          this.onAction('wildcard', this.team.wildcardId);
        }
      }
    }

    // Commands: at most one every 30s, only while tokens remain.
    if (sim.tokensRemaining(me) > 0 && sim.tick - this.lastCommandTick > 120) {
      const foes = sim.activeOf(sim.opponentOf(me));
      const captain = sim.byId(this.team.captainId);
      if (captain && captain.status === 'active' && captain.vitality / captain.dna.resources.vitality < 0.4) {
        this.issue('protect_ally', this.team.captainId);
      } else if (myPct > foePct + 0.1 && sim.tick > 160) {
        this.issue('press_attack');
      } else if (myPct < foePct - 0.15) {
        const weakest = [...foes].sort((a, b) => a.vitality - b.vitality)[0];
        if (weakest) this.issue('focus_target', weakest.fighterId);
      } else if (sim.tick > RULESET_S0.softLimitTicks && this.rng.chance(0.3)) {
        this.issue('press_attack');
      }
    }
  }

  private issue(kind: 'protect_ally' | 'press_attack' | 'focus_target', target?: string) {
    const res = this.sim.applyCommand({
      kind,
      playerId: this.team.playerId,
      targetFighterId: target,
      issuedTick: this.sim.tick,
    });
    if (res.accepted) {
      this.lastCommandTick = this.sim.tick;
      this.onAction('command', kind);
    }
  }

  private wildcardPosition(wc: WildcardContract | undefined): { x: number; z: number } {
    const sim = this.sim;
    const me = this.team.playerId;
    if (!wc || wc.deployment === 'global') return { x: 0, z: 0 };
    const helpsAllies = wc.effects.every((e) => e.affects === 'allies');
    const group = helpsAllies ? sim.activeOf(me) : sim.activeOf(sim.opponentOf(me));
    if (group.length === 0) return { x: 0, z: 0 };
    const cx = group.reduce((s, f) => s + f.x, 0) / group.length;
    const cz = group.reduce((s, f) => s + f.z, 0) / group.length;
    return { x: cx, z: cz };
  }
}

function wildcardById(id: string): WildcardContract | undefined {
  return WILDCARDS.find((w) => w.wildcardId === id);
}
