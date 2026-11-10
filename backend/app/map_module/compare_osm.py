
import json
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
DATA = ROOT / "data" / "processed"

FILES = {
    "기존 등산로": DATA / "bukhansan-trails.geojson",
    "자동 등산로": DATA / "bukhansan-pipeline-test/osm-layers/trails.geojson",
    "기존 하천": DATA / "bukhansan-waterways.geojson",
    "자동 하천": DATA / "bukhansan-pipeline-test/osm-layers/waterways.geojson",
}


def analyze(path):
    with open(path, "r", encoding="utf-8") as f:
        geojson = json.load(f)

    highway = Counter()
    waterway = Counter()
    geometry = Counter()

    for feature in geojson["features"]:
        props = feature.get("properties") or {}
        geom = feature.get("geometry") or {}

        highway[str(props.get("highway", "없음"))] += 1
        waterway[str(props.get("waterway", "없음"))] += 1
        geometry[str(geom.get("type", "없음"))] += 1

    return highway, waterway, geometry


for name, path in FILES.items():
    highway, waterway, geometry = analyze(path)

    print(f"\n=== {name} ===")
    print("Geometry:", dict(geometry))

    if "등산로" in name:
        print("Highway:", dict(highway))
    else:
        print("Waterway:", dict(waterway))
