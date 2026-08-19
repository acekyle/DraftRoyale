/**
 * Battle renderer — thin simulation, thick cinema. Consumes semantic events and
 * interpolated sim state; never influences outcomes. Fighters are stylized
 * procedural chassis (collectible-statue placeholders until the 3D pipeline
 * phase); VFX/camera react to the authoritative event stream.
 */
import * as THREE from 'three';
import type { MatchEvent } from '@arena/contracts';
import type { FighterRt, MatchSim } from '@arena/combat-sim';
import { DNA_BY_ID, FILE_BY_ID } from '../content';
import { loadSettings, type Settings } from '../settings';

interface FighterVisual {
  group: THREE.Group;
  body: THREE.Mesh[];
  energy: THREE.Mesh | null;
  prev: { x: number; z: number; alt: number };
  curr: { x: number; z: number; alt: number };
  lunge: { dx: number; dz: number; t: number } | null;
  flash: number;
  ko: number; // 0..1 fall progress
  label: HTMLDivElement;
  baseY: number;
  bobPhase: number;
}

interface Vfx {
  mesh: THREE.Object3D;
  ttl: number;
  age: number;
  update: (v: Vfx, dt: number) => void;
}

interface Projectile {
  mesh: THREE.Mesh;
  targetId: string;
  speed: number;
}

export class BattleView {
  onGroundClick: ((x: number, z: number) => void) | null = null;

  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private hemi: THREE.HemisphereLight;
  private sun: THREE.DirectionalLight;
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
  private tactical = false;
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
    this.hemi = new THREE.HemisphereLight(0xcfe4ff, 0x30281c, 1.0);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff2d0, 2.2);
    this.sun.position.set(30, 55, 20);
    this.sun.castShadow = true;
    this.sun.shadow.camera.left = -45; this.sun.shadow.camera.right = 45;
    this.sun.shadow.camera.top = 45; this.sun.shadow.camera.bottom = -45;
    this.scene.add(this.sun);

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

  private buildArena() {
    const { sizeX, sizeZ } = this.sim.arena;
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(sizeX, sizeZ),
      new THREE.MeshStandardMaterial({ color: 0x232a3c, roughness: 0.92 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    const grid = new THREE.GridHelper(Math.max(sizeX, sizeZ), 24, 0x38445f, 0x2a3450);
    grid.position.y = 0.02;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.35;
    this.scene.add(grid);

    const rim = new THREE.Mesh(
      new THREE.RingGeometry(Math.max(sizeX, sizeZ) * 0.62, Math.max(sizeX, sizeZ) * 0.64, 64),
      new THREE.MeshBasicMaterial({ color: 0xf5b93c, transparent: true, opacity: 0.35, side: THREE.DoubleSide }),
    );
    rim.rotation.x = -Math.PI / 2;
    rim.position.y = 0.03;
    this.scene.add(rim);

    for (const feat of this.sim.features) {
      let mesh: THREE.Object3D | null = null;
      if (feat.type === 'pillar') {
        mesh = new THREE.Mesh(
          new THREE.CylinderGeometry(feat.radius * 0.8, feat.radius, 7, 10),
          new THREE.MeshStandardMaterial({ color: 0x5a6680, roughness: 0.7 }),
        );
        mesh.position.set(feat.x, 3.5, feat.z);
      } else if (feat.type === 'cover') {
        mesh = new THREE.Mesh(
          new THREE.BoxGeometry(feat.radius * 2, 2, feat.radius * 1.4),
          new THREE.MeshStandardMaterial({ color: 0x74553c, roughness: 0.85 }),
        );
        mesh.position.set(feat.x, 1, feat.z);
        mesh.rotation.y = 0.4;
      } else if (feat.type === 'water') {
        mesh = new THREE.Mesh(
          new THREE.CircleGeometry(feat.radius, 28),
          new THREE.MeshStandardMaterial({ color: 0x2b6fa8, transparent: true, opacity: 0.75, roughness: 0.2, metalness: 0.4 }),
        );
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(feat.x, 0.05, feat.z);
      }
      if (mesh) {
        mesh.traverse((o) => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; } });
        this.scene.add(mesh);
        this.featureMeshes.set(feat.id, mesh);
      }
    }
  }

  private buildFighter(f: FighterRt) {
    const dna = f.dna;
    const primary = new THREE.Color(dna.presentation.primaryColor);
    const secondary = new THREE.Color(dna.presentation.secondaryColor);
    const energy = new THREE.Color(dna.presentation.energyColor);
    const s = dna.identity.scale;
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: primary, roughness: 0.45, metalness: 0.25 });
    const trimMat = new THREE.MeshStandardMaterial({ color: secondary, roughness: 0.5 });
    const energyMat = new THREE.MeshStandardMaterial({
      color: energy, emissive: energy, emissiveIntensity: 1.6, roughness: 0.3,
    });
    const body: THREE.Mesh[] = [];
    let energyMesh: THREE.Mesh | null = null;
    let baseY = 0;

    const add = (m: THREE.Mesh, x: number, y: number, z: number) => {
      m.position.set(x, y, z);
      m.castShadow = true;
      group.add(m);
      body.push(m);
      return m;
    };

    switch (dna.identity.chassis) {
      case 'heavy':
      case 'humanoid': {
        const heavy = dna.identity.chassis === 'heavy';
        const torsoH = heavy ? 1.5 : 1.2;
        add(new THREE.Mesh(new THREE.CapsuleGeometry(heavy ? 0.62 : 0.42, torsoH, 6, 12), bodyMat), 0, 1.15, 0);
        add(new THREE.Mesh(new THREE.SphereGeometry(heavy ? 0.34 : 0.28, 14, 12), trimMat), 0, heavy ? 2.35 : 2.15, 0);
        add(new THREE.Mesh(new THREE.BoxGeometry(heavy ? 1.5 : 1.05, 0.22, 0.5), trimMat), 0, heavy ? 1.95 : 1.78, 0); // shoulders
        energyMesh = add(new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 10), energyMat), 0, 1.35, heavy ? 0.62 : 0.44);
        baseY = 0;
        break;
      }
      case 'quadruped': {
        add(new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 1.5, 6, 12), bodyMat), 0, 0.85, 0).rotation.z = Math.PI / 2;
        add(new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 10), trimMat), 1.05, 1.05, 0);
        for (const [lx, lz] of [[-0.6, 0.3], [-0.6, -0.3], [0.6, 0.3], [0.6, -0.3]] as const)
          add(new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.09, 0.8, 8), bodyMat), lx, 0.4, lz);
        energyMesh = add(new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 8), energyMat), 1.2, 1.12, 0);
        baseY = 0;
        break;
      }
      case 'floating': {
        add(new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 14), bodyMat), 0, 1.7, 0);
        const skirt = add(new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.3, 12, 1, true), trimMat), 0, 0.85, 0);
        skirt.rotation.x = Math.PI;
        const ring = add(new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.05, 8, 24), energyMat), 0, 1.0, 0);
        ring.rotation.x = Math.PI / 2;
        energyMesh = add(new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 10), energyMat), 0, 1.7, 0.42);
        baseY = 0.45;
        break;
      }
    }
    group.scale.setScalar(s);
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
      group, body, energy: energyMesh,
      prev: { x: f.x, z: f.z, alt: f.alt },
      curr: { x: f.x, z: f.z, alt: f.alt },
      lunge: null, flash: 0, ko: 0, label, baseY,
      bobPhase: Math.random() * Math.PI * 2,
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
    this.hemi.intensity = 1.0 - this.dark * 0.72;
    this.sun.intensity = 2.2 - this.dark * 1.9;
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
        } else if ((ability?.kind === 'ranged' || ability?.kind === 'control') && target) {
          this.spawnProjectile(sf, target.fighterId, energyColor);
        } else if (ability?.kind === 'area') {
          const cx = target?.x ?? sf.x, cz = target?.z ?? sf.z;
          this.ring(cx, cz, ability.radius ?? 4, energyColor.getHex());
          this.shake = Math.max(this.shake, 0.35);
        }
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
        if (vf) this.burst(vf.x, vf.z, 0xffd166, 8);
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

  private spawnProjectile(from: FighterRt, targetId: string, color: THREE.Color) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 8, 8),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 2 }),
    );
    mesh.position.set(from.x, 1.6 + from.alt, from.z);
    this.scene.add(mesh);
    this.projectiles.push({ mesh, targetId, speed: 46 });
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

  frame(dtMs: number, alpha: number) {
    if (this.disposed) return;
    const dt = Math.min(0.05, dtMs / 1000);

    for (const [id, v] of this.fighters) {
      const sf = this.sim.byId(id);
      if (!sf) continue;
      const x = v.prev.x + (v.curr.x - v.prev.x) * alpha;
      const z = v.prev.z + (v.curr.z - v.prev.z) * alpha;
      const alt = v.prev.alt + (v.curr.alt - v.prev.alt) * alpha;
      v.bobPhase += dt * 2.2;
      const bob = this.motion.reducedMotion ? 0 : Math.sin(v.bobPhase) * (alt > 0 ? 0.28 : 0.06);
      let lx = 0, lz = 0;
      if (v.lunge) {
        v.lunge.t -= dt * 4;
        if (v.lunge.t <= 0) v.lunge = null;
        else {
          const k = Math.sin(v.lunge.t * Math.PI);
          lx = v.lunge.dx * k;
          lz = v.lunge.dz * k;
        }
      }
      if (v.ko > 0 && v.ko < 1) v.ko = Math.min(1, v.ko + dt * 1.6);
      v.group.position.set(x + lx, v.baseY + alt + bob - v.ko * 0.6, z + lz);
      v.group.rotation.z = -v.ko * Math.PI * 0.45;
      const targetId = sf.currentTargetId;
      const target = targetId ? this.sim.byId(targetId) : null;
      if (target && v.ko === 0) v.group.rotation.y = Math.atan2(target.x - x, target.z - z);

      if (v.flash > 0) {
        v.flash = Math.max(0, v.flash - dt * 5);
        for (const m of v.body) {
          const mat = m.material as THREE.MeshStandardMaterial;
          mat.emissive.setRGB(v.flash * 0.8, v.flash * 0.15, v.flash * 0.1);
        }
      }
      const opacity = sf.stealthed ? 0.3 : 1;
      for (const m of v.body) {
        const mat = m.material as THREE.MeshStandardMaterial;
        mat.transparent = opacity < 1;
        mat.opacity = opacity;
      }
      if (v.energy && sf.windup) v.energy.scale.setScalar(1.6 + Math.sin(v.bobPhase * 6) * 0.4);
      else if (v.energy) v.energy.scale.setScalar(1);

      // Label + health bar.
      if (v.group.visible && sf.status === 'active') {
        const pos = new THREE.Vector3(x, v.baseY + alt + 3.1 * sf.dna.identity.scale, z).project(this.camera);
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

    // Projectiles.
    this.projectiles = this.projectiles.filter((p) => {
      const t = this.sim.byId(p.targetId);
      if (!t) { this.scene.remove(p.mesh); return false; }
      const dest = new THREE.Vector3(t.x, 1.6 + t.alt, t.z);
      const dir = dest.clone().sub(p.mesh.position);
      const dist = dir.length();
      if (dist < 0.8) { this.scene.remove(p.mesh); return false; }
      p.mesh.position.add(dir.normalize().multiplyScalar(Math.min(dist, p.speed * dt)));
      return true;
    });

    // VFX.
    this.vfx = this.vfx.filter((v) => {
      v.age += dt;
      if (v.age >= v.ttl) { this.scene.remove(v.mesh); return false; }
      v.update(v, dt);
      return true;
    });

    // Floaters.
    this.floaters = this.floaters.filter((f) => {
      f.age += dt;
      if (f.age > 1.1) { f.div.remove(); return false; }
      const pos = new THREE.Vector3(f.x, f.y + f.age * 1.6, f.z).project(this.camera);
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
    const tx = cx * (1 - focusMix) + this.focus.x * focusMix;
    const tz = cz * (1 - focusMix) + this.focus.z * focusMix;

    let desired: THREE.Vector3;
    let look: THREE.Vector3;
    if (this.tactical) {
      desired = new THREE.Vector3(0, 62, 6);
      look = new THREE.Vector3(0, 0, 0);
    } else {
      const dist = 20 + spread * 1.5 - focusMix * 8;
      desired = new THREE.Vector3(tx, 14 + spread * 0.8, tz + dist);
      look = new THREE.Vector3(tx, 1.5, tz);
    }
    this.camera.position.lerp(desired, 0.045);
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
    this.tactical = on;
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
