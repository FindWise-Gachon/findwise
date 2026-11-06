
import numpy as np

from .config import ABMConfig
from .agent import Agent
from .grid import TerrainGrid
from .simulation import random_walking_step


# 1. Create a small test grid
config = ABMConfig(
    map_size_m=50.0,
    grid_rows=5,
    grid_cols=5,
)

valid = np.ones(config.grid_shape, dtype=bool)
inaccessible = np.zeros(config.grid_shape, dtype=bool)

grid = TerrainGrid(config, valid, inaccessible)

# 2. Create an agent
agent = Agent(x=2, y=2)

# Use the current position as test initial history
previous_position = (2, 2)

rng = np.random.default_rng(seed=42)

print("Initial position:", agent.position)

# 3. Perform one RW step
success = random_walking_step(
    agent=agent,
    grid=grid,
    previous_position=previous_position,
    rng=rng,
)

print("\nTest 1: Random Walking step")
print("Success:", success)
print("New position:", agent.position)
print("History:", agent.history)

assert success is True
assert len(agent.history) == 1
assert grid.is_accessible(*agent.position)


# 4. Create a fully blocked grid
blocked = np.ones(config.grid_shape, dtype=bool)
blocked_grid = TerrainGrid(config, valid, blocked)

old_position = agent.position
old_history = agent.history.copy()

# 5. Attempt movement in blocked terrain
success = random_walking_step(
    agent=agent,
    grid=blocked_grid,
    previous_position=previous_position,
    rng=rng,
)

print("\nTest 2: Blocked terrain")
print("Success:", success)
print("Position:", agent.position)
print("History:", agent.history)

assert success is False
assert agent.position == old_position
assert agent.history == old_history

print("\nAll simulation tests passed!")
