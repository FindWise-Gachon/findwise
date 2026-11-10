
import argparse
from pathlib import Path

import numpy as np
from PIL import Image


def export_image(values, valid, output_path, vmin, vmax, colors):
    # 유효하지 않은 값을 안전하게 처리
    safe_values = np.where(valid, values, vmin)

    normalized = np.clip(
        (safe_values - vmin) / (vmax - vmin),
        0,
        1,
    )

    stops = np.linspace(0, 1, len(colors))

    rgb = np.stack(
        [
            np.interp(
                normalized,
                stops,
                [c[channel] for c in colors],
            )
            for channel in range(3)
        ],
        axis=-1,
    ).astype(np.uint8)

    alpha = np.where(valid, 180, 0).astype(np.uint8)
    rgba = np.dstack((rgb, alpha))

    Image.fromarray(rgba, mode="RGBA").save(output_path)

    print(f"Created: {output_path}")


def main():
    parser = argparse.ArgumentParser(
        description="Export elevation and slope images from terrain NPZ."
    )

    parser.add_argument("--terrain", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)

    args = parser.parse_args()

    if not args.terrain.is_file():
        parser.error(f"Terrain file not found: {args.terrain}")

    elevation_path = args.output_dir / "elevation.png"
    slope_path = args.output_dir / "slope.png"

    if elevation_path.exists() or slope_path.exists():
        parser.error("Output images already exist in the target directory")

    with np.load(args.terrain, allow_pickle=False) as data:
        elevation = data["elevation_m"]
        slope = data["slope_deg"]
        valid = data["valid"].astype(bool)

    if elevation.shape != slope.shape or elevation.shape != valid.shape:
        raise ValueError("Terrain arrays must have identical shapes")

    args.output_dir.mkdir(parents=True, exist_ok=True)

    # 고도 이미지
    export_image(
        elevation,
        valid & np.isfinite(elevation),
        elevation_path,
        0,
        800,
        [
            (70, 160, 100),
            (200, 210, 110),
            (170, 110, 65),
        ],
    )

    # 경사도 이미지
    export_image(
        slope,
        valid & np.isfinite(slope),
        slope_path,
        0,
        60,
        [
            (250, 240, 160),
            (245, 150, 70),
            (190, 55, 55),
        ],
    )

    print("DEM image export complete!")


if __name__ == "__main__":
    main()
