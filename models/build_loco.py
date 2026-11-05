"""
4-4-0 "American" for the Railroad Union v2 hero, modelled on the in-county engine
(State of Deliverance's "Probation Train", the RDR2 4-4-0): olive-green boiler with
thin brass bands, graphite smokebox with a number plate, tall straight stack with a
flared cone top, red box headlamp with gold trim, red-capped domes with a brass bell
in a red yoke, varnished plank cab with porthole windows and a grey planked roof,
red spoked wheels, green tender with gold pinstripe panels.
Reference frames: models/reference/ (kept out of git).

Run headless:  blender -b -P models/build_loco.py -- site/assets/3d

Surfaces are weathered with textures generated here (numpy): paint with grime, rain
streaks and soot; tarnished brass; rusty iron; plank wood with grain; then ambient
occlusion is baked into vertex colours so dirt collects in the crevices the way the
game's engines do. Everything exports to glTF (textures as JPEG).

Axis: +X forward, +Z up, rail top at Z=0, metres, roughly 1:1.
Animated parts keep their pivot on the axle:
  Driver_*, Lead_*, TenderWheel_*  rotate about local Y (glTF: Z)
  SideRod_L / SideRod_R            translate on the crank circle
  MainRod_L / MainRod_R            translate + pitch, crank pin to crosshead
  Smoke, Headlamp                  empties: particle origin, light origin
"""
import math
import os
import random
import sys

import bmesh
import bpy
import numpy as np

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = ARGS[0] if ARGS else "site/assets/3d"
FAST = "fast" in ARGS          # skip the AO bake while iterating
# Liveries: "green" = the Probation Train (default); "black" = the black-and-brass engine
# from Lesson 1 of the Safety Video.
LIVERY = "black" if "black" in ARGS else "green"
SUFFIX = "" if LIVERY == "green" else "-" + LIVERY
os.makedirs(OUT, exist_ok=True)
HERE = os.path.dirname(os.path.abspath(__file__))
TEXDIR = os.path.join(HERE, "textures", "black" if "black" in ARGS else "green")
os.makedirs(TEXDIR, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
SCN = bpy.context.scene
rng = np.random.default_rng(1899)
random.seed(1899)

# ── texture synthesis ──────────────────────────────────────────────
TS = 512


def value_noise(n, cells_x, cells_y=None, seed=None):
    """Tileable bilinear value noise in [0,1], n x n."""
    cells_y = cells_y or cells_x
    g = (np.random.default_rng(seed) if seed is not None else rng).random((cells_y, cells_x))
    ys = np.linspace(0, cells_y, n, endpoint=False)
    xs = np.linspace(0, cells_x, n, endpoint=False)
    y0 = np.floor(ys).astype(int); x0 = np.floor(xs).astype(int)
    fy = (ys - y0)[:, None]; fx = (xs - x0)[None, :]
    fy = fy * fy * (3 - 2 * fy); fx = fx * fx * (3 - 2 * fx)
    y1 = (y0 + 1) % cells_y; x1 = (x0 + 1) % cells_x
    a = g[y0][:, x0]; b = g[y0][:, x1]; c = g[y1][:, x0]; d = g[y1][:, x1]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


def fbm(n, base=4, octaves=6, stretch=1, seed=0):
    out = np.zeros((n, n)); amp = 1.0; tot = 0.0
    for o in range(octaves):
        c = base * 2 ** o
        out += amp * value_noise(n, c, max(1, c // stretch), seed + o)
        tot += amp; amp *= 0.5
    return out / tot


def save_img(name, rgb, colorspace="sRGB"):
    h, w = rgb.shape[:2]
    if rgb.ndim == 2:
        rgb = np.dstack([rgb] * 3)
    rgba = np.dstack([np.clip(rgb, 0, 1), np.ones((h, w))])
    # Generated images lose their pixels on save/export; write a real file and load it.
    tmp = bpy.data.images.new(name + "_gen", w, h, alpha=False)
    tmp.pixels.foreach_set(rgba[::-1].astype(np.float32).ravel())
    path = os.path.join(TEXDIR, name + ".png")
    tmp.filepath_raw = path
    tmp.file_format = "PNG"
    tmp.save()
    bpy.data.images.remove(tmp)
    img = bpy.data.images.load(path, check_existing=False)
    img.name = name
    img.colorspace_settings.name = colorspace
    return img


def srgb_lin(h):
    h = h.lstrip("#")
    c = np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)])
    return c


def height_to_normal(h, strength=2.0):
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * strength
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * strength
    nz = np.ones_like(h)
    l = np.sqrt(dx * dx + dy * dy + nz * nz)
    return np.dstack([(-dx / l) * 0.5 + 0.5, (dy / l) * 0.5 + 0.5, (nz / l) * 0.5 + 0.5])


# shared weathering fields
BLOTCH = fbm(TS, 3, 6, seed=10)                     # broad grime patches
STREAK = fbm(TS, 6, 5, stretch=12, seed=30)         # vertical rain/soot streaks (v is up after projection)
SPECK = (value_noise(TS, 256, seed=50) > 0.86).astype(float) * value_noise(TS, 64, seed=51)
SCRATCH = np.clip((fbm(TS, 32, 3, stretch=1, seed=70) - 0.66) * 6, 0, 1)
DENT = fbm(TS, 16, 4, seed=90)


def paint_set(name, hex_color, rough=0.62, grime=0.38, soot=0.0, chips_hex=None):
    base = srgb_lin(hex_color)
    dirt = np.clip(BLOTCH * 0.55 + STREAK * 0.6 - 0.32, 0, 1) * grime
    var = 1 + (fbm(TS, 8, 4, seed=hash(name) % 997) - 0.5) * 0.12
    col = base[None, None, :] * var[..., None] * (1 - dirt[..., None] * 0.55)
    grime_col = np.array([0.18, 0.15, 0.11])
    col = col * (1 - dirt[..., None] * 0.35) + grime_col * dirt[..., None] * 0.35
    if soot:
        s = np.clip(STREAK * 1.2 - 0.35, 0, 1) * soot
        col = col * (1 - s[..., None] * 0.7)
    if chips_hex:
        chips = np.clip(SCRATCH * (BLOTCH > 0.5), 0, 1)
        col = col * (1 - chips[..., None]) + srgb_lin(chips_hex) * chips[..., None]
    col = col * (1 - SPECK[..., None] * 0.35)
    r = np.clip(rough + dirt * 0.25 - SCRATCH * 0.1 + (DENT - 0.5) * 0.08, 0.05, 1)
    return (save_img(name + "_col", col), save_img(name + "_rough", r, "Non-Color"),
            save_img(name + "_nrm", height_to_normal(DENT * 0.6 + STREAK * 0.2, 1.4), "Non-Color"))


def brass_set():
    base = srgb_lin("#b88a3f")
    tarn = np.clip(BLOTCH * 0.9 - 0.25, 0, 1)
    col = base * (1 - tarn[..., None] * 0.45) + srgb_lin("#4c3b1e") * tarn[..., None] * 0.45
    col = col * (1 - np.clip(STREAK - 0.55, 0, 1)[..., None] * 0.6)
    r = np.clip(0.28 + tarn * 0.35 + (DENT - 0.5) * 0.1, 0.1, 1)
    return (save_img("brass_col", col), save_img("brass_rough", r, "Non-Color"),
            save_img("brass_nrm", height_to_normal(DENT * 0.3, 1.0), "Non-Color"))


def iron_set(name, hex_color, rust=0.4):
    base = srgb_lin(hex_color)
    rr = np.clip(fbm(TS, 6, 6, seed=120) * 1.4 - 0.62, 0, 1) * rust
    col = base * (0.9 + (BLOTCH[..., None] - 0.5) * 0.25)
    col = col * (1 - rr[..., None]) + srgb_lin("#5a2f17") * rr[..., None]
    r = np.clip(0.5 + rr * 0.4 + (DENT - 0.5) * 0.15, 0.1, 1)
    return (save_img(name + "_col", col), save_img(name + "_rough", r, "Non-Color"),
            save_img(name + "_nrm", height_to_normal(DENT * 0.8 + rr * 0.6, 2.0), "Non-Color"))


def wood_set():
    v = np.linspace(0, 1, TS, endpoint=False)[None, :]
    warp = fbm(TS, 4, 4, stretch=1, seed=200) * 0.08
    grain = np.sin((v * 60 + warp * 80 + fbm(TS, 24, 3, stretch=1, seed=210) * 3) * math.pi) * 0.5 + 0.5
    plank = ((np.linspace(0, 1, TS, endpoint=False)[:, None] * 10) % 1.0)
    seam = (plank < 0.03).astype(float)
    tone = fbm(TS, 10, 3, stretch=1, seed=220)
    plank_id = np.floor(np.linspace(0, 1, TS, endpoint=False)[:, None] * 10)
    plank_var = (np.sin(plank_id * 12.9898) * 43758.5453) % 1.0
    base = srgb_lin("#4f321d")
    col = base * (0.78 + grain[..., None] * 0.22 + (plank_var[..., None] - 0.5) * 0.18 + (tone[..., None] - 0.5) * 0.1)
    col = col * (1 - seam[..., None] * 0.55)
    dirt = np.clip(STREAK * 0.8 - 0.4, 0, 1)
    col = col * (1 - dirt[..., None] * 0.3)
    r = np.clip(0.42 + (1 - grain) * 0.1 + seam * 0.3 + dirt * 0.2, 0.1, 1)
    return (save_img("wood_col", col), save_img("wood_rough", r, "Non-Color"),
            save_img("wood_nrm", height_to_normal(grain * 0.15 - seam * 0.8, 2.0), "Non-Color"))


def roof_set():
    u = np.linspace(0, 1, TS, endpoint=False)[None, :]
    seam = (((u * 14) % 1.0) < 0.05).astype(float) * np.ones((TS, 1))
    base = srgb_lin("#55574f")
    dirt = np.clip(BLOTCH * 0.8 + STREAK * 0.3 - 0.4, 0, 1)
    col = base * (0.95 - dirt[..., None] * 0.35) * (1 - seam[..., None] * 0.4)
    r = np.clip(0.72 + dirt * 0.2, 0, 1)
    return (save_img("roof_col", col), save_img("roof_rough", r, "Non-Color"),
            save_img("roof_nrm", height_to_normal(-seam * 0.9 + DENT * 0.2, 2.0), "Non-Color"))


def tender_set(base="#3d4a2a"):
    """Tender side with a gold pinstripe panel and corner flourishes."""
    col_i, rough_i, nrm_i = paint_set("tender", base, 0.6, 0.32)
    px = np.array(col_i.pixels[:]).reshape(TS, TS, 4)[::-1, :, :3]
    # loaded sRGB PNG pixels come back as stored values; keep working in that space
    yy, xx = np.mgrid[0:TS, 0:TS] / TS
    line = np.zeros((TS, TS))
    for inset in (0.08, 0.1):
        d = np.minimum.reduce([np.abs(xx - inset), np.abs(xx - (1 - inset)), np.abs(yy - inset), np.abs(yy - (1 - inset))])
        inside = (xx > inset - 0.004) & (xx < 1 - inset + 0.004) & (yy > inset - 0.004) & (yy < 1 - inset + 0.004)
        line = np.maximum(line, ((d < 0.0035) & inside).astype(float))
    for cx, cy in ((0.08, 0.08), (0.92, 0.08), (0.08, 0.92), (0.92, 0.92)):
        r = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)
        line = np.maximum(line, (np.abs(r - 0.035) < 0.003).astype(float))
    gold = srgb_lin("#c9a24a") * (0.85 + BLOTCH[..., None] * 0.2)
    px = px * (1 - line[..., None]) + gold * line[..., None]
    bpy.data.images.remove(col_i)
    return save_img("tender_col", px), rough_i, nrm_i


BLACK = LIVERY == "black"
TEX = {
    # boiler jacket, splashers, valances
    "green": paint_set("green", "#1d1e1f" if BLACK else "#3e4b2b", 0.5 if BLACK else 0.6, 0.38, soot=0.35),
    # wheels, domes, lamp, pilot beam: signal red, or black on the black engine
    "red": paint_set("red", "#232220" if BLACK else "#5e1f17", 0.55, 0.42, chips_hex="#3a3530" if BLACK else "#2e2420"),
    "graphite": paint_set("graphite", "#3b3c3a", 0.7, 0.5, soot=0.6),
    "iron": iron_set("iron", "#2c2b29", 0.35),
    "steel": iron_set("steel", "#6f6f6c", 0.15),
    "brass": brass_set(),
    # the black engine's cab is painted, not varnished
    "wood": paint_set("wood", "#1f1e1c", 0.52, 0.35) if BLACK else wood_set(),
    "roof": roof_set(),
    "tender": tender_set("#1c1d1e" if BLACK else "#3d4a2a"),
}


def mat(name, tex=None, color=(1, 1, 1), rough=0.5, metal=0.0, emit=None, emit_strength=0.0, normal_strength=0.6):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if tex:
        col, rgh, nrm = TEX[tex]
        uv = nt.nodes.new("ShaderNodeUVMap")

        def tn(img):
            t = nt.nodes.new("ShaderNodeTexImage")
            t.image = img
            nt.links.new(uv.outputs["UV"], t.inputs["Vector"])
            return t
        nt.links.new(tn(col).outputs["Color"], b.inputs["Base Color"])
        nt.links.new(tn(rgh).outputs["Color"], b.inputs["Roughness"])
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nm.inputs["Strength"].default_value = normal_strength
        nt.links.new(tn(nrm).outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], b.inputs["Normal"])
    if emit:
        b.inputs["Emission Color"].default_value = (*emit, 1)
        b.inputs["Emission Strength"].default_value = emit_strength
    return m


M = {
    "green": mat("Olive paint", "green", metal=0.0),
    "red": mat("Signal red paint", "red"),
    "graphite": mat("Smokebox graphite", "graphite", metal=0.35),
    "iron": mat("Running gear iron", "iron", metal=0.6),
    "steel": mat("Rod steel", "steel", metal=0.9),
    "brass": mat("Tarnished brass", "brass", metal=1.0),
    "wood": mat("Varnished cab wood", "wood"),
    "roof": mat("Cab roof", "roof", metal=0.2),
    "tender": mat("Tender paint", "tender"),
    "glass": mat("Cab glass", None, (0.04, 0.05, 0.06), 0.08),
    "lens": mat("Headlamp lens", None, (1.0, 0.85, 0.6), 0.1, emit=(1.0, 0.8, 0.5), emit_strength=16.0),
    "coal": mat("Coal", None, (0.012, 0.012, 0.013), 0.6, 0.1),
    "gold": mat("Gilt", "brass", metal=1.0),
}

# ── modelling helpers ───────────────────────────────────────────────
objs = []


def put(obj, material, smooth=True):
    obj.data.materials.clear()
    obj.data.materials.append(M[material])
    if smooth:
        for p in obj.data.polygons:
            p.use_smooth = True
    return obj


def select_only(o):
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    bpy.context.view_layer.objects.active = o


def apply(o, loc=False, rot=True, scale=True):
    select_only(o)
    bpy.ops.object.transform_apply(location=loc, rotation=rot, scale=scale)


def bevel(obj, width=0.02, segments=2):
    mod = obj.modifiers.new("bevel", "BEVEL")
    mod.width = width
    mod.segments = segments
    mod.limit_method = "ANGLE"
    return obj


def box(name, size, loc, material, bev=0.015, rot=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.object
    o.name = name
    o.scale = size
    if rot:
        o.rotation_euler = rot
    apply(o)
    put(o, material, smooth=False)
    if bev:
        bevel(o, bev, 2)
    return o


def cyl(name, r, depth, loc, material, axis="X", verts=36, bev=0.0, r2=None):
    rot = {"X": (0, math.pi / 2, 0), "Y": (math.pi / 2, 0, 0), "Z": (0, 0, 0)}[axis]
    if r2 is None:
        bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth, location=loc, rotation=rot)
    else:
        bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r, radius2=r2, depth=depth, location=loc, rotation=rot)
    o = bpy.context.object
    o.name = name
    apply(o)
    put(o, material)
    if bev:
        bevel(o, bev, 3)
    return o


def lathe(name, profile, loc, material, steps=36):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    vs = [bm.verts.new((r, 0, z)) for r, z in profile]
    edges = [bm.edges.new((vs[i], vs[i + 1])) for i in range(len(vs) - 1)]
    bmesh.ops.spin(bm, geom=vs + edges, cent=(0, 0, 0), axis=(0, 0, 1), angle=2 * math.pi, steps=steps, use_merge=True)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    SCN.collection.objects.link(o)
    o.location = loc
    return put(o, material)


def ring(name, r_in, r_out, width, material, y_off=0.0, steps=48):
    h = width / 2
    o = lathe(name, [(r_in, -h), (r_out, -h), (r_out, h), (r_in, h), (r_in, -h)], (0, 0, 0), material, steps)
    o.rotation_euler = (math.pi / 2, 0, 0)
    o.location = (0, y_off, 0)
    apply(o, loc=True)
    return o


def empty(name, loc):
    e = bpy.data.objects.new(name, None)
    e.location = loc
    SCN.collection.objects.link(e)
    return e


def join(name, parts):
    for o in parts:
        for m in list(o.modifiers):
            bpy.context.view_layer.objects.active = o
            bpy.ops.object.modifier_apply(modifier=m.name)
    bpy.ops.object.select_all(action="DESELECT")
    for o in parts:
        o.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    o = bpy.context.object
    o.name = name
    return o


def wheel(name, r, x, y, spokes, material="red", tire_w=0.13, counterweight=True, hub_mat=None):
    parts = []
    inner = -1 if y > 0 else 1
    parts.append(ring(name + "_tyre", r - 0.055, r, tire_w, "steel"))
    parts.append(ring(name + "_flange", r - 0.02, r + 0.045, 0.03, "steel", inner * (tire_w / 2 - 0.015)))
    parts.append(ring(name + "_rim", r - 0.13, r - 0.05, tire_w - 0.02, material))
    if spokes == 0:
        parts.append(cyl(name + "_disc", r - 0.12, tire_w - 0.05, (0, 0, 0), material, "Y", 48))
        for i in range(8):           # cast-iron plate wheel: raised ribs
            a = 2 * math.pi * i / 8
            s = box(name + f"_rib{i}", (r * 0.62, tire_w - 0.02, 0.035), (math.cos(a) * r * 0.42, 0, math.sin(a) * r * 0.42), material, 0.006)
            s.rotation_euler = (0, -a, 0)
            apply(s)
            parts.append(s)
    parts.append(cyl(name + "_hub", r * 0.21, tire_w + 0.06, (0, 0, 0), material, "Y", 32, 0.01))
    parts.append(cyl(name + "_cap", r * 0.1, tire_w + 0.1, (0, 0, 0), hub_mat or "brass", "Y", 24))
    for i in range(spokes):          # tapered elliptical spokes
        a = 2 * math.pi * i / spokes
        mid = r * 0.56
        s = cyl(name + f"_sp{i}", 0.036, r * 0.76, (0, 0, 0), material, "X", 10, r2=0.026)
        s.scale = (1, 0.8, 1)
        s.rotation_euler = (0, -a, 0)
        s.location = (math.cos(a) * mid, 0, math.sin(a) * mid)
        apply(s, loc=True)
        parts.append(s)
    if counterweight:
        cw = cyl(name + "_cw", r * 0.66, 0.07, (0, 0, 0), material, "Y", 48)
        cut = box(name + "_cwcut", (r * 2, 0.3, r * 2), (0, 0, r * 0.64), "red", 0)
        mod = cw.modifiers.new("cut", "BOOLEAN"); mod.operation = "DIFFERENCE"; mod.object = cut
        bpy.context.view_layer.objects.active = cw
        bpy.ops.object.modifier_apply(modifier="cut")
        bpy.data.objects.remove(cut)
        parts.append(cw)
        parts.append(cyl(name + "_pin", 0.055, tire_w + 0.18, (r * 0.45, 0, 0), "steel", "Y", 20))
    w = join(name, parts)
    w.location = (x, y, r)
    return w


# ── dimensions ──────────────────────────────────────────────────────
DR = 0.84            # driver radius (66 in)
LR = 0.42            # lead truck wheel
GAUGE = 0.72
D1, D2 = -1.25, 0.65
L1, L2 = 3.05, 4.15
BZ = 2.05            # boiler centreline
BR = 0.64

# ── frame, running boards, steps ────────────────────────────────────
objs.append(box("Frame", (7.2, 1.1, 0.3), (0.9, 0, 0.92), "iron", 0.02))
for s, side in ((1, "L"), (-1, "R")):
    objs.append(box(f"RunBoard_{side}", (5.0, 0.42, 0.05), (1.55, s * 0.93, 1.36), "iron", 0.008))
    objs.append(box(f"RunEdge_{side}", (5.0, 0.03, 0.09), (1.55, s * 1.14, 1.34), "brass", 0.005))
    objs.append(box(f"Valance_{side}", (5.0, 0.03, 0.24), (1.55, s * 1.13, 1.22), "green", 0.005))
    objs.append(box(f"CabStep_{side}", (0.36, 0.34, 0.04), (-2.25, s * 1.05, 0.62), "iron", 0.005))
    objs.append(box(f"CabStep2_{side}", (0.36, 0.34, 0.04), (-2.25, s * 1.05, 1.0), "iron", 0.005))

# ── boiler: olive green with thin brass bands ───────────────────────
objs.append(cyl("Boiler", BR, 4.4, (1.35, 0, BZ), "green", "X", 56, 0.015))
for i, bx in enumerate((-0.68, 0.12, 0.92, 1.72, 2.52, 3.3)):
    objs.append(cyl(f"Band{i}", BR + 0.012, 0.045, (bx, 0, BZ), "brass", "X", 56))
# wagon-top firebox, green, stepped up into the cab
objs.append(box("Firebox", (1.25, 1.3, 1.25), (-1.5, 0, 1.8), "green", 0.09))
objs.append(cyl("FireboxTop", 0.72, 1.25, (-1.5, 0, 2.35), "green", "X", 64))
# smokebox: graphite, with a heavy front ring and the number plate
objs.append(cyl("Smokebox", BR + 0.07, 1.2, (4.1, 0, BZ), "graphite", "X", 56, 0.02))
objs.append(cyl("SmokeboxRing", BR + 0.1, 0.09, (4.68, 0, BZ), "graphite", "X", 56, 0.02))
objs.append(cyl("SmokeboxDoor", BR - 0.02, 0.1, (4.74, 0, BZ), "graphite", "X", 56, 0.04))
objs.append(cyl("NumberPlateRing", 0.2, 0.05, (4.8, 0, BZ + 0.12), "red", "X", 48))
objs.append(cyl("NumberPlate", 0.16, 0.06, (4.81, 0, BZ + 0.12), "brass", "X", 48))
for a in (0, 1, 2, 3):   # door dogs
    ang = a * math.pi / 2 + math.pi / 4
    objs.append(cyl(f"Dog{a}", 0.035, 0.08, (4.79, math.cos(ang) * 0.5, BZ + math.sin(ang) * 0.5), "steel", "X", 12))
objs.append(box("Saddle", (1.0, 1.15, 0.75), (4.05, 0, 1.4), "graphite", 0.05))

# stack: straight pipe rising into a big flared cone, a lip on top (in-county style)
objs.append(lathe("Stack", [
    (0.0, 0.0), (0.42, 0.0), (0.3, 0.1), (0.21, 0.22), (0.2, 1.25),          # base flare + pipe
    (0.24, 1.32), (0.5, 1.9), (0.54, 1.98), (0.56, 2.04), (0.5, 2.06),       # cone + lip
    (0.18, 1.7), (0.0, 1.7)], (4.15, 0, BZ + BR - 0.08), "graphite", 56))
objs.append(cyl("StackBand", 0.215, 0.05, (4.15, 0, BZ + BR + 1.15), "brass", "Z", 48))

# domes: red caps, brass rings, graphite bodies, finials
for nm, x in (("SandDome", 2.75), ("SteamDome", 1.05)):
    objs.append(lathe(nm + "Base", [(0.0, 0.0), (0.5, 0.0), (0.4, 0.1), (0.36, 0.14), (0.0, 0.14)], (x, 0, BZ + BR - 0.16), "graphite"))
    objs.append(lathe(nm, [(0.0, 0.0), (0.35, 0.0), (0.35, 0.5), (0.0, 0.5)], (x, 0, BZ + BR - 0.06), "graphite"))
    objs.append(cyl(nm + "Band1", 0.36, 0.06, (x, 0, BZ + BR + 0.08), "red", "Z", 48))
    objs.append(cyl(nm + "Band2", 0.365, 0.03, (x, 0, BZ + BR + 0.22), "brass", "Z", 48))
    objs.append(lathe(nm + "Cap", [(0.0, 0.0), (0.38, 0.0), (0.38, 0.06), (0.3, 0.18), (0.16, 0.26), (0.0, 0.28)], (x, 0, BZ + BR + 0.42), "red"))
    objs.append(lathe(nm + "Finial", [(0.0, 0.0), (0.05, 0.0), (0.03, 0.08), (0.06, 0.12), (0.0, 0.18)], (x, 0, BZ + BR + 0.7), "brass", 16))
# safety valves + whistle in brass
objs.append(lathe("Whistle", [(0.0, 0.0), (0.035, 0.0), (0.035, 0.24), (0.07, 0.26), (0.07, 0.6), (0.05, 0.64), (0.0, 0.66)], (0.3, 0, BZ + BR + 0.05), "brass", 24))
objs.append(cyl("Pops", 0.06, 0.2, (0.55, 0, BZ + BR + 0.1), "brass", "Z", 20))

# bell in a red yoke
objs.append(lathe("Bell", [(0.0, 0.42), (0.07, 0.42), (0.12, 0.36), (0.15, 0.2), (0.22, 0.04), (0.24, 0.0), (0.0, 0.0)], (1.95, 0, BZ + BR + 0.24), "brass", 40))
for s in (1, -1):
    objs.append(box(f"YokeArm{s}", (0.07, 0.06, 0.55), (1.95, s * 0.3, BZ + BR + 0.42), "red", 0.01))
objs.append(box("YokeTop", (0.08, 0.66, 0.07), (1.95, 0, BZ + BR + 0.7), "red", 0.01))
objs.append(lathe("YokeFinial", [(0.0, 0.0), (0.06, 0.0), (0.04, 0.08), (0.08, 0.14), (0.0, 0.22)], (1.95, 0, BZ + BR + 0.73), "brass", 16))
objs.append(box("BellStand", (0.3, 0.5, 0.12), (1.95, 0, BZ + BR + 0.02), "graphite", 0.02))

# headlamp: red box lamp, gold corner trim, brass crest, round lens
LX, LZ = 4.45, BZ + BR + 0.52
objs.append(box("LampBody", (0.66, 0.6, 0.72), (LX, 0, LZ), "red", 0.03))
for sy in (1, -1):
    for sx in (1, -1):
        objs.append(box(f"LampPost{sx}{sy}", (0.05, 0.05, 0.76), (LX + sx * 0.33, sy * 0.3, LZ), "brass", 0.006))
    objs.append(box(f"LampPanel{sy}", (0.42, 0.02, 0.44), (LX, sy * 0.305, LZ), "brass", 0.004))
    objs.append(box(f"LampPanelIn{sy}", (0.36, 0.024, 0.38), (LX, sy * 0.306, LZ), "red", 0.004))
objs.append(box("LampRoof", (0.78, 0.72, 0.07), (LX, 0, LZ + 0.39), "red", 0.02))
objs.append(lathe("LampChimney", [(0.0, 0.0), (0.12, 0.0), (0.08, 0.1), (0.08, 0.2), (0.14, 0.24), (0.0, 0.28)], (LX - 0.1, 0, LZ + 0.42), "graphite", 20))
objs.append(box("LampCrest", (0.05, 0.5, 0.26), (LX + 0.3, 0, LZ + 0.55), "brass", 0.01))
objs.append(cyl("LampCrestDisc", 0.13, 0.05, (LX + 0.32, 0, LZ + 0.55), "brass", "X", 32))
objs.append(cyl("LampBezel", 0.25, 0.06, (LX + 0.34, 0, LZ - 0.02), "brass", "X", 48))
objs.append(cyl("LampLens", 0.22, 0.04, (LX + 0.36, 0, LZ - 0.02), "lens", "X", 48))
objs.append(box("LampBracket", (0.5, 0.36, 0.3), (LX, 0, BZ + BR + 0.05), "graphite", 0.02))
empty("Headlamp", (LX + 0.4, 0, LZ - 0.02))

# cylinders + steam chests, graphite with brass heads
for s, side in ((1, "L"), (-1, "R")):
    y = s * 1.0
    objs.append(cyl(f"Cylinder_{side}", 0.33, 1.05, (3.75, y, 1.2), "graphite", "X", 48, 0.02))
    objs.append(cyl(f"CylHeadF_{side}", 0.345, 0.08, (4.29, y, 1.2), "graphite", "X", 48, 0.015))
    objs.append(cyl(f"CylRingF_{side}", 0.35, 0.025, (4.25, y, 1.2), "brass", "X", 48))
    objs.append(cyl(f"CylHeadB_{side}", 0.345, 0.08, (3.21, y, 1.2), "graphite", "X", 48, 0.015))
    objs.append(box(f"SteamChest_{side}", (0.95, 0.42, 0.34), (3.75, y * 0.98, 1.65), "graphite", 0.03))
    objs.append(box(f"ChestPlate_{side}", (0.6, 0.03, 0.18), (3.75, y * 1.19, 1.65), "brass", 0.006))
    objs.append(box(f"Guide_{side}", (1.6, 0.08, 0.13), (2.35, y * 1.02, 1.2), "steel", 0.01))
    objs.append(box(f"Crosshead_{side}", (0.3, 0.12, 0.22), (2.95, y * 1.02, 1.2), "steel", 0.015))
    objs.append(cyl(f"Handrail_{side}", 0.018, 4.3, (1.7, s * (BR + 0.13), BZ + 0.18), "brass", "X", 12))
    objs.append(cyl(f"SandPipe_{side}", 0.025, 1.5, (2.1, s * 0.62, 1.55), "graphite", "Z", 10))
    objs.append(box(f"Splasher_{side}", (2.2, 0.2, 0.08), ((D1 + D2) / 2, s * 0.86, 1.72), "green", 0.02))

# pilot: graphite cowcatcher slats fanned down to the rails, beam, coupler
pil = []
for i in range(13):
    t = (i - 6) / 6.0
    s = box(f"Slat{i}", (1.0 - abs(t) * 0.18, 0.045, 0.06), (0, 0, 0), "graphite", 0.006)
    s.rotation_euler = (0, math.radians(36), math.radians(t * 30))
    s.location = (4.5 + 0.4 * math.cos(math.radians(36)), t * 0.56, 0.92 - 0.4 * math.sin(math.radians(36)) - 0.06)
    apply(s, loc=True)
    pil.append(s)
pil.append(box("PilotBeam", (0.22, 1.85, 0.3), (4.45, 0, 0.98), "red", 0.02))
pil.append(box("PilotRail", (0.06, 1.7, 0.06), (4.9, 0, 0.54), "graphite", 0.01))
pil.append(box("Coupler", (0.5, 0.14, 0.12), (4.72, 0, 0.98), "steel", 0.01))
objs.append(join("Pilot", pil))

# ── cab: varnished planks, front windows, porthole side windows ─────
cab = []
CX = -2.05
cab.append(box("CabFront", (0.1, 2.0, 1.9), (-1.08, 0, 2.6), "wood", 0.01))
for wy in (0.55, -0.55):
    cab.append(box(f"FrontWin{wy}", (0.12, 0.48, 0.5), (-1.08, wy, 3.05), "glass", 0.005))
    cab.append(box(f"FrontWinF{wy}", (0.11, 0.56, 0.58), (-1.075, wy, 3.05), "brass", 0.005))
for s, side in ((1, "L"), (-1, "R")):
    cab.append(box(f"CabWall_{side}", (1.95, 0.09, 1.9), (CX, s * 0.98, 2.6), "wood", 0.01))
    cab.append(box(f"CabBelt_{side}", (1.98, 0.11, 0.08), (CX, s * 0.99, 2.38), "graphite", 0.005))
    cab.append(box(f"CabSill_{side}", (2.0, 0.12, 0.1), (CX, s * 1.0, 1.68), "graphite", 0.005))
    for k, px in enumerate((-1.65, -2.4)):         # two portholes per side
        pr = cyl(f"Port_{side}{k}", 0.2, 0.12, (px, s * 0.99, 2.92), "glass", "Y", 32)
        cab.append(pr)
        cab.append(ring(f"PortRing_{side}{k}", 0.19, 0.25, 0.13, "brass", 0.0))
        cab[-1].location = (px, s * 0.99, 2.92)
        apply(cab[-1], loc=True)
    cab.append(box(f"CabPost_{side}", (0.1, 0.12, 1.9), (-3.0, s * 0.98, 2.6), "wood", 0.01))
# arched roof with eaves: top half of a squashed ellipsoid, planked grey, plus a rain strip
roof = cyl("CabRoof", 1.24, 2.4, (CX, 0, 3.55), "roof", "X", 64)
roof.scale = (1, 1, 0.26)
apply(roof)
for v in roof.data.vertices:          # keep the upper arch: a barrel roof running fore and aft
    if v.co.z < 0:
        v.co.z = 0
cab.append(roof)
cab.append(box("RoofFascia", (2.4, 2.48, 0.06), (CX, 0, 3.53), "roof", 0.01))
objs.append(join("Cab", cab))

# ── wheels ──────────────────────────────────────────────────────────
for side, y in (("L", GAUGE), ("R", -GAUGE)):
    for i, x in enumerate((D1, D2)):
        objs.append(wheel(f"Driver_{side}{i + 1}", DR, x, y, 16))
    for i, x in enumerate((L1, L2)):
        objs.append(wheel(f"Lead_{side}{i + 1}", LR, x, y, 10, counterweight=False))
objs.append(box("LeadTruck", (1.6, 1.2, 0.2), ((L1 + L2) / 2, 0, LR + 0.1), "iron", 0.02))
for s in (1, -1):
    objs.append(box(f"Equaliser{s}", (2.2, 0.08, 0.12), ((D1 + D2) / 2, s * 0.6, 0.95), "iron", 0.01))

for side, y in (("L", GAUGE + 0.17), ("R", -GAUGE - 0.17)):
    r = box(f"SideRod_{side}", (D2 - D1 + 0.26, 0.05, 0.13), (0, 0, 0), "steel", 0.02)
    r.location = ((D1 + D2) / 2, y, DR)
    m = box(f"MainRod_{side}", (2.0, 0.06, 0.14), (0, 0, 0), "steel", 0.02)
    m.location = (D2 + 1.0, y + (0.07 if y > 0 else -0.07), 1.2)
    objs += [r, m]

empty("Smoke", (4.15, 0, BZ + BR + 2.05))

# ── tender: green with gold panels, coal, trucks ────────────────────
TX = -5.7
ten = []
ten.append(box("TenderTank", (3.9, 2.05, 1.3), (TX, 0, 1.78), "tender", 0.05))
ten.append(box("TenderFlare", (3.95, 2.12, 0.1), (TX, 0, 2.48), "graphite", 0.02))
ten.append(box("TenderFrame", (4.2, 1.6, 0.25), (TX, 0, 1.0), "iron", 0.02))
ten.append(box("CoalBoards", (2.4, 1.85, 0.36), (TX + 0.6, 0, 2.7), "wood", 0.02))
ten.append(box("TankHatch", (0.6, 0.6, 0.12), (TX - 1.3, 0, 2.55), "graphite", 0.02))
ten.append(box("TenderBeam", (0.2, 1.9, 0.28), (TX - 2.0, 0, 1.0), "red", 0.02))
objs.append(join("Tender", ten))

bpy.ops.mesh.primitive_grid_add(x_subdivisions=48, y_subdivisions=30, size=1, location=(TX + 0.6, 0, 2.7))
coal = bpy.context.object
coal.name = "Coal"
coal.scale = (2.3, 1.78, 1)
apply(coal)
for v in coal.data.vertices:
    nx = (v.co.x - TX - 0.6) / 1.15
    ny = v.co.y / 0.89
    d = max(0.0, 1.0 - (nx * nx * 0.7 + ny * ny))
    v.co.z += 0.5 * d ** 0.7 + random.uniform(-0.05, 0.05) * d
put(coal, "coal")
objs.append(coal)

for bi, bx in enumerate((TX + 1.15, TX - 1.15)):
    objs.append(box(f"TenderTruck{bi}", (1.35, 1.25, 0.24), (bx, 0, 0.62), "iron", 0.02))
    for s in (1, -1):
        objs.append(box(f"TruckSide{bi}{s}", (1.3, 0.08, 0.3), (bx, s * 0.92, 0.48), "iron", 0.02))
    for side, y in (("L", GAUGE), ("R", -GAUGE)):
        for j, dx in enumerate((-0.45, 0.45)):
            objs.append(wheel(f"TenderWheel_{side}{bi}{j}", 0.42, bx + dx, y, 0, "iron", counterweight=False, hub_mat="iron"))

objs.append(box("Drawbar", (1.4, 0.2, 0.12), (-3.2, 0, 0.92), "iron", 0.01))

# ── finish: apply modifiers, UVs at world scale, AO into vertex colours ─
meshes = [o for o in SCN.objects if o.type == "MESH"]
for o in meshes:
    if o.modifiers:
        bpy.context.view_layer.objects.active = o
        for m in list(o.modifiers):
            bpy.ops.object.modifier_apply(modifier=m.name)

for o in meshes:   # one texture repeat per ~1.6 m everywhere
    select_only(o)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.cube_project(cube_size=1.6, scale_to_bounds=False, correct_aspect=True)
    bpy.ops.object.mode_set(mode="OBJECT")
# the tender sides carry the pinstripe panel: fit each side face to the full texture
tender = bpy.data.objects["Tender"]
me = tender.data
uvl = me.uv_layers.active.data
for p in me.polygons:
    n = p.normal
    if abs(n.y) > 0.9 and p.area > 2.0:
        xs = [me.vertices[me.loops[li].vertex_index].co.x for li in p.loop_indices]
        zs = [me.vertices[me.loops[li].vertex_index].co.z for li in p.loop_indices]
        x0, x1, z0, z1 = min(xs), max(xs), min(zs), max(zs)
        for li in p.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            uvl[li].uv = ((co.x - x0) / (x1 - x0), (co.z - z0) / (z1 - z0))

if not FAST:
    SCN.render.engine = "CYCLES"
    SCN.cycles.samples = 48
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "METAL"; prefs.get_devices()
        for d in prefs.devices: d.use = True
        SCN.cycles.device = "GPU"
    except Exception:
        pass
    world = bpy.data.worlds.new("Bake"); world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (1, 1, 1, 1)
    SCN.world = world
    SCN.render.bake.target = "VERTEX_COLORS"
    world.light_settings.distance = 1.2
    for o in meshes:
        if o.name == "Coal":
            continue
        if not o.data.color_attributes:
            o.data.color_attributes.new("AO", "BYTE_COLOR", "CORNER")
        o.data.color_attributes.active_color = o.data.color_attributes["AO"]
    bpy.ops.object.select_all(action="DESELECT")
    for o in meshes:
        if o.name != "Coal":
            o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.bake(type="AO")
    # soften: AO only darkens to 35%, so the paint still reads in the crevices
    for o in meshes:
        if o.name == "Coal" or "AO" not in o.data.color_attributes:
            continue
        ca = o.data.color_attributes["AO"]
        arr = np.empty(len(ca.data) * 4, dtype=np.float32)
        ca.data.foreach_get("color", arr)
        a = arr.reshape(-1, 4)
        a[:, :3] = 0.35 + 0.65 * a[:, :3]
        ca.data.foreach_set("color", a.ravel())

out = os.path.join(OUT, "loco" + SUFFIX + ".glb")
bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_apply=True, export_yup=True,
                          export_image_format="JPEG", export_image_quality=78,
                          export_vertex_color="ACTIVE" if not FAST else "MATERIAL",
                          export_cameras=False, export_lights=False)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, "loco" + SUFFIX + ".blend"))
print("WROTE", out, os.path.getsize(out))
