#!/usr/bin/env node
// GLB budget inspector — tri count, texture sizes, bounds (rubric line 3).
//   node tools/heroforge/inspect.mjs <file.glb> [...]
import { readFileSync } from 'node:fs';

for (const path of process.argv.slice(2)) {
  const buf = readFileSync(path);
  if (buf.readUInt32LE(0) !== 0x46546c67) {
    console.log(`${path}: not a GLB`);
    continue;
  }
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  let tris = 0;
  for (const mesh of json.meshes ?? []) {
    for (const prim of mesh.primitives ?? []) {
      const mode = prim.mode ?? 4;
      if (mode !== 4) continue;
      const count =
        prim.indices != null
          ? json.accessors[prim.indices].count
          : json.accessors[prim.attributes.POSITION].count;
      tris += count / 3;
    }
  }
  const images = (json.images ?? []).map((im) => {
    if (im.bufferView == null) return `${im.uri ?? '?'} (external)`;
    const bv = json.bufferViews[im.bufferView];
    return `${im.mimeType ?? '?'} ${(bv.byteLength / 1024).toFixed(0)}KB`;
  });
  let bounds = '';
  const posAcc = json.meshes?.[0]?.primitives?.[0]?.attributes?.POSITION;
  if (posAcc != null) {
    const a = json.accessors[posAcc];
    if (a.min && a.max) bounds = ` bounds ${a.max.map((v, i) => (v - a.min[i]).toFixed(2)).join('×')}`;
  }
  console.log(
    `${path.split('/').slice(-2).join('/')}: ${Math.round(tris)} tris, ${json.meshes?.length ?? 0} mesh(es), ` +
      `images [${images.join(', ')}]${bounds}`,
  );
}
