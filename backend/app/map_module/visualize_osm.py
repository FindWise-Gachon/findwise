
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np


BASE_DIR = Path(__file__).resolve().parents[3]
DATA_DIR = BASE_DIR / "data" / "processed"

terrain_path = DATA_DIR / "bukhansan-terrain.npz"
osm_path = DATA_DIR / "bukhansan-osm-layers.npz"

with np.load(terrain_path, allow_pickle=False) as terrain:
    elevation = terrain["elevation_m"].copy()
    valid = terrain["valid"].astype(bool)

with np.load(osm_path, allow_pickle=False) as osm:
    trails = osm["trail_mask"].astype(bool)
    waterways = osm["waterway_mask"].astype(bool)

assert elevation.shape == trails.shape == waterways.shape
assert valid.shape == elevation.shape

# 유효한 지형 영역만 표시
elevation = np.where(valid, elevation, np.nan)

# 등산로와 하천은 투명한 오버레이로 표시
trail_overlay = np.ma.masked_where(
    ~trails, np.ones(trails.shape)
)
water_overlay = np.ma.masked_where(
    ~waterways, np.ones(waterways.shape)
)

fig, ax = plt.subplots(figsize=(10, 12))

terrain_img = ax.imshow(
    elevation,
    cmap="terrain",
    origin="upper",
)

ax.imshow(
    trail_overlay,
    cmap="autumn",
    vmin=0,
    vmax=1,
    alpha=0.8,
    interpolation="nearest",
)

ax.imshow(
    water_overlay,
    cmap="Blues",
    vmin=0,
    vmax=1,
    alpha=0.9,
    interpolation="nearest",
)

fig.colorbar(
    terrain_img,
    ax=ax,
    label="Elevation (m)",
    shrink=0.7,
)

ax.set_title("Bukhansan Terrain + OSM Layers")
ax.set_xlabel("Grid column")
ax.set_ylabel("Grid row")

output_path = DATA_DIR / "bukhansan-osm-preview.png"

plt.savefig(
    output_path,
    dpi=180,
    bbox_inches="tight",
)

plt.show()

print("Saved preview:", output_path)
