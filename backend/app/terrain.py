import argparse
import json
import math
import os
from pathlib import Path
from tempfile import NamedTemporaryFile

import numpy as np
import rasterio
from rasterio.crs import CRS
from rasterio.enums import Resampling
from rasterio.transform import Affine
from rasterio.vrt import WarpedVRT


def align_terrain(dem, grid):
    if grid["schema_version"] != 1:
        raise ValueError("Unsupported grid schema")
    rows, columns = grid["rows"], grid["columns"]
    if any(type(size) is not int or size < 3 for size in (rows, columns)):
        raise ValueError("Terrain grid requires at least three rows and columns")

    crs = CRS.from_user_input(grid["crs"])
    if not crs.is_projected or crs.linear_units_factor[1] != 1:
        raise ValueError("Grid CRS must be projected in metres")
    west, north = grid["origin_north_west"]
    cell = grid["cell_size_m"]
    if not all(map(math.isfinite, (west, north, cell))) or cell <= 0:
        raise ValueError("Invalid grid origin or cell size")
    transform = Affine(cell, 0, west, 0, -cell, north)
    if grid["geo_transform"] != list(transform.to_gdal()) or grid["cell_count"] != rows * columns:
        raise ValueError("Grid manifest has inconsistent geometry")

    with rasterio.open(dem) as source:
        if source.count != 1 or source.crs is None:
            raise ValueError("DEM must have one elevation band and a CRS")
        if source.scales[0] != 1 or source.offsets[0] != 0:
            raise ValueError("Convert scaled DEM values to metres before alignment")
        source_metadata = {
            "crs": source.crs.to_string(),
            "pixel_size": list(source.res),
            "nodata": source.nodata if source.nodata is None or math.isfinite(source.nodata) else str(source.nodata),
        }
        with WarpedVRT(
            source, crs=crs, transform=transform, width=columns, height=rows,
            dtype="float32", nodata=float("nan"), resampling=Resampling.bilinear,
        ) as aligned:
            elevation = aligned.read(1, masked=True).filled(np.nan)

    elevation[~np.isfinite(elevation)] = np.nan
    slope = np.full_like(elevation, np.nan)
    # Central differences require a valid center and all four neighbors.
    dx = (elevation[1:-1, 2:] - elevation[1:-1, :-2]) / (2 * cell)
    dy = (elevation[2:, 1:-1] - elevation[:-2, 1:-1]) / (2 * cell)
    interior = np.degrees(np.arctan(np.hypot(dx, dy)))
    slope[1:-1, 1:-1] = np.where(np.isfinite(elevation[1:-1, 1:-1]), interior, np.nan)
    valid = np.isfinite(slope)
    if not valid.any():
        raise ValueError("DEM and grid overlap does not contain any valid slope cells")
    return elevation, slope, valid, source_metadata


def main():
    parser = argparse.ArgumentParser(description="Align a metre-valued DEM to a FindWise grid manifest.")
    parser.add_argument("--dem", required=True, help="Single-band GeoTIFF path or HTTPS URL")
    parser.add_argument("--grid", required=True, type=Path, help="Exported grid JSON")
    parser.add_argument("--vertical-datum", required=True, help="Source datum, recorded without conversion")
    parser.add_argument("--source-version", required=True, help="Source release, checksum or ETag")
    parser.add_argument("--output", required=True, type=Path, help="New .npz file")
    args = parser.parse_args()
    if args.output.suffix != ".npz":
        parser.error("--output must end in .npz")
    if args.output.exists():
        parser.error("--output already exists")

    grid = json.loads(args.grid.read_text(encoding="utf-8"))
    elevation, slope, valid, source = align_terrain(args.dem, grid)
    metadata = {
        "terrain_schema_version": 1,
        "grid": grid,
        "source": {
            **source, "location": args.dem, "version": args.source_version,
            "vertical_datum": args.vertical_datum, "elevation_unit": "m",
        },
        "resampling": "bilinear",
        "slope_method": "centered differences, degrees",
        "software": {"numpy": np.__version__, "rasterio": rasterio.__version__, "gdal": rasterio.__gdal_version__},
    }
    # Publish the completed archive without replacing an existing result.
    with NamedTemporaryFile(dir=args.output.parent) as temp:
        np.savez_compressed(
            temp, elevation_m=elevation, slope_deg=slope, valid=valid,
            metadata=json.dumps(metadata, allow_nan=False),
        )
        temp.flush()
        os.link(temp.name, args.output)
    print(f"{args.output}: {valid.sum():,} / {valid.size:,} cells with elevation and slope")


if __name__ == "__main__":
    main()
