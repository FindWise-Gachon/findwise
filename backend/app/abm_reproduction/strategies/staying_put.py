# Staying Put (SP) 행동 파일 - 제자리에 머무르기
# 후보 위치는 항상 현재 위치

# 평활화 식을 적용해도 직전 이동의 0.45배만 남는다
# 한 스텝 이동은 각 축 최대 1칸이므로 반올림하면 0이 되어 결과가 같다
# 그래서 평활화와 move_to 없이 제자리에 둔다

import numpy as np

from ..agent import Agent
from ..grid import TerrainGrid
from ..simulation import SimulationState, StepRecord


def staying_put_candidate(
    agent: Agent,
) -> tuple[int, int]:
    """Select the provisional SP position (the current cell)."""

    return agent.position


def staying_put_step(
    agent: Agent,
    grid: TerrainGrid,
    previous_position: tuple[int, int],
    rng: np.random.Generator,
) -> bool:
    """Perform one Staying Put step."""

    # The SP candidate is the current cell, so the agent does not move
    return True


def run_staying_put_continuous(
    agent: Agent,
    grid: TerrainGrid,
    state: SimulationState,
    num_steps: int,
    rng: np.random.Generator,
    steps_per_hour: int = 850,
) -> list[StepRecord]:
    """Continue SP without resetting the previous position."""

    if num_steps < 0:
        raise ValueError("num_steps must be non-negative")

    if steps_per_hour <= 0:
        raise ValueError("steps_per_hour must be positive")

    seconds_per_step = 3600.0 / steps_per_hour
    records = []

    for _ in range(num_steps):

        current_position = agent.position

        success = staying_put_step(
            agent=agent,
            grid=grid,
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
