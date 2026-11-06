import numpy as np

from ..config import ABMConfig
from ..agent import Agent
from ..grid import TerrainGrid
from ..simulation import (
    initialize_simulation,
    run_random_walking_continuous,
)
from .backtracking import (
    BacktrackState,
    backtracking_candidate,
    run_backtracking_continuous,
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


# 2. Walk randomly with the existing RW code
agent = Agent(x=5, y=5)
rng = np.random.default_rng(seed=42)

state = initialize_simulation(agent, grid, rng)

run_random_walking_continuous(
    agent=agent,
    grid=grid,
    state=state,
    num_steps=8,
    rng=rng,
)

route = agent.history.copy()

print("Route:", route + [agent.position])


# Test 1: A new backtrack starts from x(t-1)
backtrack = BacktrackState()

assert backtracking_candidate(agent, backtrack, state) == route[-1]

print("[PASS] Test 1: BT starts from the previous position")


# Test 2: Continuous BT retraces the route exactly
records = run_backtracking_continuous(
    agent=agent,
    grid=grid,
    state=state,
    backtrack=backtrack,
    num_steps=len(route),
    rng=rng,
)

visited = [record.position for record in records]

assert visited == list(reversed(route))
assert agent.position == (5, 5)

print("[PASS] Test 2: BT retraces the route")


# Test 3: BT stays put when the history is exhausted
records = run_backtracking_continuous(
    agent=agent,
    grid=grid,
    state=state,
    backtrack=backtrack,
    num_steps=3,
    rng=rng,
)

assert all(record.position == (5, 5) for record in records)
assert all(record.success for record in records)

print("[PASS] Test 3: BT stays after the history ends")


# Test 4: Another behavior in between restarts BT from x(t-1)
agent = Agent(x=5, y=5)
rng = np.random.default_rng(seed=7)

state = initialize_simulation(agent, grid, rng)

run_random_walking_continuous(agent, grid, state, 6, rng)

backtrack = BacktrackState()

run_backtracking_continuous(agent, grid, state, backtrack, 2, rng)

run_random_walking_continuous(agent, grid, state, 1, rng)

previous_cell = agent.history[-1]

records = run_backtracking_continuous(agent, grid, state, backtrack, 1, rng)

assert records[0].position == previous_cell

print("[PASS] Test 4: BT restarts after another behavior")


print("\nAll Backtracking tests passed!")
