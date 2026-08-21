#!/usr/bin/env node
// Strip clip GLBs down to animation + skeleton (drop meshes/materials/
// textures — the rigged base model already carries them). Cuts each clip
// from ~5-6MB to tens of KB so the Tier-3 asset set stays deployable.
//   node tools/heroforge/strip-clips.mjs apps/web/public/heroes/rigged/*.{clip}.glb
import { NodeIO } from '@gltf-transform/core';
import { prune } from '@gltf-transform/functions';

const io = new NodeIO();
for (const path of process.argv.slice(2)) {
  const doc = await io.read(path);
  const root = doc.getRoot();
  if (!root.listAnimations().length) {
    console.log(`${path}: no animations — left untouched`);
    continue;
  }
  for (const mesh of root.listMeshes()) mesh.dispose();
  for (const skin of root.listSkins()) skin.dispose();
  for (const mat of root.listMaterials()) mat.dispose();
  for (const tex of root.listTextures()) tex.dispose();
  await doc.transform(prune());
  const before = (await import('node:fs')).statSync(path).size;
  await io.write(path, doc);
  const after = (await import('node:fs')).statSync(path).size;
  console.log(`${path.split('/').pop()}: ${(before / 1e6).toFixed(1)}MB → ${(after / 1e3).toFixed(0)}KB`);
}
