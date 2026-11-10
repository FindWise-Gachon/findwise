import argparse
import json
from pathlib import Path

import numpy as np
import rasterio
from rasterio.features import rasterize
from rasterio.transform import Affine
from shapely.geometry import shape
from shapely.ops import transform
from pyproj import Transformer


def load_grid(grid_path):
    with open(grid_path, "r", encoding="utf-8") as f:
        grid = json.load(f)

    rows = grid["rows"]
    cols = grid["columns"]
    geo_transform = grid["geo_transform"]

    affine = Affine.from_gdal(*geo_transform)

    print(f"Grid size: {rows} x {cols}")
    print(f"Grid CRS: {grid['crs']}")
    print(f"Cell size: {grid['cell_size_m']}m")

    return grid, (rows, cols), affine


def load_lines(geojson_path, target_crs):
    with open(geojson_path, "r", encoding="utf-8") as f:
        geojson = json.load(f)

    # Osmium export GeoJSON 좌표는 WGS84 경위도
    transformer = Transformer.from_crs(
        "EPSG:4326",
        target_crs,
        always_xy=True,
    )

    lines = []

    for feature in geojson["features"]:
        geometry_data = feature.get("geometry")

        if not geometry_data:
            continue

        geometry = shape(geometry_data)

        # 이번 단계에서는 선형 지형만 사용
        if geometry.geom_type not in (
            "LineString",
            "MultiLineString",
        ):
            continue

        if geometry.is_empty:
            continue

        projected = transform(
            transformer.transform,
            geometry,
        )

        if not projected.is_empty:
            lines.append(projected)

    return lines


def create_mask(lines, grid_shape, affine):
    if not lines:
        return np.zeros(grid_shape, dtype=bool)

    mask = rasterize(
        [(line, 1) for line in lines],
        out_shape=grid_shape,
        transform=affine,
        fill=0,
        dtype=np.uint8,
        all_touched=True,
    )

    return mask.astype(bool)



def main():
    parser = argparse.ArgumentParser(
        description="Rasterize OSM trails and waterways onto a terrain grid."
    )

    parser.add_argument("--grid", required=True, type=Path)
    parser.add_argument("--trails", required=True, type=Path)
    parser.add_argument("--waterways", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)

    args = parser.parse_args()

    # 입력 파일 확인
    for path in (args.grid, args.trails, args.waterways):
        if not path.is_file():
            parser.error(f"Input file not found: {path}")

    if args.output.suffix.lower() != ".npz":
        parser.error("--output must end in .npz")

    if args.output.exists():
        parser.error(f"Output already exists: {args.output}")

    grid, grid_shape, affine = load_grid(args.grid)

    print("\nLoading trail geometries...")
    trails = load_lines(args.trails, grid["crs"])
    print("Trail lines:", len(trails))

    print("\nLoading waterway geometries...")
    waterways = load_lines(args.waterways, grid["crs"])
    print("Waterway lines:", len(waterways))

    print("\nRasterizing trails...")
    trail_mask = create_mask(
        trails, grid_shape, affine
    )

    print("Rasterizing waterways...")
    waterway_mask = create_mask(
        waterways, grid_shape, affine
    )

    print("\n=== RESULT ===")
    print("Trail mask shape:", trail_mask.shape)
    print("Waterway mask shape:", waterway_mask.shape)
    print("Trail cells:", np.count_nonzero(trail_mask))
    print("Waterway cells:", np.count_nonzero(waterway_mask))
    print(
        "Overlapping cells:",
        np.count_nonzero(trail_mask & waterway_mask),
    )

    args.output.parent.mkdir(parents=True, exist_ok=True)

    np.savez_compressed(
        args.output,
        trail_mask=trail_mask,
        waterway_mask=waterway_mask,
        crs=grid["crs"],
        geo_transform=np.array(grid["geo_transform"]),
    )

    print("\nSaved to:", args.output)


if __name__ == "__main__":
    main()
