import numpy as np

from ..config import ABMConfig
from ..agent import Agent
from ..grid import TerrainGrid
from ..simulation import initialize_simulation
from .staying_put import (
    run_staying_put_continuous,
    staying_put_candidate,
)


# 1. Create a test grid
config = ABMConfig(
    map_size_m=100.0,
    grid_rows=10,
    grid_cols=10,
)

valid = np.ones(config.grid_shape, dtype=bool)
inaccessible = np.zeros(config.grid_shape, dtype=bool)

grid = TerrainGrid(config, valid, inaccessible)


# 2. Create an agent and initialize movement
agent = Agent(x=5, y=5)
rng = np.random.default_rng(seed=42)

state = initialize_simulation(agent, grid, rng)

start_position = agent.position
start_history = agent.history.copy()

print("Initial position:", agent.position)


# Test 1: The SP candidate is the current cell
assert staying_put_candidate(agent) == agent.position

print("[PASS] Test 1: SP candidate")


# Test 2: Staying put keeps the position and history
records = run_staying_put_continuous(
    agent=agent,
    grid=grid,
    state=state,
    num_steps=10,
    rng=rng,
)

assert agent.position == start_position
assert agent.history == start_history
assert all(record.position == start_position for record in records)
assert all(record.success for record in records)

print("[PASS] Test 2: SP keeps position and history")


# Test 3: Time and step count still advance
assert len(records) == 10
assert state.step_count == 10
assert state.previous_position == start_position
assert np.isclose(agent.elapsed_seconds, 10 * 3600 / 850)

print("[PASS] Test 3: SP advances time")


print("\nAll Staying Put tests passed!")
