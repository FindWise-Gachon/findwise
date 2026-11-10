
from pathlib import Path
import argparse
import math

import rasterio
from rasterio.errors import WindowError
from rasterio.windows import from_bounds, Window
from rasterio.warp import transform, transform_bounds


def clip_dem(
    input_path,
    output_path,
    center_lon,
    center_lat,
    size_km,
):
    input_path = Path(input_path)
    output_path = Path(output_path)

    if not input_path.is_file():
        raise FileNotFoundError(f"DEM not found: {input_path}")

    if not all(math.isfinite(v) for v in (
        center_lon, center_lat, size_km
    )):
        raise ValueError("Coordinates and size must be finite")

    if not (-180 <= center_lon <= 180):
        raise ValueError("Invalid longitude")

    if not (-90 <= center_lat <= 90):
        raise ValueError("Invalid latitude")

    if size_km <= 0:
        raise ValueError("size_km must be positive")

    # 중심점을 미터 단위 좌표계로 변환
    x, y = transform(
        "EPSG:4326",
        "EPSG:5179",
        [center_lon],
        [center_lat],
    )

    half_size = size_km * 1000 / 2

    left = x[0] - half_size
    bottom = y[0] - half_size
    right = x[0] + half_size
    top = y[0] + half_size

    with rasterio.open(input_path) as src:
        if src.crs is None:
            raise ValueError("DEM has no CRS")

        if src.count != 1:
            raise ValueError("DEM must have one band")

        # 요청한 영역을 원본 DEM 좌표계로 변환
        bounds = transform_bounds(
            "EPSG:5179",
            src.crs,
            left,
            bottom,
            right,
            top,
            densify_pts=21,
        )

        window = from_bounds(
            *bounds,
            transform=src.transform,
        )

        # 요청 영역을 모두 포함하도록 픽셀 경계 확장
        col_start = math.floor(window.col_off)
        row_start = math.floor(window.row_off)
        col_end = math.ceil(window.col_off + window.width)
        row_end = math.ceil(window.row_off + window.height)

        window = Window(
            col_start,
            row_start,
            col_end - col_start,
            row_end - row_start,
        )

        full_window = Window(
            0, 0, src.width, src.height
        )

        try:
            overlap = window.intersection(full_window)
        except WindowError as exc:
            raise ValueError(
                "Requested area does not overlap the DEM"
            ) from exc

        # 원본 DEM이 요청 영역을 전부 포함하는지 확인
        if overlap != window:
            raise ValueError(
                "Requested area extends outside the DEM. "
                "Use a smaller size or another DEM."
            )

        data = src.read(1, window=window)

        profile = src.profile.copy()
        profile.update(
            height=data.shape[0],
            width=data.shape[1],
            transform=src.window_transform(window),
        )

        output_path.parent.mkdir(
            parents=True,
            exist_ok=True,
        )

        with rasterio.open(output_path, "w", **profile) as dst:
            dst.write(data, 1)

    print(f"DEM clipped: {output_path}")
    print(f"Shape: {data.shape}")

    return output_path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dem", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--center-lon", required=True, type=float)
    parser.add_argument("--center-lat", required=True, type=float)
    parser.add_argument("--size-km", required=True, type=float)

    args = parser.parse_args()

    clip_dem(
        args.dem,
        args.output,
        args.center_lon,
        args.center_lat,
        args.size_km,
    )


if __name__ == "__main__":
    main()
