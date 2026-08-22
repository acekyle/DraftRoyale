"""Headless Blender skeleton transfer (Tier-3 Blender pass, D-031).

Binds an unrigged hero GLB to the skeleton of an existing Meshy-rigged donor
so the donor's animation clips (which bind by bone name) drive the new body.

  blender --background --python tools/heroforge/blender-transfer.py -- \
    --donor results/<f>/<task>.rigged.glb --target <statue.glb> --out <out.glb>

Strategy: import donor (keep armature, remember its mesh bbox), import the
target, normalize the target into the donor mesh's world box, parent with
automatic weights (bone heat). If bone heat leaves vertices unweighted
(triangle-soup meshes do that), fall back to nearest-face weight transfer
from the donor mesh. Exports armature+mesh only — clips ride separately.
"""
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]


def arg(name):
    return argv[argv.index(name) + 1]


DONOR = arg('--donor')
TARGET = arg('--target')
OUT = arg('--out')

bpy.ops.wm.read_factory_settings(use_empty=True)


def world_bbox(objs):
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for o in objs:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            lo = Vector(map(min, lo, w))
            hi = Vector(map(max, hi, w))
    return lo, hi


# ---- donor -----------------------------------------------------------------
bpy.ops.import_scene.gltf(filepath=DONOR)
armature = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
donor_meshes = [o for o in bpy.data.objects if o.type == 'MESH']
d_lo, d_hi = world_bbox(donor_meshes)
# Keep the biggest donor mesh around (hidden) as the weight-transfer fallback
donor_body = max(donor_meshes, key=lambda o: (o.dimensions.x * o.dimensions.y * o.dimensions.z))
for o in donor_meshes:
    if o is not donor_body:
        bpy.data.objects.remove(o, do_unlink=True)

# ---- target ----------------------------------------------------------------
before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=TARGET)
t_objs = [o for o in set(bpy.data.objects) - before if o.type == 'MESH']
for o in set(bpy.data.objects) - before:
    if o.type != 'MESH' and not o.children:
        continue  # keep hierarchy parents until transforms are applied
# Join target meshes into one
bpy.ops.object.select_all(action='DESELECT')
for o in t_objs:
    o.select_set(True)
bpy.context.view_layer.objects.active = t_objs[0]
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
if len(t_objs) > 1:
    bpy.ops.object.join()
target = bpy.context.view_layer.objects.active
target.name = 'hero_body'

# Normalize the target into the donor mesh's world box (height-fit, feet on
# the donor's floor, centered on the donor's center) so the donor skeleton
# sits inside it.
t_lo, t_hi = world_bbox([target])
scale = (d_hi.z - d_lo.z) / max(1e-6, (t_hi.z - t_lo.z))
target.scale = (scale, scale, scale)
bpy.ops.object.transform_apply(scale=True)
t_lo, t_hi = world_bbox([target])
d_center = (d_lo + d_hi) / 2
t_center = (t_lo + t_hi) / 2
target.location.x += d_center.x - t_center.x
target.location.y += d_center.y - t_center.y
target.location.z += d_lo.z - t_lo.z
bpy.ops.object.transform_apply(location=True)

# ---- bind ------------------------------------------------------------------
bpy.ops.object.select_all(action='DESELECT')
target.select_set(True)
armature.select_set(True)
bpy.context.view_layer.objects.active = armature
bpy.ops.object.parent_set(type='ARMATURE_AUTO')

# Coverage check: vertices with (near-)zero total weight get the fallback.
bone_names = {b.name for b in armature.data.bones}
groups = [g for g in target.vertex_groups if g.name in bone_names]
unweighted = 0
for v in target.data.vertices:
    total = 0.0
    for ge in v.groups:
        if target.vertex_groups[ge.group].name in bone_names:
            total += ge.weight
    if total < 1e-4:
        unweighted += 1
print(f'[transfer] bone-heat groups={len(groups)} unweighted_verts={unweighted}/{len(target.data.vertices)}')

if unweighted > len(target.data.vertices) * 0.02:
    # Fallback: nearest-face weight transfer from the donor body.
    print('[transfer] falling back to donor-mesh weight transfer')
    for g in list(target.vertex_groups):
        target.vertex_groups.remove(g)
    bpy.ops.object.select_all(action='DESELECT')
    donor_body.select_set(True)
    target.select_set(True)
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.data_transfer(
        use_reverse_transfer=False,
        data_type='VGROUP_WEIGHTS',
        vert_mapping='POLYINTERP_NEAREST',
        layers_select_src='ALL',
        layers_select_dst='NAME',
    )

# Remove the donor body from the export.
bpy.data.objects.remove(donor_body, do_unlink=True)

# Drop any animation that rode in with the donor.
for a in list(bpy.data.actions):
    bpy.data.actions.remove(a)

# ---- embed clips -----------------------------------------------------------
# Re-exporting the armature through Blender can change its unit convention
# (Meshy rigs ship with 0.01 node scale), which breaks separately-shipped
# clip files (centimeter hip translations explode). Importing the clips HERE
# and exporting one self-consistent GLB sidesteps units entirely — actions
# target bones by name, so they retarget onto our armature cleanly.
clips_dir = arg('--clips') if '--clips' in argv else None
if clips_dir:
    import os
    armature.animation_data_create()
    for fn in sorted(os.listdir(clips_dir)):
        if not fn.endswith('.glb'):
            continue
        clip_name = fn.rsplit('.', 2)[-2]  # <fighter>.<clip>.glb
        before_actions = set(bpy.data.actions)
        before_objects = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=os.path.join(clips_dir, fn))
        for o in set(bpy.data.objects) - before_objects:
            bpy.data.objects.remove(o, do_unlink=True)
        new_actions = list(set(bpy.data.actions) - before_actions)
        if not new_actions:
            print(f'[transfer] clip {fn}: no action imported — skipped')
            continue
        action = new_actions[0]
        action.name = clip_name
        for extra in new_actions[1:]:
            bpy.data.actions.remove(extra)
        track = armature.animation_data.nla_tracks.new()
        track.name = clip_name
        track.strips.new(clip_name, 0, action)
    print(f'[transfer] embedded {len(armature.animation_data.nla_tracks)} clips')

bpy.ops.object.select_all(action='SELECT')
kwargs = dict(
    filepath=OUT,
    export_format='GLB',
    export_animations=clips_dir is not None,
    export_skins=True,
    export_yup=True,
)
if clips_dir:
    kwargs['export_animation_mode'] = 'NLA_TRACKS'
bpy.ops.export_scene.gltf(**kwargs)
print(f'[transfer] exported {OUT}')
