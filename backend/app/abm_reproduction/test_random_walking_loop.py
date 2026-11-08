
import numpy as np

from .config import ABMConfig
from .agent import Agent
from .grid import TerrainGrid
from .simulation import run_random_walking


# 1. Create a test grid
config = ABMConfig(
    map_size_m=100.0,
    grid_rows=10,
    grid_cols=10,
)

valid = np.ones(config.grid_shape, dtype=bool)
inaccessible = np.zeros(config.grid_shape, dtype=bool)

grid = TerrainGrid(config, valid, inaccessible)


# 2. Create an agent
agent = Agent(x=5, y=5)

# 3. Create random generator
rng = np.random.default_rng(seed=42)

print("Initial position:", agent.position)
print("Initial time:", agent.elapsed_seconds)


# 4. Run 10 simulation steps
records = run_random_walking(
    agent=agent,
    grid=grid,
    num_steps=10,
    rng=rng,
)


# 5. Print step-by-step results
print("\nRandom Walking simulation:")

for record in records:
    print(
        f"Step {record.step}: "
        f"Position={record.position}, "
        f"Time={record.elapsed_seconds:.2f}s, "
        f"Success={record.success}"
    )


# 6. Print final results
print("\nFinal results")
print("Final position:", agent.position)
print("Elapsed seconds:", round(agent.elapsed_seconds, 2))
print("Total steps:", len(records))
print("Successful attempts:", sum(r.success for r in records))
print("History length:", len(agent.history))


# 7. Verify results
assert len(records) == 10
assert np.isclose(agent.elapsed_seconds, 10 * 3600 / 850)

assert all(
    grid.is_accessible(*record.position)
    for record in records
)

assert len(agent.history) == sum(
    record.success for record in records
)

assert agent.position == records[-1].position

print("\nAll repeated simulation tests passed!")
