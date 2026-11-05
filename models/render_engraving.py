"""
Looping "steel engraving" clip of the in-county 4-4-0 for the Top 10 Drivers poster header.
Run:  blender -b models/loco.blend -P models/render_engraving.py -- <outdir> [frames] [width] [height]

Look: black ink line work (Freestyle) over flat paper-white with light grey tone, so it
sits on the cream poster like the printed engraving it replaces. Broadside 3/4 view,
engine travelling left to right. Wheels and rods turn through a whole number of
revolutions so the clip loops without a jump; ties and telegraph poles slide one spacing.
Smoke is NOT rendered here: it is drawn on top in the compositor (Remotion) as soft ink
puffs, which loops cleanly and reads as engraving hatching.
"""
import math
import os
import sys

import bpy
from mathutils import Vector

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = ARGS[0] if ARGS else "/tmp/engr"
FRAMES = int(ARGS[1]) if len(ARGS) > 1 else 48
W = int(ARGS[2]) if len(ARGS) > 2 else 1200
H = int(ARGS[3]) if len(ARGS) > 3 else 520
os.makedirs(OUT, exist_ok=True)
S = bpy.context.scene

# ── look: flat grey tone + Freestyle ink ─────────────────────────────
S.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items] else "BLENDER_EEVEE"
S.render.resolution_x, S.render.resolution_y = W, H
S.render.film_transparent = True
S.view_settings.view_transform = "Standard"
S.render.use_freestyle = True
S.render.line_thickness_mode = "ABSOLUTE"
S.render.line_thickness = 1.25

tone = bpy.data.materials.new("EngravingTone")
tone.use_nodes = True
nt = tone.node_tree
for n in list(nt.nodes):
    nt.nodes.remove(n)
out = nt.nodes.new("ShaderNodeOutputMaterial")
diff = nt.nodes.new("ShaderNodeBsdfDiffuse")
s2rgb = nt.nodes.new("ShaderNodeShaderToRGB")
ramp = nt.nodes.new("ShaderNodeValToRGB")
emit = nt.nodes.new("ShaderNodeEmission")
# Shade -> engraving: lit faces are bare paper, shade is cut as diagonal hatching
# whose density follows the shadow (a screen-space saw wave against the shade value).
ramp.color_ramp.interpolation = "LINEAR"
els = ramp.color_ramp.elements
els[0].position = 0.05; els[0].color = (0.0, 0.0, 0.0, 1)
els[1].position = 0.92; els[1].color = (1, 1, 1, 1)
tc = nt.nodes.new("ShaderNodeTexCoord")
mp = nt.nodes.new("ShaderNodeMapping")
mp.inputs["Rotation"].default_value = (0, 0, math.radians(38))
wave = nt.nodes.new("ShaderNodeTexWave")
wave.wave_type = "BANDS"; wave.bands_direction = "X"; wave.wave_profile = "SAW"
wave.inputs["Scale"].default_value = 78.0
wave.inputs["Distortion"].default_value = 0.0
nt.links.new(tc.outputs["Window"], mp.inputs["Vector"])
nt.links.new(mp.outputs["Vector"], wave.inputs["Vector"])
gt = nt.nodes.new("ShaderNodeMath"); gt.operation = "GREATER_THAN"
nt.links.new(wave.outputs["Fac"], gt.inputs[0])
sep = nt.nodes.new("ShaderNodeSeparateColor")
nt.links.new(ramp.outputs["Color"], sep.inputs["Color"])
nt.links.new(sep.outputs[0], gt.inputs[1])
mix = nt.nodes.new("ShaderNodeMix"); mix.data_type = "RGBA"
mix.inputs["A"].default_value = (0.95, 0.91, 0.82, 1)
mix.inputs["B"].default_value = (0.10, 0.08, 0.06, 1)
nt.links.new(gt.outputs[0], mix.inputs["Factor"])
nt.links.new(diff.outputs[0], s2rgb.inputs[0])
nt.links.new(s2rgb.outputs["Color"], ramp.inputs["Fac"])
nt.links.new(mix.outputs["Result"], emit.inputs["Color"])
nt.links.new(emit.outputs[0], out.inputs["Surface"])

for o in S.objects:
    if o.type == "MESH":
        o.data.materials.clear()
        o.data.materials.append(tone)
        o.visible_shadow = False

ls = S.view_layers[0].freestyle_settings.linesets[0] if S.view_layers[0].freestyle_settings.linesets else S.view_layers[0].freestyle_settings.linesets.new("Ink")
ls.select_by_visibility = True
ls.select_silhouette = True
ls.select_border = True
ls.select_crease = True
ls.select_external_contour = True
if ls.linestyle is None:
    ls.linestyle = bpy.data.linestyles.new("InkStyle")
ls.linestyle.color = (0.08, 0.06, 0.05)
ls.linestyle.thickness = 1.4

for o in [o for o in S.objects if o.type == "LIGHT"]:
    bpy.data.objects.remove(o)
sun = bpy.data.lights.new("Sun", "SUN")
sun.energy = 4.0
so = bpy.data.objects.new("Sun", sun)
S.collection.objects.link(so)
so.rotation_euler = (math.radians(50), math.radians(10), math.radians(35))
world = bpy.data.worlds.new("W"); world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.0
S.world = world

# ── track: ties + rails + a few telegraph poles, all in ink ──────────
def box(name, size, loc):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.object; o.name = name; o.scale = size
    bpy.ops.object.transform_apply(scale=True)
    o.data.materials.append(tone)
    return o

REV = 2                            # driver revolutions per loop
DIST = 2 * math.pi * 0.84 * REV    # metres travelled per loop
TIE = DIST / 18                    # 9 ties per revolution, so ties loop exactly
track = bpy.data.objects.new("Track", None); S.collection.objects.link(track)
for i in range(-40, 40):
    t = box(f"Tie{i}", (0.24, 2.5, 0.12), (i * TIE, 0, -0.06)); t.parent = track
for y in (-0.72, 0.72):
    r = box(f"Rail{y}", (60, 0.09, 0.14), (0, y, 0.04)); r.parent = track
POLE = DIST                        # one pole per loop: poles loop exactly too
for i in range(-4, 5):
    p = box(f"Pole{i}", (0.16, 0.16, 7.0), (i * POLE, 4.2, 3.4)); p.parent = track
    a = box(f"Arm{i}", (0.12, 1.6, 0.12), (i * POLE, 4.2, 6.6)); a.parent = track

# ── camera: 3/4 broadside, looking along the engine ──────────────────
cam_d = bpy.data.cameras.new("Cam"); cam = bpy.data.objects.new("Cam", cam_d)
S.collection.objects.link(cam); S.camera = cam
cam.location = Vector((7.0, -19.5, 3.4))
cam.rotation_euler = (Vector((-1.0, 0, 2.15)) - cam.location).to_track_quat("-Z", "Y").to_euler()
cam_d.lens = 44

# ── loop: wheels turn N whole revolutions, track slides the matching distance ─
DR, LR, TR = 0.84, 0.42, 0.42
S.frame_start, S.frame_end = 1, FRAMES

def key_all(f, k):
    th = k * 2 * math.pi * REV
    for o in S.objects:
        n = o.name
        if n.startswith("Driver_"): o.rotation_euler = (0, th, 0)
        elif n.startswith("Lead_"): o.rotation_euler = (0, th * DR / LR, 0)
        elif n.startswith("TenderWheel_"): o.rotation_euler = (0, th * DR / TR, 0)
        else: continue
        o.keyframe_insert("rotation_euler", frame=f)

bpy.context.preferences.edit.keyframe_new_interpolation_type = "LINEAR"
# rods follow the crank pin of the front driver
rods = {o.name: o.location.copy() for o in S.objects if o.name.startswith(("SideRod_", "MainRod_"))}
RC = DR * 0.45
for f in range(1, FRAMES + 2):
    k = (f - 1) / FRAMES
    th = k * 2 * math.pi * REV
    key_all(f, k)
    cx, cz = RC * math.cos(th), -RC * math.sin(th)
    for n, b in rods.items():
        o = S.objects[n]
        if n.startswith("SideRod"):
            o.location = (b.x + cx, b.y, b.z + cz)
        else:
            pin = Vector((0.65 + cx, b.y, DR + cz))
            dz = b.z - pin.z; dx = math.sqrt(max(0.01, 4.0 - dz * dz))
            o.location = (pin.x + dx / 2, b.y, pin.z + dz / 2)
            o.rotation_euler = (0, -math.atan2(dz, dx), 0)
        o.keyframe_insert("location", frame=f)
        o.keyframe_insert("rotation_euler", frame=f)
    # the world slides backward by one revolution's distance, wrapped on the tie gap
    track.location = (-k * DIST, 0, 0)
    track.keyframe_insert("location", frame=f)

S.render.image_settings.file_format = "PNG"
S.render.image_settings.color_mode = "RGBA"
S.render.filepath = os.path.join(OUT, "f_")
bpy.ops.render.render(animation=True)
print("DONE", OUT, FRAMES)
