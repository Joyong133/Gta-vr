"""prep.py가 만든 work/<지역>/mesh.npz로 Blender 씬(work/<지역>/<지역>.blend)을 만든다.

Blender 안에서:   blender -b -P build_blender.py -- <지역> [렌더폴더]
bpy 모듈로:       python build_blender.py <지역> [렌더폴더]
"""
import json, math, os, sys

import bpy
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import region, work_dir  # noqa: E402

args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
REGION = region(args[0])
NPZ = os.path.join(work_dir(REGION["id"]), "mesh.npz")
BLEND = os.path.join(work_dir(REGION["id"]), REGION["id"] + ".blend")
RENDER_DIR = args[1] if len(args) > 1 else None

D = np.load(NPZ)
META = json.loads(bytes(D["meta"]).decode())
LON0, LAT0 = META["origin_lonlat"]


def ll(lon, lat):
    """경위도 → 씬 좌표(m). 카메라 배치용 근사."""
    return ((lon - LON0) * math.cos(math.radians(LAT0)) * 111320.0, (lat - LAT0) * 110574.0)


# ------------------------------------------------------------------ 기본
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.unit_settings.system = "METRIC"
    return sc


def collection(name, parent=None):
    c = bpy.data.collections.new(name)
    (parent or bpy.context.scene.collection).children.link(c)
    return c


def make_mesh(name, v, fs, fi, coll, mats=(), uv=None, mat_idx=None, face_attr=None, smooth=False):
    me = bpy.data.meshes.new(name)
    me.vertices.add(len(v))
    me.vertices.foreach_set("co", np.ascontiguousarray(v, np.float32).ravel())
    me.loops.add(len(fi))
    me.loops.foreach_set("vertex_index", np.ascontiguousarray(fi, np.int32))
    me.polygons.add(len(fs))
    me.polygons.foreach_set("loop_start", np.concatenate([[0], np.cumsum(fs)[:-1]]).astype(np.int32))
    if uv is not None:
        me.uv_layers.new(name="UVMap").data.foreach_set("uv", np.ascontiguousarray(uv, np.float32).ravel())
    if mat_idx is not None:
        me.polygons.foreach_set("material_index", np.ascontiguousarray(mat_idx, np.int32))
    if face_attr is not None:
        me.attributes.new("tint", "FLOAT", "FACE").data.foreach_set("value", np.ascontiguousarray(face_attr, np.float32))
    if smooth:
        me.polygons.foreach_set("use_smooth", np.ones(len(fs), bool))
    me.update(calc_edges=True)
    me.validate(clean_customdata=False)
    for m in mats:
        me.materials.append(m)
    ob = bpy.data.objects.new(name, me)
    coll.objects.link(ob)
    return ob


def from_npz(prefix, name, coll, mats, **kw):
    if prefix + "_v" not in D:
        return None
    return make_mesh(name, D[prefix + "_v"], D[prefix + "_fs"], D[prefix + "_fi"], coll, mats,
                     uv=D[prefix + "_uv"], mat_idx=D[prefix + "_mat"], face_attr=D[prefix + "_attr"], **kw)


# ------------------------------------------------------------------ 재질
def mat_basic(name, color, rough=0.8, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    m.diffuse_color = (*color, 1)
    return m


def node(nt, kind, x=0, y=0, **props):
    n = nt.nodes.new(kind)
    n.location = (x, y)
    for k, v in props.items():
        setattr(n, k, v)
    return n


def math_node(nt, op, a, b, x=0, y=0):
    n = node(nt, "ShaderNodeMath", x, y, operation=op)
    for i, val in enumerate((a, b)):
        if isinstance(val, (int, float)):
            n.inputs[i].default_value = val
        else:
            nt.links.new(val, n.inputs[i])
    return n.outputs[0]


def ramp(nt, inp, stops, x=0, y=0):
    r = node(nt, "ShaderNodeValToRGB", x, y)
    els = r.color_ramp.elements
    els[0].position, els[0].color = stops[0][0], (*stops[0][1], 1)
    els[1].position, els[1].color = stops[-1][0], (*stops[-1][1], 1)
    for pos, c in stops[1:-1]:
        e = els.new(pos)
        e.color = (*c, 1)
    nt.links.new(inp, r.inputs[0])
    return r.outputs[0]


def band(nt, val, lo, hi, x, y):
    return math_node(nt, "MULTIPLY", math_node(nt, "GREATER_THAN", val, lo, x, y), math_node(nt, "LESS_THAN", val, hi, x, y - 150), x + 180, y)


def mat_facade(name, palette, bay, floor, wx, wy, glass, wall_rough=0.75):
    """벽: UV(u=벽 둘레 m, v=높이 m)로 창문 격자를 그린다. 면 속성 tint로 건물마다 색을 바꾼다."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    uv = node(nt, "ShaderNodeUVMap", -1600, 0)
    sep = node(nt, "ShaderNodeSeparateXYZ", -1400, 0)
    nt.links.new(uv.outputs[0], sep.inputs[0])
    fx = math_node(nt, "FRACT", math_node(nt, "DIVIDE", sep.outputs[0], bay, -1200, 100), 0, -1000, 100)
    fy = math_node(nt, "FRACT", math_node(nt, "DIVIDE", sep.outputs[1], floor, -1200, -100), 0, -1000, -100)
    mx = band(nt, fx, wx[0], wx[1], -800, 200)
    my = band(nt, fy, wy[0], wy[1], -800, -200)
    ground = math_node(nt, "GREATER_THAN", sep.outputs[1], 1.2, -800, -500)
    mask = math_node(nt, "MULTIPLY", math_node(nt, "MULTIPLY", mx, my, -550, 0), ground, -400, 0)
    attr = node(nt, "ShaderNodeAttribute", -1000, 400, attribute_name="tint", attribute_type="GEOMETRY")
    wall = ramp(nt, attr.outputs["Fac"], palette, -700, 500)
    # 창마다 약간씩 다른 반사/밝기
    cell = node(nt, "ShaderNodeTexWhiteNoise", -1000, -700, noise_dimensions="2D")
    sc = node(nt, "ShaderNodeVectorMath", -1200, -700, operation="DIVIDE")
    nt.links.new(uv.outputs[0], sc.inputs[0])
    sc.inputs[1].default_value = (bay, floor, 1)
    flo = node(nt, "ShaderNodeVectorMath", -1100, -850, operation="FLOOR")
    nt.links.new(sc.outputs[0], flo.inputs[0])
    nt.links.new(flo.outputs[0], cell.inputs["Vector"])
    gcol = node(nt, "ShaderNodeMix", -400, -500, data_type="RGBA")
    gcol.inputs["A"].default_value = (*glass, 1)
    gcol.inputs["B"].default_value = (glass[0] * 1.8 + 0.02, glass[1] * 1.8 + 0.02, glass[2] * 1.6 + 0.02, 1)
    nt.links.new(math_node(nt, "MULTIPLY", cell.outputs["Value"], 0.6, -700, -700), gcol.inputs["Factor"])
    mix = node(nt, "ShaderNodeMix", -150, 300, data_type="RGBA")
    nt.links.new(mask, mix.inputs["Factor"])
    nt.links.new(wall, mix.inputs["A"])
    nt.links.new(gcol.outputs["Result"], mix.inputs["B"])
    nt.links.new(mix.outputs["Result"], bsdf.inputs["Base Color"])
    rough = node(nt, "ShaderNodeMapRange", -150, 0)
    nt.links.new(mask, rough.inputs["Value"])
    rough.inputs["To Min"].default_value = wall_rough
    rough.inputs["To Max"].default_value = 0.06
    nt.links.new(rough.outputs[0], bsdf.inputs["Roughness"])
    m.diffuse_color = (*palette[0][1], 1)
    # export_web.py가 웹 셰이더에 같은 창문 격자를 쓰도록 값을 남겨 둔다
    m["web_facade"] = json.dumps({"bay": bay, "floor": floor, "wx": wx, "wy": wy, "glass": glass, "wall_rough": wall_rough})
    return m


def mat_attr_color(name, attr_name, rough=0.9, noise=True):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    at = node(nt, "ShaderNodeAttribute", -700, 200, attribute_name=attr_name)
    out = at.outputs["Color"]
    if noise:
        tex = node(nt, "ShaderNodeTexNoise", -700, -100)
        tex.inputs["Scale"].default_value = 0.02
        tex.inputs["Detail"].default_value = 6
        coord = node(nt, "ShaderNodeTexCoord", -900, -100)
        nt.links.new(coord.outputs["Object"], tex.inputs["Vector"])
        mul = node(nt, "ShaderNodeMix", -350, 100, data_type="RGBA", blend_type="MULTIPLY")
        mul.inputs["Factor"].default_value = 0.5
        nt.links.new(out, mul.inputs["A"])
        nt.links.new(ramp(nt, tex.outputs["Fac"], [(0.3, (0.7, 0.7, 0.7)), (0.7, (1.3, 1.3, 1.3))], -500, -150), mul.inputs["B"])
        out = mul.outputs["Result"]
    nt.links.new(out, bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = rough
    return m


def mat_tint(name, stops, rough=0.85):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    at = node(nt, "ShaderNodeAttribute", -700, 200, attribute_name="tint")
    nt.links.new(ramp(nt, at.outputs["Fac"], stops, -400, 200), nt.nodes["Principled BSDF"].inputs["Base Color"])
    nt.nodes["Principled BSDF"].inputs["Roughness"].default_value = rough
    m.diffuse_color = (*stops[0][1], 1)
    return m


def mat_water(name, color):
    m = mat_basic(name, color, rough=0.04)
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    tex = node(nt, "ShaderNodeTexNoise", -700, -300)
    tex.inputs["Scale"].default_value = 0.08
    tex.inputs["Detail"].default_value = 8
    coord = node(nt, "ShaderNodeTexCoord", -900, -300)
    nt.links.new(coord.outputs["Object"], tex.inputs["Vector"])
    bump = node(nt, "ShaderNodeBump", -300, -300)
    bump.inputs["Strength"].default_value = 0.12
    nt.links.new(tex.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return m


# ------------------------------------------------------------------ 나무(지오메트리 노드 인스턴싱)
def tree_proto(coll, crown_mat, trunk_mat):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=3.0, location=(0, 0, 6.2))
    crown = bpy.context.object
    crown.scale = (1, 1, 1.25)
    crown.data.materials.append(crown_mat)
    bpy.ops.mesh.primitive_cylinder_add(vertices=6, radius=0.35, depth=4.0, location=(0, 0, 2.0))
    trunk = bpy.context.object
    trunk.data.materials.append(trunk_mat)
    bpy.ops.object.select_all(action="DESELECT")
    crown.select_set(True)
    trunk.select_set(True)
    bpy.context.view_layer.objects.active = crown
    bpy.ops.object.join()
    bpy.ops.object.transform_apply(scale=True)
    tree = bpy.context.object
    tree.name = "Tree_Proto"
    for c in tree.users_collection:
        c.objects.unlink(tree)
    coll.objects.link(tree)
    tree.hide_render = True
    tree.hide_viewport = True
    return tree


def trees_object(coll, proto):
    t = D["trees"]
    me = bpy.data.meshes.new("Trees_Points")
    me.vertices.add(len(t))
    me.vertices.foreach_set("co", np.ascontiguousarray(t[:, :3]).ravel())
    me.attributes.new("scale", "FLOAT", "POINT").data.foreach_set("value", t[:, 3])
    me.attributes.new("rot", "FLOAT", "POINT").data.foreach_set("value", t[:, 4])
    ob = bpy.data.objects.new("Trees", me)
    coll.objects.link(ob)
    ng = bpy.data.node_groups.new("TreeScatter", "GeometryNodeTree")
    ng.interface.new_socket("Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
    ng.interface.new_socket("Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
    gi = node(ng, "NodeGroupInput", -800, 0)
    go = node(ng, "NodeGroupOutput", 400, 0)
    inst = node(ng, "GeometryNodeInstanceOnPoints", 100, 0)
    oi = node(ng, "GeometryNodeObjectInfo", -300, -200)
    oi.inputs["Object"].default_value = proto
    s = node(ng, "GeometryNodeInputNamedAttribute", -500, -400, data_type="FLOAT")
    s.inputs["Name"].default_value = "scale"
    r = node(ng, "GeometryNodeInputNamedAttribute", -500, -550, data_type="FLOAT")
    r.inputs["Name"].default_value = "rot"
    cx = node(ng, "ShaderNodeCombineXYZ", -300, -550)
    ng.links.new(r.outputs["Attribute"], cx.inputs["Z"])
    ng.links.new(gi.outputs[0], inst.inputs["Points"])
    ng.links.new(oi.outputs["Geometry"], inst.inputs["Instance"])
    ng.links.new(s.outputs["Attribute"], inst.inputs["Scale"])
    ng.links.new(cx.outputs[0], inst.inputs["Rotation"])
    ng.links.new(inst.outputs[0], go.inputs[0])
    mod = ob.modifiers.new("TreeScatter", "NODES")
    mod.node_group = ng
    return ob


# ------------------------------------------------------------------ 씬 구성
def build():
    sc = reset()
    rect = D["rect"]
    root = collection(REGION["name"])
    c_ground = collection("Terrain_Water", root)
    c_roads = collection("Roads", root)
    c_bld = collection("Buildings", root)
    c_lm = collection("Landmarks_150m+", root)
    c_nat = collection("Trees", root)
    c_cam = collection("Cameras_Lights", root)

    # 지형
    pal = np.array([[0.30, 0.29, 0.27], [0.045, 0.085, 0.03], [0.12, 0.22, 0.06], [0.72, 0.60, 0.42],
                    [0.32, 0.30, 0.28], [0.10, 0.14, 0.12], [0.26, 0.28, 0.10]], np.float32)
    v, q, c = D["terrain_v"], D["terrain_q"], D["terrain_c"]
    terr = make_mesh("Terrain", v, np.full(len(q), 4, np.int32), q.ravel(), c_ground,
                     [mat_attr_color("Ground", "gcol")], smooth=True)
    col = np.ones((len(v), 4), np.float32)
    col[:, :3] = pal[c] * np.random.default_rng(1).uniform(0.85, 1.15, (len(v), 1))
    terr.data.color_attributes.new("gcol", "FLOAT_COLOR", "POINT").data.foreach_set("color", col.ravel())

    if "backdrop_v" in D:
        bq = D["backdrop_q"]
        bv = D["backdrop_v"]
        bd = make_mesh("Backdrop_Terrain", bv, np.full(len(bq), 4, np.int32), bq.ravel(), c_ground, [terr.data.materials[0]], smooth=True)
        bcol = np.ones((len(bv), 4), np.float32)
        bcol[:, :3] = pal[D["backdrop_c"]]
        bd.data.color_attributes.new("gcol", "FLOAT_COLOR", "POINT").data.foreach_set("color", bcol.ravel())

    x0, y0, x1, y1 = map(float, rect)
    sea_m = mat_water("Sea", (0.01, 0.045, 0.06))
    sea_m.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.14
    big = 40000
    make_mesh("Sea", np.array([[x0 - big, y0 - big, 0], [x1 + big, y0 - big, 0], [x1 + big, y1 + big, 0], [x0 - big, y1 + big, 0]]),
              [4], [0, 1, 2, 3], c_ground, [sea_m])
    from_npz("inland_water", "Rivers_Ponds", c_ground, [mat_water("River", (0.02, 0.05, 0.045))])
    from_npz("sand", "Beaches", c_ground, [mat_basic("Sand", (0.62, 0.47, 0.28), 0.95)])

    # 도로/다리
    asph = mat_basic("Asphalt_Major", (0.035, 0.035, 0.038), 0.7)
    asph2 = mat_basic("Asphalt_Minor", (0.06, 0.06, 0.062), 0.8)
    paver = mat_basic("Sidewalk", (0.30, 0.27, 0.24), 0.9)
    rail = mat_basic("Railbed", (0.17, 0.13, 0.10), 0.9)
    conc = mat_basic("Concrete", (0.42, 0.41, 0.39), 0.85)
    paint = mat_basic("Paint", (0.8, 0.8, 0.75), 0.6)
    for key in sorted(k[:-2] for k in D.files if k.endswith("_v")):
        if key.startswith("roads_"):
            from_npz(key, "Roads_" + key[6:], c_roads, [asph, asph2, paver, rail])
        elif key.startswith("lanes_"):
            from_npz(key, "Lanes_" + key[6:], c_roads, [paint])
    from_npz("bridges", "Bridges_Overpasses", c_roads, [asph, conc])
    p = D["piers"]
    if len(p):
        cx, cy, za, zb, w = p.T
        corners = np.array([[-1, -1], [1, -1], [1, 1], [-1, 1]], np.float32)
        vv = []
        for z in (za, zb):
            vv.append(np.stack([np.column_stack([cx + sx * w / 2, cy + sy * w / 2, z]) for sx, sy in corners], 1))
        vv = np.concatenate(vv, 1).reshape(-1, 3)
        base = np.arange(len(p))[:, None] * 8
        box_f = np.array([[0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7], [4, 5, 6, 7]])
        fi = (base[:, None, :] + box_f[None]).reshape(-1)
        make_mesh("Bridge_Piers", vv, np.full(len(p) * 5, 4, np.int32), fi, c_roads, [conc])

    # 건물
    roof = mat_tint("Roof", [(0.0, (0.30, 0.30, 0.29)), (0.5, (0.42, 0.40, 0.37)), (0.8, (0.22, 0.30, 0.28)), (1.0, (0.35, 0.22, 0.18))])
    wall = mat_facade("Facade", [(0.0, (0.78, 0.77, 0.74)), (0.35, (0.70, 0.64, 0.55)), (0.6, (0.62, 0.63, 0.64)),
                                 (0.8, (0.85, 0.83, 0.78)), (1.0, (0.45, 0.50, 0.56))],
                      bay=3.4, floor=3.1, wx=(0.16, 0.84), wy=(0.30, 0.88), glass=(0.035, 0.05, 0.065))
    tower = mat_facade("Tower_Glass", [(0.0, (0.55, 0.60, 0.66)), (0.5, (0.65, 0.66, 0.66)), (1.0, (0.40, 0.46, 0.52))],
                       bay=1.6, floor=3.3, wx=(0.08, 0.96), wy=(0.12, 0.95), glass=(0.04, 0.07, 0.10), wall_rough=0.4)
    lm_names = META["landmarks"]
    for key in sorted(k for k in D.files if k.endswith("_v")):
        pre = key[:-2]
        if pre.startswith("bld_"):
            from_npz(pre, "Buildings_" + pre[4:], c_bld, [roof, wall])
        elif pre.startswith("bldlo_"):
            from_npz(pre, "BuildingsLow_" + pre[6:], c_bld, [roof, wall])
        elif pre.startswith("tower_"):
            i = int(pre.split("_")[1])
            from_npz(pre, f"Tower_{i:02d}_{lm_names[i]}", c_lm, [roof, tower])

    # 나무
    crown = mat_basic("Leaves", (0.05, 0.11, 0.03), 0.9)
    ont = crown.node_tree
    oinfo = node(ont, "ShaderNodeObjectInfo", -700, 200)
    nt_mix = node(ont, "ShaderNodeMix", -300, 200, data_type="RGBA")
    nt_mix.inputs["A"].default_value = (0.035, 0.08, 0.025, 1)
    nt_mix.inputs["B"].default_value = (0.09, 0.15, 0.04, 1)
    ont.links.new(oinfo.outputs["Random"], nt_mix.inputs["Factor"])
    ont.links.new(nt_mix.outputs["Result"], ont.nodes["Principled BSDF"].inputs["Base Color"])
    proto = tree_proto(c_nat, crown, mat_basic("Bark", (0.12, 0.08, 0.05), 0.9))
    trees_object(c_nat, proto)

    # 하늘/태양
    world = bpy.data.worlds.new("Sky")
    sc.world = world
    world.use_nodes = True
    wnt = world.node_tree
    sky = node(wnt, "ShaderNodeTexSky", -400, 0)
    for t in ("MULTIPLE_SCATTERING", "NISHITA", "HOSEK_WILKIE"):
        try:
            sky.sky_type = t
            break
        except TypeError:
            pass
    if hasattr(sky, "sun_elevation"):
        sky.sun_elevation = math.radians(32)
        sky.sun_rotation = math.radians(200)
        sky.altitude = 50
    bg = wnt.nodes["Background"]
    bg.inputs["Strength"].default_value = 0.25
    if hasattr(sky, "sun_disc"):
        sky.sun_disc = False
    wnt.links.new(sky.outputs[0], bg.inputs[0])
    sun = bpy.data.lights.new("Sun", "SUN")
    sun.energy = 3.5
    sun.color = (1.0, 0.95, 0.88)
    sun.angle = math.radians(1.5)
    sun_ob = bpy.data.objects.new("Sun", sun)
    sun_ob.rotation_euler = (math.radians(58), 0, math.radians(200 - 180 + 90))
    c_cam.objects.link(sun_ob)
    sc.view_settings.view_transform = "AgX"
    sc.view_settings.exposure = -0.8

    # 카메라
    def cam(name, pos_ll, z, tgt_ll, tz, lens=28, ortho=None):
        cd = bpy.data.cameras.new(name)
        cd.lens = lens
        cd.clip_start, cd.clip_end = 1, 60000
        if ortho:
            cd.type = "ORTHO"
            cd.ortho_scale = ortho
        ob = bpy.data.objects.new(name, cd)
        c_cam.objects.link(ob)
        px, py = ll(*pos_ll) if pos_ll else (0, 0)
        ob.location = (px, py, z)
        if tgt_ll:
            tx, ty = ll(*tgt_ll)
            d = np.array([tx - px, ty - py, tz - z])
            ob.rotation_euler = (math.atan2(math.hypot(d[0], d[1]), -d[2]), 0, math.atan2(d[1], d[0]) - math.pi / 2)
        return ob

    cams = [cam(c["name"], c["lonlat"], c["z"], c["target"], c["tz"], lens=c.get("lens", 28)) for c in REGION.get("cameras", [])]
    top = cam("CAM_Top_Map", None, 3000, None, 0, ortho=float(max(x1 - x0, y1 - y0)))
    top.location = ((x0 + x1) / 2, (y0 + y1) / 2, 3000)
    cams.append(top)
    sc.camera = cams[0]

    # 렌더 설정
    sc.render.resolution_x, sc.render.resolution_y = 1600, 900
    sc.render.engine = "CYCLES"
    sc.cycles.samples = 48
    sc.cycles.use_denoising = True
    sc.cycles.max_bounces = 4
    sc.render.film_transparent = False
    return sc, cams


def main():
    sc, cams = build()
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(BLEND), compress=True)
    print("저장:", BLEND)
    if RENDER_DIR:
        os.makedirs(RENDER_DIR, exist_ok=True)
        for c in cams:
            sc.camera = c
            if c.data.type == "ORTHO":
                sc.render.resolution_x, sc.render.resolution_y = 1600, int(1600 * (D["rect"][3] - D["rect"][1]) / (D["rect"][2] - D["rect"][0]))
            else:
                sc.render.resolution_x, sc.render.resolution_y = 1600, 900
            sc.render.filepath = os.path.join(os.path.abspath(RENDER_DIR), c.name + ".png")
            bpy.ops.render.render(write_still=True)
            print("렌더:", sc.render.filepath, flush=True)
        sc.camera = cams[0]


main()
