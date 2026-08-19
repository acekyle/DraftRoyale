/**
 * AI commentary — grounded ONLY in structured match events (Product Law 4.5).
 * Template-driven and fully deterministic in this phase; an LLM voice can be layered
 * later but may never invent events. Repetition is controlled by per-template
 * cooldowns and event-priority gating.
 */
import type { CombatDNA, MatchEvent } from '@arena/contracts';
import { prettyName } from './breakdown';

export interface CommentaryLine {
  tick: number;
  priority: number; // higher = more important
  text: string;
}

type TemplateFn = (e: MatchEvent, n: (id: unknown) => string) => string | null;

interface TemplateSet {
  priority: number;
  cooldownTicks: number;
  variants: TemplateFn[];
}

const T: Partial<Record<MatchEvent['type'], TemplateSet>> = {
  MATCH_STARTED: {
    priority: 10,
    cooldownTicks: 0,
    variants: [() => `Here we go — both squads are on the field and the arena is live!`],
  },
  DAMAGE_APPLIED: {
    priority: 2,
    cooldownTicks: 24,
    variants: [
      (e, n) => (Number(e.data.amount) >= 25 ? `${n(e.data.attacker)} connects HARD on ${n(e.data.target)} — ${e.data.amount} damage!` : null),
      (e, n) => (Number(e.data.amount) >= 25 ? `Huge hit! ${n(e.data.target)} eats ${e.data.amount} from ${n(e.data.attacker)}.` : null),
      (e, n) => (Number(e.data.amount) >= 25 ? `${n(e.data.attacker)} finds the opening — ${n(e.data.target)} is reeling.` : null),
    ],
  },
  ATTACK_EVADED: {
    priority: 1,
    cooldownTicks: 40,
    variants: [
      (e, n) => `${n(e.data.target)} slips the attack from ${n(e.data.attacker)} — beautiful footwork.`,
      (e, n) => `Nothing but air! ${n(e.data.target)} reads it perfectly.`,
    ],
  },
  WEAKNESS_TRIGGERED: {
    priority: 7,
    cooldownTicks: 16,
    variants: [
      (e, n) => `That's the weakness! ${n(e.data.by)} is exploiting exactly what ${n(e.data.fighterId)} can't handle.`,
      (e, n) => `${n(e.data.fighterId)}'s known vulnerability just got exposed — this is why you study the draft board.`,
    ],
  },
  WILDCARD_DEPLOYED: {
    priority: 9,
    cooldownTicks: 0,
    variants: [
      (e) => `WILDCARD! ${e.data.name} hits the field — the whole equation just changed.`,
      (e) => `There it is — ${e.data.name} is live. Someone planned for this exact moment.`,
    ],
  },
  WILDCARD_DESTROYED: {
    priority: 8,
    cooldownTicks: 0,
    variants: [(e) => `The counterplay lands — ${e.data.name} has been destroyed!`],
  },
  WILDCARD_EXPIRED: {
    priority: 5,
    cooldownTicks: 0,
    variants: [(e) => `${e.data.name} fades out — back to a straight fight.`],
  },
  TACTICAL_COMMAND_ISSUED: {
    priority: 6,
    cooldownTicks: 0,
    variants: [(e) => `The call comes in from the corner: ${String(e.data.kind).replace(/_/g, ' ')}!`],
  },
  TACTICAL_COMMAND_REJECTED: {
    priority: 5,
    cooldownTicks: 8,
    variants: [(e, n) => `${n(e.data.fighterId)} waves off the order — ${e.data.reason}.`],
  },
  ALLY_PROTECTED: {
    priority: 4,
    cooldownTicks: 24,
    variants: [(e, n) => `${n(e.data.protector)} steps in front of ${n(e.data.ally)} — that's teammate loyalty.`],
  },
  STABILITY_BROKEN: {
    priority: 4,
    cooldownTicks: 20,
    variants: [(e, n) => `${n(e.data.fighterId)}'s guard is SHATTERED — completely exposed!`],
  },
  RESERVE_ENTERED: {
    priority: 8,
    cooldownTicks: 0,
    variants: [(e, n) => `Fresh legs! ${n(e.data.fighterId)} enters the relay — ${e.data.reason}.`],
  },
  RESOURCE_DEPLETED: {
    priority: 6,
    cooldownTicks: 0,
    variants: [(e, n) => `${n(e.data.fighterId)} has run dry on ${e.data.resource} — the power source is GONE.`],
  },
  FEATURE_DESTROYED: {
    priority: 5,
    cooldownTicks: 12,
    variants: [(e, n) => `The arena itself is coming apart — ${n(e.data.by)} just demolished that ${e.data.type}!`],
  },
  ESCALATION: {
    priority: 7,
    cooldownTicks: 0,
    variants: [(e) => `Escalation protocol — damage is climbing to ${Math.round((Number(e.data.damageMult) - 1) * 100)}% bonus. No hiding now.`],
  },
  FIGHTER_KNOCKED_OUT: {
    priority: 10,
    cooldownTicks: 0,
    variants: [
      (e, n) => `DOWN GOES ${n(e.data.fighterId).toUpperCase()}! What a sequence.`,
      (e, n) => `${n(e.data.fighterId)} is OUT of the fight!`,
    ],
  },
  FIGHTER_CONTAINED: {
    priority: 10,
    cooldownTicks: 0,
    variants: [(e, n) => `${n(e.data.fighterId)} has been CONTAINED — neutralized without a knockout. Clinical.`],
  },
  TURNING_POINT: {
    priority: 9,
    cooldownTicks: 0,
    variants: [(e) => `Looking back, that was the moment: ${e.data.description}`],
  },
  MATCH_ENDED: {
    priority: 10,
    cooldownTicks: 0,
    variants: [(e) => `IT'S OVER! Victory by ${e.data.reason}. What a battle.`],
  },
};

export function generateCommentary(events: MatchEvent[], dnaById: Map<string, CombatDNA>): CommentaryLine[] {
  const n = (id: unknown) => {
    const s = String(id ?? '');
    return dnaById.has(s) ? prettyName(s) : s;
  };
  const lines: CommentaryLine[] = [];
  const lastUsed: Record<string, number> = {};
  for (const e of events) {
    const set = T[e.type];
    if (!set) continue;
    const key = e.type;
    if ((lastUsed[key] ?? -1e9) + set.cooldownTicks > e.tick) continue;
    const variant = set.variants[e.seq % set.variants.length];
    const text = variant(e, n);
    if (!text) continue;
    lastUsed[key] = e.tick;
    lines.push({ tick: e.tick, priority: set.priority, text });
  }
  return lines;
}
