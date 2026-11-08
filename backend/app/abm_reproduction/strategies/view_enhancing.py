# View Enhancing (VE) 행동 파일 - 시야 확보를 위해 높은 곳으로 이동
# 주변 8칸 중 고도가 가장 높은 칸을 후보로 선택
# 현재 위치가 가장 높으면 제자리

# 논문에 없어 정한 규칙
# - 가장 높은 칸이 여러 개면 무작위로 선택
# - 고도를 알 수 없는 칸(격자 밖, 지형 데이터 없음, NaN)은 비교에서 제외
# - 진입 불가 칸도 비교에 포함 → 이동 단계에서 막혀 제자리 (논문 규칙)

# 후보 선택 후 이동은 RW와 같다: 평활화 → 반올림 → move_to

import numpy as np

from ..agent import Agent
from ..grid import TerrainGrid
from ..behaviors import smooth_position
from ..simulation import INITIAL_OFFSETS, SimulationState, StepRecord
from .elevation import check_elevation, elevation_at


def view_enhancing_candidate(
    agent: Agent,
    grid: TerrainGrid,
    elevation: np.ndarray,
    rng: np.random.Generator,
) -> tuple[int, int]:
    """Select the provisional VE position (highest adjacent cell)."""

    check_elevation(grid, elevation)

    current_elevation = elevation_at(grid, elevation, agent.x, agent.y)

    # 1. Find the highest adjacent cells (INITIAL_OFFSETS = 8 neighbors)
    best_elevation = None
    best_cells = []

    for dx, dy in INITIAL_OFFSETS:
        new_x = agent.x + dx
        new_y = agent.y + dy

        value = elevation_at(grid, elevation, new_x, new_y)

        if value is None:
            continue

        if best_elevation is None or value > best_elevation:
            best_elevation = value
            best_cells = [(new_x, new_y)]
        elif value == best_elevation:
            best_cells.append((new_x, new_y))

    # 2. Stay put if no neighbor is higher than the current cell
    if best_elevation is None:
        return agent.position

    if current_elevation is not None and current_elevation >= best_elevation:
        return agent.position

    # 3. Break ties randomly
    index = int(rng.integers(0, len(best_cells)))

    return best_cells[index]


def view_enhancing_step(
    agent: Agent,
    grid: TerrainGrid,
    elevation: np.ndarray,
    previous_position: tuple[int, int],
    rng: np.random.Generator,
) -> bool:
    """Perform one View Enhancing movement attempt."""

    # 1. Select a provisional destination
    candidate = view_enhancing_candidate(agent, grid, elevation, rng)

    # 2. Apply smoothing
    smoothed = smooth_position(
        previous_position=previous_position,
        current_position=agent.position,
        provisional_position=candidate,
    )

    # 3. Convert to integer grid coordinates
    next_x = round(smoothed[0])
    next_y = round(smoothed[1])

    # 4. Attempt to move
    success = agent.move_to(next_x, next_y, grid)

    return success


def run_view_enhancing_continuous(
    agent: Agent,
    grid: TerrainGrid,
    elevation: np.ndarray,
    state: SimulationState,
    num_steps: int,
    rng: np.random.Generator,
    steps_per_hour: int = 850,
) -> list[StepRecord]:
    """Continue VE without resetting the previous position."""

    if num_steps < 0:
        raise ValueError("num_steps must be non-negative")

    if steps_per_hour <= 0:
        raise ValueError("steps_per_hour must be positive")

    seconds_per_step = 3600.0 / steps_per_hour
    records = []

    for _ in range(num_steps):

        current_position = agent.position

        success = view_enhancing_step(
            agent=agent,
            grid=grid,
            elevation=elevation,
            previous_position=state.previous_position,
            rng=rng,
        )

        agent.elapsed_seconds += seconds_per_step

        state.previous_position = current_position
        state.step_count += 1

        records.append(
            StepRecord(
                step=state.step_count,
                position=agent.position,
                elapsed_seconds=agent.elapsed_seconds,
                success=success,
            )
        )

    return records
