# 행동 알고리즘
# RW_OFFSETS - 이동 후보 정의
# rng.integers() - 무작위 선택
# 임시 목적지 계산 (아직 실제 이동은 아님)
import numpy as np

from .agent import Agent


# Nine possible positions in a 3x3 neighborhood
RW_OFFSETS = [
    (-1, -1), (0, -1), (1, -1),
    (-1,  0), (0,  0), (1,  0),
    (-1,  1), (0,  1), (1,  1),
]


def random_walking_candidate(
    agent: Agent,
    rng: np.random.Generator,
) -> tuple[int, int]:
    """Select a provisional RW position uniformly."""

    # Randomly choose one of the nine offsets
    index = int(rng.integers(0, len(RW_OFFSETS)))

    dx, dy = RW_OFFSETS[index]

    # Calculate provisional destination
    new_x = agent.x + dx
    new_y = agent.y + dy

    return (new_x, new_y)

def smooth_position(
    previous_position: tuple[float, float],
    current_position: tuple[float, float],
    provisional_position: tuple[float, float],
    alpha: float = 0.55,
) -> tuple[float, float]:
    """Apply the position smoothing equation from the paper."""

    if not 0.0 <= alpha <= 1.0:
        raise ValueError("alpha must be between 0 and 1")

    prev_x, prev_y = previous_position
    curr_x, curr_y = current_position
    prov_x, prov_y = provisional_position

    # Provisional movement vector
    vx = prov_x - curr_x
    vy = prov_y - curr_y

    # Equation (1): smoothing
    next_x = (
        (2 - alpha) * curr_x
        + (alpha - 1) * prev_x
        + alpha * vx
    )

    next_y = (
        (2 - alpha) * curr_y
        + (alpha - 1) * prev_y
        + alpha * vy
    )

    return (next_x, next_y)

