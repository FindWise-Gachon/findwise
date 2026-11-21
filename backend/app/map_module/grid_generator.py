
import argparse
import json
import math
from pathlib import Path

import rasterio
from rasterio.crs import CRS
from rasterio.transform import Affine
from rasterio.warp import transform_bounds


TARGET_CRS = "EPSG:5179"
CELL_SIZE_M = 10


def generate_grid(dem_path, output_path, grid_id):
    with rasterio.open(dem_path) as dem:
        if dem.count != 1:
            raise ValueError("DEM must have exactly one band.")
        if dem.crs is None:
            raise ValueError("DEM has no CRS.")

        # 원본 DEM의 범위를 공통 좌표계로 변환
        west, south, east, north = transform_bounds(
            dem.crs,
            TARGET_CRS,
            *dem.bounds,
            densify_pts=21,
        )

    # 격자 경계를 10m 단위로 정렬
    west = math.floor(west / CELL_SIZE_M) * CELL_SIZE_M
    south = math.floor(south / CELL_SIZE_M) * CELL_SIZE_M
    east = math.ceil(east / CELL_SIZE_M) * CELL_SIZE_M
    north = math.ceil(north / CELL_SIZE_M) * CELL_SIZE_M

    columns = int(round((east - west) / CELL_SIZE_M))
    rows = int(round((north - south) / CELL_SIZE_M))

    transform = Affine(
        CELL_SIZE_M, 0, west,
        0, -CELL_SIZE_M, north,
    )

    crs = CRS.from_string(TARGET_CRS)

    grid = {
        "schema_version": 1,
        "grid_id": grid_id,
        "crs": TARGET_CRS,
        "proj4": crs.to_proj4(),
        "origin_north_west": [west, north],
        "cell_size_m": CELL_SIZE_M,
        "rows": rows,
        "columns": columns,
        "cell_count": rows * columns,
        "projected_extent": [west, south, east, north],
        "geo_transform": list(transform.to_gdal()),
        "array_order": "row-major; west to east, north to south",
        "coordinate_order": "longitude, latitude",
        "boundary_policy": "west/north included; east/south excluded",
        "status": "geometry-only",
        "elevation_resampled": False,
        "validity_mask": None,
        "probabilities": None,
        "purpose": "Korean mountain terrain grid",
    }

    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    output_path.write_text(
        json.dumps(grid, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    print("Grid generated successfully!")
    print("CRS:", TARGET_CRS)
    print("Cell size:", CELL_SIZE_M, "m")
    print("Rows:", rows)
    print("Columns:", columns)
    print("Total cells:", rows * columns)
    print("Output:", output_path)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dem", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--grid-id", required=True)
    args = parser.parse_args()

    generate_grid(args.dem, args.output, args.grid_id)
