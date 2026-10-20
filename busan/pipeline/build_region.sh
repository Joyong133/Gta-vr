#!/usr/bin/env bash
# 지역 하나를 처음부터 끝까지 만든다: 데이터 받기 → 메시 변환 → Blender 씬 → 웹(Quest)용 에셋.
#
#   busan/pipeline/build_region.sh <지역> [--skip-fetch]
#
# PYTHON   : bpy, pyarrow, shapely, pyproj, mapbox_earcut, pillow 가 설치된 파이썬 (requirements.txt)
# 결과     : busan/pipeline/work/<지역>/<지역>.blend  (Blender 씬, 저장소에는 안 올림)
#            busan/regions/<지역>/                     (웹 뷰어가 자동으로 찾아 쓰는 에셋)
set -euo pipefail
cd "$(dirname "$0")"
PY="${PYTHON:-python3}"
R="${1:?지역 id를 주세요 (regions.json)}"

if [ "${2:-}" != "--skip-fetch" ]; then
  "$PY" fetch.py "$R"
  "$PY" fetch_dem.py "$R"
fi
"$PY" prep.py "$R"
"$PY" build_blender.py "$R"
"$PY" export_web.py "$R"
for f in terrain backdrop city roads; do
  # -vp 16: 위치 16비트(지역 10km 기준 약 0.16m) / -kn -km: 타일 노드·재질 이름 유지(웹에서 컬링·재질 매칭)
  # city만 -kv -vtf: 텍스처가 없어도 벽 UV(창문 격자용, m 단위)를 버리지 않고 부동소수로 둔다
  extra=""
  [ "$f" = city ] && extra="-kv -vtf"
  npx --yes gltfpack@1.3.0 -i "work/$R/web_raw/$f.glb" -o "../regions/$R/$f.glb" -cc -kn -km -vp 16 $extra
done
du -sh "../regions/$R"
