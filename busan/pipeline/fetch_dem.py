"""AWS Terrain Tiles(terrarium PNG)에서 지역 고도를 받아 하나의 배열로 합친다.

사용법: python fetch_dem.py <지역>
결과: work/<지역>/data/dem.npz (상세, z15), dem_wide.npz (주변 배경, z11)
"""
import io, math, os, sys, urllib.request

import numpy as np
from PIL import Image

from common import region, work_dir

Z = 15
URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"


def tile_xy(lon, lat, z):
    n = 2 ** z
    x = (lon + 180) / 360 * n
    y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
    return x, y


def main(rid, name="dem", Z=Z, pad=(0.0, 0.0)):
    W, S, E, N = region(rid)["bbox"]
    out = work_dir(rid, "data")
    x0, y0 = tile_xy(W - pad[0], N + pad[1], Z)
    x1, y1 = tile_xy(E + pad[0], S - pad[1], Z)
    xs = range(int(x0), int(x1) + 1)
    ys = range(int(y0), int(y1) + 1)
    rows = []
    for ty in ys:
        row = []
        for tx in xs:
            with urllib.request.urlopen(URL.format(z=Z, x=tx, y=ty), timeout=60) as r:
                img = np.asarray(Image.open(io.BytesIO(r.read())).convert("RGB")).astype(np.float64)
            row.append(img[..., 0] * 256 + img[..., 1] + img[..., 2] / 256 - 32768)
        rows.append(np.hstack(row))
    elev = np.vstack(rows).astype(np.float32)
    np.savez_compressed(os.path.join(out, name + ".npz"), elev=elev, z=Z, tx0=xs[0], ty0=ys[0])
    print(name, elev.shape, "min", elev.min(), "max", elev.max())


if __name__ == "__main__":
    main(sys.argv[1])
    main(sys.argv[1], "dem_wide", 11, (0.30, 0.25))
