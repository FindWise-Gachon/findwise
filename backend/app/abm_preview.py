"""Run the existing ABM behaviors and count occupied cells every half hour."""
import json
import os
import sys
from collections import Counter
from pathlib import Path

import numpy as np

from .abm_reproduction.agent import Agent, Behavior
from .abm_reproduction.config import ABMConfig
from .abm_reproduction.grid import TerrainGrid
from .abm_reproduction.simulation import (
    INITIAL_OFFSETS, SimulationState, initialize_simulation, run_random_walking_continuous,
)
from .abm_reproduction.strategies import (
    BacktrackState, run_backtracking_continuous, run_direction_traveling_continuous,
    run_route_traveling_continuous, run_staying_put_continuous, run_view_enhancing_continuous,
)
from .access import build_access
from .movement import can_move
from .ring_model import read_grid

SAMPLES = 512
SEED = 2026
STEPS_PER_HOUR = 850
BEHAVIOR_LABELS = {
    "rw": "무작위 보행",
    "rt": "경로 따라가기",
    "dt": "방향 유지",
    "sp": "제자리에 머무르기",
    "ve": "높은 곳으로 이동",
    "bt": "되돌아가기",
}
DEFAULT_DEM = Path(__file__).resolve().parents[2] / "data" / "processed" / "yosemite-terrain.npz"


class PreviewInputError(ValueError):
    """An input problem that can be presented to the user."""


class ReviewedGrid(TerrainGrid):
    """Use FindWise's operational movement rule in the web preview."""

    def __init__(self, config, access, valid, allow_unknown):
        super().__init__(config, valid, (access == 2) | ((access == 0) & (not allow_unknown)))
        self.access = np.where(valid, access, 2).astype(np.uint8)
        self.allow_unknown = allow_unknown

    def can_move(self, start, destination):
        return can_move(self.access, start[::-1], destination[::-1], allow_unknown=self.allow_unknown)


def load_dem(grid, path):
    try:
        with np.load(path, allow_pickle=False) as dem:
            metadata = json.loads(dem["metadata"].item())
            source = metadata["source"]
            if (metadata["terrain_schema_version"] != 1 or source["elevation_unit"] != "m" or
                    any(metadata["grid"][key] != grid[key] for key in (
                        "grid_id", "crs", "origin_north_west", "rows", "columns", "cell_size_m",
                    ))):
                raise ValueError("DEM grid or units differ")
            elevation, slope = dem["elevation_m"], dem["slope_deg"]
            version = source["version"]
            if (elevation.shape != (grid["rows"], grid["columns"]) or slope.shape != elevation.shape or
                    not isinstance(version, str) or not version):
                raise ValueError("Invalid DEM shape or source version")
            return elevation, slope, version
    except (OSError, KeyError, TypeError, ValueError) as error:
        raise PreviewInputError("현재 격자에 맞는 분석용 DEM을 준비해 주세요.") from error


def abm_preview(grid, case, *, samples=SAMPLES, dem_path=None):
    west, north, cell, rows, columns = read_grid(grid)
    x, y = case["point"]
    column, row = int((x - west) // cell), int((north - y) // cell)
    hours = case["hours"]
    behavior = case.get("behavior", "rw")
    slope_limit = case.get("slope_limit")
    reviewed = case.get("terrain")
    apply_access = case.get("apply_access", reviewed is not None)
    allow_unknown = case.get("allow_unknown", True)
    if not (0 <= column < columns and 0 <= row < rows and type(hours) is int and hours in (1, 2)):
        raise PreviewInputError("시작 위치와 계산 시간을 확인해 주세요.")
    if (not isinstance(behavior, str) or behavior not in BEHAVIOR_LABELS or
            slope_limit not in (None, 35, 45) or type(apply_access) is not bool or
            type(allow_unknown) is not bool or (apply_access and reviewed is None)):
        raise PreviewInputError("행동과 경사 설정을 확인해 주세요.")
    if behavior == "rt" and reviewed is None:
        raise PreviewInputError("경로 따라가기에는 등산로·도로 등의 선형 지형 자료가 필요합니다.")

    config = ABMConfig(map_size_m=columns * cell, grid_rows=rows, grid_cols=columns)
    valid = np.ones(config.grid_shape, dtype=bool)
    elevation = None
    metadata = {"samples": samples, "seed": SEED, "behavior": behavior}
    if behavior == "ve" or slope_limit is not None:
        elevation, slope, metadata["dem_version"] = load_dem(grid, dem_path or os.environ.get("FINDWISE_DEM_NPZ", DEFAULT_DEM))
        if behavior == "ve":
            valid &= np.isfinite(elevation)
        if slope_limit is not None:
            valid &= np.isfinite(slope) & (slope <= slope_limit)
            metadata["slope_limit_deg"] = slope_limit

    access = np.ones(config.grid_shape, dtype=np.uint8)
    linear_features = None
    if apply_access or behavior == "rt":
        try:
            reviewed_access, linear_features = build_access({**reviewed, "grid": grid})
        except (KeyError, ValueError, TypeError, RuntimeError) as error:
            raise PreviewInputError("지형 자료를 처리하지 못했습니다. 지형 설정을 확인해 주세요.") from error
        if apply_access:
            access = reviewed_access
            metadata["access_mode"] = "allow-unknown" if allow_unknown else "known-only"
        if behavior == "rt" and not linear_features.any():
            raise PreviewInputError("분석 범위 안에 경로 따라가기에 사용할 선형 지형이 없습니다.")

    terrain = ReviewedGrid(config, access, valid, allow_unknown)
    if not valid[row, column]:
        raise PreviewInputError("마지막 확인 위치의 고도·경사 자료와 경사 제한을 확인해 주세요.")
    if access[row, column] == 0 and not allow_unknown:
        raise PreviewInputError("마지막 확인 위치의 통행 상태가 미확인입니다. 통행이 확인된 위치를 선택하거나 ‘미확인 셀 이동 허용’을 확인해 주세요.")
    if not terrain.is_accessible(column, row):
        raise PreviewInputError("마지막 확인 위치가 통행 불가로 지정되어 있습니다. 위치나 통행 설정을 확인해 주세요.")
    can_depart = any(terrain.can_move((column, row), (column + dx, row + dy)) for dx, dy in INITIAL_OFFSETS)
    metadata["can_depart"] = can_depart
    counts = [Counter() for _ in range(hours * 2)]
    for seed in np.random.SeedSequence(SEED).spawn(samples):
        rng = np.random.default_rng(seed)
        agent = Agent(column, row, behavior=Behavior(behavior.upper()))
        state = initialize_simulation(agent, terrain, rng) if can_depart and behavior != "sp" else SimulationState(agent.position)
        backtrack = BacktrackState() if behavior == "bt" else None
        frame_args = (STEPS_PER_HOUR // 2, rng, STEPS_PER_HOUR)
        for index, frame in enumerate(counts):
            if can_depart or behavior == "sp":
                match behavior:
                    case "rt":
                        run_route_traveling_continuous(agent, terrain, linear_features, state, *frame_args)
                    case "dt":
                        run_direction_traveling_continuous(agent, terrain, state, *frame_args)
                    case "sp":
                        run_staying_put_continuous(agent, terrain, state, *frame_args)
                    case "ve":
                        run_view_enhancing_continuous(agent, terrain, elevation, state, *frame_args)
                    case "bt" if index > 0:
                        run_backtracking_continuous(agent, terrain, state, backtrack, *frame_args)
                    case _:
                        # The first BT interval generates a path from the LKP to retrace.
                        run_random_walking_continuous(agent, terrain, state, *frame_args)
            frame[agent.y * columns + agent.x] += 1
    return {
        "schema_version": 1,
        "grid_id": grid["grid_id"],
        "model_version": f"ABM · {BEHAVIOR_LABELS[behavior]}",
        "result_kind": "model",
        "lkp": case["lkp"],
        "last_seen_utc": case["last_seen_utc"],
        "abm_preview": metadata,
        **({"terrain_revision": reviewed["revision"]} if apply_access or behavior == "rt" else {}),
        "frames": [
            {"elapsed_seconds": 1800 * step, "cells": [[index, count / samples] for index, count in sorted(frame.items())]}
            for step, frame in enumerate(counts, start=1)
        ],
    }


if __name__ == "__main__":
    try:
        result = abm_preview(json.loads(sys.argv[1]), json.load(sys.stdin))
    except PreviewInputError as error:
        result = {"error": str(error)}
    print(json.dumps(result, allow_nan=False))
