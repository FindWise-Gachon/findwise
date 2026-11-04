
import numpy as np

from .config import ABMConfig
from .agent import Agent
from .grid import TerrainGrid
from .simulation import (
    initialize_simulation,
    run_random_walking_continuous,
)


# 1. Create a large test grid
config = ABMConfig(
    map_size_m=1000.0,
    grid_rows=100,
    grid_cols=100,
)

valid = np.ones(config.grid_shape, dtype=bool)
inaccessible = np.zeros(config.grid_shape, dtype=bool)

grid = TerrainGrid(config, valid, inaccessible)


# 2. First simulation: 5 steps + 5 steps
agent_a = Agent(x=50, y=50)
rng_a = np.random.default_rng(seed=42)

state_a = initialize_simulation(
    agent_a, grid, rng_a
)

print("Initial position after setup:", agent_a.position)
print("Initial history:", agent_a.history)

records_a1 = run_random_walking_continuous(
    agent_a, grid, state_a, 5, rng_a
)

print("\nAfter first 5 steps")
print("Position:", agent_a.position)
print("Step count:", state_a.step_count)
print("Elapsed time:", round(agent_a.elapsed_seconds, 2))

records_a2 = run_random_walking_continuous(
    agent_a, grid, state_a, 5, rng_a
)

print("\nAfter next 5 steps")
print("Position:", agent_a.position)
print("Step count:", state_a.step_count)
print("Elapsed time:", round(agent_a.elapsed_seconds, 2))


# 3. Second simulation: 10 steps at once
agent_b = Agent(x=50, y=50)
rng_b = np.random.default_rng(seed=42)

state_b = initialize_simulation(
    agent_b, grid, rng_b
)

records_b = run_random_walking_continuous(
    agent_b, grid, state_b, 10, rng_b
)


# 4. Compare the two simulations
positions_a = [
    record.position for record in records_a1 + records_a2
]

positions_b = [
    record.position for record in records_b
]

assert positions_a == positions_b
assert agent_a.position == agent_b.position
assert state_a.previous_position == state_b.previous_position
assert state_a.step_count == 10
assert state_b.step_count == 10

assert np.isclose(
    agent_a.elapsed_seconds,
    10 * 3600 / 850,
)

print("\nComparison")
print("Split run final position:", agent_a.position)
print("Single run final position:", agent_b.position)
print("Same movement history:", positions_a == positions_b)

print("\nAll continuous simulation tests passed!")
