"""Headless quadruped rig + authored clips (Tier-3 Blender pass, D-031).

No auto-rigger handles quadrupeds, so this script builds a procedural
skeleton sized to the mesh (spine along the body axis, head/tail at the
ends, four leg chains dropped onto ground-contact clusters), binds with
automatic weights, and AUTHORS a clip set programmatically:
idle / walk (trot) / attack (lunge) / hit (recoil) / dead (side collapse).

  blender --background --python tools/heroforge/blender-quadruped.py -- \
    --target <statue.glb> --out <out.glb> [--head +y|-y]

--head picks which end of the long axis is the head (default +y = the end
the model faces after glTF import; check a render if unsure).
Exports GLB WITH the authored animations embedded (the client splits them
by name at load: this file is both model and clip set).
"""
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]


def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


TARGET = arg('--target')
OUT = arg('--out')
HEAD = arg('--head', '+y')

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=TARGET)
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
bpy.ops.object.select_all(action='DESELECT')
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
if len(meshes) > 1:
    bpy.ops.object.join()
body = bpy.context.view_layer.objects.active
body.name = 'hero_body'

# ---- measure ---------------------------------------------------------------
vs = [body.matrix_world @ v.co for v in body.data.vertices]
lo = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
hi = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
length_axis = 'y' if (hi.y - lo.y) >= (hi.x - lo.x) else 'x'
L0, L1 = (lo.y, hi.y) if length_axis == 'y' else (lo.x, hi.x)
sign = 1 if HEAD == '+y' else -1
if sign < 0:
    L0, L1 = L1, L0  # L1 is always the head end below


def at(t, z):
    """Point at body-axis fraction t (0=tail end, 1=head end), height z."""
    a = L0 + (L1 - L0) * t
    return Vector((0, a, z)) if length_axis == 'y' else Vector((a, 0, z))


H = hi.z - lo.z
spine_z = lo.z + H * 0.62
# Ground-contact leg clusters: verts in the bottom 12%, split into
# front/back × left/right quadrants around the body center.
side_axis = 'x' if length_axis == 'y' else 'y'
ground = [v for v in vs if v.z < lo.z + H * 0.12]
mid_len = (L0 + L1) / 2
legs = {}
for name, front, left in [('FrontLeftLeg', True, True), ('FrontRightLeg', True, False),
                          ('BackLeftLeg', False, True), ('BackRightLeg', False, False)]:
    def keep(v):
        along = getattr(v, length_axis)
        across = getattr(v, side_axis)
        is_front = (along - mid_len) * (1 if sign > 0 else -1) > 0
        return is_front == front and (across > 0) == left
    pts = [v for v in ground if keep(v)]
    if pts:
        cx = sum(getattr(v, side_axis) for v in pts) / len(pts)
        cy = sum(getattr(v, length_axis) for v in pts) / len(pts)
        legs[name] = (cx, cy)

# ---- armature --------------------------------------------------------------
arm_data = bpy.data.armatures.new('Armature')
armature = bpy.data.objects.new('Armature', arm_data)
bpy.context.collection.objects.link(armature)
bpy.context.view_layer.objects.active = armature
bpy.ops.object.mode_set(mode='EDIT')
eb = arm_data.edit_bones


def bone(name, head, tail, parent=None):
    b = eb.new(name)
    b.head, b.tail = head, tail
    if parent:
        b.parent = eb[parent]
    return b


bone('Hips', at(0.25, spine_z), at(0.5, spine_z))
bone('Spine', at(0.5, spine_z), at(0.75, spine_z), 'Hips')
bone('Neck', at(0.75, spine_z), at(0.88, spine_z + H * 0.12), 'Spine')
bone('Head', at(0.88, spine_z + H * 0.12), at(1.0, spine_z + H * 0.18), 'Neck')
bone('Tail', at(0.25, spine_z), at(0.02, spine_z + H * 0.05), 'Hips')
for name, (cx, cy) in legs.items():
    top = Vector((cx, cy, spine_z)) if length_axis == 'y' else Vector((cy, cx, spine_z))
    if length_axis != 'y':
        top = Vector((cy, cx, spine_z))
    else:
        top = Vector((cx, cy, spine_z)) if side_axis == 'x' else Vector((cy, cx, spine_z))
    # normalize: component on side axis = cx, on length axis = cy
    top = Vector((0, 0, 0))
    setattr(top, side_axis, cx)
    setattr(top, length_axis, cy)
    top.z = spine_z
    knee = top.copy(); knee.z = lo.z + H * 0.28
    foot = top.copy(); foot.z = lo.z + H * 0.02
    parent = 'Spine' if name.startswith('Front') else 'Hips'
    bone(name, top, knee, parent)
    bone(name + 'Lower', knee, foot, name)

bpy.ops.object.mode_set(mode='OBJECT')

# ---- bind ------------------------------------------------------------------
bpy.ops.object.select_all(action='DESELECT')
body.select_set(True)
armature.select_set(True)
bpy.context.view_layer.objects.active = armature
bpy.ops.object.parent_set(type='ARMATURE_AUTO')

# ---- author clips ----------------------------------------------------------
import math

FPS = 24
bpy.context.scene.render.fps = FPS
armature.animation_data_create()


def make_clip(name, seconds, keyer):
    """keyer(pose, frame, t01) inserts keyframes for frame at t in [0,1]."""
    action = bpy.data.actions.new(name)
    armature.animation_data.action = action
    frames = max(2, int(seconds * FPS))
    for f in range(frames + 1):
        t = f / frames
        bpy.context.scene.frame_set(f)
        for pb in armature.pose.bones:
            pb.rotation_mode = 'XYZ'
            pb.rotation_euler = (0, 0, 0)
            pb.location = (0, 0, 0)
        keyer(armature.pose.bones, f, t)
        for pb in armature.pose.bones:
            pb.keyframe_insert('rotation_euler', frame=f)
            if pb.name == 'Hips':
                pb.keyframe_insert('location', frame=f)
    return action


def sway(pb, x=0.0, y=0.0, z=0.0):
    pb.rotation_euler = (pb.rotation_euler[0] + x, pb.rotation_euler[1] + y, pb.rotation_euler[2] + z)


def idle_key(pose, f, t):
    w = math.sin(t * math.tau)
    sway(pose['Spine'], x=0.03 * w)
    sway(pose['Head'], x=0.05 * math.sin(t * math.tau + 0.9), z=0.06 * math.sin(t * math.tau * 0.5))
    sway(pose['Tail'], z=0.25 * math.sin(t * math.tau + 0.4))


def walk_key(pose, f, t):
    ph = t * math.tau * 2  # two strides per loop
    for name, off in [('FrontLeftLeg', 0), ('BackRightLeg', 0), ('FrontRightLeg', math.pi), ('BackLeftLeg', math.pi)]:
        if name in pose:
            sway(pose[name], x=0.45 * math.sin(ph + off))
            lower = pose.get(name + 'Lower')
            if lower:
                sway(lower, x=max(0.0, 0.5 * math.sin(ph + off + 1.2)))
    pose['Hips'].location.z += 0.015 * abs(math.sin(ph))
    sway(pose['Spine'], z=0.04 * math.sin(ph / 2))
    sway(pose['Tail'], z=0.3 * math.sin(ph / 2 + 1))
    sway(pose['Head'], x=0.03 * math.sin(ph))


def attack_key(pose, f, t):
    k = math.sin(min(1.0, t * 1.4) * math.pi)
    sway(pose['Spine'], x=-0.25 * k)
    sway(pose['Neck'], x=-0.3 * k)
    sway(pose['Head'], x=0.55 * k)  # head toss / gore
    pose['Hips'].location.y += 0.06 * k * (1 if HEAD == '+y' else -1)
    for name in ('FrontLeftLeg', 'FrontRightLeg'):
        if name in pose:
            sway(pose[name], x=-0.35 * k)


def hit_key(pose, f, t):
    k = math.sin(min(1.0, t * 1.2) * math.pi)
    sway(pose['Spine'], x=0.18 * k, z=0.12 * k)
    sway(pose['Head'], x=-0.3 * k)
    sway(pose['Tail'], x=0.4 * k)


def dead_key(pose, f, t):
    k = min(1.0, t * 1.6)
    e = k * k * (3 - 2 * k)
    sway(pose['Hips'], y=1.35 * e)  # roll onto the side
    pose['Hips'].location.z -= 0.22 * e
    sway(pose['Head'], x=0.4 * e)
    for name in ('FrontLeftLeg', 'FrontRightLeg', 'BackLeftLeg', 'BackRightLeg'):
        if name in pose:
            sway(pose[name], x=0.5 * e)


clips = [
    ('idle', 2.4, idle_key), ('walk', 1.0, walk_key), ('attack', 0.8, attack_key),
    ('cast', 0.8, attack_key), ('guard', 0.8, hit_key), ('hit', 0.55, hit_key),
    ('dead', 1.2, dead_key),
]
actions = []
for name, seconds, keyer in clips:
    actions.append(make_clip(name, seconds, keyer))

# Stash every action on NLA tracks so the exporter writes them all.
armature.animation_data.action = None
for a in actions:
    track = armature.animation_data.nla_tracks.new()
    track.name = a.name
    track.strips.new(a.name, 0, a)

bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_animations=True, export_skins=True, export_yup=True)
print(f'[quadruped] exported {OUT} with {len(actions)} clips; legs found: {list(legs)}')
