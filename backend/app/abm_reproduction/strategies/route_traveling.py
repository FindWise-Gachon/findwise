"""Route Traveling (RT), Hashimoto et al. (2022), Modeling, Fig. 2.

Use a boolean linear-feature layer (trails, roads, ridges, banks, etc.).
If a feature is found in the forward three cells, choose uniformly among
those feature cells. Otherwise fall back to RW (implementation interpretation
of the paper's feature detection and forward persistence).
"""

# 에이전트가 주변 선형 지형을 확인하고, 진행 방향을 유지하도록
# 전방의 최대 3개 위치에서 균등하게 후보를 선택함
# 선형 지형이 없다면 RW로 전환

# 1. 이전 위치와 현재 위치로 진행 방향 계산
# 2. 전방 3개 셀 계산
# 3. linear_feature_mask에서 선형 지형 확인
# 4. 조건을 만족하는 후보 중 무작위 선택
# 5. 후보가 없으면 RW 사용
# 6. 기존 smoothing 적용 후 이동
# RT는 linear_feature_mask가 있어야 실제 지형 기반으로 작동함
# 현재는 테스트용 마스크로 검증했으며, 실제 레이어(등산로,도로,등)와 연결하는 작업 필요

import numpy as np
from ..agent import Agent
from ..grid import TerrainGrid
from ..behaviors import random_walking_candidate, smooth_position
from ..simulation import SimulationState, StepRecord
from .direction_utils import forward_cells


def route_traveling_candidate(agent: Agent, grid: TerrainGrid, linear_feature_mask: np.ndarray, previous_position: tuple[int, int], rng: np.random.Generator) -> tuple[int, int]:
    if linear_feature_mask.shape != grid.config.grid_shape:
        raise ValueError('linear_feature_mask shape must match grid')
    forward = forward_cells(agent, previous_position)
    matches = [(x, y) for x, y in forward if grid.is_inside(x, y) and bool(linear_feature_mask[y, x])]
    if not matches:
        return random_walking_candidate(agent, rng)
    return matches[int(rng.integers(0, len(matches)))]


def route_traveling_step(agent: Agent, grid: TerrainGrid, linear_feature_mask: np.ndarray, previous_position: tuple[int, int], rng: np.random.Generator) -> bool:
    candidate = route_traveling_candidate(agent, grid, linear_feature_mask, previous_position, rng)
    smoothed = smooth_position(previous_position, agent.position, candidate)
    return agent.move_to(round(smoothed[0]), round(smoothed[1]), grid)


def run_route_traveling_continuous(agent: Agent, grid: TerrainGrid, linear_feature_mask: np.ndarray, state: SimulationState, num_steps: int, rng: np.random.Generator, steps_per_hour: int = 850) -> list[StepRecord]:
    if num_steps < 0:
        raise ValueError('num_steps must be non-negative')
    if steps_per_hour <= 0:
        raise ValueError('steps_per_hour must be positive')
    records = []
    for _ in range(num_steps):
        current = agent.position
        success = route_traveling_step(agent, grid, linear_feature_mask, state.previous_position, rng)
        agent.elapsed_seconds += 3600.0 / steps_per_hour
        state.previous_position = current
        state.step_count += 1
        records.append(StepRecord(state.step_count, agent.position, agent.elapsed_seconds, success))
    return records
