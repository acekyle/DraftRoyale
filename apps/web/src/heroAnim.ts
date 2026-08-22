/**
 * Rigged, clip-animated battle heroes (Tier 3, D-030).
 *
 * Assets live under `public/heroes/rigged/`: `<fighter>.glb` is the Meshy
 * auto-rigged multiverse model, `<fighter>.<clip>.glb` are library clips
 * bought per-hero (idle/walk/attack/cast/guard/hit/dead — see
 * tools/heroforge/animate-all.sh for the action_id mapping), and
 * `manifest.json` maps fighterId → available clip names.
 *
 * The battle renderer mounts the procedural chassis first and swaps in the
 * animated hero when (and only when) the rig + clips arrive — the procedural
 * rig remains the locked fallback and still drives every fighter without a
 * rig (quadrupeds, floaters, customs).
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const base = `${import.meta.env.BASE_URL ?? '/'}heroes/rigged/`;
const loader = new GLTFLoader();

let manifest: Promise<Record<string, string[]>> | null = null;
function loadManifest(): Promise<Record<string, string[]>> {
  manifest ??= fetch(`${base}manifest.json`)
    .then((r) => (r.ok ? r.json() : {}))
    .then((m: unknown) => (m && typeof m === 'object' && !Array.isArray(m) ? (m as Record<string, string[]>) : {}))
    .catch(() => ({}));
  return manifest;
}

/** One-shot clips return to locomotion when they finish. */
const ONE_SHOTS = new Set(['attack', 'cast', 'guard', 'hit']);

export interface AnimatedHero {
  group: THREE.Group;
  /** Blend locomotion each frame: speed in world units/s (0 = idle). */
  setLocomotion(speed: number): void;
  /** Fire a one-shot reaction/action clip; 'dead' latches at the last frame. */
  trigger(name: string): void;
  /** True once 'dead' has been triggered (locomotion stops driving). */
  isDead(): boolean;
  update(dt: number): void;
  setGhost(opacity: number): void;
  setFlash(k: number): void;
  dispose(): void;
}

const cache = new Map<string, Promise<{ scene: THREE.Group; clips: Map<string, THREE.AnimationClip> } | null>>();

function loadAssets(fighterId: string) {
  let p = cache.get(fighterId);
  if (!p) {
    p = loadManifest().then(async (m) => {
      const clipNames = m[fighterId];
      if (!clipNames?.length) return null;
      try {
        const gltf = await loader.loadAsync(`${base}${fighterId}.glb`);
        gltf.scene.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).frustumCulled = false;
        });
        const clips = new Map<string, THREE.AnimationClip>();
        // Quadruped rigs embed their authored clips in the model file itself;
        // biped clips ride separate per-clip GLBs sharing the rig bone names.
        for (const a of gltf.animations) if (clipNames.includes(a.name)) clips.set(a.name, a);
        await Promise.all(
          clipNames
            .filter((name) => !clips.has(name))
            .map(async (name) => {
              try {
                const cg = await loader.loadAsync(`${base}${fighterId}.${name}.glb`);
                if (cg.animations[0]) clips.set(name, cg.animations[0]);
              } catch {
                /* missing clip — the hero just won't play it */
              }
            }),
        );
        if (!clips.has('idle')) return null; // idle is the contract minimum
        return { scene: gltf.scene, clips };
      } catch {
        return null;
      }
    });
    cache.set(fighterId, p);
  }
  return p;
}

/**
 * Wrap a static statue (floating chassis — hover IS their locomotion) in the
 * AnimatedHero interface: no clips, group-level KO tip-over, material hooks.
 * Lets the renderer treat statue-bodied floaters exactly like clip heroes.
 */
export function staticHero(model: THREE.Group, targetHeight: number): AnimatedHero {
  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  const fit = targetHeight / Math.max(0.001, size.y);
  const group = new THREE.Group();
  model.scale.setScalar(fit);
  model.position.y = -bounds.min.y * fit;
  group.add(model);
  const mats: THREE.MeshStandardMaterial[] = [];
  model.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of list) if ((m as THREE.MeshStandardMaterial).isMeshStandardMaterial) mats.push(m as THREE.MeshStandardMaterial);
    }
  });
  let dead = false;
  let deadT = 0;
  const baseModelY = model.position.y;
  return {
    group,
    setLocomotion() {},
    trigger(name: string) {
      if (name === 'dead' || name === 'ko') dead = true;
    },
    isDead: () => dead,
    update(dt: number) {
      if (dead && deadT < 1) {
        deadT = Math.min(1, deadT + dt * 1.4);
        const e = deadT * deadT * (3 - 2 * deadT);
        // Tip the inner model — the renderer owns the outer group transforms.
        model.rotation.z = -e * Math.PI * 0.45;
        model.position.y = baseModelY - e * targetHeight * 0.2;
      }
    },
    setGhost(opacity: number) {
      for (const m of mats) {
        m.transparent = opacity < 1;
        m.opacity = opacity;
      }
    },
    setFlash(k: number) {
      for (const m of mats) m.emissive.setScalar(k * 0.85);
    },
    dispose() {},
  };
}

/**
 * Load an animated hero instance normalized to `targetHeight` world units.
 * Returns null when no rig is published (procedural fallback stands).
 */
export async function loadAnimatedHero(fighterId: string, targetHeight: number): Promise<AnimatedHero | null> {
  const assets = await loadAssets(fighterId);
  if (!assets) return null;
  // SkinnedMesh clone needs SkeletonUtils semantics; clone(true) keeps bind
  // references shared which breaks per-instance animation, so give each
  // instance its own parsed scene instead when more than one is live. Battle
  // spawns at most one instance per fighter, so a fresh load per mount is
  // simplest and correct.
  const scene = assets.scene;
  if (scene.userData.claimed) {
    cache.delete(fighterId); // force a fresh parse for a second concurrent use
    return loadAnimatedHero(fighterId, targetHeight);
  }
  scene.userData.claimed = true;

  const bounds = new THREE.Box3().setFromObject(scene);
  const size = bounds.getSize(new THREE.Vector3());
  const fit = targetHeight / Math.max(0.001, size.y);
  const group = new THREE.Group();
  scene.scale.setScalar(fit);
  scene.position.y = -bounds.min.y * fit;
  group.add(scene);

  const mixer = new THREE.AnimationMixer(scene);
  const actions = new Map<string, THREE.AnimationAction>();
  for (const [name, clip] of assets.clips) {
    const action = mixer.clipAction(clip);
    if (ONE_SHOTS.has(name) || name === 'dead') {
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
    }
    actions.set(name, action);
  }

  const mats: THREE.MeshStandardMaterial[] = [];
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of list) if ((m as THREE.MeshStandardMaterial).isMeshStandardMaterial) mats.push(m as THREE.MeshStandardMaterial);
    }
  });

  let current: THREE.AnimationAction | null = null;
  let oneShot: THREE.AnimationAction | null = null;
  let dead = false;

  const playBase = (name: string, fade = 0.25) => {
    const next = actions.get(name);
    if (!next || next === current) return;
    next.reset().fadeIn(fade).play();
    current?.fadeOut(fade);
    current = next;
  };
  playBase('idle', 0);

  mixer.addEventListener('finished', (e) => {
    if (e.action === oneShot && !dead) {
      oneShot.fadeOut(0.2);
      oneShot = null;
      current?.reset().fadeIn(0.2).play();
    }
  });

  return {
    group,
    setLocomotion(speed: number) {
      if (dead || oneShot) return;
      const walk = actions.get('walk');
      if (walk && speed > 0.7) {
        walk.timeScale = THREE.MathUtils.clamp(speed / 4, 0.7, 1.8);
        playBase('walk');
      } else {
        playBase('idle');
      }
    },
    trigger(name: string) {
      if (dead) return;
      if (name === 'dead' || name === 'ko') {
        dead = true;
        const d = actions.get('dead');
        if (d) {
          mixer.stopAllAction();
          current = null;
          oneShot = null;
          d.reset().play();
        }
        return;
      }
      const a = actions.get(name);
      if (!a || !ONE_SHOTS.has(name)) return;
      oneShot?.stop();
      current?.fadeOut(0.12);
      a.reset().fadeIn(0.08).play();
      oneShot = a;
    },
    isDead: () => dead,
    update(dt: number) {
      mixer.update(dt);
    },
    setGhost(opacity: number) {
      for (const m of mats) {
        m.transparent = opacity < 1;
        m.opacity = opacity;
      }
    },
    setFlash(k: number) {
      for (const m of mats) {
        m.emissive.setScalar(k * 0.85);
      }
    },
    dispose() {
      mixer.stopAllAction();
      scene.userData.claimed = false;
    },
  };
}
