"""
Stills of the v2 locomotive: the no-WebGL / reduced-motion hero and the Rail Yard card art.
Run:  blender -b models/loco.blend -P models/render_loco.py -- site/assets/3d [preview]
Writes loco-hero.png (3/4 front, night key light, transparent) and loco-side.png (broadside).
"""
import math
import os
import sys

import bpy
from mathutils import Vector

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = ARGS[0] if ARGS else "site/assets/3d"
PREVIEW = "preview" in ARGS
SCN = bpy.context.scene

SCN.render.engine = "CYCLES"
SCN.cycles.samples = 48 if PREVIEW else 160
SCN.cycles.use_denoising = True
try:
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "METAL"
    prefs.get_devices()
    for d in prefs.devices:
        d.use = True
    SCN.cycles.device = "GPU"
except Exception as e:  # CPU fallback
    print("GPU unavailable:", e)
SCN.render.film_transparent = True
SCN.view_settings.view_transform = "AgX"
SCN.view_settings.look = "AgX - Medium High Contrast"

world = bpy.data.worlds.new("Night")
world.use_nodes = True
bg = world.node_tree.nodes["Background"]
DAY = "day" in ARGS
bg.inputs["Color"].default_value = (0.55, 0.58, 0.6, 1) if DAY else (0.012, 0.016, 0.03, 1)
bg.inputs["Strength"].default_value = 1.0
SCN.world = world


def light(name, kind, loc, energy, color, size=1.0, rot=None):
    ld = bpy.data.lights.new(name, kind)
    ld.energy = energy
    ld.color = color
    if kind == "AREA":
        ld.size = size
    o = bpy.data.objects.new(name, ld)
    o.location = loc
    SCN.collection.objects.link(o)
    if rot:
        o.rotation_euler = rot
    else:
        d = Vector((0.5, 0, 1.6)) - Vector(loc)
        o.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    return o


# warm lantern key, cold moon rim, low fill
light("Key", "AREA", (9, 7, 6), 2600, (1.0, 0.78, 0.52), 4)
light("Rim", "AREA", (-6, -7, 7), 1800, (0.55, 0.68, 1.0), 6)
light("Fill", "AREA", (2, 9, 1.2), 300, (1.0, 0.6, 0.4), 3)
light("Top", "AREA", (0, 0, 9), 400, (0.8, 0.85, 1.0), 10)

cam_d = bpy.data.cameras.new("Cam")
cam = bpy.data.objects.new("Cam", cam_d)
SCN.collection.objects.link(cam)
SCN.camera = cam


def aim(loc, target, lens):
    cam.location = loc
    cam.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    cam_d.lens = lens


shots = [("loco-hero", (12.5, 8.5, 2.6), (-0.6, 0, 1.55), 38, 2400, 1350),
         ("loco-front", (11.5, 5.5, 6.5), (0.8, 0, 1.6), 40, 2400, 1350),
         ("loco-side", (0.2, 17.5, 1.9), (-0.4, 0, 1.6), 42, 2400, 900)]
for name, loc, tgt, lens, w, h in shots:
    aim(loc, tgt, lens)
    SCN.render.resolution_x = w // (3 if PREVIEW else 1)
    SCN.render.resolution_y = h // (3 if PREVIEW else 1)
    SCN.render.filepath = os.path.join(OUT, name + (".day" if DAY else "") + (".preview" if PREVIEW else "") + ".png")
    bpy.ops.render.render(write_still=True)
    print("WROTE", SCN.render.filepath)
