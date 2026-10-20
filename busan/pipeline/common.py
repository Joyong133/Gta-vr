"""지역 설정(regions.json)과 부산 공통 좌표계."""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG = json.load(open(os.path.join(HERE, "regions.json"), encoding="utf-8"))
LON0, LAT0 = CONFIG["origin"]
PROJ = f"+proj=tmerc +lat_0={LAT0} +lon_0={LON0} +k=1 +x_0=0 +y_0=0 +ellps=WGS84"


def region(rid):
    if rid not in CONFIG["regions"]:
        raise SystemExit(f"알 수 없는 지역: {rid} (regions.json: {', '.join(CONFIG['regions'])})")
    r = dict(CONFIG["regions"][rid])
    r["id"] = rid
    return r


def work_dir(rid, *sub):
    """원본 데이터·중간 결과(.blend 등)를 두는 곳. 저장소에는 올리지 않는다(.gitignore)."""
    p = os.path.join(HERE, "work", rid, *sub)
    os.makedirs(p, exist_ok=True)
    return p


def web_dir(rid):
    """웹 뷰어가 읽는 최종 결과물(busan/regions/<지역>)."""
    p = os.path.join(HERE, "..", "regions", rid)
    os.makedirs(p, exist_ok=True)
    return os.path.normpath(p)


def transformers():
    from pyproj import Transformer
    to_xy = Transformer.from_crs("EPSG:4326", PROJ, always_xy=True)
    to_ll = Transformer.from_crs(PROJ, "EPSG:4326", always_xy=True)
    return to_xy, to_ll
