# Backtracking (BT) 행동 파일 - 이전 경로 되짚기
# 직전 행동이 BT가 아니면 x(t-1)로, 직전 행동도 BT면
# BT가 아니었던 마지막 위치로 → 지나온 길을 한 칸씩 거꾸로 따라감

# agent.history를 스택처럼 사용
# move_to는 history 끝에만 위치를 추가하므로 앞쪽 인덱스는 바뀌지 않는다
# BacktrackState.index가 다음에 되돌아갈 history 위치를 가리킴

# 직전 행동이 BT였는지는 기존 코드를 고치지 않고 step_count로 판단
# 모든 연속 실행 함수는 한 스텝마다 state.step_count를 1 올린다
# last_step_count == state.step_count 이면 바로 앞 스텝이 BT

# 논문에 없어 정한 규칙
# - 평활화 없이 기록 위치로 바로 이동 (경로를 정확히 되짚기 위해)
# - 기록을 모두 되짚으면 제자리

from dataclasses import dataclass

import numpy as np

from ..agent import Agent
from ..grid import TerrainGrid
from ..simulation import SimulationState, StepRecord


@dataclass
class BacktrackState:
    """Persistent state for Backtracking."""

    # History index of the last backtracking target
    index: int | None = None

    # state.step_count right after the last BT step
    last_step_count: int | None = None


def backtracking_index(
    agent: Agent,
    backtrack: BacktrackState,
    state: SimulationState,
) -> int:
    """Return the history index of the next BT target (-1 if exhausted)."""

    continuing = (
        backtrack.index is not None
        and backtrack.last_step_count == state.step_count
    )

    # 1. A new backtrack starts from x(t-1)
    if not continuing:
        return len(agent.history) - 1

    # 2. A continuing backtrack goes one more cell back
    return backtrack.index - 1


def backtracking_candidate(
    agent: Agent,
    backtrack: BacktrackState,
    state: SimulationState,
) -> tuple[int, int]:
    """Select the provisional BT position."""

    index = backtracking_index(agent, backtrack, state)

    # Stay put when the history is exhausted
    if index < 0:
        return agent.position

    return agent.history[index]


def backtracking_step(
    agent: Agent,
    grid: TerrainGrid,
    backtrack: BacktrackState,
    state: SimulationState,
) -> bool:
    """Perform one Backtracking movement attempt."""

    # 1. Select a provisional destination
    index = backtracking_index(agent, backtrack, state)
    candidate = backtracking_candidate(agent, backtrack, state)

    # 2. Move without smoothing to retrace the exact route
    if index < 0:
        success = True
    else:
        success = agent.move_to(*candidate, grid)

    # 3. Save the index (retry the same target after a failed move)
    if index >= 0 and success:
        backtrack.index = index
    else:
        backtrack.index = index + 1

    # 4. Mark this step as BT (the loop increments step_count next)
    backtrack.last_step_count = state.step_count + 1

    return success


def run_backtracking_continuous(
    agent: Agent,
    grid: TerrainGrid,
    state: SimulationState,
    backtrack: BacktrackState,
    num_steps: int,
    rng: np.random.Generator,
    steps_per_hour: int = 850,
) -> list[StepRecord]:
    """Continue BT without resetting the previous position."""

    # rng is unused; kept to match the RW runner signature

    if num_steps < 0:
        raise ValueError("num_steps must be non-negative")

    if steps_per_hour <= 0:
        raise ValueError("steps_per_hour must be positive")

    seconds_per_step = 3600.0 / steps_per_hour
    records = []

    for _ in range(num_steps):

        current_position = agent.position

        success = backtracking_step(
            agent=agent,
            grid=grid,
            backtrack=backtrack,
            state=state,
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
