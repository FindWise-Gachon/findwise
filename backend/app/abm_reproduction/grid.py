# 격자 검사 기능 파일 - 이동 전, 목적지가 유효한지 확인하는 기능

import numpy as np

try:
    from .config import ABMConfig
except ImportError:
    from config import ABMConfig


class TerrainGrid:
    """Grid boundary and accessibility checks for ABM."""

    # 격자 객체 초기화
    def __init__(
        self,
        config: ABMConfig, # 격자 크기, 해상도
        valid_mask: np.ndarray, # 지형 데이터가 유효한 셀인지
        inaccessible_mask: np.ndarray, # 진입 불가 영역인지
    ):
        self.config = config

        expected_shape = config.grid_shape

        if valid_mask.shape != expected_shape:
            raise ValueError("Invalid valid_mask shape")

        if inaccessible_mask.shape != expected_shape:
            raise ValueError("Invalid inaccessible_mask shape")

        self.valid_mask = valid_mask.astype(bool)
        self.inaccessible_mask = inaccessible_mask.astype(bool)

    # 격자 범위 확인
    def is_inside(self, x: int, y: int) -> bool:
        """Check whether a cell is inside the grid."""
        return (
            0 <= x < self.config.grid_cols
            and 0 <= y < self.config.grid_rows
        )

    # 실제 이동 가능한지 확인
    def is_accessible(self, x: int, y: int) -> bool:
        """Check whether an agent may enter a cell."""

        if not self.is_inside(x, y):
            return False

        if not self.valid_mask[y, x]:
            return False

        if self.inaccessible_mask[y, x]:
            return False

        return True


if __name__ == "__main__":
    config = ABMConfig()

    valid = np.ones(config.grid_shape, dtype=bool)
    inaccessible = np.zeros(config.grid_shape, dtype=bool)

    # Mark one cell as inaccessible
    inaccessible[1500, 1502] = True

    # Mark one cell as missing terrain data
    valid[1501, 1500] = False

    grid = TerrainGrid(config, valid, inaccessible)

    print("Inside grid:", grid.is_inside(1500, 1500))
    print("Outside grid:", grid.is_inside(3000, 1500))

    print("Normal cell:", grid.is_accessible(1500, 1500))
    print("Blocked cell:", grid.is_accessible(1502, 1500))
    print("Invalid terrain:", grid.is_accessible(1500, 1501))
