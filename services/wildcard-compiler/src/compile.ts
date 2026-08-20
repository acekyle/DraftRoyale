/**
 * Deterministic rule-based wildcard compiler (Season 0 — ADR-0008).
 * Free text → WildcardContract, strictly inside the closed WildcardEffectKind
 * vocabulary, with honest normalization notes and mandatory counterplay.
 */
import type {
  CompiledWildcardResult,
  DamageType,
  WildcardClass,
  WildcardContract,
  WildcardEffect,
} from '@arena/contracts';
import { WILDCARD_SCHEMA_VERSION } from '@arena/contracts';
import { fnv1a32, frange, hex4, irange, pick, rngFor, slugify } from './hash';

// ---------------------------------------------------------------------------
// Family tag lexicon (kept local — this service depends only on contracts)
// ---------------------------------------------------------------------------

interface WcFamily {
  key: string;
  keywords: string[];
  tags: string[];
  motif: string;
  dot: DamageType;
}

const WC_FAMILIES: WcFamily[] = [
  { key: 'fire', keywords: ['fire', 'flame', 'heat', 'lava', 'magma', 'ember', 'burn', 'scorch'], tags: ['fire', 'thermal'], motif: 'Ember', dot: 'thermal' },
  { key: 'water', keywords: ['water', 'hydro', 'ice', 'frost', 'tide', 'flood', 'rain', 'snow'], tags: ['hydro', 'water', 'ice'], motif: 'Tide', dot: 'kinetic' },
  { key: 'lightning', keywords: ['lightning', 'electric', 'storm', 'thunder', 'volt', 'static', 'shock'], tags: ['lightning', 'electric'], motif: 'Storm', dot: 'energy' },
  { key: 'stone', keywords: ['stone', 'earth', 'rock', 'metal', 'seismic', 'earthquake', 'crystal'], tags: ['stone', 'earth'], motif: 'Stone', dot: 'kinetic' },
  { key: 'wind', keywords: ['wind', 'gale', 'cyclone', 'tornado', 'aero'], tags: ['wind', 'air'], motif: 'Gale', dot: 'kinetic' },
  { key: 'light', keywords: ['light', 'solar', 'holy', 'radiant', 'sun', 'photon'], tags: ['solar', 'light'], motif: 'Radiant', dot: 'energy' },
  { key: 'shadow', keywords: ['shadow', 'dark', 'void', 'night', 'umbral', 'gloom'], tags: ['shadow', 'dark'], motif: 'Umbra', dot: 'magic' },
  { key: 'psychic', keywords: ['psychic', 'mind', 'telekinetic', 'psionic', 'mental'], tags: ['psychic', 'mind'], motif: 'Mind', dot: 'psychic' },
  { key: 'magic', keywords: ['magic', 'arcane', 'witch', 'spell', 'hex', 'rune', 'mystic'], tags: ['magic', 'arcane'], motif: 'Hex', dot: 'magic' },
  { key: 'tech', keywords: ['tech', 'robot', 'cyber', 'mech', 'machine', 'drone', 'electronic', 'technology', 'emp'], tags: ['tech', 'cyber'], motif: 'Circuit', dot: 'energy' },
  { key: 'sonic', keywords: ['sonic', 'sound', 'scream', 'echo', 'resonan', 'noise'], tags: ['sonic', 'sound'], motif: 'Echo', dot: 'sonic' },
  { key: 'toxic', keywords: ['toxic', 'poison', 'venom', 'acid', 'plague', 'miasma', 'corros'], tags: ['toxic', 'venom'], motif: 'Blight', dot: 'toxic' },
  { key: 'spirit', keywords: ['spirit', 'ghost', 'phantom', 'wraith', 'soul', 'haunt'], tags: ['spirit', 'ghost'], motif: 'Wraith', dot: 'psychic' },
  { key: 'blade', keywords: ['blade', 'sword', 'razor', 'knife'], tags: ['blade', 'martial'], motif: 'Edge', dot: 'kinetic' },
  { key: 'beast', keywords: ['beast', 'claw', 'feral', 'predator'], tags: ['beast', 'claw'], motif: 'Fang', dot: 'kinetic' },
];

// ---------------------------------------------------------------------------
// Class inference
// ---------------------------------------------------------------------------

const CLASS_WORDS: { cls: WildcardClass; words: string[] }[] = [
  { cls: 'terrain', words: ['flood', 'floods', 'flooded', 'overgrowth', 'vines', 'ice sheet', 'lava terrain', 'lava floor', 'earthquake', 'terrain', 'quicksand floor'] },
  { cls: 'object', words: ['device', 'spire', 'beacon', 'crystal', 'mine', 'totem', 'statue', 'pylon', 'obelisk', 'turret', 'shard', 'monolith', 'pillar', 'generator', 'altar'] },
  { cls: 'field', words: ['fog', 'field', 'zone', 'aura', 'well', 'mist', 'cloud', 'dome', 'bubble', 'shroud', 'quicksand', 'storm'] },
  { cls: 'condition', words: ['eclipse', 'night', 'nightfall', 'sun', 'weather', 'global', 'sky', 'moon', 'dusk', 'dawn', 'arena-wide', 'whole arena', 'everywhere'] },
];

const hasWord = (text: string, w: string): boolean =>
  w.includes(' ') || w.includes('-') ? text.includes(w) : new RegExp(`\\b${w}\\b`).test(text);

function inferClass(text: string): { cls: WildcardClass; matched: string | null } {
  for (const row of CLASS_WORDS) {
    const hit = row.words.find((w) => hasWord(text, w));
    if (hit) return { cls: row.cls, matched: hit };
  }
  return { cls: 'field', matched: null };
}

// ---------------------------------------------------------------------------
// Moderation + unbounded clauses
// ---------------------------------------------------------------------------

const DISALLOWED = ['gore', 'suicide', 'genocide', 'sexual', 'nazi', 'terror attack', 'school shooting', 'racial slur'];

const UNBOUNDED_WC: { re: RegExp; label: string; note: string }[] = [
  { re: /\b(instant(ly)? (win|kill)\w*|wins? the match|auto[- ]?win)\b/, label: 'instant win/kill', note: 'Instant-win/kill clause rejected — wildcards shape fights, they do not end them.' },
  { re: /\b(invincib\w*|invulnerab\w*|immortal|unkillable)\b/, label: 'invulnerability', note: 'Invulnerability clause rejected — no wildcard may make fighters unhittable.' },
  { re: /\b(infinite|unlimited|limitless)\b/, label: 'infinite', note: 'Infinite/unlimited clause rejected — every wildcard has finite, disclosed numbers.' },
  { re: /\b(one[- ]shot\w*|kills? everyone|destroys? everything)\b/, label: 'one-shot', note: 'One-shot/annihilation clause rejected — damage over time is bounded at 1.5/tick.' },
];

// ---------------------------------------------------------------------------
// Compiler
// ---------------------------------------------------------------------------

const ADJ = ['Ashen', 'Umbral', 'Nullglass', 'Static', 'Verdant', 'Rimebound', 'Sable', 'Gilded', 'Hollow', 'Vermilion', 'Pale', 'Sunken'];
const CLASS_NOUN: Record<WildcardClass, string[]> = {
  object: ['Spire', 'Totem', 'Monolith', 'Beacon', 'Shard'],
  field: ['Well', 'Veil', 'Shroud', 'Miasma', 'Ring'],
  condition: ['Eclipse', 'Pall', 'Sky', 'Omen'],
  terrain: ['Flood', 'Overgrowth', 'Upheaval', 'Expanse'],
};

export function compileWildcard(description: string, seed: number): CompiledWildcardResult {
  const text = (description ?? '').toLowerCase();
  const hash = fnv1a32(`${description ?? ''}${seed}`);
  const rng = rngFor(hash, 'wildcard');
  const notes: string[] = [];
  const rejectedClauses: string[] = [];

  // Moderation.
  const disallowedHit = DISALLOWED.find((w) => text.includes(w));
  const moderation: WildcardContract['moderation'] = disallowedHit ? 'rejected' : 'approved';
  if (disallowedHit) notes.push(`Moderation: description contains disallowed content ("${disallowedHit}") — wildcard rejected for play.`);

  // Unbounded clauses.
  for (const rule of UNBOUNDED_WC) {
    const m = text.match(rule.re);
    if (m) {
      rejectedClauses.push(m[0]);
      notes.push(rule.note);
    }
  }
  // 'permanent' is only legitimate for terrain.
  const permMatch = text.match(/\b(permanent\w*|forever|rest of the match)\b/);

  // Class.
  const clsScan = inferClass(text);
  const cls = clsScan.cls;
  if (!clsScan.matched) notes.push('No clear manifestation cue — defaulted to a placed field (medium/low confidence).');
  if (permMatch && cls !== 'terrain') {
    rejectedClauses.push(permMatch[0]);
    notes.push(`"${permMatch[0]}" rejected — only terrain conversions are permanent; this ${cls} carries a finite duration.`);
  }

  // Families mentioned.
  const families = WC_FAMILIES.filter((f) => f.keywords.some((w) => hasWord(text, w)));

  // Geometry / lifetime by class.
  const deployment: WildcardContract['deployment'] = cls === 'condition' || cls === 'terrain' ? 'global' : 'placed';
  const radius = cls === 'object' ? irange(rng, 5, 10) : cls === 'field' ? irange(rng, 8, 14) : 0;
  const durationTicks = cls === 'object' ? irange(rng, 240, 400) : cls === 'field' ? irange(rng, 160, 280) : cls === 'condition' ? irange(rng, 200, 280) : 0;
  const objectHp = cls === 'object' ? irange(rng, 40, 80) : 0;

  // Effects (closed vocabulary only).
  const effects: WildcardEffect[] = [];
  const interactions: string[] = [];
  const global = deployment === 'global';
  const enemyLanguage = /\b(enem\w*|foes?|opponents?|their team)\b/.test(text);

  const suppressVerb = /\b(suppress\w*|nullif\w*|silence\w*|negate\w*|dampen\w*|anti|disable\w*)\b/.test(text) || /shuts? down/.test(text);
  if (suppressVerb && families.length > 0) {
    const tags = [...new Set(families.flatMap((f) => f.tags.slice(0, 2)))];
    effects.push({ kind: 'suppress_tags', tags, affects: 'both' });
    interactions.push(`Abilities, passives, and resources tagged [${tags.join(', ')}] stop working ${global ? 'arena-wide' : 'inside the radius'}.`);
  }
  if (/\b(burn\w*|scorch\w*|sear\w*|acid|corro\w*|poison\w*|toxin|damag\w*|zap\w*|shock\w*|sting\w*)\b/.test(text)) {
    const fam = families[0];
    effects.push({ kind: 'dot', magnitude: frange(rng, 0.5, 1.5), damageType: fam ? fam.dot : 'kinetic', affects: 'both' });
    interactions.push('Everything caught inside takes steady damage per tick — a timer on any brawl fought there.');
  }
  if (/\b(heal\w*|mend\w*|restor\w*|regen\w*)\b/.test(text)) {
    effects.push({ kind: 'hot', magnitude: frange(rng, 0.5, 1.5), affects: global ? 'both' : 'allies' });
    interactions.push('Sustained healing per tick — fights of attrition tilt toward whoever holds the ground.');
  }
  if (/\b(slow\w*|quicksand|mire|sluggish|tar pit|molasses|drags? at)\b/.test(text)) {
    effects.push({ kind: 'speed_mult', magnitude: frange(rng, 0.6, 0.85), affects: 'both' });
    interactions.push('Movement is multiplied down for everyone wading through it — melee kits lose their gap-close.');
  }
  if (/\b(blind\w*|fog|smoke|mist|glare|obscur\w*|haze)\b/.test(text)) {
    effects.push({ kind: 'accuracy_delta', magnitude: -frange(rng, 0.1, 0.2), affects: enemyLanguage && !global ? 'enemies' : 'both' });
    interactions.push('Hit chances drop inside — sustained-fire kits suffer most, burst kits time around it.');
  }
  if (/\b(hide\w*|conceal\w*|stealth\w*|cloak\w*|invisib\w*)\b/.test(text)) {
    effects.push({ kind: 'stealth_bonus', magnitude: frange(rng, 0.1, 0.2), affects: global ? 'both' : 'allies' });
    interactions.push('Stealth-capable fighters compound with the concealment for harder openings.');
  }
  if (/\bgravity\b|\bmagnet\w*\b|out of the sky|grounds? (all )?(fliers?|flight|flyers?)|drags? fliers?/.test(text)) {
    effects.push({ kind: 'ground_flight', affects: 'both' });
    interactions.push('Flight and hover are forced to the ground — airborne evasion bonuses stop applying.');
  }
  if (/\b(water|flood\w*|rain|tide|deluge)\b/.test(text)) {
    effects.push({ kind: 'add_context_tags', tags: ['water_present'], affects: 'both' });
    interactions.push('Adds the water_present context: hydro reserves recharge, water-gated abilities unlock, water-triggered weaknesses go live.');
  }
  if (/\b(darkness|eclipse|night\w*|blots? out the sun|shadow)\b/.test(text)) {
    effects.push({ kind: 'remove_context_tags', tags: ['daylight'], affects: 'both' });
    effects.push({ kind: 'add_context_tags', tags: ['darkness'], affects: 'both' });
    interactions.push('Removes daylight and adds darkness: solar recharge stops, darkness-triggered weaknesses and shadow affinities go live.');
  }

  let confidence: WildcardContract['confidence'] = clsScan.matched && effects.length > 0 ? 'high' : clsScan.matched || effects.length > 0 ? 'medium' : 'low';
  if (effects.length === 0) {
    effects.push({ kind: 'accuracy_delta', magnitude: -0.1, affects: 'both' });
    interactions.push('A distracting presence — everyone fighting near it aims slightly worse.');
    notes.push('No recognizable effect in the description — defaulted to a mild distraction field (accuracy -10% for both teams).');
    confidence = 'low';
  }

  // Broadness normalization: ≥2 suppressed families or a global class must hit both teams.
  const suppressedFamilies = families.length;
  const isBroad = global || (effects.some((e) => e.kind === 'suppress_tags') && suppressedFamilies >= 2) || effects.length >= 3;
  if (isBroad) {
    let downgraded = false;
    for (const e of effects) {
      if (e.affects !== 'both' && e.kind !== 'hot' && e.kind !== 'stealth_bonus') {
        e.affects = 'both';
        downgraded = true;
      }
      if (global && (e.kind === 'hot' || e.kind === 'stealth_bonus') && e.affects !== 'both') {
        e.affects = 'both';
        downgraded = true;
      }
    }
    notes.push(
      downgraded
        ? 'Broad effect normalized to affect BOTH teams — the honesty price of broad power.'
        : 'Broad effect: applies to BOTH teams by design — draft around it or exploit the symmetry harder than your opponent.',
    );
  } else if (enemyLanguage && effects.length === 1 && effects[0].affects === 'enemies') {
    notes.push('Narrow single effect — enemy-only targeting allowed.');
  }

  // Naming.
  const motif =
    families[0]?.motif ??
    (effects.some((e) => e.kind === 'ground_flight')
      ? 'Gravity'
      : effects.some((e) => e.kind === 'suppress_tags')
        ? 'Null'
        : effects.some((e) => e.kind === 'dot')
          ? 'Blight'
          : effects.some((e) => e.kind === 'hot')
            ? 'Mercy'
            : effects.some((e) => e.kind === 'speed_mult')
              ? 'Mire'
              : effects.some((e) => e.kind === 'accuracy_delta')
                ? 'Haze'
                : 'Omen');
  const nameRng = rngFor(hash, 'name');
  const adj = pick(nameRng, ADJ);
  const noun = pick(nameRng, CLASS_NOUN[cls]);
  const normalizedName = [adj, motif, noun].filter((w, i, a) => a.indexOf(w) === i).join(' ');
  const wildcardId = `${slugify(normalizedName)}-x${hex4(hash)}`;

  // Counterplay (always ≥2, class-appropriate).
  const secs = Math.round(durationTicks / 4);
  const counterplay: string[] = [];
  if (cls === 'object') {
    counterplay.push(`Destroy it — ${objectHp} integrity does not survive concentrated fire for long.`);
    counterplay.push(`Fight outside its ${radius} m radius; the effect does not chase.`);
    counterplay.push(`Or simply outlast it — the ${noun.toLowerCase()} expires after ~${secs} seconds.`);
  } else if (cls === 'field') {
    counterplay.push(`Leave the ${radius} m radius — the effect ends the moment a fighter crosses the boundary.`);
    counterplay.push(`Wait out its ~${secs}-second duration before committing your heaviest cooldowns.`);
    if (effects.every((e) => e.affects === 'both')) counterplay.push('It is symmetric — exploit the shared conditions harder than the team that placed it.');
  } else if (cls === 'condition') {
    counterplay.push(`Wait out its ~${secs}-second duration — the sky always clears.`);
    counterplay.push('It is arena-wide and symmetric: draft fighters who ignore it and exploit it harder than your opponent.');
  } else {
    counterplay.push('Draft around it — fighters whose kits ignore or feed on the converted terrain lose nothing.');
    counterplay.push('It is permanent and perfectly symmetric: if the enemy team suffers the terrain worse than yours, their wildcard worked for you.');
  }

  // Side effects.
  const sideEffects: string[] = [];
  if (effects.some((e) => e.affects === 'both'))
    sideEffects.push(`Affects BOTH teams ${global ? 'arena-wide' : 'inside its radius'} — your own fighters pay the same price.`);
  if (cls === 'object') sideEffects.push('The object is a priority target: tactically-minded enemies will focus it down early.');
  if (cls === 'terrain') sideEffects.push('There is no undo — this conversion lasts until the final bell.');
  if (effects.some((e) => e.kind === 'suppress_tags'))
    sideEffects.push('Suppression does not discriminate: drafting your own fighters with the suppressed tags is a self-inflicted wound.');
  if (sideEffects.length === 0) sideEffects.push('Narrow by design — its value depends entirely on placement and timing.');

  const famPhrase = families[0]?.key ?? 'neutral';
  const wildcard: WildcardContract = {
    schemaVersion: WILDCARD_SCHEMA_VERSION,
    wildcardId,
    version: '1.0.0',
    creator: 'player',
    inputDescription: description ?? '',
    normalizedName,
    class: cls,
    radius,
    durationTicks,
    objectHp,
    deployment,
    effects,
    environmentalInteractions: interactions,
    sideEffects,
    counterplay,
    visualManifestation:
      cls === 'object'
        ? `A ${adj.toLowerCase()} ${noun.toLowerCase()} of ${famPhrase}-touched material, visibly humming with its effect; the ground around it reacts within ${radius} m.`
        : cls === 'field'
          ? `A ${radius} m ${noun.toLowerCase()} of ${adj.toLowerCase()} ${famPhrase} energy with a clearly readable boundary edge.`
          : cls === 'condition'
            ? `The sky itself changes — an ${adj.toLowerCase()} cast falls over the whole arena for ~${secs} seconds.`
            : 'The arena floor converts before everyone’s eyes — the change is total, obvious, and permanent.',
    audioManifestation:
      cls === 'object'
        ? 'A resonant hum that spikes when fighters enter its radius, and a shattering report if it is destroyed.'
        : cls === 'field'
          ? 'A low ambient wash at the boundary; crossing in or out is clearly audible.'
          : cls === 'condition'
            ? 'A hush across the whole arena as the change arrives, and a slow swell as it fades.'
            : 'A rolling groundswell as the conversion sweeps the arena, settling into a permanent ambient bed.',
    confidence,
    provenance: 'rule-compiled from player description (deterministic Season 0 compiler, no LLM)',
    moderation,
    eligibility: 'experimental',
  };

  return { wildcard, notes, rejectedClauses };
}
