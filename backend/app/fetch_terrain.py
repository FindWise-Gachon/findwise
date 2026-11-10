"""Fetch OSM ways for the geographic bounds of an exported grid."""
import argparse
import json
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from rasterio.warp import transform_bounds
from osm import water_geometry

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--grid", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    with open(args.grid, encoding="utf-8") as source:
        grid = json.load(source)
    west, south, east, north = transform_bounds(grid["crs"], "EPSG:4326", *grid["projected_extent"], densify_pts=21)
   
    # Divide the geographic extent into four tiles.
    mid_lat = (south + north) / 2
    mid_lon = (west + east) / 2

    boxes = [
        (south, west, mid_lat, mid_lon),
        (south, mid_lon, mid_lat, east),
        (mid_lat, west, north, mid_lon),
        (mid_lat, mid_lon, north, east),
    ]

    endpoint = "https://overpass.kumi.systems/api/interpreter"
    elements_by_id = {}
    timestamps = []

    for index, (s, w, n, e) in enumerate(boxes, start=1):
        box = f"{s},{w},{n},{e}"

        query = (
            f'[out:json][timeout:120];('
            f'way["highway"]({box});'
            f'way["waterway"]({box});'
            f'way["natural"="water"]({box});'
            f'relation["type"="multipolygon"]["natural"="water"]({box});'
            f'relation["type"="multipolygon"]["waterway"="riverbank"]({box});'
            f');out geom;'
        )

        print(f"Fetching OSM tile {index}/{len(boxes)}...", flush=True)

        for attempt in range(1, 4):
            try:
                request = Request(
                    endpoint,
                    data=urlencode({"data": query}).encode(),
                    headers={"User-Agent": "FindWise-research/0.1"},
                )

                with urlopen(request, timeout=180) as response:
                    tile_data = json.load(response)

                if tile_data.get("remark"):
                    raise RuntimeError(tile_data["remark"])

                break

            except (HTTPError, URLError, TimeoutError) as error:
                print(f"  Attempt {attempt}/3 failed: {error}", flush=True)

                if attempt == 3:
                    raise

                time.sleep(10 * attempt)

        for element in tile_data["elements"]:
            key = (element["type"], element["id"])
            elements_by_id[key] = element

        timestamp = tile_data.get("osm3s", {}).get("timestamp_osm_base")
        if timestamp:
            timestamps.append(timestamp)

        print(
            f"  Tile {index} completed. "
            f"Total unique elements: {len(elements_by_id)}",
            flush=True,
        )

    data = {
        "elements": list(elements_by_id.values()),
        "osm3s": {
            "timestamp_osm_base": min(timestamps) if timestamps else None
        },
    }
    if data.get("remark"):
        raise RuntimeError(data["remark"])
    features = []
    water_members = set()
    for relation in data["elements"]:
        if relation["type"] != "relation":
            continue
        geometry = water_geometry(relation)
        tags = relation.get("tags", {})
        features.append({"type": "Feature", "geometry": geometry, "properties": {
            "id": f'osm-relation-{relation["id"]}', "name": tags.get("name", f'water {relation["id"]}'),
            "kind": "water", "status": "blocked", "reason": "복합 수역 내부 기준",
            "source": "OpenStreetMap contributors / ODbL", "osm_tags": tags}})
        water_members.update(m["ref"] for m in relation["members"] if m["type"] == "way")
    for way in data["elements"]:
        if way["type"] != "way":
            continue
        tags = way.get("tags", {})
        if way["id"] in water_members and "highway" not in tags:
            continue
        points = [[p["lon"], p["lat"]] for p in way.get("geometry", [])]
        if len(points) < 2:
            continue
        water = tags.get("natural") == "water" or tags.get("waterway") == "riverbank"
        polygon = water and len(points) >= 4 and points[0] == points[-1]
        kind = "water" if polygon else "river" if "waterway" in tags else "trail" if tags.get("highway") in ("path", "footway", "track", "steps", "bridleway") else "road"
        # OSM presence alone does not establish passability for a particular subject.
        status = "blocked" if polygon else "unknown"
        features.append({"type": "Feature", "geometry": {"type": "Polygon" if polygon else "LineString", "coordinates": [points] if polygon else points},
                         "properties": {"id": f'osm-way-{way["id"]}', "name": tags.get("name", f'{kind} {way["id"]}'),
                         "kind": kind, "status": status, "reason": "수역 내부 기준" if polygon else "통행 조건 확인 필요",
                         "source": "OpenStreetMap contributors / ODbL", "osm_tags": tags}})
    result = {"type": "FeatureCollection", "source_timestamp": data.get("osm3s", {}).get("timestamp_osm_base"),
              "coverage": "OSM highway/waterway ways and natural=water/waterway=riverbank multipolygons", "features": features}
    with open(args.output, "x", encoding="utf-8") as output:
        json.dump(result, output, ensure_ascii=False)
    print(f'Saved {len(features)} features')

if __name__ == "__main__":
    main()
