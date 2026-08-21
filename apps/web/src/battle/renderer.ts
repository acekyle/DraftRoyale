/**
 * Battle renderer — thin simulation, thick cinema. Consumes semantic events and
 * interpolated sim state; never influences outcomes. Fighters are sculpted
 * procedural hero meshes (see heroMeshes.ts — the "living collectible" pass);
 * VFX/camera react to the authoritative event stream. The arena reads as a
 * miniature diorama: tiled plaza slab, recessed fountain basin, fluted columns
 * that break to rubble, bench/planter dressing on the outer apron.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { MatchEvent } from '@arena/contracts';
import type { FighterRt, MatchSim } from '@arena/combat-sim';
import { DNA_BY_ID, FILE_BY_ID } from '../content';
import { loadSettings, type Settings } from '../settings';
import {
  buildHeroMesh, poseForIntent, poseHeroMesh, type HeroMeshHandle, type HeroPose,
} from './heroMeshes';

/** Reused per-frame scratch vector — the frame loop must not allocate (perf baseline flag #3). */
const SCRATCH_A = new THREE.Vector3();
const SCRATCH_B = new THREE.Vector3();

interface FighterVisual {
  group: THREE.Group; // outer: position + facing + team ring (stays level)
  hero: HeroMeshHandle; // hero root: KO tilt + joint poses
  ringMat: THREE.MeshBasicMaterial;
  prev: { x: number; z: number; alt: number };
  curr: { x: number; z: number; alt: number };
  lunge: { dx: number; dz: number; t: number } | null;
  flash: number;
  ko: number; // 0..1 fall progress
  label: HTMLDivElement;
  baseY: number;
  bobPhase: number;
  bobAmp: number;
  pose: HeroPose;
  poseT: number; // 1 → 0 pose envelope
  /** Sonic hits vibrate the whole figure briefly (decays to 0). */
  shudder: number;
  /** Last rendered position — drives the movement lean/bank. */
  lastX: number;
  lastZ: number;
  /** Smoothed velocity for the athletic movement lean. */
  velX: number;
  velZ: number;
  /** Heavy-hit knock-down: 0 = none, then 0→1 fall / floor / get-up arc. */
  knockdown: number;
  /** Landing/takeoff squash-and-spring (1 → 0). */
  squash: number;
  /** Rendered altitude last frame — detects flier landings/takeoffs. */
  lastAlt: number;
  /** Smoothed yaw rate — head/tail secondary-motion lag. */
  yawRate: number;
  lastYaw: number;
}

interface Vfx {
  mesh: THREE.Object3D;
  ttl: number;
  age: number;
  update: (v: Vfx, dt: number) => void;
}

interface Projectile {
  mesh: THREE.Object3D;
  targetId: string;
  speed: number;
  /** Damage-type family — drives trail, flight style, and impact. */
  kind: 'tracer' | 'fireball' | 'psychic' | 'sonic' | 'toxic';
  color: THREE.Color;
  /** Seconds until the next trail puff is emitted. */
  trailT: number;
  wobblePhase: number;
}

export class BattleView {
  onGroundClick: ((x: number, z: number) => void) | null = null;

  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private hemi: THREE.HemisphereLight;
  private sun: THREE.DirectionalLight;
  private rimLight: THREE.DirectionalLight;
  private fighters = new Map<string, FighterVisual>();
  private featureMeshes = new Map<string, THREE.Object3D>();
  private wildcardMeshes = new Map<string, THREE.Object3D>();
  private deployableMeshes = new Map<string, THREE.Object3D>();
  private vfx: Vfx[] = [];
  private projectiles: Projectile[] = [];
  private labelLayer: HTMLDivElement;
  private floaters: { div: HTMLDivElement; x: number; z: number; y: number; age: number }[] = [];
  private focus = new THREE.Vector3(0, 0, 0);
  private focusHold = 0;
  private shake = 0;
  /**
   * ringside = low side-on fighting-game framing (default, Founder request
   * 2026-08-21); broadcast = the original raised three-quarter view;
   * tactical = top-down map.
   */
  private cameraMode: 'ringside' | 'broadcast' | 'tactical' = 'ringside';
  /** Which side of the team axis the ringside camera sits on (kept stable). */
  private ringsideSide = 1;
  private placing = false;
  private raycaster = new THREE.Raycaster();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private dark = 0; // 0 = daylight, 1 = eclipse
  private floodMesh: THREE.Mesh | null = null;
  private disposed = false;
  private motion: Settings = loadSettings();

  constructor(private container: HTMLElement, private sim: MatchSim) {
    const w = container.clientWidth, h = container.clientHeight;
    this.camera = new THREE.PerspectiveCamera(46, w / h, 0.1, 400);
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.shadowMap.enabled = true;
    container.appendChild(this.renderer.domElement);

    this.labelLayer = document.createElement('div');
    Object.assign(this.labelLayer.style, {
      position: 'absolute', inset: '0', pointerEvents: 'none', overflow: 'hidden',
    } as CSSStyleDeclaration);
    container.appendChild(this.labelLayer);

    this.scene.background = new THREE.Color(0x0e1526);
    this.scene.fog = new THREE.Fog(0x0e1526, 70, 190);
    // Collectible-diorama lighting: cool key + warm rim + soft ambient bounce.
    // Tuned bright enough that outcome readability never suffers (Art Bible §4).
    this.hemi = new THREE.HemisphereLight(0xbcd2ff, 0x2c2418, 0.85);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xe4eeff, 2.0);
    this.sun.position.set(26, 50, 24);
    this.sun.castShadow = true;
    this.sun.shadow.camera.left = -45; this.sun.shadow.camera.right = 45;
    this.sun.shadow.camera.top = 45; this.sun.shadow.camera.bottom = -45;
    this.scene.add(this.sun);
    this.rimLight = new THREE.DirectionalLight(0xffa661, 1.15);
    this.rimLight.position.set(-30, 34, -42);
    this.scene.add(this.rimLight);

    this.buildArena();
    for (const f of sim.fighters) this.buildFighter(f);
    this.camera.position.set(0, 34, 44);
    this.camera.lookAt(0, 0, 0);

    this.renderer.domElement.addEventListener('click', (ev) => this.handleClick(ev));
    window.addEventListener('resize', this.onResize);
  }

  private onResize = () => {
    if (this.disposed) return;
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  // -------------------------------------------------------------------------

  // ---- Meridian Plaza diorama -------------------------------------------

  /** Extra visual apron beyond the mechanical play bounds (dressing lives there). */
  private static APRON = 6;

  /**
   * Procedural plaza tiling, generated on a canvas at runtime (code-only, no
   * external asset): stone tiles with deterministic per-tile tinting, a
   * darker channel band under the fountain, the painted play-bound line, and
   * a soft vignette toward the diorama edges.
   */
  private makePlazaTexture(sizeX: number, sizeZ: number): THREE.CanvasTexture | null {
    const pad = BattleView.APRON;
    const worldW = sizeX + pad * 2, worldH = sizeZ + pad * 2;
    const W = 1024, H = Math.round((W * worldH) / worldW);
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const g = canvas.getContext('2d');
    if (!g) return null; // headless edge case — plain material still renders
    const ppu = W / worldW; // pixels per world unit
    const wx = (x: number) => (x + worldW / 2) * ppu;
    const wz = (z: number) => (z + worldH / 2) * ppu;

    g.fillStyle = '#262d40';
    g.fillRect(0, 0, W, H);

    // Stone tiles (4×4 world units), deterministic tint per tile.
    const tile = 4;
    for (let ix = 0; ix < Math.ceil(worldW / tile); ix++) {
      for (let iz = 0; iz < Math.ceil(worldH / tile); iz++) {
        const n = ((ix * 73856093) ^ (iz * 19349663)) >>> 0;
        const v = 44 + (n % 11); // 44..54 brightness band — readability floor (Art Bible §4)
        g.fillStyle = `rgb(${v},${v + 5},${v + 16})`;
        g.fillRect(ix * tile * ppu + 1, iz * tile * ppu + 1, tile * ppu - 2, tile * ppu - 2);
        if (n % 7 === 0) { // occasional cracked tile
          g.strokeStyle = 'rgba(10,12,20,0.55)';
          g.lineWidth = 1.5;
          g.beginPath();
          g.moveTo((ix * tile + 0.6) * ppu, (iz * tile + 0.4) * ppu);
          g.lineTo((ix * tile + 2.2) * ppu, (iz * tile + 2.1) * ppu);
          g.lineTo((ix * tile + 2.9) * ppu, (iz * tile + 3.5) * ppu);
          g.stroke();
        }
      }
    }

    // Flooded fountain channel: darker wet band running east–west + basin pool shadow.
    const water = this.sim.features.find((f) => f.type === 'water');
    if (water) {
      const bandH = 5 * ppu;
      const grad = g.createLinearGradient(0, wz(water.z) - bandH, 0, wz(water.z) + bandH);
      grad.addColorStop(0, 'rgba(20,40,70,0)');
      grad.addColorStop(0.5, 'rgba(18,42,78,0.55)');
      grad.addColorStop(1, 'rgba(20,40,70,0)');
      g.fillStyle = grad;
      g.fillRect(wx(-sizeX / 2), wz(water.z) - bandH, sizeX * ppu, bandH * 2);
      g.fillStyle = 'rgba(8,18,36,0.7)';
      g.beginPath();
      g.ellipse(wx(water.x), wz(water.z), (water.radius + 0.4) * ppu, (water.radius + 0.4) * ppu, 0, 0, Math.PI * 2);
      g.fill();
    }

    // Painted play-bound line (the mechanical wall — always legible).
    g.strokeStyle = 'rgba(245,185,60,0.5)';
    g.lineWidth = Math.max(2, 0.25 * ppu);
    g.strokeRect(wx(-sizeX / 2), wz(-sizeZ / 2), sizeX * ppu, sizeZ * ppu);

    // Vignette toward the diorama edge.
    const vig = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.32, W / 2, H / 2, Math.max(W, H) * 0.62);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(4,6,12,0.72)');
    g.fillStyle = vig;
    g.fillRect(0, 0, W, H);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }

  private buildArena() {
    const { sizeX, sizeZ } = this.sim.arena;
    const pad = BattleView.APRON;

    // Plaza floor (play field + dressing apron) over a diorama slab skirt.
    const tex = this.makePlazaTexture(sizeX, sizeZ);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(sizeX + pad * 2, sizeZ + pad * 2),
      tex
        ? new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, metalness: 0.04 })
        : new THREE.MeshStandardMaterial({ color: 0x232a3c, roughness: 0.92 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    const skirt = new THREE.Mesh(
      new THREE.BoxGeometry(sizeX + pad * 2, 1.1, sizeZ + pad * 2),
      new THREE.MeshStandardMaterial({ color: 0x0c101c, roughness: 0.85, metalness: 0.2 }),
    );
    skirt.position.y = -0.57;
    this.scene.add(skirt);

    // Features: fluted columns, transit wrecks, recessed fountain basin.
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x707c94, roughness: 0.72, flatShading: true });
    const wreckMat = new THREE.MeshStandardMaterial({ color: 0x74553c, roughness: 0.8, metalness: 0.3 });
    for (const feat of this.sim.features) {
      let mesh: THREE.Object3D | null = null;
      if (feat.type === 'pillar') {
        const r = feat.radius;
        const column = new THREE.Mesh(
          new THREE.LatheGeometry(
            [
              [r * 1.2, 0], [r * 1.2, 0.4], [r * 0.86, 0.55], [r * 0.7, 0.75],
              [r * 0.62, 5.9], [r * 0.78, 6.2], [r * 1.02, 6.45], [r * 1.02, 7], [0, 7],
            ].map(([px, py]) => new THREE.Vector2(px, py)),
            9, // low radial count + flat shading ⇒ faceted flutes
          ),
          stoneMat,
        );
        column.position.set(feat.x, 0, feat.z);
        mesh = column;
      } else if (feat.type === 'cover') {
        const wreck = new THREE.Group();
        const hull = new THREE.Mesh(new THREE.BoxGeometry(feat.radius * 2, 1.5, feat.radius * 1.3), wreckMat);
        hull.position.y = 0.85;
        hull.rotation.z = 0.08;
        wreck.add(hull);
        const cab = new THREE.Mesh(new THREE.BoxGeometry(feat.radius * 0.9, 0.8, feat.radius * 1.1), wreckMat);
        cab.position.set(feat.radius * 0.62, 1.75, 0);
        cab.rotation.z = 0.14;
        wreck.add(cab);
        const under = new THREE.Mesh(
          new THREE.BoxGeometry(feat.radius * 1.9, 0.35, feat.radius * 1.2),
          new THREE.MeshStandardMaterial({ color: 0x241b12, roughness: 0.95 }),
        );
        under.position.y = 0.2;
        wreck.add(under);
        wreck.position.set(feat.x, 0, feat.z);
        wreck.rotation.y = 0.4;
        mesh = wreck;
      } else if (feat.type === 'water') {
        // Recessed reflective basin: stone lip + wet wall + mirror-blue pool.
        const basin = new THREE.Group();
        const lip = new THREE.Mesh(new THREE.TorusGeometry(feat.radius + 0.15, 0.26, 8, 40), stoneMat);
        lip.rotation.x = Math.PI / 2;
        lip.position.y = 0.14;
        basin.add(lip);
        const pool = new THREE.Mesh(
          new THREE.CircleGeometry(feat.radius + 0.05, 36),
          new THREE.MeshStandardMaterial({
            color: 0x2b6fa8, emissive: 0x0a2438, emissiveIntensity: 0.5,
            transparent: true, opacity: 0.9, roughness: 0.06, metalness: 0.85,
          }),
        );
        pool.rotation.x = -Math.PI / 2;
        pool.position.y = 0.055;
        basin.add(pool);
        basin.position.set(feat.x, 0, feat.z);
        mesh = basin;
      }
      if (mesh) {
        mesh.traverse((o) => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; } });
        this.scene.add(mesh);
        this.featureMeshes.set(feat.id, mesh);
      }
    }

    this.buildDressing(sizeX, sizeZ);
  }

  /**
   * Bench + planter dressing on the apron ring outside the play bounds,
   * merged into three static meshes (one per material) to keep draw calls low.
   */
  private buildDressing(sizeX: number, sizeZ: number) {
    const woodParts: THREE.BufferGeometry[] = [];
    const stoneParts: THREE.BufferGeometry[] = [];
    const leafParts: THREE.BufferGeometry[] = [];
    const put = (arr: THREE.BufferGeometry[], geo: THREE.BufferGeometry, x: number, y: number, z: number, ry = 0) => {
      const g = geo.clone();
      g.applyMatrix4(new THREE.Matrix4().compose(
        new THREE.Vector3(x, y, z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)),
        new THREE.Vector3(1, 1, 1),
      ));
      arr.push(g);
    };

    const seat = new THREE.BoxGeometry(2.6, 0.14, 0.7);
    const legGeo = new THREE.BoxGeometry(0.16, 0.42, 0.6);
    const bench = (x: number, z: number, ry: number) => {
      put(woodParts, seat, x, 0.48, z, ry);
      const dx = Math.cos(ry), dz = -Math.sin(ry);
      put(stoneParts, legGeo, x - dx * 1.05, 0.21, z - dz * 1.05, ry);
      put(stoneParts, legGeo, x + dx * 1.05, 0.21, z + dz * 1.05, ry);
    };
    const planterBox = new THREE.BoxGeometry(1.5, 0.6, 1.5);
    const bush = new THREE.IcosahedronGeometry(0.62, 0);
    const planter = (x: number, z: number) => {
      put(stoneParts, planterBox, x, 0.3, z);
      put(leafParts, bush, x, 0.95, z, (x * 7 + z * 13) % 3);
    };

    const bz = sizeZ / 2 + 3;
    const bx = sizeX / 2 + 3;
    for (const x of [-16, 0, 16]) {
      bench(x, bz, 0);
      bench(x, -bz, Math.PI);
    }
    for (const z of [-9, 9]) {
      planter(bx, z);
      planter(-bx, z);
    }
    planter(bx - 4, bz - 0.5);
    planter(-(bx - 4), -(bz - 0.5));

    const add = (parts: THREE.BufferGeometry[], mat: THREE.MeshStandardMaterial) => {
      if (!parts.length) return;
      const merged = mergeGeometries(parts);
      if (!merged) return;
      const m = new THREE.Mesh(merged, mat);
      m.castShadow = true;
      m.receiveShadow = true;
      this.scene.add(m);
    };
    add(woodParts, new THREE.MeshStandardMaterial({ color: 0x6b4a2e, roughness: 0.8 }));
    add(stoneParts, new THREE.MeshStandardMaterial({ color: 0x3a4258, roughness: 0.85 }));
    add(leafParts, new THREE.MeshStandardMaterial({ color: 0x2e6b40, roughness: 0.9, flatShading: true }));
  }

  /** Persistent rubble where a destructible feature used to stand. */
  private spawnRubble(feat: { id: string; x: number; z: number; radius: number; type: string }) {
    const rubble = new THREE.Group();
    const mat = feat.type === 'pillar'
      ? new THREE.MeshStandardMaterial({ color: 0x5c6980, roughness: 0.85, flatShading: true })
      : new THREE.MeshStandardMaterial({ color: 0x4a3826, roughness: 0.9, flatShading: true });
    let n = 0;
    for (const ch of feat.id) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
    const chunks = 5;
    for (let i = 0; i < chunks; i++) {
      const a = ((n >> (i * 3)) % 32) / 32 * Math.PI * 2;
      const d = 0.4 + ((n >> (i * 2)) % 16) / 16 * feat.radius * 1.1;
      const r = feat.radius * (0.22 + ((n >> i) % 8) / 8 * 0.2);
      const chunk = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), mat);
      chunk.position.set(feat.x + Math.sin(a) * d, r * 0.7, feat.z + Math.cos(a) * d);
      chunk.rotation.set(a, a * 2.3, a * 0.7);
      chunk.castShadow = true;
      chunk.receiveShadow = true;
      rubble.add(chunk);
    }
    if (feat.type === 'pillar') {
      // Broken stump.
      const stump = new THREE.Mesh(new THREE.CylinderGeometry(feat.radius * 0.62, feat.radius * 0.8, 0.9, 9), mat);
      stump.position.set(feat.x, 0.45, feat.z);
      stump.rotation.y = (n % 7) / 7;
      stump.castShadow = true;
      stump.receiveShadow = true;
      rubble.add(stump);
    }
    this.scene.add(rubble);
  }

  private buildFighter(f: FighterRt) {
    const dna = f.dna;
    const s = dna.identity.scale;
    const group = new THREE.Group();

    // Sculpted hero mesh (shared module — same statue the draft pedestal shows).
    const hero = buildHeroMesh(dna);
    hero.group.scale.setScalar(s);
    group.add(hero.group);
    const baseY = hero.baseY * s;

    // Team indicator ring under the fighter — team color stays distinct from
    // role color (Art Bible §4); it rides the outer group so it never tilts.
    const isTeamA = f.teamId === this.sim.teams[0].playerId;
    const ringMat = new THREE.MeshBasicMaterial({
      color: isTeamA ? 0x4a9dd0 : 0xe0524a, transparent: true, opacity: 0.55, side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.62 * s, 0.76 * s, 26), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.06 - baseY; // rests on the ground at hover height
    group.add(ring);

    group.position.set(f.x, baseY, f.z);
    group.visible = f.status === 'active';
    this.scene.add(group);

    const label = document.createElement('div');
    Object.assign(label.style, {
      position: 'absolute', transform: 'translate(-50%, -100%)', textAlign: 'center',
      fontFamily: "'Rajdhani', sans-serif", fontSize: '11px', letterSpacing: '0.08em',
      color: '#e8ecf6', textShadow: '0 1px 3px #000', whiteSpace: 'nowrap',
    } as CSSStyleDeclaration);
    const teamColor = f.teamId === this.sim.teams[0].playerId ? '#4a9dd0' : '#e0524a';
    label.innerHTML = `<div style="color:${teamColor};font-weight:700">${FILE_BY_ID.get(f.fighterId)?.contract.identity.displayName ?? f.fighterId}</div>
      <div style="width:56px;height:4px;background:#131a2e;border-radius:2px;margin:2px auto"><i style="display:block;height:100%;width:100%;background:linear-gradient(90deg,#58c470,#9be15d);border-radius:2px"></i></div>`;
    this.labelLayer.appendChild(label);

    this.fighters.set(f.fighterId, {
      group, hero, ringMat,
      prev: { x: f.x, z: f.z, alt: f.alt },
      curr: { x: f.x, z: f.z, alt: f.alt },
      lunge: null, flash: 0, ko: 0, label, baseY,
      bobPhase: Math.random() * Math.PI * 2,
      bobAmp: hero.bobAmp,
      pose: 'idle', poseT: 0,
      shudder: 0, lastX: f.x, lastZ: f.z, velX: 0, velZ: 0,
      knockdown: 0, squash: 0, lastAlt: f.alt, yawRate: 0, lastYaw: 0,
    });
  }

  // -------------------------------------------------------------------------
  // Sim sync
  // -------------------------------------------------------------------------

  beforeStep() {
    for (const f of this.sim.fighters) {
      const v = this.fighters.get(f.fighterId);
      if (v) v.prev = { ...v.curr };
    }
  }

  afterStep(events: MatchEvent[]) {
    for (const f of this.sim.fighters) {
      const v = this.fighters.get(f.fighterId);
      if (!v) continue;
      v.curr = { x: f.x, z: f.z, alt: f.alt };
      if (f.status === 'active' && !v.group.visible) {
        v.group.visible = true;
        v.prev = { ...v.curr };
      }
      if ((f.status === 'reserve' || f.status === 'retired') && v.group.visible) v.group.visible = false;
    }
    for (const e of events) this.handleEvent(e);

    // Environment mood.
    const wantDark = this.sim.matchContext.has('darkness') ? 1 : 0;
    this.dark += (wantDark - this.dark) * 0.08;
    this.hemi.intensity = 0.6 - this.dark * 0.44;
    this.sun.intensity = 2.0 - this.dark * 1.7;
    this.rimLight.intensity = 1.15 - this.dark * 0.6;
    (this.scene.background as THREE.Color).setHex(this.dark > 0.5 ? 0x070a14 : 0x0e1526);

    // Flood plane.
    const flooded = this.sim.matchContext.has('water_present');
    if (flooded && !this.floodMesh) {
      this.floodMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(this.sim.arena.sizeX, this.sim.arena.sizeZ),
        new THREE.MeshStandardMaterial({ color: 0x2b6fa8, transparent: true, opacity: 0.5, roughness: 0.15, metalness: 0.5 }),
      );
      this.floodMesh.rotation.x = -Math.PI / 2;
      this.floodMesh.position.y = 0.12;
      this.scene.add(this.floodMesh);
    }

    // Destroyed features.
    for (const feat of this.sim.features) {
      if (feat.destroyed && this.featureMeshes.has(feat.id)) {
        const m = this.featureMeshes.get(feat.id)!;
        this.scene.remove(m);
        this.featureMeshes.delete(feat.id);
        this.spawnRubble(feat); // visible, persistent break state
        this.burst(feat.x, feat.z, 0x8a7a5c, 14);
        this.shake = Math.max(this.shake, 0.5);
      }
    }
    // Wildcard object/field lifecycle.
    for (const inst of this.sim.wildcardInstances) {
      if (!this.wildcardMeshes.has(inst.instanceId) && !inst.destroyed && !inst.expired) {
        const mesh = this.buildWildcardMesh(inst.contract.class, inst.contract.wildcardId, inst.x, inst.z, inst.contract.radius);
        if (mesh) this.wildcardMeshes.set(inst.instanceId, mesh);
      }
      if ((inst.destroyed || inst.expired) && this.wildcardMeshes.has(inst.instanceId)) {
        const m = this.wildcardMeshes.get(inst.instanceId)!;
        this.scene.remove(m);
        this.wildcardMeshes.delete(inst.instanceId);
        if (inst.destroyed) this.burst(inst.x, inst.z, 0x9b6ef3, 16);
      }
    }
    // Deployables.
    for (const d of this.sim.deployables) {
      if (!this.deployableMeshes.has(d.instanceId) && !d.destroyed) {
        const mesh = new THREE.Mesh(
          new THREE.OctahedronGeometry(0.5),
          new THREE.MeshStandardMaterial({ color: 0x58c470, emissive: 0x58c470, emissiveIntensity: 0.9 }),
        );
        mesh.position.set(d.x, 1.2, d.z);
        this.scene.add(mesh);
        this.deployableMeshes.set(d.instanceId, mesh);
      }
      if (d.destroyed && this.deployableMeshes.has(d.instanceId)) {
        this.scene.remove(this.deployableMeshes.get(d.instanceId)!);
        this.deployableMeshes.delete(d.instanceId);
      }
    }
  }

  private handleEvent(e: MatchEvent) {
    const fid = String(e.data.fighterId ?? e.data.attacker ?? '');
    switch (e.type) {
      case 'ABILITY_RESOLVED': {
        const actor = this.fighters.get(String(e.data.fighterId));
        const sf = this.sim.byId(String(e.data.fighterId));
        if (!actor || !sf) break;
        const dna = DNA_BY_ID.get(sf.fighterId);
        const ability = dna
          ? [...dna.capabilities.foundational, ...dna.capabilities.signature, ...dna.capabilities.contextual, dna.capabilities.escalation]
              .find((a) => a.id === e.data.abilityId)
          : undefined;
        const energyColor = new THREE.Color(dna?.presentation.energyColor ?? '#ffffff');
        const targetId = sf.currentTargetId;
        const target = targetId ? this.sim.byId(targetId) : null;
        if (ability?.kind === 'melee' && target) {
          const d = Math.hypot(target.x - sf.x, target.z - sf.z) || 1;
          actor.lunge = { dx: ((target.x - sf.x) / d) * 1.2, dz: ((target.z - sf.z) / d) * 1.2, t: 1 };
          this.swingTrail(sf, target, energyColor);
        } else if ((ability?.kind === 'ranged' || ability?.kind === 'control') && target) {
          if (ability.damageType === 'energy') this.spawnBeam(sf, target, energyColor);
          else this.spawnProjectile(sf, target.fighterId, energyColor, ability.damageType);
        } else if (ability?.kind === 'area') {
          const cx = target?.x ?? sf.x, cz = target?.z ?? sf.z;
          this.ring(cx, cz, ability.radius ?? 4, energyColor.getHex());
          // Area strikes mark the ground: burns burn, the rest glows.
          if (ability.damageType === 'thermal') this.scorch(cx, cz, 0x120a05, Math.min(2.4, (ability.radius ?? 4) * 0.5), false);
          else this.scorch(cx, cz, energyColor.getHex(), Math.min(2, (ability.radius ?? 4) * 0.4));
          this.shake = Math.max(this.shake, 0.35);
        }
        // Authored animation-intent grammar → procedural pose atom.
        actor.pose = poseForIntent(ability?.animationIntent, ability?.kind);
        actor.poseT = 1;
        this.focusOn(sf.x, sf.z, ability && ability.power >= 30 ? 24 : 10);
        break;
      }
      case 'DAMAGE_APPLIED': {
        const victim = this.fighters.get(String(e.data.target));
        const vf = this.sim.byId(String(e.data.target));
        const amount = Number(e.data.amount ?? 0);
        if (victim && vf) {
          victim.flash = 1;
          this.floater(vf.x, vf.z, 2.6, `-${amount}`, amount >= 25 ? '#ff7a5e' : '#ffd166', amount >= 25 ? 17 : 13);
          // Typed hit reaction (render-only; sim positions untouched):
          // psychic reels in place, sonic vibrates, everything else flinches
          // and gets shoved away from the attacker with weight ∝ damage.
          const dtype = String(e.data.damageType ?? '');
          if (vf.status === 'active') {
            victim.pose = 'hit';
            victim.poseT = Math.min(1, 0.55 + amount * 0.012);
            if (dtype === 'sonic') victim.shudder = 0.5;
            const attacker = this.sim.byId(String(e.data.attacker));
            if (attacker && dtype !== 'psychic' && !victim.lunge) {
              const d = Math.hypot(vf.x - attacker.x, vf.z - attacker.z) || 1;
              const mag = Math.min(0.65, 0.22 + amount * 0.011);
              victim.lunge = { dx: ((vf.x - attacker.x) / d) * mag, dz: ((vf.z - attacker.z) / d) * mag, t: 0.65 };
            }
            // Heavy physical hits FLOOR an unguarded grounded fighter: fall,
            // floor beat, get back up (knock-down vs mere knock-back).
            if (
              amount >= 28 && (dtype === 'kinetic' || dtype === 'thermal') &&
              !vf.guarding && vf.alt === 0 && victim.knockdown === 0 && victim.ko === 0 &&
              !this.motion.reducedMotion
            ) {
              victim.knockdown = 0.001;
              this.dust(vf.x, vf.z, 7);
            }
          }
          if (amount >= 25) {
            this.shake = Math.max(this.shake, 0.6);
            this.focusOn(vf.x, vf.z, 20);
          }
        }
        break;
      }
      case 'HEALING_APPLIED': {
        const vf = this.sim.byId(String(e.data.target));
        if (vf) this.floater(vf.x, vf.z, 2.6, `+${e.data.amount}`, '#7ce38b', 13);
        break;
      }
      case 'WEAKNESS_TRIGGERED': {
        const vf = this.sim.byId(String(e.data.fighterId));
        if (vf) {
          this.floater(vf.x, vf.z, 3.3, 'WEAKNESS EXPOSED', '#ff5d55', 13);
          this.focusOn(vf.x, vf.z, 18);
        }
        break;
      }
      case 'STABILITY_BROKEN': {
        const vf = this.sim.byId(String(e.data.fighterId));
        const victim = this.fighters.get(String(e.data.fighterId));
        if (vf) this.burst(vf.x, vf.z, 0xffd166, 8);
        if (victim && vf?.status === 'active') {
          victim.pose = 'stagger'; // doubled over — clearly worse than a hit
          victim.poseT = 1;
          this.shake = Math.max(this.shake, 0.4);
        }
        break;
      }
      case 'ATTACK_EVADED': {
        const vf = this.sim.byId(String(e.data.target));
        if (vf) this.floater(vf.x, vf.z, 2.4, 'evaded', '#9aa5c0', 11);
        break;
      }
      case 'WILDCARD_DEPLOYED': {
        const x = Number(e.data.x ?? 0), z = Number(e.data.z ?? 0);
        this.focusOn(x, z, 34);
        this.shake = Math.max(this.shake, 0.45);
        break;
      }
      case 'RESERVE_ENTERED': {
        const vf = this.sim.byId(String(e.data.fighterId));
        if (vf) {
          this.burst(vf.x, vf.z, 0x4a9dd0, 12);
          this.focusOn(vf.x, vf.z, 22);
        }
        break;
      }
      case 'FIGHTER_KNOCKED_OUT':
      case 'FIGHTER_CONTAINED': {
        const v = this.fighters.get(fid);
        const vf = this.sim.byId(fid);
        if (v && vf) {
          v.ko = 0.001;
          this.burst(vf.x, vf.z, 0xffffff, 18);
          this.focusOn(vf.x, vf.z, 40);
          this.shake = Math.max(this.shake, 0.9);
        }
        break;
      }
    }
  }

  // -------------------------------------------------------------------------
  // VFX helpers
  // -------------------------------------------------------------------------

  /**
   * Damage-type-keyed projectiles (Founder art note 2026-08-21: "dragon ball z
   * type of fire balls and laser shoots… not so much like galactica bullets").
   * energy fires an instant beam via spawnBeam; everything else travels.
   */
  private spawnProjectile(from: FighterRt, targetId: string, color: THREE.Color, damageType?: string) {
    const kind: Projectile['kind'] =
      damageType === 'thermal' ? 'fireball'
      : damageType === 'psychic' ? 'psychic'
      : damageType === 'sonic' ? 'sonic'
      : damageType === 'toxic' ? 'toxic'
      : 'tracer';
    let mesh: THREE.Object3D;
    let speed: number;
    if (kind === 'fireball') {
      const group = new THREE.Group();
      const core = new THREE.Mesh(
        new THREE.SphereGeometry(0.42, 12, 12),
        new THREE.MeshStandardMaterial({ color: 0xfff3c0, emissive: color, emissiveIntensity: 3.2, roughness: 0.4 }),
      );
      const halo = new THREE.Mesh(
        new THREE.SphereGeometry(0.72, 12, 12),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      group.add(core, halo);
      mesh = group;
      speed = 24;
    } else if (kind === 'psychic') {
      mesh = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.3),
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 2.6, roughness: 0.25 }),
      );
      speed = 38;
    } else if (kind === 'sonic') {
      mesh = new THREE.Mesh(
        new THREE.TorusGeometry(0.5, 0.06, 8, 24),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      speed = 30;
    } else if (kind === 'toxic') {
      mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.26, 10, 10),
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.6, roughness: 0.6 }),
      );
      speed = 28;
    } else {
      // kinetic tracer: a motion-stretched bolt, not a floating orb
      mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.09, 0.09, 0.95),
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 2.2 }),
      );
      speed = 60;
    }
    mesh.position.set(from.x, 1.6 + from.alt, from.z);
    this.scene.add(mesh);
    this.projectiles.push({ mesh, targetId, speed, kind, color: color.clone(), trailT: 0, wobblePhase: Math.random() * Math.PI * 2 });
  }

  /** Instant laser beam (energy damage): muzzle→target flash that fades. */
  private spawnBeam(from: FighterRt, to: FighterRt, color: THREE.Color) {
    const a = new THREE.Vector3(from.x, 1.7 + from.alt, from.z);
    const b = new THREE.Vector3(to.x, 1.5 + to.alt, to.z);
    const len = a.distanceTo(b);
    if (len < 0.5) return;
    const mid = a.clone().lerp(b, 0.5);
    const group = new THREE.Group();
    const core = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.07, len, 8, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1 }),
    );
    const sheath = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.22, len, 8, 1, true),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    group.add(core, sheath);
    group.position.copy(mid);
    // Cylinder axis is +Y: orient it along the beam.
    group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    this.scene.add(group);
    const coreMat = core.material as THREE.MeshBasicMaterial;
    const sheathMat = sheath.material as THREE.MeshBasicMaterial;
    this.vfx.push({
      mesh: group, ttl: 0.3, age: 0,
      update: (v) => {
        const fade = 1 - v.age / v.ttl;
        coreMat.opacity = fade;
        sheathMat.opacity = 0.45 * fade;
        group.scale.x = group.scale.z = 0.6 + 0.4 * fade;
      },
    });
    this.burst(to.x, to.z, color.getHex(), 8);
    this.scorch(to.x, to.z, color.getHex(), 0.9); // glowing beam residue
    this.shake = Math.max(this.shake, 0.25);
  }

  /** Short-lived additive trail puff behind fireballs/psychic bolts. */
  private trailPuff(at: THREE.Vector3, color: THREE.Color, size: number, ttl: number, fall = 0) {
    const puff = new THREE.Mesh(
      new THREE.SphereGeometry(size, 8, 8),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    puff.position.copy(at);
    this.scene.add(puff);
    const mat = puff.material as THREE.MeshBasicMaterial;
    this.vfx.push({
      mesh: puff, ttl, age: 0,
      update: (v, dt) => {
        const fade = 1 - v.age / v.ttl;
        mat.opacity = 0.5 * fade;
        puff.scale.setScalar(Math.max(0.05, fade));
        if (fall > 0) puff.position.y -= fall * dt;
      },
    });
  }

  private ring(x: number, z: number, radius: number, color: number) {
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(0.3, 0.6, 32),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.15, z);
    this.scene.add(mesh);
    this.vfx.push({
      mesh, ttl: 0.55, age: 0,
      update: (v, _dt) => {
        const k = v.age / v.ttl;
        v.mesh.scale.setScalar(1 + k * radius * 1.8);
        (v.mesh as THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>).material.opacity = 0.9 * (1 - k);
      },
    });
  }

  /** Ground scorch/residue decals, capped so long matches never accumulate. */
  private decals: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; base: number; ttl: number; age: number }[] = [];
  private scorch(x: number, z: number, color: number, radius: number, additive = true) {
    if (this.motion.reducedMotion) return;
    // additive = glowing residue (energy/psychic); normal = dark burn/stain.
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: additive ? 0.4 : 0.55, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    const mesh = new THREE.Mesh(new THREE.CircleGeometry(radius, 20), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.05 + this.decals.length * 0.0005, z); // tiny y-stagger avoids z-fighting
    this.scene.add(mesh);
    this.decals.push({ mesh, mat, base: mat.opacity, ttl: 9, age: 0 });
    if (this.decals.length > 20) {
      const old = this.decals.shift()!;
      this.scene.remove(old.mesh);
    }
  }

  /** Soft grey dust ring — landings, knock-downs, ground scrapes. */
  private dust(x: number, z: number, count: number) {
    if (this.motion.reducedMotion) return;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.5;
      const mat = new THREE.MeshBasicMaterial({ color: 0x9a917f, transparent: true, opacity: 0.5, depthWrite: false });
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.16 + Math.random() * 0.1, 6, 6), mat);
      mesh.position.set(x + Math.cos(a) * 0.4, 0.25, z + Math.sin(a) * 0.4);
      const vx = Math.cos(a) * (2.2 + Math.random() * 1.4), vz = Math.sin(a) * (2.2 + Math.random() * 1.4);
      this.scene.add(mesh);
      this.vfx.push({
        mesh, ttl: 0.55, age: 0,
        update: (v, dt) => {
          v.mesh.position.x += vx * dt * (1 - v.age / v.ttl);
          v.mesh.position.z += vz * dt * (1 - v.age / v.ttl);
          v.mesh.position.y += dt * 0.5;
          const fade = 1 - v.age / v.ttl;
          mat.opacity = 0.5 * fade;
          v.mesh.scale.setScalar(1 + v.age * 2.4);
        },
      });
    }
  }

  /** Sweeping arc trail for melee swings, in the attacker's energy color. */
  private swingTrail(from: FighterRt, to: FighterRt, color: THREE.Color) {
    if (this.motion.reducedMotion) return;
    const yaw = Math.atan2(to.x - from.x, to.z - from.z);
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.75, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    // Partial ring ≈ the blade's sweep plane, tilted like a diagonal slash.
    const mesh = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.7, 24, 1, 0, Math.PI * 0.75), mat);
    mesh.position.set(from.x, 1.5 + from.alt, from.z);
    mesh.rotation.set(-0.9, yaw, 0.5, 'YXZ');
    this.scene.add(mesh);
    this.vfx.push({
      mesh, ttl: 0.22, age: 0,
      update: (v) => {
        const k = v.age / v.ttl;
        mat.opacity = 0.75 * (1 - k);
        v.mesh.rotation.z = 0.5 - k * 1.6; // the arc sweeps through the slash
        v.mesh.scale.setScalar(1 + k * 0.35);
      },
    });
  }

  private burst(x: number, z: number, color: number, count: number) {
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.14, 0.14, 0.14),
        new THREE.MeshBasicMaterial({ color, transparent: true }),
      );
      mesh.position.set(x, 1.2, z);
      const vx = (Math.random() - 0.5) * 9, vy = Math.random() * 7 + 2, vz = (Math.random() - 0.5) * 9;
      this.scene.add(mesh);
      this.vfx.push({
        mesh, ttl: 0.8, age: 0,
        update: (v, dt) => {
          v.mesh.position.x += vx * dt;
          v.mesh.position.y += (vy - 14 * v.age) * dt;
          v.mesh.position.z += vz * dt;
          (v.mesh as THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>).material.opacity = 1 - v.age / v.ttl;
        },
      });
    }
  }

  private floater(x: number, z: number, y: number, text: string, color: string, size: number) {
    const div = document.createElement('div');
    Object.assign(div.style, {
      position: 'absolute', transform: 'translate(-50%,-50%)', color, fontWeight: '700',
      fontFamily: "'Rajdhani', sans-serif", fontSize: `${size}px`, textShadow: '0 1px 4px #000',
      pointerEvents: 'none', letterSpacing: '0.06em',
    } as CSSStyleDeclaration);
    div.textContent = text;
    this.labelLayer.appendChild(div);
    this.floaters.push({ div, x, z, y, age: 0 });
  }

  private buildWildcardMesh(cls: string, wildcardId: string, x: number, z: number, radius: number): THREE.Object3D | null {
    const colors: Record<string, number> = {
      'nullstone-shard': 0xb08cff, 'emp-spire': 0x5fd4ff, 'hex-dampener': 0xff5da2,
      'gravity-well': 0x8a77ff, 'mirage-veil': 0xd9c9ff, 'aegis-beacon': 0x6fe8a0,
    };
    const color = colors[wildcardId] ?? 0x9b6ef3;
    const group = new THREE.Group();
    if (cls === 'object') {
      const spike = new THREE.Mesh(
        new THREE.ConeGeometry(0.7, 2.6, 6),
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.8, roughness: 0.3 }),
      );
      spike.position.y = 1.3;
      spike.castShadow = true;
      group.add(spike);
    }
    if (cls === 'object' || cls === 'field') {
      const area = new THREE.Mesh(
        new THREE.CircleGeometry(radius, 40),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.13, side: THREE.DoubleSide }),
      );
      area.rotation.x = -Math.PI / 2;
      area.position.y = 0.08;
      group.add(area);
      const edge = new THREE.Mesh(
        new THREE.RingGeometry(radius - 0.15, radius, 48),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, side: THREE.DoubleSide }),
      );
      edge.rotation.x = -Math.PI / 2;
      edge.position.y = 0.09;
      group.add(edge);
    }
    if (cls === 'condition') return null; // global mood handled via lighting
    group.position.set(x, 0, z);
    this.scene.add(group);
    return group;
  }

  // -------------------------------------------------------------------------
  // Frame loop
  // -------------------------------------------------------------------------

  /** Wall-clock accumulator for the ~60fps render cap. */
  private renderAccumMs = 0;

  frame(dtMs: number, alpha: number) {
    if (this.disposed) return;
    // Render cap: the sim ticks at 4 Hz and interpolation reads identically
    // at 60 fps — drawing at 120 Hz on ProMotion displays is pure heat
    // (flagged by the perf baseline). Accumulate skipped time so animation
    // decay stays wall-clock correct.
    this.renderAccumMs += dtMs;
    if (this.renderAccumMs < 15.5) return;
    const dt = Math.min(0.05, this.renderAccumMs / 1000);
    this.renderAccumMs = 0;

    for (const [id, v] of this.fighters) {
      const sf = this.sim.byId(id);
      if (!sf) continue;
      const x = v.prev.x + (v.curr.x - v.prev.x) * alpha;
      const z = v.prev.z + (v.curr.z - v.prev.z) * alpha;
      const alt = v.prev.alt + (v.curr.alt - v.prev.alt) * alpha;
      v.bobPhase += dt * 2.2;
      const bob = this.motion.reducedMotion ? 0 : Math.sin(v.bobPhase) * (alt > 0 ? 0.28 : v.bobAmp);
      let lx = 0, lz = 0, lungeK = 0;
      if (v.lunge) {
        v.lunge.t -= dt * 4;
        if (v.lunge.t <= 0) v.lunge = null;
        else {
          lungeK = Math.sin(v.lunge.t * Math.PI);
          lx = v.lunge.dx * lungeK;
          lz = v.lunge.dz * lungeK;
        }
      }
      if (v.ko > 0 && v.ko < 1) v.ko = Math.min(1, v.ko + dt * 1.6);
      // KO reads as a physical fall: a short launch hop, then an eased slump
      // (the old linear tip-over looked like a toy being laid down).
      const koEase = v.ko * v.ko * (3 - 2 * v.ko);
      const koHop = this.motion.reducedMotion ? 0 : Math.sin(Math.min(1, v.ko * 2.4) * Math.PI) * 0.5 * (1 - koEase);
      // Knock-down arc: fast fall onto the back, a beat on the floor, get up.
      const sstep = (t: number) => { const c = THREE.MathUtils.clamp(t, 0, 1); return c * c * (3 - 2 * c); };
      let kdFall = 0;
      if (v.knockdown > 0 && v.ko === 0) {
        v.knockdown = Math.min(1, v.knockdown + dt / 1.15);
        const kd = v.knockdown;
        kdFall = kd < 0.3 ? sstep(kd / 0.3) : kd < 0.55 ? 1 : 1 - sstep((kd - 0.55) / 0.45);
        if (kd >= 1) v.knockdown = 0;
      }
      const kdRot = -1.3 * kdFall;
      const kdDrop = 0.55 * kdFall;
      // Sonic shudder: brief whole-figure vibration.
      let sx = 0, sz = 0;
      if (v.shudder > 0) {
        v.shudder = Math.max(0, v.shudder - dt * 1.8);
        if (!this.motion.reducedMotion) {
          sx = (Math.random() - 0.5) * v.shudder * 0.16;
          sz = (Math.random() - 0.5) * v.shudder * 0.16;
        }
      }
      // Flier landing/takeoff: dust on touchdown, squash-spring both ways.
      if (!this.motion.reducedMotion && v.ko === 0) {
        if (v.lastAlt > 1.2 && alt < 0.6) { this.dust(x, z, 8); v.squash = 1; }
        else if (v.lastAlt < 0.6 && alt > 1.2) v.squash = 1;
      }
      v.lastAlt = alt;
      if (v.squash > 0) v.squash = Math.max(0, v.squash - dt * 2.2);
      const squashK = Math.sin(v.squash * Math.PI) * 0.14;
      v.hero.group.scale.set(1 + squashK * 0.5, 1 - squashK, 1 + squashK * 0.5);

      v.group.position.set(x + lx + sx, v.baseY + alt + bob + koHop - koEase * 0.6 - kdDrop, z + lz + sz);
      // Athletic movement lean: pitch into travel, bank into turns — fliers
      // hardest (superhero flight), grounded fighters subtly.
      const instVx = (x - v.lastX) / dt, instVz = (z - v.lastZ) / dt;
      v.lastX = x; v.lastZ = z;
      const smooth = Math.min(1, dt * 8);
      v.velX += (instVx - v.velX) * smooth;
      v.velZ += (instVz - v.velZ) * smooth;
      let pitchLean = 0, bankLean = 0;
      if (v.ko === 0 && !this.motion.reducedMotion) {
        const yaw = v.group.rotation.y;
        const fwd = v.velX * Math.sin(yaw) + v.velZ * Math.cos(yaw);
        const side = v.velX * Math.cos(yaw) - v.velZ * Math.sin(yaw);
        const leanF = alt > 0.5 ? 0.075 : 0.038;
        const cap = alt > 0.5 ? 0.4 : 0.16;
        pitchLean = THREE.MathUtils.clamp(fwd * leanF, -cap, cap);
        bankLean = THREE.MathUtils.clamp(-side * leanF * 0.8, -cap * 0.7, cap * 0.7);
      }
      // KO tilt lives on the hero root; the outer group (team ring) stays level.
      v.hero.group.rotation.z = -koEase * Math.PI * 0.45 + bankLean;
      const targetId = sf.currentTargetId;
      const target = targetId ? this.sim.byId(targetId) : null;
      if (target && v.ko === 0) v.group.rotation.y = Math.atan2(target.x - x, target.z - z);

      // Procedural pose: ability intents ramp in/out; KO slumps the rig.
      // Anticipation curve (anti-stiffness pass 2026-08-21): a brief wind-back
      // before the pose snaps in, then a longer settle out.
      let pose = v.pose, poseK = 0;
      if (v.ko > 0) {
        pose = 'ko';
        poseK = Math.min(1, v.ko);
      } else if (kdFall > 0) {
        pose = 'ko'; // prone slump while floored by a knock-down
        poseK = kdFall;
      } else if (v.poseT > 0) {
        v.poseT = Math.max(0, v.poseT - dt * 1.4);
        if (this.motion.reducedMotion) {
          poseK = v.poseT > 0 ? 0.7 : 0; // held pose, no animated sweep
        } else {
          const u = 1 - v.poseT;
          poseK = u < 0.16
            ? -0.4 * (u / 0.16) // anticipation: pull against the pose
            : Math.sin(Math.pow((u - 0.16) / 0.84, 0.75) * Math.PI); // fast in, slow settle
        }
      }
      poseHeroMesh(v.hero.rig, poseK !== 0 ? pose : 'idle', poseK);
      if (poseK === 0 && v.ko === 0 && !this.motion.reducedMotion) {
        // idle life: breathing torso, arm sway, a slow look-around
        const br = Math.sin(v.bobPhase * 0.9);
        const rig = v.hero.rig;
        if (rig.torso) rig.torso.rotation.x += br * 0.022;
        if (rig.armL) rig.armL.rotation.z += br * 0.035;
        if (rig.armR) rig.armR.rotation.z -= br * 0.035;
        if (rig.head) rig.head.rotation.y += Math.sin(v.bobPhase * 0.33) * 0.07;
      }
      // Secondary motion: head and tail lag behind turns, tails trail speed —
      // cloth-and-mass follow-through on the existing joints.
      {
        const yaw = v.group.rotation.y;
        let dYaw = yaw - v.lastYaw;
        dYaw = Math.atan2(Math.sin(dYaw), Math.cos(dYaw));
        v.lastYaw = yaw;
        v.yawRate += (dYaw / Math.max(dt, 1e-4) - v.yawRate) * Math.min(1, dt * 6);
        if (v.ko === 0 && kdFall === 0 && !this.motion.reducedMotion) {
          const rig = v.hero.rig;
          const lag = THREE.MathUtils.clamp(v.yawRate * 0.1, -0.35, 0.35);
          if (rig.head) rig.head.rotation.y -= lag * 0.45;
          if (rig.tail) {
            rig.tail.rotation.y -= lag * 1.5;
            const speedMag = Math.hypot(v.velX, v.velZ);
            rig.tail.rotation.x += Math.min(0.45, speedMag * 0.055); // streams out at speed
          }
        }
      }
      // Lean into melee lunges and travel instead of gliding rigidly;
      // a knock-down rotation overrides the athletic lean while floored.
      v.hero.group.rotation.x = kdFall > 0 ? kdRot : lungeK * 0.16 + pitchLean;
      if (v.hero.rig.hover && !this.motion.reducedMotion) v.hero.rig.hover.rotation.y += dt * 0.9;

      if (v.flash > 0) v.flash = Math.max(0, v.flash - dt * 5);
      v.hero.setFlash(v.flash);
      const opacity = sf.stealthed ? 0.3 : 1;
      v.hero.setGhost(opacity);
      v.ringMat.opacity = 0.55 * opacity;
      if (sf.windup) {
        v.hero.setEnergyPulse(this.motion.reducedMotion ? 0.8 : 0.5 + Math.sin(v.bobPhase * 6) * 0.5);
      } else {
        v.hero.setEnergyPulse(0);
      }

      // Label + health bar.
      if (v.group.visible && sf.status === 'active') {
        const pos = SCRATCH_A.set(x, v.baseY + alt + 3.1 * sf.dna.identity.scale, z).project(this.camera);
        const sx = (pos.x * 0.5 + 0.5) * this.container.clientWidth;
        const sy = (-pos.y * 0.5 + 0.5) * this.container.clientHeight;
        v.label.style.display = pos.z < 1 ? 'block' : 'none';
        v.label.style.left = `${sx}px`;
        v.label.style.top = `${sy}px`;
        const bar = v.label.querySelector('i') as HTMLElement;
        if (bar) bar.style.width = `${Math.max(0, (sf.vitality / sf.dna.resources.vitality) * 100)}%`;
      } else {
        v.label.style.display = 'none';
      }
    }

    // Projectiles — typed flight (trails, wobble, orientation) + typed impact.
    this.projectiles = this.projectiles.filter((p) => {
      const t = this.sim.byId(p.targetId);
      if (!t) { this.scene.remove(p.mesh); return false; }
      const dir = SCRATCH_A.set(t.x, 1.6 + t.alt, t.z).sub(p.mesh.position);
      const dist = dir.length();
      if (dist < 0.8) {
        // Impact reads by type: fireballs detonate and scorch, toxic stains,
        // psychic leaves glow residue, the rest spark.
        if (p.kind === 'fireball') {
          this.burst(t.x, t.z, p.color.getHex(), 18);
          this.ring(t.x, t.z, 2.2, p.color.getHex());
          this.scorch(t.x, t.z, 0x120a05, 1.5, false); // burnt ground
          this.shake = Math.max(this.shake, 0.45);
        } else if (p.kind === 'toxic') {
          this.burst(t.x, t.z, p.color.getHex(), 5);
          this.scorch(t.x, t.z, 0x1c3312, 1.1, false); // lingering puddle
        } else if (p.kind === 'psychic') {
          this.burst(t.x, t.z, p.color.getHex(), 6);
          this.scorch(t.x, t.z, p.color.getHex(), 0.8);
        } else if (p.kind !== 'sonic') {
          this.burst(t.x, t.z, p.color.getHex(), 6);
        }
        this.scene.remove(p.mesh);
        return false;
      }
      dir.normalize();
      p.mesh.position.addScaledVector(dir, Math.min(dist, p.speed * dt));
      if (p.kind === 'psychic') {
        // slight serpentine drift — psychic bolts curve, they don't fly straight
        p.wobblePhase += dt * 10;
        p.mesh.position.y += Math.sin(p.wobblePhase) * dt * 1.6;
        p.mesh.rotation.x += dt * 9;
        p.mesh.rotation.y += dt * 7;
      }
      if (p.kind === 'tracer' || p.kind === 'sonic') {
        // orient along the flight path (tracer bolt length / ring facing)
        SCRATCH_B.copy(p.mesh.position).add(dir);
        p.mesh.lookAt(SCRATCH_B);
        if (p.kind === 'sonic') p.mesh.scale.multiplyScalar(1 + dt * 1.4); // widening wavefront
      }
      p.trailT -= dt;
      if (p.trailT <= 0 && !this.motion.reducedMotion) {
        if (p.kind === 'fireball') { this.trailPuff(p.mesh.position, p.color, 0.34, 0.4); p.trailT = 0.03; }
        else if (p.kind === 'psychic') { this.trailPuff(p.mesh.position, p.color, 0.16, 0.25); p.trailT = 0.045; }
        else if (p.kind === 'toxic') { this.trailPuff(p.mesh.position, p.color, 0.14, 0.5, 2.2); p.trailT = 0.07; }
        else p.trailT = 1e9; // tracers/sonic carry no trail
      }
      return true;
    });

    // VFX.
    this.vfx = this.vfx.filter((v) => {
      v.age += dt;
      if (v.age >= v.ttl) { this.scene.remove(v.mesh); return false; }
      v.update(v, dt);
      return true;
    });

    // Ground decals fade slowly and are hard-capped at spawn.
    this.decals = this.decals.filter((d) => {
      d.age += dt;
      if (d.age >= d.ttl) { this.scene.remove(d.mesh); return false; }
      d.mat.opacity = d.base * (1 - d.age / d.ttl);
      return true;
    });

    // Floaters.
    this.floaters = this.floaters.filter((f) => {
      f.age += dt;
      if (f.age > 1.1) { f.div.remove(); return false; }
      const pos = SCRATCH_A.set(f.x, f.y + f.age * 1.6, f.z).project(this.camera);
      f.div.style.left = `${(pos.x * 0.5 + 0.5) * this.container.clientWidth}px`;
      f.div.style.top = `${(-pos.y * 0.5 + 0.5) * this.container.clientHeight}px`;
      f.div.style.opacity = String(1 - f.age / 1.1);
      return true;
    });

    // Camera.
    this.updateCamera(dt);
    this.renderer.render(this.scene, this.camera);
  }

  private focusOn(x: number, z: number, priority: number) {
    if (priority >= this.focusHold) {
      this.focus.set(x, 0, z);
      this.focusHold = priority;
    }
  }

  private updateCamera(dt: number) {
    this.focusHold = Math.max(0, this.focusHold - dt * 18);
    const active = this.sim.fighters.filter((f) => f.status === 'active');
    let cx = 0, cz = 0, spread = 12;
    if (active.length) {
      cx = active.reduce((s, f) => s + f.x, 0) / active.length;
      cz = active.reduce((s, f) => s + f.z, 0) / active.length;
      spread = Math.max(...active.map((f) => Math.hypot(f.x - cx, f.z - cz)), 8);
    }
    const focusMix = Math.min(1, this.focusHold / 20);
    let tx = cx * (1 - focusMix) + this.focus.x * focusMix;
    let tz = cz * (1 - focusMix) + this.focus.z * focusMix;

    // Framing bias for corner fights: slide the CAMERA toward center so the
    // walls stay out of frame, but keep the look target ON the fight — a
    // biased target pushed edge fights to the frame border and made them
    // read tiny (verified live 2026-08-20).
    const hx = this.sim.arena.sizeX / 2;
    const hz = this.sim.arena.sizeZ / 2;
    const edge = Math.min(1, Math.max(Math.abs(tx) / hx, Math.abs(tz) / hz));
    const pull = 0.25 * edge * edge;

    let desired: THREE.Vector3;
    let look: THREE.Vector3;
    let lerpK = 0.045;
    if (this.cameraMode === 'tactical') {
      desired = new THREE.Vector3(0, 62, 6);
      look = new THREE.Vector3(0, 0, 0);
    } else if (this.cameraMode === 'ringside') {
      // Fighting-game framing: a low camera perpendicular to the team-vs-team
      // axis, so exchanges read side-on like a versus screen.
      const teamA = this.sim.teams[0]?.playerId;
      let ax = 0, az = 0, bx = 0, bz = 0, an = 0, bn = 0;
      for (const f of active) {
        if (f.teamId === teamA) { ax += f.x; az += f.z; an++; }
        else { bx += f.x; bz += f.z; bn++; }
      }
      let axisX = 1, axisZ = 0;
      if (an > 0 && bn > 0) {
        const dx = bx / bn - ax / an, dz = bz / bn - az / an;
        const dl = Math.hypot(dx, dz);
        if (dl > 0.5) { axisX = dx / dl; axisZ = dz / dl; }
      }
      // Perpendicular, on a stable side (flipping mid-fight is nauseating).
      let px = -axisZ, pz = axisX;
      const camSide = (this.camera.position.x - tx) * px + (this.camera.position.z - tz) * pz;
      if (camSide < -2) this.ringsideSide = -1;
      else if (camSide > 2) this.ringsideSide = 1;
      px *= this.ringsideSide; pz *= this.ringsideSide;
      const dist = 11 + spread * 1.15 - focusMix * 3;
      desired = new THREE.Vector3(
        tx * (1 - pull) + px * dist,
        4.6 + spread * 0.38,
        tz * (1 - pull) + pz * dist,
      );
      look = new THREE.Vector3(tx, 2.1, tz);
      lerpK = 0.06;
    } else {
      const dist = 20 + spread * 1.5 - focusMix * 8;
      desired = new THREE.Vector3(tx * (1 - pull), 14 + spread * 0.8, tz * (1 - pull) + dist);
      look = new THREE.Vector3(tx, 1.5, tz);
    }
    this.camera.position.lerp(desired, lerpK);
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 2.4);
      if (this.motion.cameraShake && !this.motion.reducedMotion) {
        this.camera.position.x += (Math.random() - 0.5) * this.shake * 0.7;
        this.camera.position.y += (Math.random() - 0.5) * this.shake * 0.5;
      }
    }
    this.camera.lookAt(look);
  }

  // -------------------------------------------------------------------------

  setTactical(on: boolean) {
    this.cameraMode = on ? 'tactical' : 'ringside';
  }
  setCameraMode(mode: 'ringside' | 'broadcast' | 'tactical') {
    this.cameraMode = mode;
  }
  setPlacing(on: boolean) {
    this.placing = on;
    this.renderer.domElement.style.cursor = on ? 'crosshair' : 'default';
  }

  private handleClick(ev: MouseEvent) {
    if (!this.placing || !this.onGroundClick) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((ev.clientX - rect.left) / rect.width) * 2 - 1,
      -((ev.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(this.groundPlane, hit)) {
      this.onGroundClick(hit.x, hit.z);
    }
  }

  dispose() {
    this.disposed = true;
    window.removeEventListener('resize', this.onResize);
    this.renderer.dispose();
    this.labelLayer.remove();
    this.renderer.domElement.remove();
  }
}
