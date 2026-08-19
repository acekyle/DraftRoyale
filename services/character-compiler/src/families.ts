/**
 * Power-family taxonomy. Each family carries a full authored ability kit
 * (foundational jab, four signature archetypes, escalation), a palette, an
 * optional custom-resource concept, environment rules, naming pools, and the
 * OPPOSING family used to auto-derive weaknesses.
 */
import type { ConditionSpec, CustomResource, DamageType, EnvRule } from '@arena/contracts';

export interface KitSlot {
  name: string;
  anim: string;
  desc: string;
  effect?: ConditionSpec;
}

export interface FamilyDef {
  key: string;
  label: string;
  keywords: string[];
  damageType: DamageType;
  /** First entry is the primary power tag. */
  tags: string[];
  opposed: string;
  opposedPhrase: string;
  palette: { primary: string; secondary: string; energy: string };
  resource?: Omit<CustomResource, 'max' | 'start' | 'regenPerTick'>;
  /** Context tag gating this family's contextual ability, when one exists. */
  contextGate?: string;
  envRules: EnvRule[];
  names: string[];
  aura: string;
  personality: string;
  powerSource: { name: string; origin: string; dependencies: string[]; interruptionConditions: string[] };
  kit: {
    jab: KitSlot;
    strike: KitSlot;
    burst: KitSlot;
    utility: KitSlot;
    guard: KitSlot;
    dash: KitSlot;
    esc: KitSlot;
    contextual?: KitSlot;
  };
}

const F = (f: FamilyDef): FamilyDef => f;

export const FAMILIES: Record<string, FamilyDef> = {
  fire: F({
    key: 'fire',
    label: 'fire',
    keywords: ['fire', 'flame', 'flames', 'heat', 'inferno', 'lava', 'magma', 'ember', 'pyro', 'burning', 'blaze', 'scorch'],
    damageType: 'thermal',
    tags: ['fire', 'thermal'],
    opposed: 'water',
    opposedPhrase: 'water and cold smother the flame',
    palette: { primary: '#d9502a', secondary: '#3a1f18', energy: '#ffb347' },
    resource: { name: 'ember_heat', drainInContext: { tags: ['water_present'], amount: 0.4 }, onDepletedSuppressTags: ['fire'] },
    envRules: [
      { contextTag: 'water_present', effect: { damageMult: 0.9 }, description: 'Standing water dampens every flame technique.' },
    ],
    names: ['Cinder', 'Ember', 'Pyra', 'Ashfall', 'Brazen', 'Kindle'],
    aura: 'banked coals and drifting sparks',
    personality: 'Runs hot — momentum first, apologies later.',
    powerSource: {
      name: 'ember_heat',
      origin: 'An internal furnace that banks and spends stored combustion',
      dependencies: ['fuel and dry air'],
      interruptionConditions: ['standing water drains the furnace', 'suppression fields choke the burn'],
    },
    kit: {
      jab: { name: 'Cinder Snap', anim: 'quick_ranged_bolt', desc: 'A flicked coal of compressed heat.' },
      strike: { name: 'Flame Lash', anim: 'charged_beam', desc: 'A whip of liquid fire that cracks across mid-range.' },
      burst: { name: 'Pyre Bloom', anim: 'area_detonation', desc: 'A rose of flame that blooms and detonates around the target.', effect: { kind: 'burn', magnitude: 1.5, durationTicks: 10 } },
      utility: { name: 'Smokeblind', anim: 'control_cloud', desc: 'A gout of choking smoke that steals the enemy’s aim.', effect: { kind: 'blind', magnitude: 0.15, durationTicks: 10 } },
      guard: { name: 'Heatshield Veil', anim: 'barrier_raise', desc: 'A shimmering curtain of superheated air that eats incoming fire.' },
      dash: { name: 'Ashstep', anim: 'dash_trail', desc: 'A burst of motion that leaves only settling ash where they stood.' },
      esc: { name: 'Ragestorm Pyre', anim: 'finisher_conflagration', desc: 'Everything held back, spent at once — a roaring pillar of flame.', effect: { kind: 'burn', magnitude: 2, durationTicks: 12 } },
    },
  }),
  water: F({
    key: 'water',
    label: 'water',
    keywords: ['water', 'hydro', 'ice', 'frost', 'tide', 'wave', 'ocean', 'rain', 'glacier', 'aqua', 'snow', 'blizzard'],
    damageType: 'kinetic',
    tags: ['hydro', 'water', 'ice'],
    opposed: 'lightning',
    opposedPhrase: 'current conducts — lightning rides the water home',
    palette: { primary: '#2b7bb5', secondary: '#0f2f45', energy: '#8fd7ff' },
    resource: { name: 'tide_charge', regenRequiresContext: ['water_present'], onDepletedSuppressTags: ['hydro'] },
    contextGate: 'water_present',
    envRules: [
      { contextTag: 'water_present', effect: { resourceRegenMult: 1.5, speedMult: 1.1 }, description: 'Open water feeds the tide and carries them faster.' },
    ],
    names: ['Riptide', 'Brine', 'Maren', 'Glacia', 'Undertow', 'Sleet'],
    aura: 'cold mist and slow-orbiting droplets',
    personality: 'Patient as a tide chart; commits only when the current favors it.',
    powerSource: {
      name: 'tide_charge',
      origin: 'Hydrokinetic reserve drawn from ambient moisture',
      dependencies: ['nearby water to draw on'],
      interruptionConditions: ['dry arenas starve the reserve', 'electrified water turns the gift against them'],
    },
    kit: {
      jab: { name: 'Spray Cut', anim: 'quick_ranged_bolt', desc: 'A pressurized needle of water, quick as a blink.' },
      strike: { name: 'Breaker Ram', anim: 'charged_wave', desc: 'A battering fist of sea-water that arrives like a closing door.' },
      burst: { name: 'Rimefall', anim: 'area_frost', desc: 'A crash of freezing spray that leaves the ground glassy.', effect: { kind: 'slow', magnitude: 0.3, durationTicks: 10 } },
      utility: { name: 'Undertow Coil', anim: 'control_pull', desc: 'A ring of dragging current that will not let go of ankles.', effect: { kind: 'root', magnitude: 0, durationTicks: 6 } },
      guard: { name: 'Tidewall', anim: 'barrier_raise', desc: 'A standing wave held in place, absorbing whatever tries to pass.' },
      dash: { name: 'Currentride', anim: 'dash_trail', desc: 'They collapse into water and reform a heartbeat down-current.' },
      esc: { name: 'Drowning Bell', anim: 'finisher_deluge', desc: 'The arena tilts underwater for one terrible breath.', effect: { kind: 'slow', magnitude: 0.3, durationTicks: 12 } },
      contextual: { name: 'Springtide Surge', anim: 'context_surge', desc: 'With open water at hand, the tide answers in force.' },
    },
  }),
  lightning: F({
    key: 'lightning',
    label: 'lightning',
    keywords: ['lightning', 'electric', 'electricity', 'storm', 'thunder', 'volt', 'shock', 'static', 'spark'],
    damageType: 'energy',
    tags: ['lightning', 'electric', 'storm'],
    opposed: 'stone',
    opposedPhrase: 'earth grounds the charge harmlessly away',
    palette: { primary: '#3f6fd8', secondary: '#141b33', energy: '#ffe94a' },
    resource: { name: 'static_charge', onDepletedSuppressTags: ['lightning'] },
    envRules: [
      { contextTag: 'water_present', effect: { damageMult: 1.1 }, description: 'Standing water conducts — every arc bites harder.' },
    ],
    names: ['Voltra', 'Arcline', 'Stormcall', 'Fulgur', 'Jolt', 'Tempest'],
    aura: 'crawling static and hair-thin arcs',
    personality: 'Impatient, staccato, always half a thought ahead of its own feet.',
    powerSource: {
      name: 'static_charge',
      origin: 'A bioelectric capacitor charged by motion',
      dependencies: ['room to keep moving'],
      interruptionConditions: ['grounding contact bleeds the charge', 'insulated opponents blunt the arcs'],
    },
    kit: {
      jab: { name: 'Static Jab', anim: 'quick_ranged_bolt', desc: 'A snapped spark across the gap between two fighters.' },
      strike: { name: 'Arc Lance', anim: 'charged_beam', desc: 'A forked line of white current that refuses to miss by much.' },
      burst: { name: 'Thunder Clap', anim: 'area_detonation', desc: 'A dome of thunder that leaves ears ringing and knees loose.', effect: { kind: 'stagger', magnitude: 0, durationTicks: 4 } },
      utility: { name: 'Galvanic Cage', anim: 'control_cage', desc: 'A lattice of live current that locks the target mid-stride.', effect: { kind: 'stagger', magnitude: 0, durationTicks: 6 } },
      guard: { name: 'Faraday Shell', anim: 'barrier_raise', desc: 'A crackling shell that grounds incoming punishment into the floor.' },
      dash: { name: 'Stepline Flash', anim: 'dash_blink', desc: 'They arrive before the afterimage finishes leaving.' },
      esc: { name: 'Stormbreak Column', anim: 'finisher_storm', desc: 'The sky files a complaint directly on top of the enemy team.', effect: { kind: 'stagger', magnitude: 0, durationTicks: 6 } },
    },
  }),
  stone: F({
    key: 'stone',
    label: 'stone',
    keywords: ['stone', 'earth', 'rock', 'metal', 'iron', 'steel', 'granite', 'seismic', 'earthquake', 'mountain', 'crystal'],
    damageType: 'kinetic',
    tags: ['stone', 'earth', 'seismic'],
    opposed: 'sonic',
    opposedPhrase: 'resonant frequencies shake stone apart from within',
    palette: { primary: '#8a7a5c', secondary: '#3b332a', energy: '#d9c48f' },
    envRules: [],
    names: ['Bastion', 'Terran', 'Gravel', 'Orebound', 'Monolith', 'Cairn'],
    aura: 'slow-orbiting gravel and settling dust',
    personality: 'Unhurried and immovable; treats every exchange like weather to be outlasted.',
    powerSource: {
      name: 'geokinesis',
      origin: 'Communion with bedrock — the arena floor is an extension of their body',
      dependencies: ['contact with earth or stone'],
      interruptionConditions: ['resonant attacks crack their armor faster than force ever could'],
    },
    kit: {
      jab: { name: 'Shard Toss', anim: 'quick_ranged_bolt', desc: 'A fist-sized stone, delivered with insulting accuracy.' },
      strike: { name: 'Fault Hammer', anim: 'heavy_slam', desc: 'A pillar of rock punched up from beneath the target’s feet.' },
      burst: { name: 'Quake Ring', anim: 'area_quake', desc: 'A shockwave through the floor that staggers everything standing on it.', effect: { kind: 'stagger', magnitude: 0, durationTicks: 4 } },
      utility: { name: 'Gravebind', anim: 'control_bind', desc: 'Stone hands close around the target’s boots and squeeze.', effect: { kind: 'root', magnitude: 0, durationTicks: 8 } },
      guard: { name: 'Bulwark Raise', anim: 'barrier_raise', desc: 'A slab of bedrock hauled upright between them and the problem.' },
      dash: { name: 'Landslide Step', anim: 'dash_trail', desc: 'They ride a wave of churning ground across the arena.' },
      esc: { name: 'Continental Verdict', anim: 'finisher_quake', desc: 'The arena floor is briefly reorganized, opinions of those standing on it notwithstanding.', effect: { kind: 'root', magnitude: 0, durationTicks: 8 } },
    },
  }),
  wind: F({
    key: 'wind',
    label: 'wind',
    keywords: ['wind', 'air', 'gale', 'cyclone', 'tornado', 'breeze', 'aero', 'zephyr', 'hurricane'],
    damageType: 'kinetic',
    tags: ['wind', 'air'],
    opposed: 'stone',
    opposedPhrase: 'weight and stone shrug off what the wind can carry',
    palette: { primary: '#7fb8a4', secondary: '#2b4a42', energy: '#dffcf0' },
    envRules: [],
    names: ['Zephra', 'Galewynn', 'Sirocco', 'Kestrel', 'Aria', 'Squall'],
    aura: 'a private breeze that never quite settles',
    personality: 'Light-footed and needling — never where the last hit landed.',
    powerSource: {
      name: 'aerokinesis',
      origin: 'Command of pressure and moving air',
      dependencies: ['open air'],
      interruptionConditions: ['enclosed dead air leaves little to work with'],
    },
    kit: {
      jab: { name: 'Razor Draft', anim: 'quick_ranged_bolt', desc: 'A sliver of hardened air, thin as a paper cut.' },
      strike: { name: 'Spear of the Gale', anim: 'charged_beam', desc: 'A compressed lance of storm-front pressure.' },
      burst: { name: 'Cyclone Burst', anim: 'area_vortex', desc: 'A sudden vortex that batters everyone caught in the bowl.', effect: { kind: 'slow', magnitude: 0.25, durationTicks: 8 } },
      utility: { name: 'Stolen Breath', anim: 'control_vacuum', desc: 'The air around the target briefly declines to be breathed.', effect: { kind: 'slow', magnitude: 0.25, durationTicks: 10 } },
      guard: { name: 'Veil of Currents', anim: 'barrier_raise', desc: 'Layered crosswinds that shove incoming blows off-line.' },
      dash: { name: 'Tailwind Rush', anim: 'dash_trail', desc: 'The wind decides where they are next, and it decides quickly.' },
      esc: { name: 'Eye of the Hurricane', anim: 'finisher_storm', desc: 'For a few seconds the arena has weather, and the weather has opinions.', effect: { kind: 'slow', magnitude: 0.25, durationTicks: 10 } },
    },
  }),
  light: F({
    key: 'light',
    label: 'light',
    keywords: ['light', 'solar', 'holy', 'radiant', 'sun', 'photon', 'dawn', 'lumen', 'prism', 'halo'],
    damageType: 'energy',
    tags: ['solar', 'light', 'energy'],
    opposed: 'shadow',
    opposedPhrase: 'darkness starves the light at its source',
    palette: { primary: '#f5b93c', secondary: '#5c4614', energy: '#fff3c4' },
    resource: { name: 'radiance', regenRequiresContext: ['daylight'], drainInContext: { tags: ['darkness'], amount: 0.3 }, onDepletedSuppressTags: ['solar'] },
    contextGate: 'daylight',
    envRules: [
      { contextTag: 'daylight', effect: { resourceRegenMult: 1.5 }, description: 'Open daylight refills the radiance reserve.' },
      { contextTag: 'darkness', effect: { resourceRegenMult: 0, damageMult: 0.85 }, description: 'Darkness halts recharge and dims their output.' },
    ],
    names: ['Lumen', 'Auriel', 'Dawnward', 'Sunhart', 'Halcyon', 'Prisma'],
    aura: 'a soft corona and drifting motes of gold',
    personality: 'Steady, exacting, quietly certain the light is on their side.',
    powerSource: {
      name: 'radiance',
      origin: 'Stored sunlight metabolized into hard light',
      dependencies: ['daylight for recharge'],
      interruptionConditions: ['darkness halts recharge and slowly drains the reserve'],
    },
    kit: {
      jab: { name: 'Glint Dart', anim: 'quick_ranged_bolt', desc: 'A needle of focused light, gone before the eye admits it.' },
      strike: { name: 'Dawn Lance', anim: 'charged_beam', desc: 'A held beam of fused daylight that crosses the arena in a blink.' },
      burst: { name: 'Halo Flare', anim: 'area_flare', desc: 'A detonating ring of brilliance that scorches and dazzles.', effect: { kind: 'blind', magnitude: 0.2, durationTicks: 12 } },
      utility: { name: 'Blinding Writ', anim: 'control_flash', desc: 'A verdict of pure glare delivered directly to the retinas.', effect: { kind: 'blind', magnitude: 0.2, durationTicks: 10 } },
      guard: { name: 'Aegis of Noon', anim: 'barrier_raise', desc: 'A hard-light shell with the patience of a long afternoon.' },
      dash: { name: 'Sunstreak', anim: 'dash_trail', desc: 'A line of afterglow is all that marks the crossing.' },
      esc: { name: 'Zenith Judgment', anim: 'finisher_nova', desc: 'Noon arrives early, locally, and at considerable expense to the target.', effect: { kind: 'blind', magnitude: 0.25, durationTicks: 12 } },
      contextual: { name: 'Overcharge Meridian', anim: 'context_overcharge', desc: 'Direct daylight lets them vent raw stellar output in a wide ring.' },
    },
  }),
  shadow: F({
    key: 'shadow',
    label: 'shadow',
    keywords: ['shadow', 'dark', 'darkness', 'void', 'night', 'umbral', 'gloom', 'dusk', 'abyss'],
    damageType: 'magic',
    tags: ['shadow', 'dark', 'void'],
    opposed: 'light',
    opposedPhrase: 'hard light burns the shadow thin',
    palette: { primary: '#4a3a6b', secondary: '#151020', energy: '#9a7bff' },
    resource: { name: 'gloom', drainInContext: { tags: ['daylight'], amount: 0.2 }, onDepletedSuppressTags: ['shadow'] },
    contextGate: 'darkness',
    envRules: [
      { contextTag: 'darkness', effect: { damageMult: 1.1, resourceRegenMult: 1.5 }, description: 'Darkness feeds the gloom and sharpens every strike.' },
      { contextTag: 'daylight', effect: { damageMult: 0.9 }, description: 'Full daylight thins their shadow-stuff.' },
    ],
    names: ['Umbrix', 'Nocturne', 'Vesper', 'Duskren', 'Shade', 'Murk'],
    aura: 'a hem of darkness that moves half a beat late',
    personality: 'Speaks rarely, strikes from the blind side, keeps its debts in the dark.',
    powerSource: {
      name: 'gloom',
      origin: 'A reservoir of living shadow that pools where light forgets to look',
      dependencies: ['shade to draw on'],
      interruptionConditions: ['hard daylight burns the reservoir down', 'light-tagged attacks disperse shadow constructs'],
    },
    kit: {
      jab: { name: 'Umbral Flick', anim: 'quick_ranged_bolt', desc: 'A sliver of dark that stings like a bad memory.' },
      strike: { name: 'Nightreach Claw', anim: 'charged_reach', desc: 'A taloned hand of shadow unfolds across the gap.' },
      burst: { name: 'Gloomwell', anim: 'area_darkburst', desc: 'A well of cold dark that bursts upward through the target zone.', effect: { kind: 'blind', magnitude: 0.15, durationTicks: 10 } },
      utility: { name: 'Smother Veil', anim: 'control_veil', desc: 'A curtain of dark drawn across the enemy’s eyes.', effect: { kind: 'blind', magnitude: 0.15, durationTicks: 12 } },
      guard: { name: 'Penumbral Shell', anim: 'barrier_raise', desc: 'Layered shadow that swallows blows without comment.' },
      dash: { name: 'Shadowslip', anim: 'dash_blink', desc: 'They step into their own shadow and out of someone else’s.' },
      esc: { name: 'Long Midnight', anim: 'finisher_eclipse', desc: 'The lights go out for everyone except the one holding the dark.', effect: { kind: 'blind', magnitude: 0.2, durationTicks: 14 } },
      contextual: { name: 'Total Umbra', anim: 'context_umbra', desc: 'In true darkness the gloom answers with its whole weight.' },
    },
  }),
  psychic: F({
    key: 'psychic',
    label: 'psychic',
    keywords: ['psychic', 'mind', 'telekinetic', 'telekinesis', 'telepath', 'psionic', 'mental', 'thought'],
    damageType: 'psychic',
    tags: ['psychic', 'mind'],
    opposed: 'sonic',
    opposedPhrase: 'concussive noise scatters the focus everything rests on',
    palette: { primary: '#b06bc4', secondary: '#33203d', energy: '#f0c8ff' },
    resource: { name: 'focus', onDepletedSuppressTags: ['psychic'] },
    envRules: [],
    names: ['Mentara', 'Sibyl', 'Cerebra', 'Innsight', 'Vantage', 'Noema'],
    aura: 'a faint pressure, like being read',
    personality: 'Three moves ahead and mildly disappointed you aren’t.',
    powerSource: {
      name: 'focus',
      origin: 'A trained mind expressing force directly',
      dependencies: ['unbroken concentration'],
      interruptionConditions: ['concussive noise and pain scatter the discipline'],
    },
    kit: {
      jab: { name: 'Thought Pin', anim: 'quick_ranged_bolt', desc: 'A pinprick of directed will, straight to the temple.' },
      strike: { name: 'Kinetic Verdict', anim: 'charged_push', desc: 'A fist of pure intention closes from across the arena.' },
      burst: { name: 'Mindquake', anim: 'area_pulse', desc: 'A pulse of pressure inside every skull in the circle.', effect: { kind: 'slow', magnitude: 0.25, durationTicks: 10 } },
      utility: { name: 'Stillness Decree', anim: 'control_hold', desc: 'The target’s body receives instructions it did not send.', effect: { kind: 'root', magnitude: 0, durationTicks: 6 } },
      guard: { name: 'Willward Sphere', anim: 'barrier_raise', desc: 'A sphere of refusal — violence is simply declined.' },
      dash: { name: 'Farstep', anim: 'dash_blink', desc: 'They stop being here and start being there.' },
      esc: { name: 'Cathedral of One Mind', anim: 'finisher_psi', desc: 'For one long second every enemy thinks with borrowed thoughts.', effect: { kind: 'slow', magnitude: 0.3, durationTicks: 12 } },
    },
  }),
  magic: F({
    key: 'magic',
    label: 'arcane',
    keywords: ['magic', 'arcane', 'witch', 'wizard', 'sorcer', 'spell', 'rune', 'hex', 'occult', 'mystic', 'mage'],
    damageType: 'magic',
    tags: ['magic', 'arcane'],
    opposed: 'tech',
    opposedPhrase: 'cold engineered counter-fields unravel spellwork',
    palette: { primary: '#7a4fd0', secondary: '#241540', energy: '#c9a0ff' },
    resource: { name: 'mana', onDepletedSuppressTags: ['magic'] },
    envRules: [],
    names: ['Hexara', 'Runewell', 'Vell', 'Arcanis', 'Sorrel', 'Glyph'],
    aura: 'slow-turning sigils in violet light',
    personality: 'Theatrical, precise, keeps the best spell for the encore.',
    powerSource: {
      name: 'mana',
      origin: 'A studied arcane reservoir refilled by ritual discipline',
      dependencies: ['intact casting focus'],
      interruptionConditions: ['nullification and counter-fields unravel workings mid-cast'],
    },
    kit: {
      jab: { name: 'Hex Dart', anim: 'quick_ranged_bolt', desc: 'A minor curse with excellent aim.' },
      strike: { name: 'Runeburst Bolt', anim: 'charged_beam', desc: 'A sigil folds shut around the target and objects loudly.' },
      burst: { name: 'Sigil Storm', anim: 'area_sigils', desc: 'Glyphs detonate in sequence across the target zone.', effect: { kind: 'vulnerable', magnitude: 0.15, durationTicks: 10 } },
      utility: { name: 'Binding Clause', anim: 'control_bind', desc: 'The fine print takes physical form around the target’s legs.', effect: { kind: 'root', magnitude: 0, durationTicks: 8 } },
      guard: { name: 'Ward of Ninth Hour', anim: 'barrier_raise', desc: 'A layered ward with a long memory for violence.' },
      dash: { name: 'Fold Step', anim: 'dash_blink', desc: 'Two points in the arena briefly agree to be adjacent.' },
      esc: { name: 'Grand Working', anim: 'finisher_arcana', desc: 'The spell they were saving. It was worth saving.', effect: { kind: 'vulnerable', magnitude: 0.2, durationTicks: 12 } },
    },
  }),
  tech: F({
    key: 'tech',
    label: 'tech',
    keywords: ['tech', 'robot', 'cyber', 'mech', 'android', 'machine', 'drone', 'nano', 'circuit', 'exosuit', 'cyborg', 'automaton'],
    damageType: 'energy',
    tags: ['tech', 'cyber'],
    opposed: 'water',
    opposedPhrase: 'shorted circuits — water finds every seam',
    palette: { primary: '#4d8f8a', secondary: '#16262a', energy: '#5ff2d6' },
    resource: { name: 'capacitor', drainInContext: { tags: ['emp_field'], amount: 0.6 }, onDepletedSuppressTags: ['tech'] },
    envRules: [
      { contextTag: 'emp_field', effect: { suppressTags: ['tech'] }, description: 'Electromagnetic fields shut powered systems down cold.' },
    ],
    names: ['Vectra', 'Cogline', 'Axiom', 'Ferron', 'Servo', 'Lattice'],
    aura: 'status lights and the hum of cooling fans',
    personality: 'Calculates aloud; treats every fight as a diagnostics pass.',
    powerSource: {
      name: 'capacitor',
      origin: 'An onboard power plant feeding servos and emitters',
      dependencies: ['charged capacitor banks'],
      interruptionConditions: ['EMP and magnetic attack drop the whole platform', 'water intrusion shorts exposed systems'],
    },
    kit: {
      jab: { name: 'Coil Shot', anim: 'quick_ranged_bolt', desc: 'A magnetically-flung slug, economical and rude.' },
      strike: { name: 'Railspike', anim: 'charged_beam', desc: 'A hypersonic dart that beats its own sound to the target.' },
      burst: { name: 'Cluster Volley', anim: 'area_barrage', desc: 'A pod of micro-munitions that saturates the grid square.', effect: { kind: 'vulnerable', magnitude: 0.1, durationTicks: 8 } },
      utility: { name: 'Shockstake Net', anim: 'control_net', desc: 'A deployed net of tether-lines that pins the catch.', effect: { kind: 'root', magnitude: 0, durationTicks: 6 } },
      guard: { name: 'Bulwark Protocol', anim: 'barrier_raise', desc: 'Ablative plating snaps into place with a satisfied clunk.' },
      dash: { name: 'Thruster Skate', anim: 'dash_trail', desc: 'Vector thrust converts standing still into somewhere else.' },
      esc: { name: 'Ordnance Zero', anim: 'finisher_barrage', desc: 'The reserve magazine. All of it.', effect: { kind: 'vulnerable', magnitude: 0.15, durationTicks: 10 } },
    },
  }),
  sonic: F({
    key: 'sonic',
    label: 'sonic',
    keywords: ['sonic', 'sound', 'scream', 'sonar', 'echo', 'resonan', 'shriek', 'howl', 'voice', 'wail'],
    damageType: 'sonic',
    tags: ['sonic', 'sound'],
    opposed: 'psychic',
    opposedPhrase: 'a silenced mind gives sound nothing to grip',
    palette: { primary: '#c48a3f', secondary: '#3d2c14', energy: '#ffd98a'  },
    envRules: [],
    names: ['Echo', 'Resonn', 'Clarion', 'Ululo', 'Decibelle', 'Skree'],
    aura: 'visible ripples riding every syllable',
    personality: 'Loud on purpose; silence is just the wind-up.',
    powerSource: {
      name: 'resonance',
      origin: 'A voice and frame tuned to destructive frequencies',
      dependencies: ['intact vocal apparatus'],
      interruptionConditions: ['dampening fields flatten every note'],
    },
    kit: {
      jab: { name: 'Snap Note', anim: 'quick_ranged_bolt', desc: 'A single clipped note that lands like a jab.' },
      strike: { name: 'Shatter Chord', anim: 'charged_wave', desc: 'A focused chord that finds the target’s resonant frequency.' },
      burst: { name: 'Concussion Chorus', anim: 'area_wave', desc: 'A widening ring of pressure that hits like a falling wall.', effect: { kind: 'stagger', magnitude: 0, durationTicks: 4 } },
      utility: { name: 'Deafening Rest', anim: 'control_null', desc: 'A held silence that stuns worse than any noise.', effect: { kind: 'stagger', magnitude: 0, durationTicks: 6 } },
      guard: { name: 'Standing Wave', anim: 'barrier_raise', desc: 'A wall of interference where incoming force cancels itself.' },
      dash: { name: 'Dopplershift', anim: 'dash_trail', desc: 'They arrive with the sound of leaving.' },
      esc: { name: 'Requiem Fortissimo', anim: 'finisher_scream', desc: 'The final movement, performed at structural volume.', effect: { kind: 'stagger', magnitude: 0, durationTicks: 6 } },
    },
  }),
  toxic: F({
    key: 'toxic',
    label: 'toxin',
    keywords: ['toxic', 'poison', 'venom', 'acid', 'plague', 'blight', 'corros', 'toxin', 'viper', 'miasma'],
    damageType: 'toxic',
    tags: ['toxic', 'venom'],
    opposed: 'fire',
    opposedPhrase: 'purging flame burns the toxin clean',
    palette: { primary: '#6fae3f', secondary: '#22330f', energy: '#c2ff5e' },
    envRules: [],
    names: ['Vessk', 'Nightshade', 'Malis', 'Ichor', 'Bane', 'Verdigris'],
    aura: 'a green haze that wilts nearby confidence',
    personality: 'Unbothered and patient — the dose is already working.',
    powerSource: {
      name: 'venom_glands',
      origin: 'A metabolic factory of tailored toxins',
      dependencies: ['time for doses to work'],
      interruptionConditions: ['fire cauterizes delivery systems', 'purging effects flush active doses'],
    },
    kit: {
      jab: { name: 'Spit Needle', anim: 'quick_ranged_bolt', desc: 'A dart of venom, courteous enough to sting first.' },
      strike: { name: 'Fang Lash', anim: 'charged_reach', desc: 'A striking serpent of liquid toxin.' },
      burst: { name: 'Miasma Bloom', anim: 'area_cloud', desc: 'A soft green cloud settles over the zone and gets to work.', effect: { kind: 'corrode', magnitude: 1, durationTicks: 12 } },
      utility: { name: 'Withering Dose', anim: 'control_dose', desc: 'One drop, and the target’s strength files for leave.', effect: { kind: 'corrode', magnitude: 1, durationTicks: 12 } },
      guard: { name: 'Caustic Shell', anim: 'barrier_raise', desc: 'A membrane of acrid film that dissolves what touches it.' },
      dash: { name: 'Serpentine Slip', anim: 'dash_trail', desc: 'They move like something that has never once been caught.' },
      esc: { name: 'Pandemic Waltz', anim: 'finisher_plague', desc: 'Every dose delivered tonight matures at once.', effect: { kind: 'corrode', magnitude: 2, durationTicks: 12 } },
    },
  }),
  spirit: F({
    key: 'spirit',
    label: 'spirit',
    keywords: ['spirit', 'ghost', 'phantom', 'wraith', 'soul', 'specter', 'spectre', 'ancestral', 'seance', 'poltergeist'],
    damageType: 'psychic',
    tags: ['spirit', 'ghost'],
    opposed: 'light',
    opposedPhrase: 'consecrating light banishes what should have moved on',
    palette: { primary: '#8fa8b8', secondary: '#2a3540', energy: '#d8f2ff' },
    envRules: [],
    names: ['Whisper', 'Kaireth', 'Solenne', 'Eidol', 'Mourn', 'Hollow'],
    aura: 'cold air and candle-smoke that bends the wrong way',
    personality: 'Half here, wholly unimpressed by the living’s hurry.',
    powerSource: {
      name: 'anima',
      origin: 'A tether to the quiet side of the veil',
      dependencies: ['an intact tether'],
      interruptionConditions: ['consecrated light frays the tether'],
    },
    kit: {
      jab: { name: 'Chill Touch', anim: 'quick_ranged_bolt', desc: 'A cold fingertip from nowhere in particular.' },
      strike: { name: 'Gravecall Grasp', anim: 'charged_reach', desc: 'Pale hands reach through the floor and take hold.' },
      burst: { name: 'Keening Wake', anim: 'area_wail', desc: 'A funeral note that passes through armor as if invited.', effect: { kind: 'slow', magnitude: 0.2, durationTicks: 10 } },
      utility: { name: 'Haunt Mark', anim: 'control_mark', desc: 'The target is now somewhere haunted. The somewhere is them.', effect: { kind: 'drain', magnitude: 0.5, durationTicks: 10 } },
      guard: { name: 'Veilshroud', anim: 'barrier_raise', desc: 'They go slightly elsewhere; the blow arrives slightly nowhere.' },
      dash: { name: 'Passing Through', anim: 'dash_blink', desc: 'Walls are a strongly-worded suggestion.' },
      esc: { name: 'Hour of the Veil', anim: 'finisher_haunt', desc: 'The veil lifts, and everything behind it looks back.', effect: { kind: 'drain', magnitude: 0.8, durationTicks: 10 } },
    },
  }),
  blade: F({
    key: 'blade',
    label: 'blade',
    keywords: ['blade', 'sword', 'katana', 'saber', 'knife', 'dagger', 'martial', 'swordsman', 'duelist', 'fencer', 'ronin', 'samurai', 'kung fu', 'karate', 'fist'],
    damageType: 'kinetic',
    tags: ['blade', 'martial'],
    opposed: 'stone',
    opposedPhrase: 'stone and heavy plate turn the finest edge',
    palette: { primary: '#9aa3ad', secondary: '#2c3138', energy: '#e8ecf1' },
    envRules: [],
    names: ['Kensei', 'Vael', 'Tessen', 'Morrow', 'Sable', 'Edgewynn'],
    aura: 'the settled stillness of a drawn line',
    personality: 'Economical — one breath, one cut, one opinion.',
    powerSource: {
      name: 'discipline',
      origin: 'Decades of drilled technique; nothing borrowed, nothing owed',
      dependencies: ['room to read the opponent'],
      interruptionConditions: ['heavy armor and stone blunt clean technique'],
    },
    kit: {
      jab: { name: 'Measured Cut', anim: 'quick_melee_cut', desc: 'A test of the distance. The distance fails.' },
      strike: { name: 'Third Form: Rend', anim: 'heavy_slash', desc: 'The form drilled ten thousand times, delivered once.' },
      burst: { name: 'Petal Storm', anim: 'area_slashes', desc: 'A circle of cuts too fast to count, easy to feel.', effect: { kind: 'vulnerable', magnitude: 0.15, durationTicks: 10 } },
      utility: { name: 'Tendon Line', anim: 'control_cut', desc: 'A precise shallow cut that argues with the target’s footwork.', effect: { kind: 'slow', magnitude: 0.25, durationTicks: 10 } },
      guard: { name: 'Perfect Parry Stance', anim: 'stance_guard', desc: 'The blade waits exactly where the future goes.' },
      dash: { name: 'Ghostflicker Advance', anim: 'dash_trail', desc: 'Closing distance is also a technique. Theirs is better.' },
      esc: { name: 'Final Form: Silence', anim: 'finisher_iai', desc: 'The sheathed draw they never show twice.', effect: { kind: 'vulnerable', magnitude: 0.2, durationTicks: 10 } },
    },
  }),
  beast: F({
    key: 'beast',
    label: 'beast',
    keywords: ['beast', 'claw', 'fang', 'feral', 'wolf', 'boar', 'panther', 'tiger', 'lion', 'bear', 'predator', 'primal', 'wild'],
    damageType: 'kinetic',
    tags: ['beast', 'claw', 'feral'],
    opposed: 'fire',
    opposedPhrase: 'flame triggers older instincts than courage',
    palette: { primary: '#a4693c', secondary: '#33200f', energy: '#ffce7a' },
    envRules: [],
    names: ['Ragefang', 'Bristle', 'Karn', 'Howler', 'Tusk', 'Sableclaw'],
    aura: 'raised hackles and low-rolling growl',
    personality: 'Reads fights by smell; negotiates exclusively downhill and at speed.',
    powerSource: {
      name: 'feral_vigor',
      origin: 'Predator physiology running far past factory settings',
      dependencies: ['adrenaline'],
      interruptionConditions: ['open flame panics deep instinct'],
    },
    kit: {
      jab: { name: 'Raking Swipe', anim: 'quick_melee_cut', desc: 'A short, contemptuous rake of claws.' },
      strike: { name: 'Lunge and Lock', anim: 'heavy_pounce', desc: 'The pounce that ends most conversations.' },
      burst: { name: 'Threshing Frenzy', anim: 'area_frenzy', desc: 'A blur of claws with a fighter somewhere inside it.', effect: { kind: 'vulnerable', magnitude: 0.1, durationTicks: 8 } },
      utility: { name: 'Hamstring Bite', anim: 'control_bite', desc: 'A bite placed where running used to happen.', effect: { kind: 'slow', magnitude: 0.3, durationTicks: 10 } },
      guard: { name: 'Bristle Guard', anim: 'stance_guard', desc: 'Hide, muscle, and the promise of consequences.' },
      dash: { name: 'Predator Burst', anim: 'dash_trail', desc: 'Four points of contact and zero warning.' },
      esc: { name: 'Alpha’s Verdict', anim: 'finisher_maul', desc: 'The pack decides, and the pack is one very large animal.', effect: { kind: 'vulnerable', magnitude: 0.15, durationTicks: 10 } },
    },
  }),
};

export const FAMILY_KEYS = Object.keys(FAMILIES);

/** Family-flavored attribute nudges (applied before the soft cap). */
export const FAMILY_ATTR: Record<string, Partial<Record<string, number>>> = {
  fire: { forceOutput: 1 },
  water: { recovery: 1 },
  lightning: { combatSpeed: 1, reactionSpeed: 1 },
  stone: { durability: 2, travelSpeed: -1 },
  wind: { mobility: 1, travelSpeed: 1 },
  light: { precision: 1 },
  shadow: { mobility: 1 },
  psychic: { tacticalIntelligence: 1, perception: 1 },
  magic: { tacticalIntelligence: 1 },
  tech: { precision: 1, tacticalIntelligence: 1 },
  sonic: { forceOutput: 1 },
  toxic: { recovery: 1 },
  spirit: { perception: 1 },
  blade: { combatSkill: 2, precision: 1 },
  beast: { forceOutput: 1, travelSpeed: 1, durability: 1 },
};
