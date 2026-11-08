"""Build an ISRID ring-model probability grid around the LKP. Distance only; no terrain or elapsed time."""
import argparse
import json
import math
import os
from pathlib import Path
from tempfile import NamedTemporaryFile

import numpy as np

MODEL_VERSION = "isrid-ring-v1"
PERCENTILES = ("25", "50", "75", "95")
CUMULATIVE = {"25": 0.25, "50": 0.50, "75": 0.75, "95": 0.95}
REFERENCE_SIDE_M = 50_000.0  # Sava et al. (2016) draw the rings on a 50 x 50 km square.
DEFAULT_PROFILES = Path(__file__).with_name("ring_profiles.json")


def read_grid(grid):
    if grid.get("schema_version") != 1:
        raise ValueError("Unsupported grid schema")
    rows, columns = grid["rows"], grid["columns"]
    if any(type(size) is not int or size < 1 for size in (rows, columns)):
        raise ValueError("Grid rows and columns must be positive integers")
    west, north = grid["origin_north_west"]
    cell = grid["cell_size_m"]
    if not all(map(math.isfinite, (west, north, cell))) or cell <= 0:
        raise ValueError("Invalid grid origin or cell size")
    if grid.get("cell_count", rows * columns) != rows * columns:
        raise ValueError("Grid manifest has inconsistent geometry")
    return west, north, cell, rows, columns


def read_distances(profile, name=""):
    distances = profile.get("distance_m", {})
    missing = [p for p in PERCENTILES if distances.get(p) is None]
    if missing:
        raise ValueError(
            f"Profile {name or '?'} has no distance for {', '.join(missing)}; "
            "fill backend/app/ring_profiles.json from the ISRID source"
        )
    values = [float(distances[p]) for p in PERCENTILES]
    if not all(math.isfinite(v) and v > 0 for v in values) or any(b <= a for a, b in zip(values, values[1:])):
        raise ValueError(f"Profile {name or '?'} distances must be positive and strictly increasing")
    return values


def ring_probability(grid, lkp_xy, distances):
    west, north, cell, rows, columns = read_grid(grid)
    x, y = lkp_xy
    if not all(map(math.isfinite, (x, y))):
        raise ValueError("LKP coordinates must be finite")
    if not (west <= x < west + columns * cell and north - rows * cell < y <= north):
        raise ValueError("LKP is outside the grid")

    centers_x = west + (np.arange(columns) + 0.5) * cell
    centers_y = north - (np.arange(rows) + 0.5) * cell
    dx = centers_x[np.newaxis, :] - x
    dy = centers_y[:, np.newaxis] - y
    distance = np.hypot(dx, dy)

    # Each annulus holds its percentile mass at uniform density. Mass outside the grid is dropped.
    probability = np.zeros((rows, columns), dtype=np.float64)
    inner, previous = 0.0, 0.0
    for percentile, outer in zip(PERCENTILES, distances):
        mass = CUMULATIVE[percentile] - previous
        density = mass / (math.pi * (outer**2 - inner**2))
        ring = (distance > inner) & (distance <= outer) if inner > 0 else distance <= outer
        probability[ring] = density * cell * cell
        inner, previous = outer, CUMULATIVE[percentile]
    # The remaining mass has a fixed density over the reference square minus the 95% ring,
    # so it does not depend on how large the grid is.
    outside_area = REFERENCE_SIDE_M**2 - math.pi * distances[-1] ** 2
    if outside_area <= 0:
        raise ValueError("The 95% distance does not fit in the reference square")
    half = REFERENCE_SIDE_M / 2
    outside = (distance > distances[-1]) & (np.abs(dx) <= half) & (np.abs(dy) <= half)
    probability[outside] = (1.0 - CUMULATIVE["95"]) / outside_area * cell * cell

    in_grid_mass = float(probability.sum())
    if in_grid_mass <= 0:
        raise ValueError("No ring mass falls inside the grid")
    return probability / in_grid_mass, in_grid_mass


def load_profile(profiles, subject_type):
    if profiles.get("schema_version") != 1:
        raise ValueError("Unsupported profile schema")
    try:
        return profiles["profiles"][subject_type]
    except KeyError:
        raise ValueError(f"Unknown subject type {subject_type!r}; choose from {sorted(profiles['profiles'])}") from None


def main():
    parser = argparse.ArgumentParser(description="Build an ISRID ring-model probability grid around the LKP.")
    parser.add_argument("--grid", required=True, type=Path, help="Exported grid JSON")
    parser.add_argument("--subject-type", required=True, help="Profile key in the profiles file, e.g. hiker")
    location = parser.add_mutually_exclusive_group(required=True)
    location.add_argument("--lkp-xy", nargs=2, type=float, metavar=("X", "Y"), help="LKP in the grid's projected metres")
    location.add_argument("--lkp-lonlat", nargs=2, type=float, metavar=("LON", "LAT"), help="LKP in WGS84 degrees")
    parser.add_argument("--profiles", type=Path, default=DEFAULT_PROFILES, help="ISRID distance profiles JSON")
    parser.add_argument("--output", required=True, type=Path, help="New .npz file")
    args = parser.parse_args()
    if args.output.suffix != ".npz":
        parser.error("--output must end in .npz")
    if args.output.exists():
        parser.error("--output already exists")

    grid = json.loads(args.grid.read_text(encoding="utf-8"))
    profiles = json.loads(args.profiles.read_text(encoding="utf-8"))
    profile = load_profile(profiles, args.subject_type)
    distances = read_distances(profile, args.subject_type)

    if args.lkp_xy:
        lkp_xy = tuple(args.lkp_xy)
    else:
        from rasterio.warp import transform
        xs, ys = transform("EPSG:4326", grid["crs"], [args.lkp_lonlat[0]], [args.lkp_lonlat[1]])
        lkp_xy = (xs[0], ys[0])

    probability, in_grid_mass = ring_probability(grid, lkp_xy, distances)
    metadata = {
        "ring_schema_version": 1,
        "model_version": MODEL_VERSION,
        "grid": grid,
        "lkp": {"xy": list(lkp_xy), "lonlat": args.lkp_lonlat},
        "subject_type": args.subject_type,
        "profile": profile,
        "percentiles": dict(zip(PERCENTILES, distances)),
        "reference_side_m": REFERENCE_SIDE_M,
        "value_meaning": "probability per cell; sums to 1 within the grid",
        "in_grid_mass": in_grid_mass,
        "software": {"numpy": np.__version__},
    }
    # Publish the completed archive without replacing an existing result.
    with NamedTemporaryFile(dir=args.output.parent) as temp:
        np.savez_compressed(temp, probability=probability, metadata=json.dumps(metadata, allow_nan=False))
        temp.flush()
        os.link(temp.name, args.output)
    print(f"{args.output}: {in_grid_mass:.1%} of ring mass inside the grid, max cell {probability.max():.3e}")


if __name__ == "__main__":
    main()
