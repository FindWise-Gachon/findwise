import numpy as np

from ..config import ABMConfig
from ..agent import Agent
from ..grid import TerrainGrid
from .view_enhancing import (
    run_view_enhancing_continuous,
    view_enhancing_candidate,
    view_enhancing_step,
)
from ..simulation import SimulationState


# 1. Create a test grid
config = ABMConfig(
    map_size_m=100.0,
    grid_rows=10,
    grid_cols=10,
)

valid = np.ones(config.grid_shape, dtype=bool)
inaccessible = np.zeros(config.grid_shape, dtype=bool)

grid = TerrainGrid(config, valid, inaccessible)

rng = np.random.default_rng(seed=42)


# 2. Create a flat elevation with one hill
elevation = np.zeros(config.grid_shape, dtype=float)
elevation[5, 6] = 10.0  # (x=6, y=5): east of the agent


# Test 1: Move to the highest adjacent cell
agent = Agent(x=5, y=5)

candidate = view_enhancing_candidate(agent, grid, elevation, rng)

assert candidate == (6, 5)

success = view_enhancing_step(
    agent=agent,
    grid=grid,
    elevation=elevation,
    previous_position=agent.position,
    rng=rng,
)

assert success
assert agent.position == (6, 5)

print("[PASS] Test 1: VE moves to the highest neighbor")


# Test 2: Stay put on the peak
assert view_enhancing_candidate(agent, grid, elevation, rng) == agent.position

state = SimulationState(previous_position=agent.position)

records = run_view_enhancing_continuous(
    agent=agent,
    grid=grid,
    elevation=elevation,
    state=state,
    num_steps=5,
    rng=rng,
)

assert all(record.position == (6, 5) for record in records)
assert state.step_count == 5

print("[PASS] Test 2: VE stays on the peak")


# Test 3: Ties are broken randomly among the highest cells
tie_elevation = np.zeros(config.grid_shape, dtype=float)
tie_elevation[4, 5] = 3.0  # (x=5, y=4)
tie_elevation[6, 5] = 3.0  # (x=5, y=6)

agent = Agent(x=5, y=5)

candidates = {
    view_enhancing_candidate(agent, grid, tie_elevation, rng)
    for _ in range(50)
}

assert candidates == {(5, 4), (5, 6)}

print("[PASS] Test 3: VE breaks ties randomly")


# Test 4: An inaccessible highest cell blocks the move
blocked = np.zeros(config.grid_shape, dtype=bool)
blocked[5, 6] = True

blocked_grid = TerrainGrid(config, valid, blocked)

agent = Agent(x=5, y=5)

success = view_enhancing_step(
    agent=agent,
    grid=blocked_grid,
    elevation=elevation,
    previous_position=agent.position,
    rng=rng,
)

assert not success
assert agent.position == (5, 5)
assert agent.history == []

print("[PASS] Test 4: VE stays when the highest cell is inaccessible")


# Test 5: Unknown elevations are ignored
unknown_elevation = elevation.copy()
unknown_elevation[5, 6] = np.nan  # NaN hill
unknown_elevation[4, 4] = 5.0     # second hill, but no terrain data

invalid = valid.copy()
invalid[4, 4] = False
unknown_elevation[6, 4] = 2.0     # (x=4, y=6): the highest known cell

unknown_grid = TerrainGrid(config, invalid, inaccessible)

agent = Agent(x=5, y=5)

assert view_enhancing_candidate(agent, unknown_grid, unknown_elevation, rng) == (4, 6)

print("[PASS] Test 5: VE ignores unknown elevations")


# Test 6: The elevation shape must match the grid
try:
    view_enhancing_candidate(agent, grid, np.zeros((3, 3)), rng)
except ValueError:
    pass
else:
    raise AssertionError("Expected ValueError")

print("[PASS] Test 6: VE checks the elevation shape")


print("\nAll View Enhancing tests passed!")
