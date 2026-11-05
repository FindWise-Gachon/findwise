"""Rasterize a reviewed terrain package. Values: 0 unknown, 1 allowed, 2 blocked."""
import argparse
import json
import os
from tempfile import NamedTemporaryFile
import numpy as np
from rasterio.features import rasterize
from rasterio.transform import Affine
from rasterio.warp import transform_geom

def build_access(package):
    grid = package["grid"]
    if package["schema_version"] != 1 or grid["schema_version"] != 1:
        raise ValueError("Unsupported schema")
    rows, columns = grid["rows"], grid["columns"]
    size = grid["cell_size_m"]
    if size <= 0 or rows <= 0 or columns <= 0 or grid["cell_count"] != rows * columns:
        raise ValueError("Invalid grid")
    transform = Affine.from_gdal(*grid["geo_transform"])
    if transform != Affine(size, 0, grid["origin_north_west"][0], 0, -size, grid["origin_north_west"][1]):
        raise ValueError("Inconsistent grid transform")
    status = {"unknown": 0, "allowed": 1, "blocked": 2}
    access = np.zeros((rows, columns), dtype="uint8")
    linear = np.zeros_like(access)
    # Base features first, then reviewed edits. Later edits take precedence.
    count = package.get("base_feature_count", len(package["features"]))
    if not isinstance(count, int) or count < 0 or count > len(package["features"]):
        raise ValueError("Invalid base feature count")
    base = sorted(package["features"][:count], key=lambda f: status[f["properties"]["status"]])
    for feature in base + package["features"][count:]:
        geometry = feature["geometry"]
        if geometry["type"] not in ("LineString", "Polygon", "MultiPolygon"):
            raise ValueError("Unsupported geometry")
        geometry = transform_geom("EPSG:4326", grid["crs"], geometry)
        mask = rasterize([(geometry, 1)], out_shape=access.shape, transform=transform,
                         all_touched=True, dtype="uint8").astype(bool)
        access[mask] = status[feature["properties"]["status"]]
        if feature["properties"]["kind"] in ("trail", "road", "river", "shoreline"):
            linear[mask] = 1
    return access, linear

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("input")
    parser.add_argument("output")
    args = parser.parse_args()
    with open(args.input, encoding="utf-8") as source:
        package = json.load(source)
    access, linear = build_access(package)
    metadata = json.dumps(package, allow_nan=False)
    with NamedTemporaryFile(dir=os.path.dirname(os.path.abspath(args.output))) as temp:
        np.savez_compressed(temp, access=access, linear_features=linear, metadata=metadata)
        temp.flush()
        os.link(temp.name, args.output)
    print(f"Saved {access.size} cells. Unknown: {(access == 0).sum()}")

if __name__ == "__main__":
    main()
