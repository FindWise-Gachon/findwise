
import argparse
import shutil
import subprocess
from pathlib import Path

import rasterio
from rasterio.warp import transform_bounds


ROOT = Path(__file__).resolve().parents[3]
DEFAULT_OSM = ROOT / "data/raw/south-korea-261107.osm.pbf"


def get_dem_bbox(dem_path):
    with rasterio.open(dem_path) as dem:
        if dem.crs is None:
            raise ValueError("DEM has no CRS.")

        west, south, east, north = transform_bounds(
            dem.crs,
            "EPSG:4326",
            *dem.bounds,
            densify_pts=21,
        )

    return west, south, east, north


def extract_osm(dem_path, osm_path, output_path):
    if shutil.which("osmium") is None:
        raise RuntimeError(
            "osmium executable not found. Check osmium installation."
        )

    if not Path(osm_path).is_file():
        raise FileNotFoundError(f"OSM file not found: {osm_path}")

    bbox = get_dem_bbox(dem_path)
    bbox_text = ",".join(f"{value:.8f}" for value in bbox)

    output_path = Path(output_path)

    if output_path.exists():
        raise FileExistsError(
            f"Output already exists: {output_path}"
        )

    output_path.parent.mkdir(parents=True, exist_ok=True)

    command = [
        "osmium",
        "extract",
        "--bbox",
        bbox_text,
        str(osm_path),
        "-o",
        str(output_path),
    ]

    print("=== OSM EXTRACTION ===", flush=True)
    print("DEM:", dem_path, flush=True)
    print("OSM:", osm_path, flush=True)
    print("BBOX:", bbox_text, flush=True)
    print("Output:", output_path, flush=True)

    subprocess.run(command, check=True)

    print("OSM extraction complete!")


def extract_osm_layers(osm_path, output_dir):
    osm_path = Path(osm_path)
    output_dir = Path(output_dir)

    if not osm_path.is_file():
        raise FileNotFoundError(f"OSM file not found: {osm_path}")

    output_dir.mkdir(parents=True, exist_ok=True)

    layers = {
        "trails": [
            "w/highway=path,footway,track,steps,bridleway",
        ],
        "waterways": [
            "w/waterway=stream,river,canal,ditch,drain",
        ],
    }

    for layer_name, filters in layers.items():
        filtered_pbf = output_dir / f"{layer_name}.osm.pbf"
        geojson_path = output_dir / f"{layer_name}.geojson"

        if filtered_pbf.exists() or geojson_path.exists():
            raise FileExistsError(
                f"Output already exists for layer: {layer_name}"
            )

        print(f"\nProcessing {layer_name}...", flush=True)

        subprocess.run(
            [
                "osmium",
                "tags-filter",
                str(osm_path),
                *filters,
                "-o",
                str(filtered_pbf),
            ],
            check=True,
        )

        subprocess.run(
            [
                "osmium",
                "export",
                str(filtered_pbf),
                "-o",
                str(geojson_path),
            ],
            check=True,
        )

        print(f"Created: {geojson_path}", flush=True)


def main():
    parser = argparse.ArgumentParser(
        description="Extract regional OSM data using a DEM bounding box."
    )

    parser.add_argument("--dem", required=True, type=Path)
    parser.add_argument("--osm", type=Path, default=DEFAULT_OSM)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument(
    "--layers-dir",
    type=Path,
    help="Directory for extracted trail and waterway GeoJSON files",
)

    args = parser.parse_args()

    if not args.dem.is_file():
        parser.error(f"DEM file not found: {args.dem}")

    extract_osm(args.dem, args.osm, args.output)
    if args.layers_dir is not None:
        extract_osm_layers(args.output, args.layers_dir)


if __name__ == "__main__":
    main()
