/**
 * Procedural hero meshes — the "living collectible" pass (Art Bible §1/§5).
 *
 * Four sculpted chassis silhouettes (humanoid / heavy / quadruped / floating)
 * built from lathe + primitive geometry, deterministically varied per fighter
 * (hash of fighterId → proportions, head variant, 1–2 accessories) so the 12
 * Season-0 fighters are tellable apart in black profile. Stylized PBR: primary
 * body, secondary trim/armor, energy emissive accents, cheap backface-shell
 * rim light. No textures, no external assets, presentation-only.
 *
 * Geometry is cached globally (shared across fighters and across the battle
 * renderer + pedestal preview); materials are per-hero so damage flash /
 * stealth ghosting never leaks between fighters.
 *
 * Triangle budget: ~1.9k–2.6k tris per hero (rim shells included) vs ~900 for
 * the old capsule placeholders — inside the ~2-3x target.
 */
import * as THREE from 'three';
import type { Chassis, CombatDNA } from '@arena/contracts';

// ---------------------------------------------------------------------------
// Deterministic per-fighter variation
// ---------------------------------------------------------------------------

/** FNV-1a — stable across engines, no RNG state. */
export function hashFighterId(id: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const bits = (h: number, shift: number, mask: number) => (h >>> shift) & mask;
/** 0..1 from 3 hash bits. */
const frac = (h: number, shift: number) => bits(h, shift, 7) / 7;

// ---------------------------------------------------------------------------
// Geometry cache (never disposed — shared for the whole session)
// ---------------------------------------------------------------------------

const geoCache = new Map<string, THREE.BufferGeometry>();

function geo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geoCache.get(key);
  if (!g) {
    g = make();
    geoCache.set(key, g);
  }
  return g;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

const cylG = (rt: number, rb: number, len: number, seg = 8) =>
  geo(`cyl:${r3(rt)}:${r3(rb)}:${r3(len)}:${seg}`, () => new THREE.CylinderGeometry(rt, rb, len, seg));
const sphG = (r: number, ws = 10, hs = 8) =>
  geo(`sph:${r3(r)}:${ws}:${hs}`, () => new THREE.SphereGeometry(r, ws, hs));
const boxG = (w: number, h: number, d: number) =>
  geo(`box:${r3(w)}:${r3(h)}:${r3(d)}`, () => new THREE.BoxGeometry(w, h, d));
const coneG = (r: number, h: number, seg = 8) =>
  geo(`cone:${r3(r)}:${r3(h)}:${seg}`, () => new THREE.ConeGeometry(r, h, seg));
const torusG = (r: number, tube: number, rs = 6, ts = 20) =>
  geo(`tor:${r3(r)}:${r3(tube)}:${rs}:${ts}`, () => new THREE.TorusGeometry(r, tube, rs, ts));
const octG = (r: number) => geo(`oct:${r3(r)}`, () => new THREE.OctahedronGeometry(r));
const tetG = (r: number) => geo(`tet:${r3(r)}`, () => new THREE.TetrahedronGeometry(r));
const planeG = (w: number, h: number) =>
  geo(`pln:${r3(w)}:${r3(h)}`, () => new THREE.PlaneGeometry(w, h));

/** Lathe from (radius, y) pairs; the sculpted alternative to a capsule. */
function latheG(key: string, pts: [number, number][], seg = 12): THREE.BufferGeometry {
  return geo(`lat:${key}:${seg}`, () =>
    new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg));
}

// ---------------------------------------------------------------------------
// Materials + handle
// ---------------------------------------------------------------------------

interface HeroMats {
  body: THREE.MeshStandardMaterial;
  trim: THREE.MeshStandardMaterial;
  dark: THREE.MeshStandardMaterial;
  energy: THREE.MeshStandardMaterial;
  rim: THREE.MeshBasicMaterial;
}

export type HeroPose = 'idle' | 'attack' | 'cast' | 'guard' | 'ko' | 'hit' | 'stagger';

export interface HeroRig {
  kind: Chassis;
  root: THREE.Group;
  torso: THREE.Group;
  head: THREE.Group | null;
  armL: THREE.Group | null;
  armR: THREE.Group | null;
  legL: THREE.Group | null;
  legR: THREE.Group | null;
  tail: THREE.Group | null;
  /** Levitation ring/shards (floating chassis) — safe to slow-spin when motion is allowed. */
  hover: THREE.Group | null;
}

export interface HeroMeshHandle {
  /** The hero root — position/scale/tilt this; joints are posed via `rig`. */
  group: THREE.Group;
  rig: HeroRig;
  /** Rest height above ground (floating chassis hovers). */
  baseY: number;
  /** Idle bob amplitude at ground level (renderer gates it on reducedMotion). */
  bobAmp: number;
  setFlash(k: number): void;
  setGhost(opacity: number): void;
  setEnergyPulse(k: number): void;
}

const RIM_BASE_OPACITY = 0.16;

function heroMaterials(dna: CombatDNA): HeroMats {
  const primary = new THREE.Color(dna.presentation.primaryColor);
  const secondary = new THREE.Color(dna.presentation.secondaryColor);
  const energy = new THREE.Color(dna.presentation.energyColor);
  return {
    body: new THREE.MeshStandardMaterial({ color: primary, roughness: 0.42, metalness: 0.18 }),
    trim: new THREE.MeshStandardMaterial({ color: secondary, roughness: 0.5, metalness: 0.38 }),
    dark: new THREE.MeshStandardMaterial({
      color: secondary.clone().multiplyScalar(0.45), roughness: 0.65, metalness: 0.2,
    }),
    energy: new THREE.MeshStandardMaterial({
      color: energy, emissive: energy, emissiveIntensity: 1.8, roughness: 0.3,
    }),
    rim: new THREE.MeshBasicMaterial({
      color: energy.clone().lerp(new THREE.Color(0xdfe9ff), 0.45),
      side: THREE.BackSide, transparent: true, opacity: RIM_BASE_OPACITY,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }),
  };
}

// ---------------------------------------------------------------------------
// Build helpers
// ---------------------------------------------------------------------------

interface Ctx {
  m: HeroMats;
  h: number; // fighter hash
  /** Cloned one-off materials (e.g. double-sided cape) that must still follow flash/ghost. */
  extra: THREE.MeshStandardMaterial[];
}

function mesh(parent: THREE.Object3D, g: THREE.BufferGeometry, mat: THREE.Material,
  x = 0, y = 0, z = 0): THREE.Mesh {
  const me = new THREE.Mesh(g, mat);
  me.position.set(x, y, z);
  parent.add(me);
  return me;
}

/** Cheap fresnel-ish rim: a slightly larger additive backface shell. */
function rimShell(target: THREE.Mesh, rim: THREE.MeshBasicMaterial, scale = 1.07) {
  const shell = new THREE.Mesh(target.geometry, rim);
  shell.scale.setScalar(scale);
  shell.userData.rimShell = true;
  target.add(shell);
}

function joint(parent: THREE.Object3D, x: number, y: number, z: number): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

// ---------------------------------------------------------------------------
// Biped (humanoid + heavy): shared skeleton, diverging mass
// ---------------------------------------------------------------------------

function buildBiped(root: THREE.Group, c: Ctx, heavy: boolean): HeroRig {
  const { m, h } = c;
  const bulk = heavy ? 1.42 : 1;
  const hipY = heavy ? 1.1 : 1.22;
  const shoulderW = (heavy ? 0.5 : 0.33) * (0.92 + frac(h, 2) * 0.22);
  const headIdx = bits(h, 5, 0xffff) % 3; // 0 bare+visor · 1 crested helm · 2 hood
  const torsoBulk = bulk * (0.95 + (bits(h, 16, 3) / 3) * 0.1);

  // Torso: lathe silhouette — pelvis, cinched waist, broad chest, shoulder taper.
  const torsoGrp = joint(root, 0, hipY, 0);
  const shH = heavy ? 0.68 : 0.76; // shoulder height above hip
  const profile: [number, number][] = [
    [0.16 * torsoBulk, 0], [0.24 * torsoBulk, 0.06], [0.26 * torsoBulk, 0.14],
    [0.19 * torsoBulk, 0.3], [0.3 * torsoBulk, 0.52], [0.33 * torsoBulk, shH - 0.08],
    [0.15 * torsoBulk, shH + 0.06], [0, shH + 0.08],
  ];
  const torsoMesh = mesh(torsoGrp, latheG(`bip:${heavy ? 'h' : 'u'}:${r3(torsoBulk)}:${r3(shH)}`, profile, 12), m.body);
  torsoMesh.scale.z = 0.78; // chest reads wider than deep
  rimShell(torsoMesh, m.rim, 1.06);

  // Belt + waist energy seam.
  mesh(torsoGrp, cylG(0.21 * torsoBulk, 0.23 * torsoBulk, 0.09, 10), m.dark, 0, 0.2, 0).scale.z = 0.8;
  const seam = mesh(torsoGrp, torusG(0.2 * torsoBulk, 0.014, 5, 18), m.energy, 0, 0.31, 0);
  seam.rotation.x = Math.PI / 2;
  seam.scale.z = 0.8;

  // Chest core (emissive) sits proud of the sternum.
  mesh(torsoGrp, octG(heavy ? 0.09 : 0.07), m.energy, 0, 0.5, 0.26 * torsoBulk);

  if (heavy) {
    // Bulked armor: chest plate, pauldrons.
    const plate = mesh(torsoGrp, boxG(0.62, 0.46, 0.14), m.trim, 0, 0.46, 0.21 * torsoBulk);
    plate.rotation.x = -0.08;
    mesh(torsoGrp, sphG(0.24, 10, 8), m.trim, shoulderW, shH - 0.02, 0);
    mesh(torsoGrp, sphG(0.24, 10, 8), m.trim, -shoulderW, shH - 0.02, 0);
  } else {
    // Shoulder mass + a trim collar bar.
    mesh(torsoGrp, sphG(0.13, 10, 8), m.trim, shoulderW, shH - 0.02, 0);
    mesh(torsoGrp, sphG(0.13, 10, 8), m.trim, -shoulderW, shH - 0.02, 0);
    mesh(torsoGrp, boxG(shoulderW * 2 + 0.1, 0.09, 0.24), m.trim, 0, shH - 0.05, 0);
  }

  // Neck + head (three deterministic variants).
  const neckH = heavy ? 0.04 : 0.1;
  if (!heavy) mesh(torsoGrp, cylG(0.07, 0.08, 0.12, 8), m.dark, 0, shH + 0.08, 0);
  const headGrp = joint(torsoGrp, 0, shH + neckH + 0.1, 0);
  const headR = heavy ? 0.21 : 0.18;
  let headMesh: THREE.Mesh;
  if (headIdx === 2) {
    // Hood: cone shell with a shadowed face and emissive eye bar.
    headMesh = mesh(headGrp, coneG(headR + 0.07, 0.42, 9), m.trim, 0, 0.14, -0.01);
    headMesh.rotation.x = 0.12;
    mesh(headGrp, sphG(headR * 0.78, 9, 7), m.dark, 0, 0.06, 0.05);
    mesh(headGrp, boxG(0.15, 0.035, 0.02), m.energy, 0, 0.08, headR * 0.78 + 0.03);
  } else {
    headMesh = mesh(headGrp, sphG(headR, 12, 9), headIdx === 1 ? m.trim : m.body, 0, 0.12, 0);
    if (headIdx === 1) {
      // Helm brim + crest fin.
      mesh(headGrp, boxG(headR * 2.1, 0.05, headR * 1.6), m.dark, 0, 0.07, 0.03);
      mesh(headGrp, boxG(0.035, 0.16, headR * 1.7), m.trim, 0, 0.26, -0.02);
      mesh(headGrp, boxG(0.16, 0.04, 0.02), m.energy, 0, 0.12, headR + 0.005); // visor slit
    } else {
      // Bare: jaw + full visor band.
      mesh(headGrp, boxG(headR * 1.3, 0.09, headR * 1.1), m.dark, 0, 0.0, 0.02);
      mesh(headGrp, boxG(headR * 1.5, 0.055, 0.03), m.energy, 0, 0.14, headR - 0.02);
    }
  }
  rimShell(headMesh, m.rim, 1.08);

  // Arms: shoulder pivot → upper, elbow, forearm, mitt. Right palm carries energy.
  const armR2 = heavy ? 0.13 : 0.08;
  const buildArm = (side: 1 | -1): THREE.Group => {
    const arm = joint(torsoGrp, side * (shoulderW + 0.06), shH - 0.04, 0);
    mesh(arm, cylG(armR2, armR2 * 0.85, 0.5, 8), m.body, 0, -0.26, 0);
    mesh(arm, sphG(armR2 * 1.05, 8, 6), m.dark, 0, -0.52, 0);
    mesh(arm, cylG(armR2 * 0.8, armR2 * 0.72, 0.42, 8), heavy ? m.trim : m.body, 0, -0.74, 0);
    if (heavy) mesh(arm, boxG(armR2 * 2.6, 0.24, armR2 * 2.6), m.trim, 0, -1.0, 0); // gauntlet
    else mesh(arm, sphG(0.105, 8, 6), m.trim, 0, -1.0, 0); // mitt
    if (side === -1) mesh(arm, sphG(0.055, 8, 6), m.energy, 0, -1.06, 0.05); // energy hand
    // Heroic stance: arms slightly out and back.
    arm.rotation.z = side * (heavy ? 0.3 : 0.17);
    arm.rotation.x = 0.1;
    return arm;
  };
  const armL = buildArm(1);
  const armR = buildArm(-1);

  // Legs: hip pivot → thigh, knee, shin, boot. Wide heroic base.
  const legR2 = heavy ? 0.15 : 0.1;
  const hipX = heavy ? 0.24 : 0.17;
  const buildLeg = (side: 1 | -1): THREE.Group => {
    const leg = joint(root, side * hipX, hipY, 0);
    mesh(leg, cylG(legR2, legR2 * 0.82, hipY * 0.46, 8), m.body, 0, -hipY * 0.24, 0);
    mesh(leg, sphG(legR2 * 0.95, 8, 6), m.dark, 0, -hipY * 0.48, 0);
    mesh(leg, cylG(legR2 * 0.75, legR2 * 0.85, hipY * 0.42, 8), heavy ? m.trim : m.body, 0, -hipY * 0.71, 0);
    mesh(leg, boxG(legR2 * 1.8, 0.1, legR2 * 3.1), m.dark, 0, -hipY + 0.05, legR2 * 0.6); // boot
    leg.rotation.z = side * (heavy ? 0.15 : 0.09);
    return leg;
  };
  const legL = buildLeg(1);
  const legR = buildLeg(-1);

  applyBipedAccessories(torsoGrp, headGrp, c, heavy, shoulderW, shH, headIdx);

  return { kind: heavy ? 'heavy' : 'humanoid', root, torso: torsoGrp, head: headGrp, armL, armR, legL, legR, tail: null, hover: null };
}

function applyBipedAccessories(torso: THREE.Group, head: THREE.Group, c: Ctx,
  heavy: boolean, shoulderW: number, shH: number, headIdx: number) {
  const { m, h } = c;
  const pool = ['cape', 'crest', 'spikes', 'plates'] as const;
  const picks = pickAccessories(h, pool.length);
  for (const idx of picks) {
    switch (pool[idx]) {
      case 'cape': {
        const cape = mesh(torso, planeG(shoulderW * 2 + 0.16, heavy ? 0.9 : 1.1), m.trim, 0, shH - 0.5, -(heavy ? 0.34 : 0.26));
        const capeMat = m.trim.clone(); // planes need DoubleSide; keep the shared trim single-sided
        capeMat.side = THREE.DoubleSide;
        cape.material = capeMat;
        c.extra.push(capeMat);
        cape.rotation.x = 0.16;
        break;
      }
      case 'crest': {
        if (headIdx !== 1) mesh(head, boxG(0.03, 0.2, 0.3), m.trim, 0, 0.3, -0.04); // helmet fin (skip if helm already crested)
        else mesh(torso, boxG(0.03, 0.34, 0.16), m.trim, 0, shH + 0.1, -0.16); // back banner fin
        break;
      }
      case 'spikes': {
        for (const side of [1, -1] as const) {
          const sp = mesh(torso, coneG(0.06, 0.24, 6), m.dark, side * (shoulderW + 0.02), shH + 0.1, 0);
          sp.rotation.z = -side * 0.5;
        }
        break;
      }
      case 'plates': {
        // Thigh/skirt armor plates.
        for (const side of [1, -1] as const) {
          const pl = mesh(torso, boxG(0.16, 0.3, 0.05), m.trim, side * 0.22, 0.02, 0.14);
          pl.rotation.x = -0.2;
          pl.rotation.z = side * 0.18;
        }
        break;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Quadruped: haunches, chest ruff, jawed head, tail — predatory stance
// ---------------------------------------------------------------------------

function buildQuadruped(root: THREE.Group, c: Ctx): HeroRig {
  const { m, h } = c;
  const snout = 0.2 + frac(h, 2) * 0.18;
  const earIdx = bits(h, 5, 0xffff) % 3; // 0 pricked ears · 1 horns · 2 crest ridge
  const bodyY = 0.92;

  const torso = joint(root, 0, bodyY, 0);
  // Body along +Z (facing direction), chest heavier than rump.
  const bodyMesh = mesh(torso, latheG(`quad:${r3(snout)}`, [
    [0.02, 0], [0.3, 0.14], [0.38, 0.5], [0.44, 1.05], [0.4, 1.5], [0.02, 1.7],
  ], 11), m.body);
  bodyMesh.rotation.x = Math.PI / 2; // lathe axis Y → Z (profile runs tail→chest)
  bodyMesh.position.z = -0.85; // center the 0..1.7 span so chest meets the head joint at +0.98
  rimShell(bodyMesh, m.rim, 1.06);

  // Chest ruff mass + haunches.
  const ruff = mesh(torso, sphG(0.42, 10, 8), m.trim, 0, 0.08, 0.62);
  ruff.scale.set(1.05, 0.95, 0.85);
  for (const side of [1, -1] as const) {
    const haunch = mesh(torso, sphG(0.34, 10, 8), m.body, side * 0.2, 0.02, -0.55);
    haunch.scale.set(0.8, 1, 1.1);
  }
  // Spine energy seam.
  mesh(torso, boxG(0.04, 0.03, 1.1), m.energy, 0, 0.42, 0.05);

  // Head: skull + snout + jaw, emissive eyes.
  const head = joint(torso, 0, 0.3, 0.98);
  const skull = mesh(head, sphG(0.24, 11, 8), m.body, 0, 0.02, 0);
  rimShell(skull, m.rim, 1.09);
  mesh(head, boxG(0.2, 0.16, snout + 0.18), m.body, 0, -0.02, 0.22 + snout / 2);
  mesh(head, boxG(0.17, 0.07, snout + 0.1), m.dark, 0, -0.13, 0.2 + snout / 2); // jaw
  for (const side of [1, -1] as const) {
    mesh(head, sphG(0.035, 6, 5), m.energy, side * 0.11, 0.1, 0.19);
    if (earIdx === 0) {
      const ear = mesh(head, coneG(0.06, 0.17, 6), m.trim, side * 0.13, 0.22, -0.05);
      ear.rotation.x = -0.25;
    } else if (earIdx === 1) {
      const horn = mesh(head, coneG(0.05, 0.26, 6), m.trim, side * 0.14, 0.18, 0.02);
      horn.rotation.z = -side * 0.55;
    }
  }
  if (earIdx === 2) mesh(head, boxG(0.035, 0.14, 0.3), m.trim, 0, 0.22, -0.04);

  // Tail — pivot inside the rump mass so the cone emerges from the body.
  const tail = joint(torso, 0, 0.1, -0.68);
  const tailMesh = mesh(tail, coneG(0.07, 0.6, 7), m.body, 0, 0.1, -0.26);
  tailMesh.rotation.x = -Math.PI / 2 - 0.45;

  // Legs: pivots on root; rear pair crouched (predatory stance).
  const mkLeg = (x: number, z: number, rear: boolean): THREE.Group => {
    const leg = joint(root, x, bodyY - 0.05, z);
    mesh(leg, cylG(0.1, 0.08, 0.46, 7), m.body, 0, -0.24, 0);
    mesh(leg, cylG(0.07, 0.08, 0.4, 7), m.dark, 0, -0.64, 0);
    mesh(leg, boxG(0.16, 0.09, 0.22), m.trim, 0, -0.84, 0.04); // paw
    leg.rotation.x = rear ? 0.22 : -0.06;
    return leg;
  };
  const armL = mkLeg(0.27, 0.5, false);
  const armR = mkLeg(-0.27, 0.5, false);
  const legL = mkLeg(0.28, -0.48, true);
  const legR = mkLeg(-0.28, -0.48, true);

  // Accessories: back spikes / tail club / chest plate / shoulder armor.
  const pool = ['backSpikes', 'tailClub', 'chestPlate', 'shoulderArmor'] as const;
  for (const idx of pickAccessories(h, pool.length)) {
    switch (pool[idx]) {
      case 'backSpikes':
        for (let i = 0; i < 4; i++) {
          const sp = mesh(torso, coneG(0.055, 0.2 - i * 0.03, 6), m.trim, 0, 0.42 - i * 0.03, 0.45 - i * 0.34);
          sp.rotation.x = -0.2;
        }
        break;
      case 'tailClub':
        // At the tail cone's apex (cone points down-back from the rump).
        mesh(tail, sphG(0.11, 8, 6), m.trim, 0, -0.06, -0.56);
        break;
      case 'chestPlate':
        mesh(torso, boxG(0.5, 0.34, 0.1), m.trim, 0, -0.06, 0.92).rotation.x = 0.35;
        break;
      case 'shoulderArmor':
        for (const side of [1, -1] as const)
          mesh(torso, sphG(0.18, 8, 6), m.trim, side * 0.34, 0.22, 0.5).scale.y = 0.7;
        break;
    }
  }

  // Predatory forward pitch.
  torso.rotation.x = 0.06;

  return { kind: 'quadruped', root, torso, head, armL, armR, legL, legR, tail, hover: null };
}

// ---------------------------------------------------------------------------
// Floating: levitating core (robed figure or orb-with-mantle) over a hover ring
// ---------------------------------------------------------------------------

function buildFloating(root: THREE.Group, c: Ctx): HeroRig {
  const { m, h } = c;
  const robed = bits(h, 5, 0xffff) % 2 === 0;
  const shardCount = 3 + (bits(h, 7, 3) % 3);

  const torso = joint(root, 0, 0, 0);
  let head: THREE.Group | null = null;
  let armL: THREE.Group | null = null;
  let armR: THREE.Group | null = null;

  if (robed) {
    // Legless robed figure: tapered mantle, hooded head, floating sleeves.
    const mantle = mesh(torso, latheG('float:robe', [
      [0.05, 0], [0.2, 0.18], [0.34, 0.55], [0.31, 0.95], [0.2, 1.18], [0.13, 1.28], [0, 1.3],
    ], 12), m.body, 0, 0.28, 0);
    rimShell(mantle, m.rim, 1.06);
    mesh(torso, torusG(0.24, 0.02, 5, 16), m.energy, 0, 1.18, 0).rotation.x = Math.PI / 2; // collar seam
    mesh(torso, octG(0.08), m.energy, 0, 1.05, 0.24); // chest core

    head = joint(torso, 0, 1.62, 0);
    const hood = mesh(head, coneG(0.22, 0.4, 9), m.trim, 0, 0.06, -0.01);
    hood.rotation.x = 0.14;
    rimShell(hood, m.rim, 1.08);
    mesh(head, sphG(0.13, 9, 7), m.dark, 0, -0.02, 0.05);
    mesh(head, boxG(0.12, 0.03, 0.02), m.energy, 0, 0, 0.16); // eye bar

    const mkSleeve = (side: 1 | -1): THREE.Group => {
      const arm = joint(torso, side * 0.34, 1.12, 0.05);
      const sleeve = mesh(arm, coneG(0.09, 0.44, 8), m.trim, 0, -0.2, 0);
      sleeve.rotation.x = Math.PI; // opens downward
      mesh(arm, sphG(0.07, 8, 6), m.body, 0, -0.46, 0.02);
      if (side === -1) mesh(arm, sphG(0.045, 7, 5), m.energy, 0, -0.52, 0.06);
      arm.rotation.z = side * 0.28;
      arm.rotation.x = -0.15;
      return arm;
    };
    armL = mkSleeve(1);
    armR = mkSleeve(-1);
  } else {
    // Orb core wrapped in a mantle of angled petal-shards.
    const core = mesh(torso, sphG(0.34, 14, 11), m.body, 0, 1.15, 0);
    rimShell(core, m.rim, 1.07);
    mesh(torso, sphG(0.15, 10, 8), m.energy, 0, 1.15, 0.24); // molten eye/core
    mesh(torso, torusG(0.4, 0.025, 5, 20), m.energy, 0, 1.15, 0).rotation.x = 0.5;
    const petals = 5;
    for (let i = 0; i < petals; i++) {
      const a = (i / petals) * Math.PI * 2;
      const p = mesh(torso, coneG(0.11, 0.62, 6), m.trim, Math.sin(a) * 0.26, 0.62, Math.cos(a) * 0.26);
      p.rotation.x = Math.PI + Math.cos(a) * 0.35;
      p.rotation.z = -Math.sin(a) * 0.35;
    }
    head = joint(torso, 0, 1.5, 0);
    mesh(head, coneG(0.1, 0.22, 7), m.trim, 0, 0.06, 0); // crown tip
  }

  // Hover ring + orbiting shards beneath (the levitation source).
  const hover = joint(root, 0, 0.12, 0);
  mesh(hover, torusG(0.48, 0.035, 6, 22), m.energy, 0, 0, 0).rotation.x = Math.PI / 2;
  for (let i = 0; i < shardCount; i++) {
    const a = (i / shardCount) * Math.PI * 2;
    const sh = mesh(hover, tetG(0.09), m.trim, Math.sin(a) * 0.48, -0.02, Math.cos(a) * 0.48);
    sh.rotation.set(a, a * 1.7, 0);
  }

  // Accessory: halo / second ring / crown shards.
  const pool = ['halo', 'ring2', 'crown'] as const;
  for (const idx of pickAccessories(h, pool.length)) {
    switch (pool[idx]) {
      case 'halo':
        if (head) mesh(head, torusG(0.26, 0.018, 5, 18), m.energy, 0, 0.24, -0.06).rotation.x = 0.3;
        break;
      case 'ring2':
        mesh(hover, torusG(0.62, 0.02, 5, 22), m.energy, 0, 0.1, 0).rotation.x = Math.PI / 2;
        break;
      case 'crown':
        if (head) for (const side of [1, -1] as const) {
          const sp = mesh(head, coneG(0.035, 0.16, 5), m.trim, side * 0.15, 0.2, 0);
          sp.rotation.z = -side * 0.4;
        }
        break;
    }
  }

  return { kind: 'floating', root, torso, head, armL, armR, legL: null, legR: null, tail: null, hover };
}

/** Pick 1–2 distinct accessory indices deterministically. */
function pickAccessories(h: number, poolLen: number): number[] {
  const a = bits(h, 8, 0xffff) % poolLen;
  const b = bits(h, 12, 0xffff) % poolLen;
  return bits(h, 20, 1) === 1 && b !== a ? [a, b] : [a];
}

// ---------------------------------------------------------------------------
// Public build
// ---------------------------------------------------------------------------

export function buildHeroMesh(dna: CombatDNA, opts: { rim?: boolean } = {}): HeroMeshHandle {
  const mats = heroMaterials(dna);
  if (opts.rim === false) mats.rim.opacity = 0;
  const ctx: Ctx = { m: mats, h: hashFighterId(dna.identity.fighterId), extra: [] };
  const root = new THREE.Group();

  let rig: HeroRig;
  switch (dna.identity.chassis) {
    case 'heavy': rig = buildBiped(root, ctx, true); break;
    case 'quadruped': rig = buildQuadruped(root, ctx); break;
    case 'floating': rig = buildFloating(root, ctx); break;
    case 'humanoid':
    default: rig = buildBiped(root, ctx, false); break;
  }

  // Shadows on solid meshes; rim shells never cast.
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = !o.userData.rimShell;
      o.receiveShadow = false;
    }
  });

  captureIdle(rig);

  const solidMats = [mats.body, mats.trim, mats.dark, ...ctx.extra];
  const handle: HeroMeshHandle = {
    group: root,
    rig,
    baseY: dna.identity.chassis === 'floating' ? 0.45 : 0,
    bobAmp: dna.identity.chassis === 'floating' ? 0.14 : 0.05,
    setFlash(k: number) {
      for (const mat of solidMats) mat.emissive.setRGB(k * 0.9, k * 0.18, k * 0.12);
    },
    setGhost(opacity: number) {
      for (const mat of solidMats) {
        mat.transparent = opacity < 1;
        mat.opacity = opacity;
      }
      mats.energy.transparent = opacity < 1;
      mats.energy.opacity = opacity;
      mats.rim.opacity = (opts.rim === false ? 0 : RIM_BASE_OPACITY) * opacity;
    },
    setEnergyPulse(k: number) {
      mats.energy.emissiveIntensity = 1.8 + k * 1.6;
    },
  };
  return handle;
}

// ---------------------------------------------------------------------------
// Procedural posing — animation-intent grammar → simple group rotations
// ---------------------------------------------------------------------------

type JointName = 'torso' | 'head' | 'armL' | 'armR' | 'legL' | 'legR' | 'tail';
const JOINTS: JointName[] = ['torso', 'head', 'armL', 'armR', 'legL', 'legR', 'tail'];
type PoseDelta = Partial<Record<JointName, [number, number, number]>>;

function captureIdle(rig: HeroRig) {
  for (const j of JOINTS) {
    const g = rig[j];
    if (g) g.userData.idleRot = { x: g.rotation.x, y: g.rotation.y, z: g.rotation.z };
  }
}

const BIPED_POSES: Record<Exclude<HeroPose, 'idle'>, PoseDelta> = {
  attack: { torso: [0.24, 0, 0], armR: [-1.45, 0, 0.14], armL: [0.35, 0, 0.05], head: [0.08, 0, 0] },
  cast: { torso: [-0.1, 0, 0], armR: [-2.35, 0, -0.1], armL: [0.2, 0, 0.12], head: [-0.14, 0, 0] },
  guard: { torso: [0.12, 0, 0], armL: [-1.0, 0, 0.55], armR: [-0.85, 0, -0.5], head: [0.1, 0, 0] },
  ko: { torso: [0.55, 0, 0.08], head: [0.45, 0, 0.12], armL: [0.5, 0, 0.25], armR: [0.5, 0, -0.25] },
  // Hit reaction: snap back from the blow, arms thrown out for balance.
  hit: { torso: [-0.28, 0, 0.06], head: [-0.3, 0, 0.1], armL: [0.4, 0, 0.5], armR: [0.35, 0, -0.45] },
  // Stability broken: doubled over and scrambling — clearly worse than a hit.
  stagger: { torso: [0.42, 0.25, 0.12], head: [0.3, 0.2, 0], armL: [-0.5, 0, 0.7], armR: [0.6, 0, -0.6], legL: [0.3, 0, 0.1] },
};

const QUAD_POSES: Record<Exclude<HeroPose, 'idle'>, PoseDelta> = {
  attack: { torso: [0.14, 0, 0], head: [0.42, 0, 0], tail: [-0.3, 0, 0], armL: [-0.4, 0, 0], armR: [-0.4, 0, 0] },
  cast: { torso: [-0.1, 0, 0], head: [-0.6, 0, 0], tail: [0.25, 0, 0] },
  guard: { torso: [0.08, 0, 0], head: [0.2, 0, 0], legL: [0.28, 0, 0], legR: [0.28, 0, 0] },
  ko: { torso: [0, 0, 0.45], head: [0.35, 0, 0.2], tail: [0.4, 0, 0] },
  hit: { torso: [-0.18, 0, 0.08], head: [-0.35, 0, 0.15], tail: [0.35, 0, 0], legL: [-0.2, 0, 0] },
  stagger: { torso: [0.12, 0.3, 0.22], head: [0.4, 0.25, 0], tail: [0.5, 0.3, 0], legL: [0.35, 0, 0.15], legR: [-0.25, 0, -0.12] },
};

const FLOAT_POSES: Record<Exclude<HeroPose, 'idle'>, PoseDelta> = {
  attack: { torso: [0.28, 0, 0], armR: [-1.3, 0, 0.15], head: [0.1, 0, 0] },
  cast: { torso: [-0.12, 0, 0], armR: [-2.1, 0, -0.1], armL: [-1.6, 0, 0.2], head: [-0.1, 0, 0] },
  guard: { torso: [-0.05, 0, 0], armL: [-1.1, 0, 0.6], armR: [-1.1, 0, -0.6] },
  ko: { torso: [0.7, 0, 0.15], head: [0.4, 0, 0] },
  hit: { torso: [-0.35, 0, 0.1], head: [-0.25, 0, 0.12], armL: [0.5, 0, 0.4], armR: [0.45, 0, -0.4] },
  stagger: { torso: [0.3, 0.35, 0.25], head: [0.25, 0.3, 0], armL: [-0.7, 0, 0.8], armR: [0.5, 0, -0.7] },
};

/**
 * Apply a pose blended k∈[0,1] over the authored idle stance. Absolute (never
 * accumulates) — call every frame; k=0 or pose='idle' restores the stance.
 */
export function poseHeroMesh(rig: HeroRig, pose: HeroPose, k: number) {
  const table = rig.kind === 'quadruped' ? QUAD_POSES : rig.kind === 'floating' ? FLOAT_POSES : BIPED_POSES;
  const delta = pose === 'idle' ? null : table[pose];
  for (const j of JOINTS) {
    const g = rig[j];
    if (!g) continue;
    const idle = g.userData.idleRot as { x: number; y: number; z: number } | undefined;
    if (!idle) continue;
    const d = delta?.[j];
    g.rotation.set(
      idle.x + (d ? d[0] * k : 0),
      idle.y + (d ? d[1] * k : 0),
      idle.z + (d ? d[2] * k : 0),
    );
  }
}

/**
 * Map an authored animationIntent hint (plus the ability kind as fallback)
 * onto one of the cheap pose atoms.
 */
export function poseForIntent(intent: string | undefined, kind?: string): HeroPose {
  const s = (intent ?? '').toLowerCase();
  if (/(shield|barrier|dome|bulwark|phalanx|guard|veil|wrap|matrix|stance|mantra|stillness|standard|growth|weave|cocoon|halo)/.test(s)) return 'guard';
  if (/(throw|volley|spit|beam|shot|hurl|dart|toss|rain|jet|snap|flick|designate|zap|wave|ripple|howl|toll|burst|spin|step|drone)/.test(s)) return 'cast';
  if (/(slam|stomp|charge|pounce|jab|cut|slash|bite|swipe|rend|strike|flurry|crush|lunge|stab|crescent|ambush|tusk|split|stampede)/.test(s)) return 'attack';
  switch (kind) {
    case 'melee': return 'attack';
    case 'support': return 'guard';
    case 'ranged':
    case 'control':
    case 'area': return 'cast';
  }
  return 'attack';
}
