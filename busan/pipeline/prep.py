"""받아온 지도/고도 데이터를 Blender가 바로 읽을 수 있는 메시 배열(npz)로 바꾼다.

사용법: python prep.py <지역>      (work/<지역>/data → work/<지역>/mesh.npz)
좌표: 1 Blender 단위 = 1m, X=동쪽, Y=북쪽, 원점 = 부산 공통 원점(regions.json의 origin)
"""
import json, math, sys, zlib
from collections import defaultdict

import mapbox_earcut as earcut
import numpy as np
import pyarrow.parquet as pq
import shapely
from shapely.geometry import LineString, MultiPolygon, Polygon, box
from shapely.ops import unary_union

from common import LAT0, LON0, region, transformers, work_dir

TO_XY, TO_LL = transformers()
GRID = 10.0  # 지형 격자 간격(m)


def rng_for(key):
    return np.random.default_rng(zlib.crc32(str(key).encode()))


def load(data, name):
    try:
        rows = pq.read_table(f"{data}/{name}.parquet").to_pylist()
    except FileNotFoundError:
        return []
    for r in rows:
        r["geom"] = shapely.transform(shapely.from_wkb(r.pop("geometry")), lambda c: np.column_stack(TO_XY.transform(c[:, 0], c[:, 1])))
    return rows


def polys(g):
    if g is None or g.is_empty:
        return []
    if isinstance(g, Polygon):
        return [g]
    if isinstance(g, MultiPolygon):
        return list(g.geoms)
    if hasattr(g, "geoms"):
        return [p for x in g.geoms for p in polys(x)]
    return []


def lines(g):
    if g is None or g.is_empty:
        return []
    if isinstance(g, LineString):
        return [g]
    if hasattr(g, "geoms"):
        return [p for x in g.geoms for p in lines(x)]
    return []


class Mesh:
    """면 크기가 섞인 메시를 모은다(코너 UV, 면 재질 번호, 면 속성 포함)."""

    def __init__(self):
        self.v, self.f, self.uv, self.mat, self.attr = [], [], [], [], []
        self.nv = 0

    def add(self, verts, faces, uvs=None, mat=0, attr=0.0):
        verts = np.asarray(verts, np.float32)
        self.v.append(verts)
        for i, face in enumerate(faces):
            self.f.append([self.nv + k for k in face])
            self.uv.append(uvs[i] if uvs is not None else [(0.0, 0.0)] * len(face))
            self.mat.append(mat if np.isscalar(mat) else mat[i])
            self.attr.append(attr)
        self.nv += len(verts)

    def pack(self, prefix, out):
        if not self.v:
            return
        out[prefix + "_v"] = np.concatenate(self.v).astype(np.float32)
        out[prefix + "_fs"] = np.array([len(f) for f in self.f], np.int32)
        out[prefix + "_fi"] = np.array([k for f in self.f for k in f], np.int32)
        out[prefix + "_uv"] = np.array([c for u in self.uv for c in u], np.float32).reshape(-1, 2)
        out[prefix + "_mat"] = np.array(self.mat, np.int16)
        out[prefix + "_attr"] = np.array(self.attr, np.float32)


class Tiled:
    """1km 타일별 Mesh 묶음. 웹에서 시야 밖 타일을 통째로 건너뛸 수 있게 나눈다."""

    def __init__(self, rect, size=1000.0):
        self.x0, self.y0, self.size = rect[0], rect[1], size
        self.meshes = defaultdict(Mesh)

    def at(self, x, y):
        return self.meshes[(int((x - self.x0) // self.size), int((y - self.y0) // self.size))]

    def pack(self, prefix, out):
        for (i, j), m in self.meshes.items():
            m.pack(f"{prefix}_{i}_{j}", out)


# ---------------------------------------------------------------- 지형
def box_blur(a, r):
    for axis in (0, 1):
        c = np.cumsum(np.pad(a, [(r + 1, r) if ax == axis else (0, 0) for ax in (0, 1)], mode="edge"), axis=axis)
        a = (np.take(c, range(2 * r + 1, c.shape[axis]), axis) - np.take(c, range(0, c.shape[axis] - 2 * r - 1), axis)) / (2 * r + 1)
    return a


def dem_sampler(path, blur=1):
    """terrarium 고도 배열을 씬 좌표 (x, y)로 샘플링하는 함수를 돌려준다."""
    d = np.load(path)
    dem = d["elev"].astype(np.float64)
    dem[dem < -200] = -30
    dem = box_blur(dem, blur)
    z, tx0, ty0 = int(d["z"]), int(d["tx0"]), int(d["ty0"])
    n = 2 ** z * 256

    def f(x, y):
        lon, lat = TO_LL.transform(np.ravel(x), np.ravel(y))
        px = (np.asarray(lon) + 180) / 360 * n - tx0 * 256
        py = (1 - np.arcsinh(np.tan(np.radians(lat))) / math.pi) / 2 * n - ty0 * 256
        return bilinear(dem, px, py).reshape(np.shape(x))
    return f


def minfilter2d(a, r):
    from numpy.lib.stride_tricks import sliding_window_view
    p = np.pad(a, r, mode="edge")
    return sliding_window_view(p, (2 * r + 1, 2 * r + 1)).min(axis=(-1, -2))


def debuild(raw, r_min=4, r_blur=4, lo=35.0, hi=110.0):
    """고도 자료에 섞인 건물/나무 높이를 걷어낸다: 최소값 필터 후 블러(오프닝).
    저지대는 걸러낸 값, 산지는 원래 값을 쓰고 그 사이는 섞는다."""
    opened = box_blur(box_blur(minfilter2d(raw, r_min), r_blur), r_blur)
    w = np.clip((opened - lo) / (hi - lo), 0, 1)
    return opened * (1 - w) + raw * w


class Terrain:
    def __init__(self, data, rect, land, inland_water, sand):
        x0, y0, x1, y1 = rect
        self.xs = np.arange(x0, x1 + 0.01, GRID)
        self.ys = np.arange(y0, y1 + 0.01, GRID)
        X, Y = np.meshgrid(self.xs, self.ys)
        raw = debuild(dem_sampler(f"{data}/dem.npz")(X, Y))
        self.on_land = shapely.contains_xy(land, X, Y)
        # 해안 근처는 블러된 육지 비율로 부드럽게 이어준다
        land_f = box_blur(self.on_land.astype(np.float64), 2)
        zl = np.maximum(raw, 0.4)
        zs = np.minimum(np.minimum(raw, -3.0), -3.0 - 0.02 * box_blur((~self.on_land).astype(np.float64), 8) * 200)
        h = np.where(self.on_land, zl, zs)
        h = np.where(self.on_land & (land_f < 0.999), np.maximum(0.4, h * land_f), h)
        shapely.prepare(sand)
        in_sand = shapely.contains_xy(sand, X, Y) & self.on_land
        # 해변은 해수면 근처(0.6~2.1m)로 낮춘다
        h = np.where(in_sand, np.minimum(h, 0.6 + 0.5 * np.clip(h, 0, 3.0)), h)
        self.ground_raw = h.copy()  # 하천 깎기 전
        self.water_z = []
        for p in inland_water:
            ring = np.array(p.exterior.segmentize(GRID).coords)
            zr = self.sample(ring[:, 0], ring[:, 1], h)
            surf = max(0.2, float(np.percentile(zr, 10)) - 0.3)
            inside = shapely.contains_xy(p, X, Y)
            h = np.where(inside, np.minimum(h, surf - 1.5), h)
            self.water_z.append(surf)
        self.h = h
        self.X, self.Y = X, Y
        # 바다 근접도(다리 높이 계산용): 600m 반경 바다 비율
        self.seaness = box_blur((~self.on_land).astype(np.float64), 30)

    def sample(self, x, y, arr=None):
        arr = self.h if arr is None else arr
        return bilinear(arr, (np.asarray(x) - self.xs[0]) / GRID, (np.asarray(y) - self.ys[0]) / GRID)

    def mesh(self, colors):
        ny, nx = self.h.shape
        v = np.column_stack([self.X.ravel(), self.Y.ravel(), self.h.ravel()]).astype(np.float32)
        i = np.arange(ny * nx).reshape(ny, nx)
        q = np.stack([i[:-1, :-1], i[:-1, 1:], i[1:, 1:], i[1:, :-1]], -1).reshape(-1, 4)
        return v, q.astype(np.int32), colors.ravel().astype(np.uint8)


def bilinear(a, px, py):
    px = np.clip(px, 0, a.shape[1] - 1.001)
    py = np.clip(py, 0, a.shape[0] - 1.001)
    x0, y0 = px.astype(int), py.astype(int)
    fx, fy = px - x0, py - y0
    return (a[y0, x0] * (1 - fx) * (1 - fy) + a[y0, x0 + 1] * fx * (1 - fy)
            + a[y0 + 1, x0] * (1 - fx) * fy + a[y0 + 1, x0 + 1] * fx * fy)


# ---------------------------------------------------------------- 폴리곤 → 메시
def triangulate(p):
    p = shapely.geometry.polygon.orient(p, 1)
    rings = [np.array(p.exterior.coords)[:-1]] + [np.array(r.coords)[:-1] for r in p.interiors]
    rings = [r for r in rings if len(r) >= 3]
    if not rings:
        return np.zeros((0, 2)), np.zeros((0, 3), int)
    verts = np.vstack(rings)
    ends = np.cumsum([len(r) for r in rings]).astype(np.uint32)
    tri = earcut.triangulate_float64(verts, ends).reshape(-1, 3)
    a, b, c = verts[tri[:, 0]], verts[tri[:, 1]], verts[tri[:, 2]]
    cross = (b[:, 0] - a[:, 0]) * (c[:, 1] - a[:, 1]) - (b[:, 1] - a[:, 1]) * (c[:, 0] - a[:, 0])
    tri[cross < 0] = tri[cross < 0][:, ::-1]
    return verts, tri


def drape(mesh, geom, terrain, offset, mat=0, tile=400.0, step=6.0):
    """지면에 붙는 평면 폴리곤(도로, 해변 등). 타일로 잘라 삼각분할한다."""
    x0, y0, x1, y1 = geom.bounds
    for tx in np.arange(math.floor(x0 / tile) * tile, x1, tile):
        for ty in np.arange(math.floor(y0 / tile) * tile, y1, tile):
            part = geom.intersection(box(tx, ty, tx + tile, ty + tile))
            for p in polys(part):
                if p.area < 1:
                    continue
                verts, tri = triangulate(p.segmentize(step))
                if not len(tri):
                    continue
                z = terrain.sample(verts[:, 0], verts[:, 1]) + offset
                m = mesh.at(*p.representative_point().coords[0]) if isinstance(mesh, Tiled) else mesh
                m.add(np.column_stack([verts, z]), tri.tolist(), mat=mat)


def flat(mesh, p, z, mat=0):
    verts, tri = triangulate(p)
    if len(tri):
        mesh.add(np.column_stack([verts, np.full(len(verts), z)]), tri.tolist(), mat=mat)


# ---------------------------------------------------------------- 건물
FLOOR = 3.1


def building_height(r, area, in_apt, rng):
    if r.get("height"):
        return float(r["height"])
    if r.get("num_floors"):
        return r["num_floors"] * FLOOR + 1.0
    cls = r.get("class")
    if cls in ("house", "detached", "shed", "garage", "hut"):
        return rng.uniform(5, 8)
    if cls in ("roof", "carport"):
        return 4.0
    if cls == "apartments" or (in_apt and area > 250):
        return FLOOR * (rng.integers(14, 31) if area > 350 else rng.integers(5, 15)) + 2
    if cls in ("school", "university", "kindergarten"):
        return FLOOR * rng.integers(3, 6)
    if cls in ("commercial", "retail", "office", "hotel"):
        return FLOOR * (rng.integers(5, 20) if area > 400 else rng.integers(3, 8))
    if area < 80:
        return FLOOR * rng.integers(1, 3) + 1
    if area < 200:
        return FLOOR * rng.integers(2, 5) + 1
    if area < 500:
        return FLOOR * rng.integers(3, 9) + 1
    if area < 2500:
        return FLOOR * rng.integers(4, 15) + 1
    return FLOOR * rng.integers(3, 8) + 1


def extrude(mesh, p, zb, zt, tint, roof_mat=0, wall_mat=1):
    p = shapely.geometry.polygon.orient(p.simplify(0.3), 1)
    if p.is_empty or p.area < 4:
        return
    if not isinstance(p, Polygon):
        for q in polys(p):
            extrude(mesh, q, zb, zt, tint, roof_mat, wall_mat)
        return
    verts, tri = triangulate(p)
    if len(tri):
        mesh.add(np.column_stack([verts, np.full(len(verts), zt)]), tri.tolist(), mat=roof_mat, attr=tint)
    h = zt - zb
    for ring in [p.exterior, *p.interiors]:
        c = np.array(ring.coords)[:-1]
        n = len(c)
        if n < 3:
            continue
        seg = np.linalg.norm(np.roll(c, -1, 0) - c, axis=1)
        u = np.concatenate([[0], np.cumsum(seg)])
        bottom = np.column_stack([c, np.full(n, zb)])
        top = np.column_stack([c, np.full(n, zt)])
        faces, uvs = [], []
        for k in range(n):
            k1 = (k + 1) % n
            faces.append([k, k1, n + k1, n + k])
            uvs.append([(u[k], 0), (u[k + 1], 0), (u[k + 1], h), (u[k], h)])
        mesh.add(np.vstack([bottom, top]), faces, uvs, mat=wall_mat, attr=tint)


# ---------------------------------------------------------------- 도로
WIDTH = {
    "motorway": 22, "trunk": 18, "primary": 15, "secondary": 13, "tertiary": 9,
    "residential": 6, "unclassified": 6, "living_street": 5, "service": 4, "track": 3,
    "pedestrian": 5, "footway": 2.5, "path": 2, "steps": 2.5, "cycleway": 2.5,
}
RANK = {"major": ("motorway", "trunk", "primary", "secondary"), "minor": ("tertiary", "residential", "unclassified", "living_street", "service", "track"),
        "foot": ("pedestrian", "footway", "path", "steps", "cycleway")}
CAT = {c: k for k, v in RANK.items() for c in v}


def rule_at(rules, t, key="value", default=None):
    for r in rules or []:
        b = r.get("between")
        if b is None or b[0] <= t <= b[1]:
            return r.get(key, r.get("values"))
    return default


def flags_at(flags, t):
    out = set()
    for f in flags or []:
        b = f.get("between")
        if b is None or b[0] <= t <= b[1]:
            out.update(f["values"])
    return out


def maxfilter(a, w):
    if len(a) == 0:
        return a
    return np.array([a[max(0, i - w): i + w + 1].max() for i in range(len(a))])


def smooth(a, w):
    if len(a) < 3 or w < 1:
        return a
    k = np.ones(2 * w + 1) / (2 * w + 1)
    pad = np.pad(a, w, mode="edge")
    return np.convolve(pad, k, mode="valid")


def deck(mesh, piers, xy, z, width, terrain, thick=1.4):
    """고가도로/다리: 위·아래·옆면을 가진 리본 + 교각."""
    n = len(xy)
    d = np.gradient(xy, axis=0)
    d /= np.linalg.norm(d, axis=1, keepdims=True) + 1e-9
    nrm = np.column_stack([-d[:, 1], d[:, 0]]) * width / 2
    L, R = xy + nrm, xy - nrm
    v = np.vstack([np.column_stack([L, z]), np.column_stack([R, z]), np.column_stack([L, z - thick]), np.column_stack([R, z - thick])])
    faces, mats = [], []
    for i in range(n - 1):
        a, b = i, i + 1
        faces += [[a, b, n + b, n + a][::-1], [2 * n + a, 2 * n + b, 3 * n + b, 3 * n + a],
                  [a, 2 * n + a, 2 * n + b, b], [n + a, n + b, 3 * n + b, 3 * n + a]]
        mats += [0, 1, 1, 1]
    mesh.add(v, faces, mat=mats)
    g = terrain.sample(xy[:, 0], xy[:, 1])
    dist = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(xy, axis=0), axis=1))])
    for s in np.arange(25, dist[-1] - 10, 50):
        i = int(np.searchsorted(dist, s))
        if z[i] - g[i] > 5:
            cx, cy = xy[i]
            w = min(width * 0.35, 4)
            piers.append((cx, cy, g[i] - 3, z[i] - thick, w))


# ---------------------------------------------------------------- 메인
def main(rid):
    reg = region(rid)
    W, S, E, N = reg["bbox"]
    data = work_dir(rid, "data")
    out_path = f"{work_dir(rid)}/mesh.npz"
    pad = 30
    x0, y0 = TO_XY.transform(W, S)
    x1, y1 = TO_XY.transform(E, N)
    xa, xb = TO_XY.transform(W, N)[0], TO_XY.transform(E, S)[0]
    rect = (math.ceil(max(x0, xa)) + pad, math.ceil(y0) + pad, math.floor(min(x1, xb)) - pad, math.floor(y1) - pad)
    R = box(*rect)
    print("영역(m):", rect, f"{(rect[2]-rect[0])/1000:.1f} x {(rect[3]-rect[1])/1000:.1f} km")

    land_rows = load(data, "land")
    water_rows = load(data, "water")
    lu_rows = load(data, "land_use")
    lc_rows = load(data, "land_cover")
    b_rows = load(data, "buildings")
    part_rows = load(data, "building_parts")
    seg_rows = load(data, "segments")

    # 육지 = land 폴리곤 - 바다/만 폴리곤
    land = unary_union([g for r in land_rows if r["subtype"] == "land" for g in polys(r["geom"])]).intersection(R)
    sea = unary_union([g for r in water_rows if r["subtype"] in ("ocean",) or r["class"] in ("sea", "bay", "ocean") for g in polys(r["geom"])])
    print("육지 면적 비율", land.area / R.area, " 바다폴리곤", sea.area / R.area)
    land = land.buffer(0)
    inland = [p for r in water_rows if r["subtype"] in ("river", "pond", "lake", "reservoir", "water", "canal")
              for p in polys(r["geom"].intersection(R)) if p.area > 50]
    inland = [p.intersection(land) for p in inland]
    inland = [q for p in inland for q in polys(p) if q.area > 50]
    shapely.prepare(land)
    sand0 = unary_union([g for r in land_rows if r["subtype"] == "sand" or r.get("class") in ("beach", "sand") for g in polys(r["geom"])]).intersection(R)
    T = Terrain(data, rect, land, inland, sand0)
    print("지형 격자", T.h.shape, "고도", T.h.min(), T.h.max())

    out = {}
    # 지면 색 분류: 0 도시, 1 숲, 2 풀/공원, 3 모래, 4 바위, 5 바다밑, 6 농지
    def union_of(pred_rows):
        u = unary_union([g for r in pred_rows for g in polys(r["geom"])])
        return u.intersection(R)
    forest = union_of([r for r in land_rows if r["subtype"] in ("forest", "shrub") or r.get("class") in ("wood", "forest", "scrub")])
    grass = union_of([r for r in land_rows + lu_rows if r["subtype"] in ("grass", "park", "golf", "recreation", "managed", "horticulture")
                      or r.get("class") in ("grass", "grassland", "park", "pitch", "golf_course", "meadow", "garden", "recreation_ground")])
    sand = union_of([r for r in land_rows if r["subtype"] == "sand" or r.get("class") in ("beach", "sand")])
    rock = union_of([r for r in land_rows if r["subtype"] == "rock"])
    farm = union_of([r for r in lu_rows if r["subtype"] == "agriculture"])
    col = np.zeros(T.h.shape, np.uint8)
    for k, g in ((6, farm), (2, grass), (1, forest), (4, rock), (3, sand)):
        shapely.prepare(g)
        col[shapely.contains_xy(g, T.X, T.Y)] = k
    # 고도 높은 산지에 숲 데이터가 없으면 숲으로 채운다
    col[(col == 0) & (T.h > 80)] = 1
    col[~T.on_land] = 5
    tv, tq, tc = T.mesh(col)
    out.update(terrain_v=tv, terrain_q=tq, terrain_c=tc, terrain_shape=np.array(T.h.shape))
    print("지형 색 분포", np.bincount(col.ravel(), minlength=7))

    # 하천/호수 수면
    wm = Mesh()
    for p, z in zip(inland, T.water_z):
        flat(wm, p, z)
    for r in water_rows:
        if r["subtype"] in ("stream", "canal") or r["class"] in ("stream", "ditch", "drain"):
            for ln in lines(r["geom"].intersection(R)):
                drape(wm, ln.buffer(2.5, cap_style="flat"), T, 0.12, tile=1e9, step=5)
    wm.pack("inland_water", out)

    # 해변 등 바닥 디테일(모래)
    sm = Mesh()
    drape(sm, sand.intersection(land), T, 0.08)
    sm.pack("sand", out)

    # 건물
    apt_zones = unary_union([g for r in lu_rows if r["subtype"] == "residential" for g in polys(r["geom"])])
    shapely.prepare(apt_zones)
    has_parts = defaultdict(list)
    for r in part_rows:
        has_parts[r["building_id"]].append(r)
    tiles = defaultdict(Mesh)
    landmarks = []
    fp = []  # 충돌/옥상 높이용 외곽선: (바닥z, 꼭대기z, 좌표)

    def footprint(p, zb, zt):
        p = p.simplify(0.5)
        for q in polys(p):
            if q.area >= 4:
                fp.append((zb, zt, np.array(q.exterior.coords)[:-1, :2]))
    TILE = 1000
    cnt = 0
    for r in b_rows:
        g = r["geom"]
        if not R.contains(g.centroid):
            continue
        rng = rng_for(r["id"])
        area = g.area
        in_apt = apt_zones.contains(g.centroid)
        c = np.array(g.exterior.coords) if isinstance(g, Polygon) else np.vstack([np.array(p.exterior.coords) for p in polys(g)])
        gz = T.sample(c[:, 0], c[:, 1], T.ground_raw)
        base = float(gz.min()) - 0.5
        ground = float(gz.min())
        h = building_height(r, area, in_apt, rng)
        parts = has_parts.get(r["id"])
        if parts:
            h = max([h] + [pr["height"] or 0 for pr in parts])
        tint = float(rng.random())
        name = (r.get("names") or {}).get("primary") if isinstance(r.get("names"), dict) else None
        target = None
        if h >= 150:
            target = Mesh()
            landmarks.append((name or "Tower", h, target))
        else:
            # 낮은 건물은 웹에서 가까이 있을 때만 그리도록 따로 묶는다
            k = (int((g.centroid.x - rect[0]) // TILE), int((g.centroid.y - rect[1]) // TILE), "bld" if h >= 30 else "bldlo")
            target = tiles[k]
        if parts:
            for pr in parts:
                ph = pr["height"] or (pr["num_floors"] or 0) * FLOOR or 10.0
                pb = pr["min_height"] or (pr["min_floor"] or 0) * FLOOR
                for p in polys(pr["geom"]):
                    extrude(target, p, ground + pb - (0.5 if not pb else 0), ground + ph, tint)
                    footprint(p, ground + pb - (0.5 if not pb else 0), ground + ph)
        else:
            for p in polys(g):
                extrude(target, p, base, ground + h, tint)
                footprint(p, base, ground + h)
        cnt += 1
    for k, m in tiles.items():
        m.pack(f"{k[2]}_{k[0]}_{k[1]}", out)
    lm_names = []
    for i, (name, h, m) in enumerate(landmarks):
        m.pack(f"tower_{i}", out)
        lm_names.append(f"{name} ({h:.0f}m)")
    out["fp_z"] = np.array([(a, b) for a, b, _ in fp], np.float32)
    out["fp_n"] = np.array([len(c) for _, _, c in fp], np.int32)
    out["fp_xy"] = np.concatenate([c for _, _, c in fp]).astype(np.float32)
    print("건물", cnt, "타일", len(tiles), "초고층", len(landmarks), "충돌 외곽선", len(fp))

    # 도로
    ground_buf = defaultdict(list)
    dm, piers = Mesh(), []
    rail_ground = []
    n_elev = 0
    for r in seg_rows:
        g = r["geom"].intersection(R)
        for ln in lines(g):
            if ln.length < 1:
                continue
            is_rail = r["subtype"] == "rail"
            cls = r["class"]
            if not is_rail and cls not in WIDTH:
                continue
            width = 4.0 if is_rail else WIDTH[cls]
            dense = ln.segmentize(6.0)
            xy = np.array(dense.coords)[:, :2]
            dist = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(xy, axis=0), axis=1))])
            # 원래 선분 전체 길이 기준 비율(between 규칙용)
            full = r["geom"].length or 1
            t0 = r["geom"].project(shapely.Point(xy[0])) / full
            t = np.clip(t0 + dist / full, 0, 1)
            fl = r["rail_flags"] if is_rail else r["road_flags"]
            lvl = np.array([rule_at(r["level_rules"], ti, default=0) or 0 for ti in t], float)
            fset = [flags_at(fl, ti) for ti in t]
            tunnel = np.array([("is_tunnel" in f) or ("is_covered" in f and l < 0) for f, l in zip(fset, lvl)]) | (lvl < 0)
            bridge = np.array(["is_bridge" in f for f in fset]) | (lvl > 0)
            # 연속 구간으로 나눠서 처리
            state = np.where(tunnel, 0, np.where(bridge, 2, 1))
            start = 0
            for i in range(1, len(xy) + 1):
                if i == len(xy) or state[i] != state[start]:
                    seg = slice(start, min(i + 1, len(xy)))
                    pts = xy[seg]
                    s = state[start]
                    if len(pts) >= 2 and s == 1:
                        if is_rail:
                            rail_ground.append(LineString(pts).buffer(width / 2, cap_style="flat"))
                        else:
                            ground_buf[CAT[cls]].append(LineString(pts).buffer(width / 2, cap_style="round", quad_segs=2))
                    elif len(pts) >= 2 and s == 2:
                        gz = np.maximum(T.sample(pts[:, 0], pts[:, 1], T.ground_raw), 0)
                        w = max(1, int(60 / 6))
                        base = maxfilter(gz, w)
                        sea = T.sample(pts[:, 0], pts[:, 1], T.seaness)
                        z = base + 6.5 * np.maximum(lvl[seg], 0) + 0.6 + 30 * np.clip(sea * 1.6 - 0.3, 0, 1)
                        z = smooth(z, 8)
                        z = np.maximum(z, base + 0.6)
                        deck(dm, piers, pts, z, width + 1.0, T)
                        n_elev += 1
                    start = i
    rm = Tiled(rect)
    offs = {"foot": 0.22, "minor": 0.28, "major": 0.34}
    road_union = {}
    for cat in ("foot", "minor", "major"):
        u = unary_union(ground_buf[cat]).intersection(R)
        road_union[cat] = u
    # 겹치는 부분은 상위 등급만 남긴다
    road_union["minor"] = road_union["minor"].difference(road_union["major"])
    road_union["foot"] = road_union["foot"].difference(unary_union([road_union["major"], road_union["minor"]]))
    for mi, cat in enumerate(("major", "minor", "foot")):
        drape(rm, road_union[cat], T, offs[cat], mat=mi)
    rail_u = unary_union(rail_ground).intersection(R) if rail_ground else None
    if rail_u is not None:
        drape(rm, rail_u, T, 0.38, mat=3)
    rm.pack("roads", out)
    dm.pack("bridges", out)
    out["piers"] = np.array(piers, np.float32).reshape(-1, 5)
    print("고가/다리 구간", n_elev, "교각", len(piers))

    # 차선(주요 도로 중앙선)
    lm = Tiled(rect)
    for r in seg_rows:
        if r["subtype"] != "road" or r["class"] not in ("motorway", "trunk", "primary", "secondary"):
            continue
        if r["road_flags"] or r["level_rules"]:
            continue
        for ln in lines(r["geom"].intersection(R)):
            drape(lm, ln.buffer(0.18, cap_style="flat"), T, offs["major"] + 0.03, step=6)
    lm.pack("lanes", out)

    # 나무: 숲 + 공원 + 가로수 점
    rngt = np.random.default_rng(7)
    trees = []
    for k, dens in ((1, 1 / 110), (2, 1 / 500)):
        nn = int((col == k).sum() * GRID * GRID * dens)
        px = rngt.uniform(rect[0], rect[2], int(nn * col.size / max((col == k).sum(), 1)))
        py = rngt.uniform(rect[1], rect[3], len(px))
        gi = np.clip(np.round((py - T.ys[0]) / GRID).astype(int), 0, col.shape[0] - 1)
        gj = np.clip(np.round((px - T.xs[0]) / GRID).astype(int), 0, col.shape[1] - 1)
        ok = col[gi, gj] == k
        trees.append(np.column_stack([px[ok], py[ok]]))
    pts = [r["geom"] for r in land_rows if r["subtype"] == "tree" and r["geom"].geom_type == "Point"]
    if pts:
        trees.append(np.array([[p.x, p.y] for p in pts]))
    trees = np.vstack(trees)
    # 건물·도로 위 나무 제거
    obst = unary_union([road_union["major"], road_union["minor"]])
    shapely.prepare(obst)
    trees = trees[~shapely.contains_xy(obst, trees[:, 0], trees[:, 1])]
    tz = T.sample(trees[:, 0], trees[:, 1])
    sc = rngt.uniform(0.7, 1.4, len(trees))
    out["trees"] = np.column_stack([trees, tz, sc, rngt.uniform(0, 6.283, len(trees))]).astype(np.float32)
    print("나무", len(trees))

    # 바깥 배경 지형(저해상도): 지평선이 끊기지 않게 영역 둘레를 25km 정도 채운다
    BG = 80.0
    bx = np.arange(rect[0] - 24000, rect[2] + 24000 + 1, BG)
    by = np.arange(rect[1] - 24000, rect[3] + 24000 + 1, BG)
    BX, BY = np.meshgrid(bx, by)
    bh = dem_sampler(f"{data}/dem_wide.npz", blur=1)(BX, BY)
    bh = debuild(bh, r_min=1, r_blur=1)
    bland = bh > 1.0
    bh = np.where(bland, np.maximum(bh, 0.5) - 1.0, np.minimum(bh, -4.0))
    bc = np.where(bland, np.where(bh > 70, 1, 0), 5).astype(np.uint8)
    ny, nx = bh.shape
    idx = np.arange(ny * nx).reshape(ny, nx)
    q = np.stack([idx[:-1, :-1], idx[:-1, 1:], idx[1:, 1:], idx[1:, :-1]], -1).reshape(-1, 4)
    cxq = (BX[:-1, :-1] + BG / 2).ravel()
    cyq = (BY[:-1, :-1] + BG / 2).ravel()
    inside = (cxq > rect[0] + BG) & (cxq < rect[2] - BG) & (cyq > rect[1] + BG) & (cyq < rect[3] - BG)
    out.update(backdrop_v=np.column_stack([BX.ravel(), BY.ravel(), bh.ravel()]).astype(np.float32),
               backdrop_q=q[~inside].astype(np.int32), backdrop_c=bc.ravel())
    print("배경 지형", bh.shape, "면", int((~inside).sum()))

    out["rect"] = np.array(rect, np.float32)
    spawns = []
    for sp in reg.get("spawns", []):
        sx, sy = TO_XY.transform(*sp["lonlat"])
        spawns.append({**sp, "xy": [round(sx, 2), round(sy, 2)]})
    out["terrain_grid"] = np.array([T.xs[0], T.ys[0], GRID, len(T.xs), len(T.ys)], np.float64)
    out["meta"] = np.frombuffer(json.dumps({"region": rid, "name": reg["name"], "origin_lonlat": [LON0, LAT0], "landmarks": lm_names, "spawns": spawns, "subtitle": reg.get("subtitle", ""),
                                            "source": "Overture Maps Foundation (© OpenStreetMap contributors, ODbL) / AWS Terrain Tiles"},
                                           ensure_ascii=False).encode(), np.uint8)
    np.savez_compressed(out_path, **out)
    print("저장:", out_path)


if __name__ == "__main__":
    main(sys.argv[1])
