
import numpy as np

from .agent import Agent
from .grid import TerrainGrid
from .behaviors import (
    random_walking_candidate,
    smooth_position,
)


def random_walking_step(
    agent: Agent,
    grid: TerrainGrid,
    previous_position: tuple[int, int],
    rng: np.random.Generator,
) -> bool:
    """Perform one Random Walking movement attempt."""

    # 1. Select a provisional destination
    candidate = random_walking_candidate(agent, rng)

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


from dataclasses import dataclass


@dataclass
class StepRecord:
    """Result of one simulation step."""

    step: int
    position: tuple[int, int]
    elapsed_seconds: float
    success: bool


def run_random_walking(
    agent: Agent,
    grid: TerrainGrid,
    num_steps: int,
    rng: np.random.Generator,
    steps_per_hour: int = 850,
) -> list[StepRecord]:
    """Run repeated Random Walking steps."""

    if num_steps < 0:
        raise ValueError("num_steps must be non-negative")

    if steps_per_hour <= 0:
        raise ValueError("steps_per_hour must be positive")

    seconds_per_step = 3600.0 / steps_per_hour

    # Temporary initialization for testing
    previous_position = agent.position

    records = []

    for step in range(1, num_steps + 1):

        # Save position before attempting movement
        current_position = agent.position

        # Perform one Random Walking step
        success = random_walking_step(
            agent=agent,
            grid=grid,
            previous_position=previous_position,
            rng=rng,
        )

        # Advance simulation time
        agent.elapsed_seconds += seconds_per_step

        # Update previous position for the next step
        previous_position = current_position

        # Record the result of this step
        record = StepRecord(
            step=step,
            position=agent.position,
            elapsed_seconds=agent.elapsed_seconds,
            success=success,
        )

        records.append(record)

    return records


@dataclass
class SimulationState:
    """Persistent state for repeated simulation runs."""

    previous_position: tuple[int, int]
    step_count: int = 0


INITIAL_OFFSETS = [
    (-1, -1), (0, -1), (1, -1),
    (-1,  0),          (1,  0),
    (-1,  1), (0,  1), (1,  1),
]


def initialize_simulation(
    agent: Agent,
    grid: TerrainGrid,
    rng: np.random.Generator,
) -> SimulationState:
    """Initialize movement using one adjacent cell."""

    if not grid.is_accessible(*agent.position):
        raise ValueError("Initial position is inaccessible")

    if agent.history or agent.elapsed_seconds != 0:
        raise ValueError("Agent must be in its initial state")

    start_position = agent.position

    # Choose from accessible adjacent cells
    candidates = []

    for dx, dy in INITIAL_OFFSETS:
        new_x = agent.x + dx
        new_y = agent.y + dy

        if grid.is_accessible(new_x, new_y):
            candidates.append((new_x, new_y))

    if not candidates:
        raise ValueError("No accessible adjacent cells")

    index = int(rng.integers(0, len(candidates)))
    first_position = candidates[index]

    agent.move_to(*first_position, grid)

    return SimulationState(
        previous_position=start_position,
        step_count=0,
    )


def run_random_walking_continuous(
    agent: Agent,
    grid: TerrainGrid,
    state: SimulationState,
    num_steps: int,
    rng: np.random.Generator,
    steps_per_hour: int = 850,
) -> list[StepRecord]:
    """Continue RW without resetting the previous position."""

    if num_steps < 0:
        raise ValueError("num_steps must be non-negative")

    if steps_per_hour <= 0:
        raise ValueError("steps_per_hour must be positive")

    seconds_per_step = 3600.0 / steps_per_hour
    records = []

    for _ in range(num_steps):

        current_position = agent.position

        success = random_walking_step(
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

