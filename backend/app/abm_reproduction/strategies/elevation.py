# 고도 조회 기능 파일 - VE 등 고도를 쓰는 행동이 사용
# 기존 TerrainGrid는 고치지 않고, 고도 배열을 따로 받아 검사한다

# check_elevation
# 고도 배열의 모양이 격자와 같은지 확인

# elevation_at
# 셀의 고도를 반환
# 격자 밖, 지형 데이터가 없는 셀, NaN이면 None

import numpy as np

from ..grid import TerrainGrid


# 고도 배열 확인
def check_elevation(
    grid: TerrainGrid,
    elevation: np.ndarray,
) -> None:
    """Check that the elevation array matches the grid."""

    if elevation.shape != grid.config.grid_shape:
        raise ValueError("Invalid elevation shape")


# 셀 고도 조회
def elevation_at(
    grid: TerrainGrid,
    elevation: np.ndarray,
    x: int,
    y: int,
) -> float | None:
    """Return the elevation of a cell, or None if unknown."""

    if not grid.is_inside(x, y):
        return None

    if not grid.valid_mask[y, x]:
        return None

    value = float(elevation[y, x])

    if np.isnan(value):
        return None

    return value
