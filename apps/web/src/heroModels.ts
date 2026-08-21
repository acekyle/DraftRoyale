/**
 * Generated hero models (Season-0 production pass, D-026).
 *
 * Loads the per-fighter GLB statues produced by tools/heroforge (Tripo
 * text-to-3D) from `public/heroes/<fighterId>.glb`. A manifest file lists
 * which fighters have an accepted model so absent heroes never trigger a
 * network miss. Loading is async and cached; callers mount the procedural
 * hero first and swap when (and only when) the GLB arrives — the procedural
 * chassis remains the locked fallback (D-026: any fighter failing the rubric
 * ships procedural).
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const base = `${import.meta.env.BASE_URL ?? '/'}heroes/`;

let manifest: Promise<Set<string>> | null = null;
const cache = new Map<string, Promise<THREE.Group | null>>();
const loader = new GLTFLoader();

function loadManifest(): Promise<Set<string>> {
  manifest ??= fetch(`${base}manifest.json`)
    .then((r) => (r.ok ? r.json() : []))
    .then((ids: unknown) => new Set(Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : []))
    .catch(() => new Set<string>());
  return manifest;
}

/**
 * Resolve the generated statue for a fighter, or null when none is published
 * (or loading fails — callers already have the procedural hero mounted).
 * The returned group is a shared cached scene: callers must `.clone()` it
 * before mutating transforms if more than one instance can be live.
 */
export function loadHeroModel(fighterId: string): Promise<THREE.Group | null> {
  let p = cache.get(fighterId);
  if (!p) {
    p = loadManifest().then(async (ids) => {
      if (!ids.has(fighterId)) return null;
      try {
        const gltf = await loader.loadAsync(`${base}${fighterId}.glb`);
        const scene = gltf.scene;
        // Statues read best with slightly tightened roughness variance left
        // as-authored; just make sure nothing culls incorrectly.
        scene.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).frustumCulled = false;
        });
        return scene;
      } catch {
        return null; // corrupt/missing file — procedural fallback stands
      }
    });
    cache.set(fighterId, p);
  }
  return p.then((g) => (g ? (g.clone(true) as THREE.Group) : null));
}
