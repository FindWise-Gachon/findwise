"""Direction Traveling (DT), Hashimoto et al. (2022), Modeling, Fig. 2.

DT uses the forward row of the agent-aligned 3x3 neighborhood.
Choice among the three forward cells is uniform (Fig. 2 interpretation).
When heading is zero, we choose RW as an explicit implementation fallback.
"""
# 이전 이동 속도 방향에 맞춘 Body Coordinates를 사용해 전방으로 이동하도록 정의

# 1. 이전 위치와 현재 위치로 진행 방향 계산
# 2. 진행 방향에 맞는 전방 후보 생성
# 3. 후보 중 하나 선택
# 4. 기존 smoothing 적용
# 5. 이동 가능 여부 확인 후 위치 갱신
# RT와 달리 선형 지형 데이터를 필요로 하지 않음

import numpy as np
from ..agent import Agent
from ..grid import TerrainGrid
from ..behaviors import random_walking_candidate, smooth_position
from ..simulation import SimulationState, StepRecord
from .direction_utils import forward_cells


def direction_traveling_candidate(agent: Agent, previous_position: tuple[int, int], rng: np.random.Generator) -> tuple[int, int]:
    choices = forward_cells(agent, previous_position)
    if not choices:
        return random_walking_candidate(agent, rng)
    return choices[int(rng.integers(0, len(choices)))]


def direction_traveling_step(agent: Agent, grid: TerrainGrid, previous_position: tuple[int, int], rng: np.random.Generator) -> bool:
    candidate = direction_traveling_candidate(agent, previous_position, rng)
    smoothed = smooth_position(previous_position, agent.position, candidate)
    return agent.move_to(round(smoothed[0]), round(smoothed[1]), grid)


def run_direction_traveling_continuous(agent: Agent, grid: TerrainGrid, state: SimulationState, num_steps: int, rng: np.random.Generator, steps_per_hour: int = 850) -> list[StepRecord]:
    if num_steps < 0:
        raise ValueError('num_steps must be non-negative')
    if steps_per_hour <= 0:
        raise ValueError('steps_per_hour must be positive')
    records = []
    for _ in range(num_steps):
        current = agent.position
        success = direction_traveling_step(agent, grid, state.previous_position, rng)
        agent.elapsed_seconds += 3600.0 / steps_per_hour
        state.previous_position = current
        state.step_count += 1
        records.append(StepRecord(state.step_count, agent.position, agent.elapsed_seconds, success))
    return records
