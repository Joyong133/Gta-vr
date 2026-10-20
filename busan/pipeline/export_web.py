"""Blender 씬(work/<지역>/<지역>.blend)에서 Quest 3(WebXR)용 에셋을 뽑는다.

bpy 모듈로:      python export_web.py <지역>
Blender 안에서:  blender -b -P export_web.py -- <지역>

결과
  work/<지역>/web_raw/{terrain,backdrop,city,roads}.glb    압축 전 GLB (build_region.sh가 gltfpack으로 압축)
  busan/regions/<지역>/region.json                 지역 정보(워프 지점, 높이맵 격자, 재질 값)
  busan/regions/<지역>/height.bin                  지형 높이(Int16, 0.1m 단위)
  busan/regions/<지역>/buildings.bin               건물 외곽선 + 바닥/꼭대기 높이(충돌, 옥상 착지)
  busan/regions/<지역>/trees.bin                   나무 위치(x, y, z, 크기, 회전) float32

.blend는 저장하지 않는다(웹용 감량은 내보낼 때만 적용).
"""
import json, os, sys, time

import bpy
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import region, web_dir, work_dir  # noqa: E402

TERRAIN_ERROR = 0.3   # 상세 지형 최대 높이 오차(m) — 걷기용 높이맵과 화면 지형이 이만큼 안에서 맞는다
TERRAIN_TILE = 128    # 지형 타일 한 변 격자 수(2의 거듭제곱)
BACKDROP_RATIO = 0.08  # 바깥 배경 지형
TREE_KEEP = 0.4       # 나무 유지 비율(Quest 부하)
ROAD_RATIO = 0.4      # 지면 도로·차선 삼각형 유지 비율

args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
REG = region(args[0])
RID = REG["id"]
RAW = work_dir(RID, "web_raw")
OUT = web_dir(RID)
D = np.load(os.path.join(work_dir(RID), "mesh.npz"))
META = json.loads(bytes(D["meta"]).decode())

bpy.ops.wm.open_mainfile(filepath=os.path.join(work_dir(RID), RID + ".blend"))
SCENE = bpy.context.scene


def ramp_lut(mat):
    node = next(n for n in mat.node_tree.nodes if n.bl_idname == "ShaderNodeValToRGB")
    return np.array([node.color_ramp.evaluate(i / 255)[:3] for i in range(256)], np.float32)


def bake_tint_colors(ob):
    """면 속성 tint + 재질의 컬러 램프 → 코너 정점 색(Color). 웹에서는 정점 색만 읽는다."""
    me = ob.data
    nf = len(me.polygons)
    tint = np.zeros(nf, np.float32)
    me.attributes["tint"].data.foreach_get("value", tint)
    mi = np.zeros(nf, np.int32)
    me.polygons.foreach_get("material_index", mi)
    lt = np.zeros(nf, np.int32)
    me.polygons.foreach_get("loop_total", lt)
    idx = np.clip((tint * 255).astype(int), 0, 255)
    col = np.ones((nf, 4), np.float32)
    for k, m in enumerate(me.materials):
        col[mi == k, :3] = ramp_lut(m)[idx[mi == k]]
    attr = me.color_attributes.new("Color", "BYTE_COLOR", "CORNER")
    attr.data.foreach_set("color", np.repeat(col, lt, axis=0).ravel())
    set_active_color(me, "Color")


def set_active_color(me, name):
    me.color_attributes.active_color_name = name
    me.color_attributes.render_color_index = me.color_attributes.find(name)


def strip_uv(ob):
    me = ob.data
    while me.uv_layers:
        me.uv_layers.remove(me.uv_layers[0])


class Martini:
    """RTIN(직각 삼각형 불규칙망) 지형 감량 — mapbox/martini 알고리즘. 최대 오차를 보장한다."""

    def __init__(self, size):
        self.size = size + 1
        n_tri = size * size * 2 - 2
        self.n_parent = n_tri - size * size
        coords = []
        for i in range(n_tri):
            tid = i + 2
            ax = ay = bx = by = cx = cy = 0
            if tid & 1:
                bx = by = cx = size
            else:
                ax = ay = cy = size
            tid >>= 1
            while tid > 1:
                mx, my = (ax + bx) >> 1, (ay + by) >> 1
                if tid & 1:
                    bx, by, ax, ay = ax, ay, cx, cy
                else:
                    ax, ay, bx, by = bx, by, cx, cy
                cx, cy = mx, my
                tid >>= 1
            coords.append((ax, ay, bx, by))
        self.coords = coords

    def errors(self, h, w):
        """h: (size*size) 높이 리스트(행=y), w: 점별 오차 가중치. 각 격자점을 넣지 않았을 때의 최대 오차."""
        s = self.size
        err = [0.0] * (s * s)
        for i in range(len(self.coords) - 1, -1, -1):
            ax, ay, bx, by = self.coords[i]
            mx, my = (ax + bx) >> 1, (ay + by) >> 1
            cx, cy = mx + my - ay, my + ax - mx
            mid = my * s + mx
            e = abs((h[ay * s + ax] + h[by * s + bx]) / 2 - h[mid]) * w[mid]
            if e > err[mid]:
                err[mid] = e
            if i < self.n_parent:
                l = err[((ay + cy) >> 1) * s + ((ax + cx) >> 1)]
                r = err[((by + cy) >> 1) * s + ((bx + cx) >> 1)]
                m = l if l > r else r
                if m > err[mid]:
                    err[mid] = m
        return err

    def mesh(self, err, max_error):
        s = self.size
        n = s - 1
        tris = []

        def walk(ax, ay, bx, by, cx, cy):
            mx, my = (ax + bx) >> 1, (ay + by) >> 1
            if abs(ax - cx) + abs(ay - cy) > 1 and err[my * s + mx] > max_error:
                walk(cx, cy, ax, ay, mx, my)
                walk(bx, by, cx, cy, mx, my)
            else:
                tris.append((ay * s + ax, by * s + bx, cy * s + cx))

        walk(0, 0, n, n, n, 0)
        walk(n, n, 0, 0, 0, n)
        return tris


def terrain_tiles(coll):
    """상세 지형 격자 → 오차 TERRAIN_ERROR 이내 RTIN 타일 메시(TerrainWeb_i_j) + 경계 치마(틈 가림)."""
    gx0, gy0, step, nx, ny = D["terrain_grid"]
    nx, ny = int(nx), int(ny)
    H = D["terrain_v"][:, 2].reshape(ny, nx).astype(np.float64)
    src = bpy.data.objects["Terrain"].data.color_attributes["gcol"]
    C = np.zeros(nx * ny * 4, np.float32)
    src.data.foreach_get("color", C)
    C = C.reshape(ny, nx, 4)
    T = TERRAIN_TILE
    ntx, nty = -(-(nx - 1) // T), -(-(ny - 1) // T)
    Hp = np.pad(H, ((0, nty * T + 1 - ny), (0, ntx * T + 1 - nx)), mode="edge")
    Cp = np.pad(C, ((0, nty * T + 1 - ny), (0, ntx * T + 1 - nx), (0, 0)), mode="edge")
    mart = Martini(T)
    s = T + 1
    objs = []
    for ty in range(nty):
        for tx in range(ntx):
            h = Hp[ty * T: ty * T + s, tx * T: tx * T + s]
            hl = h.ravel().tolist()
            # 도로가 없는 산지(고도 40m→130m)는 허용 오차를 최대 3배까지 늘린다
            wl = np.clip(1 - (h.ravel() - 40) / 90, 1 / 3, 1).tolist()
            tris = np.array(mart.mesh(mart.errors(hl, wl), TERRAIN_ERROR), np.int64)
            used, inv = np.unique(tris.ravel(), return_inverse=True)
            gy, gxx = np.divmod(used, s)
            ax, ay = tx * T + gxx, ty * T + gy
            v = np.column_stack([gx0 + np.minimum(ax, nx - 1) * step, gy0 + np.minimum(ay, ny - 1) * step, h.ravel()[used]])
            f = inv.reshape(-1, 3)
            # 위를 보도록 감기 방향 정리
            p = v[f]
            cross = (p[:, 1, 0] - p[:, 0, 0]) * (p[:, 2, 1] - p[:, 0, 1]) - (p[:, 1, 1] - p[:, 0, 1]) * (p[:, 2, 0] - p[:, 0, 0])
            f[cross < 0] = f[cross < 0][:, ::-1]
            f = f[np.abs(cross) > 1e-6]
            col = Cp[ty * T: ty * T + s, tx * T: tx * T + s].reshape(-1, 4)[used]
            # 치마: 타일 경계 변을 5m 아래로 내려 이웃 타일과의 틈을 가린다
            e = np.sort(np.concatenate([f[:, [0, 1]], f[:, [1, 2]], f[:, [2, 0]]]), axis=1)
            uniq, cnt = np.unique(e, axis=0, return_counts=True)
            border = uniq[cnt == 1]
            nv = len(v)
            sk_v = np.vstack([v[border[:, 0]], v[border[:, 1]]]) - [0, 0, 5]
            nb = len(border)
            sk_f = np.column_stack([border[:, 0], border[:, 1], nv + nb + np.arange(nb), nv + np.arange(nb)])
            verts = np.vstack([v, sk_v])
            cols = np.vstack([col, col[border[:, 0]], col[border[:, 1]]])
            faces = [list(t) for t in f] + [list(q) for q in sk_f]
            me = bpy.data.meshes.new(f"TerrainWeb_{tx}_{ty}")
            me.from_pydata(verts.tolist(), [], faces)
            me.materials.append(bpy.data.objects["Terrain"].data.materials[0])
            me.polygons.foreach_set("use_smooth", np.ones(len(faces), bool))
            a = me.color_attributes.new("gcol", "FLOAT_COLOR", "POINT")
            a.data.foreach_set("color", cols.astype(np.float32).ravel())
            set_active_color(me, "gcol")
            ob = bpy.data.objects.new(me.name, me)
            coll.objects.link(ob)
            objs.append(ob)
    return objs


def decimate(ob, ratio):
    mod = ob.modifiers.new("WebDecimate", "DECIMATE")
    mod.ratio = ratio
    mod.use_collapse_triangulate = True


def tri_count(objs):
    dg = bpy.context.evaluated_depsgraph_get()
    n = 0
    for ob in objs:
        me = ob.evaluated_get(dg).to_mesh()
        me.calc_loop_triangles()
        n += len(me.loop_triangles)
        ob.evaluated_get(dg).to_mesh_clear()
    return n


def export(name, objs):
    bpy.ops.object.select_all(action="DESELECT")
    for ob in objs:
        ob.hide_set(False)
        ob.select_set(True)
    path = os.path.join(RAW, name + ".glb")
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", use_selection=True, export_apply=True, export_yup=True,
        export_texcoords=True, export_normals=True, export_vertex_color="ACTIVE", export_all_vertex_colors=False,
        export_materials="EXPORT", export_cameras=False, export_lights=False, export_animations=False,
        export_extras=False, export_image_format="NONE")
    tris = tri_count(objs)
    print(f"{name}.glb: 객체 {len(objs)}개, 삼각형 {tris:,}, {os.path.getsize(path) / 1e6:.1f}MB", flush=True)
    return tris


def material_table(objs):
    out = {}
    for ob in objs:
        for m in ob.data.materials:
            if m is None or m.name in out:
                continue
            b = m.node_tree.nodes.get("Principled BSDF") if m.node_tree else None
            c = list(b.inputs["Base Color"].default_value)[:3] if b else list(m.diffuse_color)[:3]
            r = b.inputs["Roughness"].default_value if b else 0.8
            out[m.name] = {"color": [round(x, 4) for x in c], "roughness": round(r, 3)}
            if "web_facade" in m:
                out[m.name]["facade"] = json.loads(m["web_facade"])
    return out


def main():
    obs = bpy.data.objects
    tiles = terrain_tiles(obs["Terrain"].users_collection[0])
    backdrop = [obs["Backdrop_Terrain"]] if "Backdrop_Terrain" in obs else []
    for ob in backdrop:
        decimate(ob, BACKDROP_RATIO)
        set_active_color(ob.data, "gcol")

    city = [o for o in obs if o.type == "MESH" and (o.name.startswith(("Buildings_", "BuildingsLow_", "Tower_")))]
    for ob in city:
        bake_tint_colors(ob)

    road_names = ["Bridges_Overpasses", "Bridge_Piers", "Beaches", "Rivers_Ponds"]
    roads = [o for o in obs if o.type == "MESH" and (o.name.startswith("Roads_") or o.name.startswith("Lanes_"))]
    roads += [obs[n] for n in road_names if n in obs]
    for ob in roads:
        strip_uv(ob)
        if ob.name.startswith(("Roads_", "Lanes_", "Beaches")):
            decimate(ob, ROAD_RATIO)

    stats = {"terrain_tris": export("terrain", tiles), "city_tris": export("city", city), "roads_tris": export("roads", roads)}
    if backdrop:  # 배경은 범위가 넓어 압축 정밀도가 떨어지므로 따로 낸다
        stats["backdrop_tris"] = export("backdrop", backdrop)

    # 높이맵: 상세 지형 격자 그대로(감량 전) — 걷기/텔레포트 지면 판정용
    gx0, gy0, step, nx, ny = D["terrain_grid"]
    nx, ny = int(nx), int(ny)
    h = D["terrain_v"][:, 2].reshape(ny, nx)
    np.clip(np.round(h * 10), -32000, 32000).astype("<i2").tofile(os.path.join(OUT, "height.bin"))

    # 건물 외곽선: [M, P] int32, zb[M] zt[M] float32, n[M] int32, xy[2P] float32
    z, n, xy = D["fp_z"], D["fp_n"], D["fp_xy"]
    with open(os.path.join(OUT, "buildings.bin"), "wb") as f:
        f.write(np.array([len(n), len(xy)], "<i4").tobytes())
        f.write(np.ascontiguousarray(z[:, 0], "<f4").tobytes())
        f.write(np.ascontiguousarray(z[:, 1], "<f4").tobytes())
        f.write(np.ascontiguousarray(n, "<i4").tobytes())
        f.write(np.ascontiguousarray(xy, "<f4").tobytes())

    t = D["trees"]
    keep = np.random.default_rng(3).random(len(t)) < TREE_KEEP
    np.ascontiguousarray(t[keep], "<f4").tofile(os.path.join(OUT, "trees.bin"))
    stats["trees"] = int(keep.sum())
    stats["buildings"] = int(len(n))

    info = {
        "id": RID,
        "name": REG["name"],
        "subtitle": REG.get("subtitle", ""),
        "origin": META["origin_lonlat"],
        "rect": [float(v) for v in D["rect"]],
        "height": {"file": "height.bin", "x0": float(gx0), "y0": float(gy0), "step": float(step), "nx": nx, "ny": ny, "scale": 0.1},
        "files": {"terrain": "terrain.glb", "backdrop": "backdrop.glb", "city": "city.glb", "roads": "roads.glb", "buildings": "buildings.bin", "trees": "trees.bin"},
        "materials": material_table(tiles + backdrop + city + roads),
        "spawns": [{"name": s["name"], "x": s["xy"][0], "y": s["xy"][1], "yaw": s.get("yaw", 0), "mode": s.get("mode", "walk"), "z": s.get("z", 0)}
                   for s in META.get("spawns", [])],
        "stats": stats,
        "version": int(time.time()),
        "attribution": "지도: Overture Maps Foundation (© OpenStreetMap contributors, ODbL) · 지형: AWS Terrain Tiles (Mapzen)",
    }
    with open(os.path.join(OUT, "region.json"), "w", encoding="utf-8") as f:
        json.dump(info, f, ensure_ascii=False, indent=1)
    print("완료:", OUT, json.dumps(stats))


main()
