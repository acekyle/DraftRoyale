/**
 * Deterministic correction passes. Semantic corrections re-parse the
 * instruction and rebuild mechanics through the same assembler; visual
 * corrections touch ONLY presentation (plus scale, within chassis bounds).
 * Both are pure functions of (prev, instruction) — no hidden state.
 */
import type { CompiledFighterResult, Role, Weakness } from '@arena/contracts';
import { FAMILIES, FAMILY_KEYS } from './families';
import { COLOR_WORDS, ROLE_KEYWORDS, SCALE_BOUNDS } from './lexicon';
import { assemble, specFromFighter } from './compile';
import { clamp, round2 } from './hash';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const familyFromWord = (text: string): string | null =>
  FAMILY_KEYS.find((k) =>
    FAMILIES[k].keywords.some((w) =>
      w.includes(' ') ? text.includes(w) : new RegExp(`\\b${w}`).test(text),
    ),
  ) ?? null;

function extractNewName(instruction: string): string | null {
  const m = instruction.match(
    /\b(?:call|name|rename)\s+(?:it|him|her|them|to)?\s*["“”']?([A-Za-z][A-Za-z'’-]*(?:\s+[A-Z][A-Za-z'’-]*){0,2})/,
  );
  if (!m) return null;
  const raw = m[1].replace(/["“”']/g, '').trim().slice(0, 24);
  if (!raw) return null;
  return raw
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function semanticCorrection(prev: CompiledFighterResult, instruction: string): CompiledFighterResult {
  const spec = specFromFighter(prev);
  const lower = instruction.toLowerCase();
  const changes: string[] = [];

  // 1. Rename ("call it X" / "name it X" / "rename to X").
  const newName = extractNewName(instruction);
  if (newName) {
    changes.push(`renamed to "${newName}"`);
    spec.displayName = newName;
  }

  // Weakness phrases are parsed first so "make him weak to fire" never reads as
  // "add the fire family".
  const weakAdd = lower.match(/(?:weak(?:ness)?\s+(?:to|against)|vulnerable\s+to)\s+([a-z ,-]{2,30})/);
  const weaknessFam = weakAdd ? familyFromWord(weakAdd[1]) : null;

  // 2. Family operations: replace X with Y > remove X > add Y.
  const replaceMatch = lower.match(/replace\s+([a-z -]+?)\s+with\s+([a-z -]+)/);
  const removeMatch = lower.match(/\b(?:remove|drop|lose|no more|without)\s+(?:the\s+|his\s+|her\s+|their\s+)?([a-z -]{2,24})/);
  if (replaceMatch) {
    const from = familyFromWord(replaceMatch[1]);
    const to = familyFromWord(replaceMatch[2]);
    if (from && to && spec.familyKeys.includes(from) && !spec.familyKeys.includes(to)) {
      spec.familyKeys = spec.familyKeys.map((k) => (k === from ? to : k));
      changes.push(`replaced ${FAMILIES[from].label} powers with ${FAMILIES[to].label}`);
    }
  } else if (removeMatch && familyFromWord(removeMatch[1])) {
    const fam = familyFromWord(removeMatch[1])!;
    if (spec.familyKeys.includes(fam) && spec.familyKeys.length > 1) {
      spec.familyKeys = spec.familyKeys.filter((k) => k !== fam);
      changes.push(`removed ${FAMILIES[fam].label} powers`);
    } else if (spec.familyKeys.includes(fam)) {
      changes.push(`kept ${FAMILIES[fam].label} powers — a fighter needs at least one power family`);
    }
  } else {
    const addMatch = lower.match(/\b(?:add|give|make|with|gain|now has|turn(?:ed)? into)\b/);
    const fam = familyFromWord(weakAdd ? lower.replace(weakAdd[0], ' ') : lower);
    if (fam && !spec.familyKeys.includes(fam) && (addMatch || spec.familyKeys.length < 2)) {
      if (spec.familyKeys.length >= 2) {
        changes.push(`swapped secondary ${FAMILIES[spec.familyKeys[1]].label} powers for ${FAMILIES[fam].label}`);
        spec.familyKeys = [spec.familyKeys[0], fam];
      } else {
        spec.familyKeys = [...spec.familyKeys, fam];
        changes.push(`added ${FAMILIES[fam].label} powers`);
      }
    }
  }

  // 3. Role shift.
  for (const row of ROLE_KEYWORDS) {
    if (row.words.some((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(lower))) {
      if (spec.role !== row.role) {
        changes.push(`role shifted ${spec.role} → ${row.role}`);
        spec.role = row.role as Role;
      }
      break;
    }
  }

  // 4. Weakness adjustments.
  if (weakAdd) {
    const fam = weaknessFam;
    if (fam && !spec.weaknesses.some((w) => w.id === `declared-${fam}`)) {
      const f = FAMILIES[fam];
      const w: Weakness = {
        id: `declared-${fam}`,
        description: `Creator-declared weakness: ${f.label} attacks land disproportionately hard.`,
        severity: 2,
        trigger: { damageTypes: [f.damageType], abilityTags: f.tags.slice(0, 2) },
        effect: { damageTakenMult: 1.3 },
        evidence: 'creator-correction',
      };
      spec.weaknesses = [...spec.weaknesses, w];
      changes.push(`added declared weakness to ${f.label}`);
    }
  }
  const weakRemove = lower.match(/remove\s+(?:the\s+)?weakness(?:\s+to\s+([a-z -]{2,24}))?/);
  if (weakRemove) {
    const fam = weakRemove[1] ? familyFromWord(weakRemove[1]) : null;
    const target = fam
      ? spec.weaknesses.find((w) => w.id === `declared-${fam}` || w.id === `opposed-${fam}`)
      : spec.weaknesses[spec.weaknesses.length - 1];
    if (target && spec.weaknesses.length > 2) {
      spec.weaknesses = spec.weaknesses.filter((w) => w.id !== target.id);
      changes.push(`removed weakness "${target.id}"`);
    } else if (target) {
      changes.push('weakness kept — ranked rules require at least 2 disclosed weaknesses');
    }
  }

  // Keep the opposing-family weakness in sync with the (possibly new) primary family.
  const primary = FAMILIES[spec.familyKeys[0]];
  const opposedId = `opposed-${primary.opposed}`;
  if (!spec.weaknesses.some((w) => w.id === opposedId)) {
    const stale = spec.weaknesses.findIndex((w) => w.id.startsWith('opposed-'));
    const opp = FAMILIES[primary.opposed];
    const fresh: Weakness = {
      id: opposedId,
      description: `Elemental opposition: ${primary.opposedPhrase}.`,
      severity: 2,
      trigger: { damageTypes: [opp.damageType], abilityTags: opp.tags.slice(0, 2) },
      effect: { damageTakenMult: 1.25 },
      evidence: 'compiler-taxonomy',
    };
    if (stale >= 0) spec.weaknesses[stale] = fresh;
    else spec.weaknesses = [fresh, ...spec.weaknesses];
  }

  if (changes.length === 0) changes.push('no recognized semantic change — instruction recorded, mechanics unchanged');
  spec.semanticRevisionCount += 1;
  spec.notes = [`Semantic correction: ${changes.join('; ')}.`];
  spec.assumptions = [...spec.assumptions, `Semantic correction applied: "${instruction.trim().slice(0, 120)}".`];

  const result = assemble(spec);
  result.notes = [...spec.notes];
  return result;
}

export function visualCorrection(prev: CompiledFighterResult, instruction: string): CompiledFighterResult {
  const next = clone(prev);
  const lower = instruction.toLowerCase();
  const changes: string[] = [];
  const p = next.fighter.dna.presentation;

  // Colors.
  const colorHits = Object.keys(COLOR_WORDS).filter((w) => new RegExp(`\\b${w}\\b`).test(lower));
  if (colorHits.length > 0) {
    const energyIntent = /\b(glow|energy|aura|trail)\b/.test(lower);
    if (energyIntent && colorHits.length === 1) {
      p.energyColor = COLOR_WORDS[colorHits[0]];
      changes.push(`energy color → ${colorHits[0]}`);
    } else {
      p.primaryColor = COLOR_WORDS[colorHits[0]];
      changes.push(`primary color → ${colorHits[0]}`);
      if (colorHits[1]) {
        p.secondaryColor = COLOR_WORDS[colorHits[1]];
        changes.push(`secondary color → ${colorHits[1]}`);
      }
      if (energyIntent && colorHits.length > 1) {
        p.energyColor = COLOR_WORDS[colorHits[colorHits.length - 1]];
        changes.push(`energy color → ${colorHits[colorHits.length - 1]}`);
      }
    }
  }

  // Scale (within chassis bounds).
  const [lo, hi] = SCALE_BOUNDS[next.fighter.dna.identity.chassis];
  if (/\b(bigger|larger|taller|huger|grow|scale up)\b/.test(lower)) {
    const s = round2(clamp(next.fighter.dna.identity.scale + 0.1, lo, hi));
    if (s !== next.fighter.dna.identity.scale) changes.push(`scale ${next.fighter.dna.identity.scale} → ${s}`);
    else changes.push(`scale already at the ${next.fighter.dna.identity.chassis} chassis ceiling (${hi})`);
    next.fighter.dna.identity.scale = s;
  } else if (/\b(smaller|shorter|shrink|scale down|tinier)\b/.test(lower)) {
    const s = round2(clamp(next.fighter.dna.identity.scale - 0.1, lo, hi));
    if (s !== next.fighter.dna.identity.scale) changes.push(`scale ${next.fighter.dna.identity.scale} → ${s}`);
    else changes.push(`scale already at the ${next.fighter.dna.identity.chassis} chassis floor (${lo})`);
    next.fighter.dna.identity.scale = s;
  }

  // Silhouette restyle for style nouns (or as a fallback so every instruction lands).
  const styleNoun =
    /\b(cape|horn|horns|armor|armour|helmet|mask|robe|robes|tail|crest|crown|scar|tattoo|wings?|cloak|spikes?|halo|visor|hood|braids?|plume|banner)\b/.test(
      lower,
    );
  if (styleNoun || changes.length === 0) {
    const restyle = instruction.trim().replace(/\s+/g, ' ').slice(0, 80);
    p.silhouette = `${p.silhouette.split('; restyled:')[0]}; restyled: ${restyle}`;
    changes.push(`silhouette restyled ("${restyle}")`);
  }

  next.fighter.contract.approval.visualRevisionCount += 1;
  next.notes = [`Visual correction: ${changes.join('; ')}. Mechanics untouched — presentation only.`];
  return next;
}
