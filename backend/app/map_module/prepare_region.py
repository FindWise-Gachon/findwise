
import argparse
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

from clip_dem import clip_dem
from grid_generator import generate_grid
from osm_extract import extract_osm, extract_osm_layers


ROOT = Path(__file__).resolve().parents[3]
PROCESSED = ROOT / "data" / "processed"
WEB_TERRAIN = ROOT / "frontend" / "public" / "terrain"


def run_script(script_path, *arguments):
    command = [
        sys.executable,
        str(script_path),
        *[str(arg) for arg in arguments],
    ]
    subprocess.run(command, check=True)


def main():
    parser = argparse.ArgumentParser(
        description="Prepare terrain and OSM layers for a new region."
    )

    parser.add_argument("--dem", required=True, type=Path)
    parser.add_argument("--name", required=True)
    parser.add_argument("--vertical-datum", required=True)
    parser.add_argument("--source-version", required=True)

    # Optional DEM clipping
    parser.add_argument("--center-lon", type=float, default=None)
    parser.add_argument("--center-lat", type=float, default=None)
    parser.add_argument("--size-km", type=float, default=None)

    args = parser.parse_args()

    # --------------------------------------------------
    # 1. Validate input
    # --------------------------------------------------

    if not args.dem.is_file():
        parser.error(f"DEM file not found: {args.dem}")

    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]*", args.name):
        parser.error(
            "--name must use lowercase letters, digits, _ or -"
        )

    clip_options = [
        args.center_lon,
        args.center_lat,
        args.size_km,
    ]

    clip_requested = any(
        value is not None for value in clip_options
    )

    if clip_requested and not all(
        value is not None for value in clip_options
    ):
        parser.error(
            "--center-lon, --center-lat, --size-km "
            "must be provided together"
        )

    region = args.name
    work_dir = PROCESSED / region
    web_dir = WEB_TERRAIN / region

    # Prevent overwriting existing regions
    if work_dir.exists() or web_dir.exists():
        parser.error(
            "Region output directory already exists. "
            "Choose a new name to avoid overwriting data."
        )

    # --------------------------------------------------
    # 2. Prepare output directories
    # --------------------------------------------------

    work_dir.mkdir(parents=True)
    web_dir.mkdir(parents=True)

    # --------------------------------------------------
    # 3. Select DEM (clipped or full)
    # --------------------------------------------------

    dem_path = args.dem.resolve()

    if clip_requested:
        print(
            "\n[DEM] Clipping input DEM...",
            flush=True,
        )

        clipped_path = work_dir / "clipped_dem.tif"

        dem_path = clip_dem(
            input_path=dem_path,
            output_path=clipped_path,
            center_lon=args.center_lon,
            center_lat=args.center_lat,
            size_km=args.size_km,
        )

        print(
            "[DEM] Using clipped DEM:",
            dem_path,
            flush=True,
        )

    else:
        print(
            "\n[DEM] Using full DEM:",
            dem_path,
            flush=True,
        )

    # --------------------------------------------------
    # 4. Define output paths
    # --------------------------------------------------

    grid_path = work_dir / "grid.json"
    terrain_path = work_dir / "terrain.npz"
    osm_path = work_dir / "region.osm.pbf"
    layers_dir = work_dir / "osm-layers"
    osm_grid_path = work_dir / "osm-grid.npz"

    # --------------------------------------------------
    # 5. Run existing pipeline
    # --------------------------------------------------

    print("\n[1/6] Generating grid...", flush=True)

    generate_grid(
        dem_path,
        grid_path,
        f"{region}-grid",
    )

    print("\n[2/6] Processing DEM...", flush=True)

    run_script(
        ROOT / "backend/app/terrain.py",
        "--dem", dem_path,
        "--grid", grid_path,
        "--vertical-datum", args.vertical_datum,
        "--source-version", args.source_version,
        "--output", terrain_path,
    )

    print("\n[3/6] Extracting regional OSM...", flush=True)

    extract_osm(
        dem_path,
        ROOT / "data/raw/south-korea-261107.osm.pbf",
        osm_path,
    )

    print("\n[4/6] Extracting OSM layers...", flush=True)

    extract_osm_layers(
        osm_path,
        layers_dir,
    )

    print("\n[5/6] Rasterizing OSM layers...", flush=True)

    run_script(
        ROOT / "backend/app/map_module/osm_grid.py",
        "--grid", grid_path,
        "--trails", layers_dir / "trails.geojson",
        "--waterways", layers_dir / "waterways.geojson",
        "--output", osm_grid_path,
    )

    print("\n[6/6] Exporting terrain images...", flush=True)

    run_script(
        ROOT / "backend/app/map_module/export_terrain_images.py",
        "--terrain", terrain_path,
        "--output-dir", web_dir,
    )

    # --------------------------------------------------
    # 6. Copy web map files
    # --------------------------------------------------

    for filename, source in {
        "grid.json": grid_path,
        "trails.geojson": layers_dir / "trails.geojson",
        "waterways.geojson": layers_dir / "waterways.geojson",
    }.items():
        shutil.copy2(source, web_dir / filename)

    # --------------------------------------------------
    # 7. Create manifest
    # --------------------------------------------------

    grid = json.loads(
        grid_path.read_text(encoding="utf-8")
    )

    manifest = {
        "region_id": region,
        "grid": "grid.json",
        "trails": "trails.geojson",
        "waterways": "waterways.geojson",
        "elevation": "elevation.png",
        "slope": "slope.png",
        "bounds_projected": grid["projected_extent"],
        "crs": grid["crs"],
    }

    (web_dir / "manifest.json").write_text(
        json.dumps(
            manifest,
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    print("\n=== PIPELINE COMPLETE ===", flush=True)
    print("Processed data:", work_dir)
    print("Web map data:", web_dir)


if __name__ == "__main__":
    main()
