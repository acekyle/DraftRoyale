/**
 * Collectible pedestal viewer — the inspect-drawer "statue on a pedestal"
 * presentation (Art Bible §1/§5: pedestal presentation in draft contexts).
 *
 * One WebGL renderer + canvas is created lazily and reused across every
 * drawer open (contexts are a scarce browser resource); each mount swaps the
 * hero mesh and retints the pedestal ring inlay to the fighter's ROLE color.
 * Turntable + hover bob are disabled under reducedMotion (a still statue is
 * rendered instead). If WebGL is unavailable, mount() returns null and the
 * caller falls back to the 2D silhouette.
 */
import * as THREE from 'three';
import type { CombatDNA } from '@arena/contracts';
import { buildHeroMesh } from './battle/heroMeshes';
import { roleColor } from './roleTheme';
import { loadSettings } from './settings';

interface Stage {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  ringMat: THREE.MeshStandardMaterial;
  glow: THREE.PointLight;
  heroSlot: THREE.Group;
}

let stage: Stage | null = null;
let stageFailed = false;
let raf = 0;
let generation = 0; // stale dispose() calls (drawer replaced without closing) must not touch the live preview

function buildStage(): Stage | null {
  if (stageFailed) return null;
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch {
    stageFailed = true; // headless/blocked WebGL — callers fall back to the SVG silhouette
    return null;
  }
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 60);
  camera.position.set(0, 2.1, 5.2);
  camera.lookAt(0, 1.35, 0);

  // Dramatic collectible lighting: cool key, warm rim, soft fill.
  scene.add(new THREE.HemisphereLight(0x8fa8d8, 0x1a1410, 0.5));
  const key = new THREE.DirectionalLight(0xcfe0ff, 2.4);
  key.position.set(2.4, 4.5, 3.2);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xffb36b, 2.0);
  rim.position.set(-2.6, 3.2, -3.4);
  scene.add(rim);
  const fill = new THREE.DirectionalLight(0x9fb4e0, 0.7); // soft front fill — statue detail stays readable
  fill.position.set(0.4, 2.0, 5.0);
  scene.add(fill);

  // Pedestal: stepped tech cylinder with a glowing role-color ring inlay.
  const dark = new THREE.MeshStandardMaterial({ color: 0x1a2032, roughness: 0.55, metalness: 0.5 });
  const darker = new THREE.MeshStandardMaterial({ color: 0x10131f, roughness: 0.7, metalness: 0.35 });
  const pedestal = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.66, 0.18, 36), darker);
  base.position.y = 0.09;
  pedestal.add(base);
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(1.18, 1.3, 0.4, 36), dark);
  drum.position.y = 0.44;
  pedestal.add(drum);
  const top = new THREE.Mesh(new THREE.CylinderGeometry(1.16, 1.16, 0.06, 36), darker);
  top.position.y = 0.67;
  pedestal.add(top);
  const ringMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1.6, roughness: 0.3,
  });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.02, 0.035, 8, 48), ringMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.7;
  pedestal.add(ring);
  scene.add(pedestal);

  // Role-colored under-glow.
  const glow = new THREE.PointLight(0xffffff, 5, 5.5);
  glow.position.set(0, 0.85, 0);
  scene.add(glow);

  const heroSlot = new THREE.Group();
  heroSlot.position.y = 0.7; // pedestal top surface
  scene.add(heroSlot);

  return (stage = { renderer, scene, camera, ringMat, glow, heroSlot });
}

export interface PedestalPreview {
  dispose(): void;
}

/**
 * Mount the turntable viewer into `host`. Returns null when WebGL is not
 * available (caller should keep its 2D fallback). Call dispose() on drawer
 * close; the loop also self-stops if the canvas leaves the document.
 */
export function mountPedestal(host: HTMLElement, dna: CombatDNA): PedestalPreview | null {
  const st = stage ?? buildStage();
  if (!st) return null;

  cancelAnimationFrame(raf); // only ever one active preview
  const gen = ++generation;

  // Swap in this fighter's hero, normalized to statue height on the pedestal.
  st.heroSlot.clear();
  const hero = buildHeroMesh(dna);
  const bounds = new THREE.Box3().setFromObject(hero.group);
  const size = bounds.getSize(new THREE.Vector3());
  // Fit by height AND footprint — quadrupeds are short but long.
  const fit = Math.min(
    1.15,
    2.35 / Math.max(0.001, size.y),
    2.1 / Math.max(0.001, size.x, size.z),
  );
  hero.group.scale.setScalar(fit);
  hero.group.position.y = -bounds.min.y * fit + hero.baseY * fit;
  st.heroSlot.add(hero.group);
  st.heroSlot.rotation.y = -0.5; // three-quarter hero angle at rest

  // Role-color the ring inlay + under-glow.
  const rc = new THREE.Color(roleColor(dna.identity.role));
  st.ringMat.color.copy(rc);
  st.ringMat.emissive.copy(rc);
  st.glow.color.copy(rc);

  // Size to the host.
  const w = Math.max(220, host.clientWidth || 320);
  const hpx = 320;
  st.renderer.setSize(w, hpx);
  st.camera.aspect = w / hpx;
  st.camera.updateProjectionMatrix();
  host.appendChild(st.renderer.domElement);

  const reduced = loadSettings().reducedMotion;
  let disposed = false;
  let last = performance.now();
  let bobT = 0;

  const frame = (now: number) => {
    if (disposed) return;
    if (!st.renderer.domElement.isConnected) { disposed = true; return; } // drawer re-rendered away
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!reduced) {
      st.heroSlot.rotation.y += dt * 0.55; // slow turntable
      if (hero.rig.hover) hero.rig.hover.rotation.y -= dt * 0.8;
      if (dna.identity.chassis === 'floating') {
        bobT += dt * 2;
        hero.group.position.y = -bounds.min.y * fit + hero.baseY * fit + Math.sin(bobT) * 0.05;
      }
    }
    st.renderer.render(st.scene, st.camera);
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  return {
    dispose() {
      if (disposed || gen !== generation) return; // a newer preview owns the stage now
      disposed = true;
      cancelAnimationFrame(raf);
      st.heroSlot.clear();
      st.renderer.domElement.remove(); // canvas + renderer are kept for the next open
    },
  };
}
