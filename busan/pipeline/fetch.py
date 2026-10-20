"""Overture Maps(S3 공개 버킷)에서 지역 데이터를 HTTP Range 요청으로 받아온다.

사용법: python fetch.py <지역> [레이어...]
결과: work/<지역>/data/<레이어>.parquet  (지역 bbox에 걸치는 행만)
"""
import io, os, re, sys, threading, urllib.request
from concurrent.futures import ThreadPoolExecutor

import pyarrow as pa
import pyarrow.parquet as pq

from common import region, work_dir

BASE = "https://overturemaps-us-west-2.s3.us-west-2.amazonaws.com"
REL = "release/2026-09-23.1"
W = S = E = N = 0.0  # main()에서 지역 bbox로 채운다

LAYERS = {
    "buildings": ("buildings/type=building", ["id", "geometry", "height", "num_floors", "class", "names"]),
    "building_parts": ("buildings/type=building_part", ["id", "building_id", "geometry", "height", "min_height", "num_floors", "min_floor"]),
    "segments": ("transportation/type=segment", ["id", "geometry", "subtype", "class", "names", "subclass", "road_flags", "rail_flags", "level_rules", "width_rules"]),
    "water": ("base/type=water", ["id", "geometry", "subtype", "class", "names"]),
    "land": ("base/type=land", ["id", "geometry", "subtype", "class", "names", "elevation"]),
    "land_use": ("base/type=land_use", ["id", "geometry", "subtype", "class", "names"]),
    "land_cover": ("base/type=land_cover", ["id", "geometry", "subtype"]),
    "infrastructure": ("base/type=infrastructure", ["id", "geometry", "subtype", "class", "names"]),
}


def http_range(key, start, end):
    req = urllib.request.Request(f"{BASE}/{key}", headers={"Range": f"bytes={start}-{end}"})
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.read()
        except Exception:
            if attempt == 4:
                raise


class RangeFile(io.RawIOBase):
    """pyarrow가 필요한 바이트 구간만 Range 요청으로 읽게 하는 파일 객체."""

    def __init__(self, key, size):
        self.key, self.size, self.pos = key, size, 0

    def readable(self): return True
    def seekable(self): return True
    def tell(self): return self.pos

    def seek(self, off, whence=0):
        self.pos = off if whence == 0 else (self.pos + off if whence == 1 else self.size + off)
        return self.pos

    def read(self, n=-1):
        if n is None or n < 0:
            n = self.size - self.pos
        n = min(n, self.size - self.pos)
        if n <= 0:
            return b""
        data = http_range(self.key, self.pos, self.pos + n - 1)
        self.pos += len(data)
        return data

    def readinto(self, b):
        data = self.read(len(b))
        b[: len(data)] = data
        return len(data)


def list_keys(prefix):
    with urllib.request.urlopen(f"{BASE}/?list-type=2&prefix={REL}/theme={prefix}/", timeout=60) as r:
        xml = r.read().decode()
    return [(k, int(s)) for k, s in re.findall(r"<Key>([^<]+)</Key>.*?<Size>(\d+)</Size>", xml)]


def overlaps(stats_min_x, stats_max_x, stats_min_y, stats_max_y):
    return stats_min_x < E and stats_max_x > W and stats_min_y < N and stats_max_y > S


def scan_file(key, size, columns):
    f = pq.ParquetFile(pa.PythonFile(RangeFile(key, size), mode="r"))
    md = f.metadata
    names = [md.schema.column(i).path for i in range(md.num_columns)]
    idx = {n: names.index(n) for n in ("bbox.xmin", "bbox.xmax", "bbox.ymin", "bbox.ymax")}
    # 파일 전체 범위로 먼저 거른다
    tables = []
    for g in range(md.num_row_groups):
        rg = md.row_group(g)
        st = {k: rg.column(i).statistics for k, i in idx.items()}
        if not overlaps(st["bbox.xmin"].min, st["bbox.xmax"].max, st["bbox.ymin"].min, st["bbox.ymax"].max):
            continue
        cols = [c for c in columns if c in f.schema_arrow.names] + ["bbox"]
        t = f.read_row_group(g, columns=cols)
        bb = t.column("bbox").combine_chunks()
        import pyarrow.compute as pc
        mask = pc.and_(
            pc.and_(pc.less(pc.struct_field(bb, "xmin"), E), pc.greater(pc.struct_field(bb, "xmax"), W)),
            pc.and_(pc.less(pc.struct_field(bb, "ymin"), N), pc.greater(pc.struct_field(bb, "ymax"), S)),
        )
        t = t.filter(mask)
        if t.num_rows:
            tables.append(t)
    return tables


def main(rid, only=None):
    global W, S, E, N
    W, S, E, N = region(rid)["bbox"]
    out = work_dir(rid, "data")
    only = only or list(LAYERS)
    for name in only:
        prefix, columns = LAYERS[name]
        keys = list_keys(prefix)
        lock, done, tables = threading.Lock(), [0], []

        def job(ks):
            res = scan_file(*ks, columns)
            with lock:
                done[0] += 1
                tables.extend(res)
                if done[0] % 32 == 0:
                    print(f"  {name}: {done[0]}/{len(keys)} 파일 확인", flush=True)

        with ThreadPoolExecutor(16) as ex:
            list(ex.map(job, keys))
        table = pa.concat_tables(tables, promote_options="permissive") if tables else None
        if table is not None:
            pq.write_table(table, os.path.join(out, f"{name}.parquet"))
        print(f"{name}: {table.num_rows if table is not None else 0}행", flush=True)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2:])
