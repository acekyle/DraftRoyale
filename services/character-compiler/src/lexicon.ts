/**
 * Keyword lexicons for the rule-based parser: chassis, movement, role,
 * adjectives, unbounded-power clauses, protected-IP and real-person guards,
 * and color words. All matching is lowercase keyword/regex based — documented
 * as shallow by design (Season 0; LLM providers are Founder-gated).
 */
import type { Chassis, Role } from '@arena/contracts';

// --------------------------------------------------------------------------
// Chassis (checked in this order — first hit wins)
// --------------------------------------------------------------------------

export const CHASSIS_KEYWORDS: { chassis: Chassis; words: string[] }[] = [
  { chassis: 'heavy', words: ['giant', 'colossus', 'colossal', 'huge', 'titan', 'massive', 'towering', 'enormous', 'gargantuan', 'behemoth'] },
  { chassis: 'quadruped', words: ['wolf', 'boar', 'cat', 'panther', 'tiger', 'lion', 'bear', 'hound', 'fox', 'jaguar', 'spider', 'stag', 'on all fours', 'four-legged', 'four legs', 'quadruped'] },
  { chassis: 'floating', words: ['ghost', 'wisp', 'floating', 'floats', 'orb', 'genie', 'legless', 'levitat', 'hovering', 'spectre', 'specter', 'wraith', 'phantom', 'jellyfish'] },
];

/** Scale bounds per chassis — visual corrections must stay inside these. */
export const SCALE_BOUNDS: Record<Chassis, [number, number]> = {
  humanoid: [0.85, 1.2],
  heavy: [1.3, 1.6],
  quadruped: [0.85, 1.4],
  floating: [0.85, 1.3],
};

// --------------------------------------------------------------------------
// Movement
// --------------------------------------------------------------------------

export const MOVEMENT_KEYWORDS = {
  flight: ['fly', 'flies', 'flying', 'wing', 'wings', 'winged', 'soar', 'airborne'],
  hover: ['hover', 'levitat', 'floats', 'floating', 'drifts'],
  blink: ['teleport', 'blink', 'phase', 'phases', 'warp'],
  sprint: ['fast', 'quick', 'speedster', 'swift', 'rapid', 'blur', 'lightning-fast'],
};

// --------------------------------------------------------------------------
// Roles
// --------------------------------------------------------------------------

export const ROLE_KEYWORDS: { role: Role; words: string[] }[] = [
  { role: 'defender', words: ['protect', 'shield', 'guard', 'bodyguard', 'bulwark', 'sentinel', 'defender'] },
  { role: 'support', words: ['heal', 'healer', 'support', 'medic', 'mend', 'restore', 'cleric'] },
  { role: 'artillery', words: ['sniper', 'artillery', 'cannon', 'long-range', 'long range', 'marksman', 'bombard'] },
  { role: 'controller', words: ['control', 'trap', 'bind', 'lockdown', 'disable', 'crowd control', 'suppress'] },
  { role: 'skirmisher', words: ['assassin', 'sneak', 'stealth', 'skirmish', 'rogue', 'duelist', 'scout'] },
  { role: 'tactician', words: ['lead', 'leader', 'commander', 'tactician', 'strategist', 'captain', 'general'] },
  { role: 'bruiser', words: ['brawler', 'bruiser', 'smash', 'crush', 'wrestler', 'juggernaut', 'brute'] },
];

export const DEFAULT_ROLE_BY_CHASSIS: Record<Chassis, Role> = {
  humanoid: 'skirmisher',
  heavy: 'bruiser',
  quadruped: 'skirmisher',
  floating: 'controller',
};

// --------------------------------------------------------------------------
// Adjective → attribute modifiers
// --------------------------------------------------------------------------

export interface AdjectiveRule {
  words: string[];
  deltas: Partial<Record<string, number>>;
  note: string;
}

export const ADJECTIVES: AdjectiveRule[] = [
  { words: ['mighty', 'strong', 'powerful', 'superhuman strength', 'herculean'], deltas: { forceOutput: 2 }, note: 'strength language → forceOutput +2' },
  { words: ['tough', 'armored', 'armoured', 'durable', 'sturdy', 'hardy', 'unyielding'], deltas: { durability: 2 }, note: 'toughness language → durability +2' },
  { words: ['fast', 'quick', 'swift', 'speedster', 'rapid'], deltas: { combatSpeed: 2, mobility: 1, travelSpeed: 1 }, note: 'speed language → combatSpeed +2, mobility/travelSpeed +1' },
  { words: ['agile', 'nimble', 'acrobat', 'graceful'], deltas: { mobility: 2 }, note: 'agility language → mobility +2' },
  { words: ['genius', 'tactical', 'brilliant', 'cunning', 'strategist', 'calculating'], deltas: { tacticalIntelligence: 2 }, note: 'intellect language → tacticalIntelligence +2' },
  { words: ['precise', 'accurate', 'sharpshooter', 'deadeye'], deltas: { precision: 2 }, note: 'precision language → precision +2' },
  { words: ['brave', 'fearless', 'dauntless', 'valiant'], deltas: { resolve: 2 }, note: 'courage language → resolve +2' },
  { words: ['wise', 'ancient', 'veteran', 'seasoned'], deltas: { perception: 1, tacticalIntelligence: 1 }, note: 'experience language → perception/tacticalIntelligence +1' },
  { words: ['clumsy', 'lumbering', 'awkward'], deltas: { precision: -2, mobility: -1 }, note: 'clumsy language → precision -2, mobility -1' },
  { words: ['frail', 'fragile', 'sickly', 'brittle'], deltas: { durability: -2 }, note: 'frailty language → durability -2' },
  { words: ['slow', 'sluggish', 'ponderous'], deltas: { combatSpeed: -1, travelSpeed: -1 }, note: 'slowness language → combatSpeed/travelSpeed -1' },
];

/** Soft cap on the sum of the 13 attribute tiers (≈ strongest curated fighter). */
export const ATTRIBUTE_SUM_CAP = 78;

// --------------------------------------------------------------------------
// Unbounded-power clauses — recognized, stripped, and honestly noted.
// --------------------------------------------------------------------------

export interface UnboundedRule {
  re: RegExp;
  label: string;
  /** Bounded compensation applied instead of the claim. */
  deltas?: Partial<Record<string, number>>;
  grantsShield?: boolean;
  note: string;
}

export const UNBOUNDED: UnboundedRule[] = [
  {
    re: /\b(invincib\w*|invulnerab\w*|indestructib\w*|unkillable|untouchable)\b/,
    label: 'invulnerability',
    deltas: { durability: 2 },
    grantsShield: true,
    note: "'invincible' normalized to +2 durability and a 40-point shield ability — Enhanced division does not permit invulnerability.",
  },
  {
    re: /\b(immortal\w*|never dies|cannot die|deathless)\b/,
    label: 'immortality',
    deltas: { recovery: 2 },
    note: "'immortal' normalized to +2 recovery — fighters can always be knocked out or contained.",
  },
  {
    re: /\b(instant(ly)? kill\w*|one[- ]shot\w*|one[- ]hit kill\w*|kills? every(one|thing)|deletes? anyone)\b/,
    label: 'instant kill',
    deltas: { forceOutput: 1 },
    note: "'instantly kills' normalized to +1 forceOutput and a bounded escalation finisher — no attack may remove a fighter outright.",
  },
  {
    re: /\b(infinite|unlimited|limitless|endless|boundless)\b/,
    label: 'infinite power',
    note: "'infinite/unlimited' claims normalized — all resources in the Enhanced division are finite and disclosed.",
  },
  {
    re: /\b(omnipoten\w*|omniscien\w*|all[- ]powerful|reality[- ]warp\w*|godlike|god[- ]mode|a god\b|god who)\b/,
    label: 'omnipotence',
    note: 'Omnipotence/reality-warping stripped — divine framing kept as lore only, scoped to Enhanced-division mechanics.',
  },
  {
    re: /\b(cannot lose|never loses|always wins|undefeatable|unbeatable|unstoppable)\b/,
    label: 'cannot lose',
    deltas: { resolve: 2 },
    note: "'cannot lose' normalized to +2 resolve — outcomes are decided in the arena, not the character sheet.",
  },
  {
    re: /\b(immune to (all|every\w*)|absorbs? (all|any) (damage|attacks?)|no weakness\w*)\b/,
    label: 'blanket immunity',
    note: 'Blanket immunity stripped — resistances are capped at 75% and every fighter carries real weaknesses.',
  },
];

// --------------------------------------------------------------------------
// Protected-IP guard. Keyword blocklist of well-known characters; matches are
// transformed into ORIGINAL archetype-inspired fighters. Shallow by design.
// --------------------------------------------------------------------------

export interface IpRule {
  re: RegExp;
  name: string;
  /** Replacement archetype description fed to the parser instead of the input. */
  archetype: string;
}

const ip = (name: string, re: RegExp, archetype: string): IpRule => ({ name, re, archetype });

export const IP_BLOCKLIST: IpRule[] = [
  ip('Superman', /\bsuperman\b/, 'a flying solar-powered paragon with mighty strength and heroic resolve who protects everyone'),
  ip('Batman', /\bbatman\b/, 'a brilliant tactical night detective in dark armor with gadgets and martial mastery'),
  ip('Spider-Man', /\bspider[- ]?man\b/, 'an agile web-slinging acrobat with quick reflexes and a sharp sense of danger'),
  ip('Wolverine', /\bwolverine\b/, 'a feral clawed brawler with rapid healing and a savage fighting style'),
  ip('Goku', /\bgoku\b/, 'a cheerful martial warrior who fires radiant energy blasts and flies at blinding speed'),
  ip('Vegeta', /\bvegeta\b/, 'a proud martial prince who channels burning energy blasts and never retreats'),
  ip('Naruto', /\bnaruto\b/, 'a quick ninja with wind techniques, shadow tricks, and boundless resolve'),
  ip('Sasuke', /\bsasuke\b/, 'a brooding lightning swordsman ninja with piercing perception'),
  ip('Kakashi', /\bkakashi\b/, 'a masked tactical ninja mentor wielding lightning blade techniques'),
  ip('Luffy', /\bluffy\b/, 'a rubber-limbed brawler pirate captain with stretching strikes and fearless spirit'),
  ip('Ichigo', /\bichigo\b/, 'a spirit swordsman who cleaves with a massive blade and steps between worlds'),
  ip('Saitama', /\bsaitama\b/, 'a deadpan bald martial hero of mighty strength and effortless speed'),
  ip('All Might', /\ball[- ]?might\b/, 'a towering heroic bruiser mentor of mighty strength and booming laughter'),
  ip('Pikachu', /\bpikachu\b/, 'a small quick electric creature that unleashes lightning bolts'),
  ip('Charizard', /\bcharizard\b/, 'a winged fire drake that soars and breathes flame'),
  ip('Mewtwo', /\bmewtwo\b/, 'a cold psychic experiment with telekinetic force and genius intellect'),
  ip('Mario', /\bmario\b/, 'a cheerful leaping brawler who hurls fireballs and never stays down'),
  ip('Luigi', /\bluigi\b/, 'a nervous leaping ghost-hunter with a vacuum gadget and hidden courage'),
  ip('Kirby', /\bkirby\b/, 'a round floating creature that copies powers and swallows attacks'),
  ip('Sonic the Hedgehog', /\bsonic the hedgehog\b|\bhedgehog named sonic\b/, 'a cocky blue speedster beast who runs faster than sound'),
  ip('Master Chief', /\bmaster chief\b/, 'a stoic armored super-soldier in a powered exosuit with energy shields'),
  ip('Kratos', /\bkratos\b/, 'a scarred warrior of mighty strength wielding chained blades and cold fury'),
  ip('Samus', /\bsamus\b/, 'an armored bounty hunter in a powered exosuit with an arm cannon'),
  ip('Mega Man', /\bmega[- ]?man\b/, 'a small blue robot hero with an arm cannon that adapts enemy weapons'),
  ip('Darth Vader', /\bdarth vader\b/, 'an armored dark knight with a burning blade and a choking telekinetic grip'),
  ip('Luke Skywalker', /\bluke skywalker\b/, 'a hopeful blade duelist guided by an unseen mystic force'),
  ip('Yoda', /\byoda\b/, 'a tiny ancient mystic master of telekinesis and acrobatic blade work'),
  ip('Iron Man', /\biron[- ]?man\b/, 'a genius engineer in a flying powered tech armor with repulsor beams'),
  ip('Hulk', /\bhulk\b|\bthe hulk\b/, 'a giant green rage brawler whose strength grows with his anger'),
  ip('Thor Odinson', /\bthor odinson\b|\bthor,? god of thunder\b/, 'a stormcalling warrior with a returning hammer and booming thunder'),
  ip('Captain America', /\bcaptain america\b/, 'a valiant shield-throwing tactician defender who never retreats'),
  ip('Black Panther', /\bblack panther\b/, 'a regal clawed skirmisher in a kinetic-absorbing suit'),
  ip('Doctor Strange', /\bdo?cto?r\.? strange\b/, 'a precise arcane surgeon of shimmering shields and folded space'),
  ip('Thanos', /\bthanos\b/, 'a colossal purple conqueror of mighty strength and cold cosmic ambition'),
  ip('Magneto', /\bmagneto\b/, 'a magnetic master who bends metal and commands the battlefield'),
  ip('Deadpool', /\bdeadpool\b/, 'a wisecracking blade mercenary with rapid healing and terrible manners'),
  ip('Wonder Woman', /\bwonder woman\b/, 'a valiant warrior princess with a lasso, bracers, and mighty strength'),
  ip('Aquaman', /\baquaman\b/, 'a trident-wielding king of the tides who commands the ocean'),
  ip('The Flash', /\bthe flash\b/, 'a scarlet speedster who moves faster than thought'),
  ip('The Joker', /\bthe joker\b/, 'a cackling chaos trickster with gadgets, toxins, and cruel cunning'),
  ip('Harley Quinn', /\bharley quinn\b/, 'a gleeful acrobat brawler with an oversized hammer and zero fear'),
  ip('Green Lantern', /\bgreen lantern\b/, 'a willpower-driven light-construct wielder with a glowing ring'),
  ip('Silver Surfer', /\bsilver surfer\b/, 'a gleaming cosmic herald riding a board of light through the sky'),
  ip('Ghost Rider', /\bghost rider\b/, 'a flaming skull spirit of vengeance with burning chains'),
  ip('Optimus Prime', /\boptimus prime\b/, 'a noble giant robot leader who transforms and stands for the small'),
  ip('Megatron', /\bmegatron\b/, 'a tyrant giant robot warlord with an arm cannon'),
  ip('Godzilla', /\bgodzilla\b/, 'a colossal ancient beast that breathes atomic fire'),
  ip('Sailor Moon', /\bsailor moon\b/, 'a radiant magical guardian who fights with moonlight and love'),
  ip('Harry Potter', /\bharry potter\b/, 'a young wizard duelist with a quick wand and quicker loyalty'),
  ip('Voldemort', /\bvoldemort\b/, 'a serpentine dark wizard of cruel hexes and split shadows'),
  ip('Gandalf', /\bgandalf\b/, 'an ancient wise wizard with staff, blade, and hidden fire'),
  ip('Homelander', /\bhomelander\b/, 'a flying solar-eyed paragon whose smile never reaches his eyes'),
  ip('Omni-Man', /\bomni[- ]?man\b/, 'a mustached flying bruiser of mighty strength and colder loyalties'),
];

// --------------------------------------------------------------------------
// Real-person guard: honorific patterns + tiny celebrity list. Shallow.
// --------------------------------------------------------------------------

export const HONORIFIC_RE =
  /\b(president|senator|prime minister|chancellor|governor|pope)\s+[a-z][a-z'-]+/;

export const CELEBRITIES: string[] = [
  'elon musk', 'jeff bezos', 'taylor swift', 'beyonce', 'kanye west', 'lebron james',
  'cristiano ronaldo', 'lionel messi', 'tom cruise', 'dwayne johnson', 'mrbeast',
  'kim kardashian', 'donald trump', 'joe biden', 'barack obama', 'mark zuckerberg',
];

export const REAL_PERSON_ARCHETYPE =
  'a charismatic arena champion, a tactical leader with commanding presence and quick wit';

// --------------------------------------------------------------------------
// Color words (visual corrections + description-driven palettes)
// --------------------------------------------------------------------------

export const COLOR_WORDS: Record<string, string> = {
  red: '#c0392b', crimson: '#a71d31', scarlet: '#b7222e',
  orange: '#d9702a', amber: '#d99a2a',
  yellow: '#d9c22a', gold: '#c9a227', golden: '#c9a227',
  green: '#3f8f4a', emerald: '#2e8b57', jade: '#3aa17e',
  blue: '#2b6cb0', azure: '#3390cc', cobalt: '#2450a4', navy: '#1f3a5f', cyan: '#28a5a5', teal: '#2a8d8d',
  purple: '#7a4fd0', violet: '#8a2be2', magenta: '#b03aa0', pink: '#d06090',
  black: '#1d1d24', white: '#e8e8ee', grey: '#8a8f98', gray: '#8a8f98',
  silver: '#aab4bf', bronze: '#a9743c', copper: '#b06c3f', brown: '#7a5230',
};

// --------------------------------------------------------------------------
// Behavior constraint cues
// --------------------------------------------------------------------------

export const CONSTRAINT_CUES: { re: RegExp; constraint: string }[] = [
  { re: /\bnever (retreats?|runs away|backs down)\b/, constraint: 'never_retreats' },
  { re: /\b(never abandons?|always protects?|dies for) (his |her |their )?(allies|team|friends)\b/, constraint: 'never_abandons_allies' },
  { re: /\b(pacifist|never kills?|no killing|refuses to kill|non-?lethal)\b/, constraint: 'avoids_lethal_force' },
  { re: /\breckless\b/, constraint: 'reckless' },
  { re: /\b(hunts?|seeks?) (the )?strongest\b/, constraint: 'hunts_strongest' },
  { re: /\b(protects? the captain|bodyguard)\b/, constraint: 'protects_captain' },
];

export const NAME_EPITHETS = ['Warden', 'Herald', 'Vane', 'Ronin', 'Sovereign', 'Harrow', 'Keeper', 'Strider', 'March', 'Reverie'];
