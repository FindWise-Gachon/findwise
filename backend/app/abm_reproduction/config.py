
from dataclasses import dataclass


@dataclass(frozen=True)
class ABMConfig:
    """Configuration for the paper-reproduction ABM."""

    # Spatial grid: 20 km x 20 km, 3000 x 3000 cells
    map_size_m: float = 20_000.0
    grid_rows: int = 3000
    grid_cols: int = 3000

    @property
    def cell_size_m(self) -> float:
        return self.map_size_m / self.grid_cols

    @property
    def grid_shape(self) -> tuple[int, int]:
        return (self.grid_rows, self.grid_cols)


if __name__ == "__main__":
    config = ABMConfig()

    print("Map size:", config.map_size_m, "m")
    print("Grid shape:", config.grid_shape)
    print("Cell size:", config.cell_size_m, "m")
