
import numpy as np

from .config import ABMConfig
from .agent import Agent
from .grid import TerrainGrid
from .behaviors import (
    RW_OFFSETS,
    smooth_position,
)
from .simulation import (
    initialize_simulation,
    run_random_walking_continuous,
)


# ==========================================
# Test 1. Paper simulation parameters
# ==========================================

config = ABMConfig()

assert config.grid_shape == (3000, 3000)
assert np.isclose(config.cell_size_m, 20_000 / 3000)

alpha = 0.55
steps_per_hour = 850
simulation_hours = 100

total_steps = steps_per_hour * simulation_hours

assert total_steps == 85000

print("[PASS] Test 1: Simulation parameters")


# ==========================================
# Test 2. RW candidate offsets
# ==========================================

assert len(RW_OFFSETS) == 9
assert len(set(RW_OFFSETS)) == 9

expected_offsets = {
    (dx, dy)
    for dx in (-1, 0, 1)
    for dy in (-1, 0, 1)
}

assert set(RW_OFFSETS) == expected_offsets

print("[PASS] Test 2: RW candidate offsets")


# ==========================================
# Test 3. Smoothing equation
# ==========================================

previous = (0, 0)
current = (1, 0)
provisional = (1, 1)

result = smooth_position(
    previous_position=previous,
    current_position=current,
    provisional_position=provisional,
    alpha=alpha,
)

velocity = np.subtract(provisional, current)

expected = (
    (2 - alpha) * np.array(current)
    + (alpha - 1) * np.array(previous)
    + alpha * velocity
)

assert np.allclose(result, expected)

print("[PASS] Test 3: Smoothing equation")


# ==========================================
# Test 4. Initialization
# ==========================================

small_config = ABMConfig(
    map_size_m=100.0,
    grid_rows=10,
    grid_cols=10,
)

valid = np.ones(small_config.grid_shape, dtype=bool)
inaccessible = np.zeros(small_config.grid_shape, dtype=bool)

grid = TerrainGrid(
    small_config,
    valid,
    inaccessible,
)

agent = Agent(x=5, y=5)
rng = np.random.default_rng(seed=42)

start_position = agent.position

state = initialize_simulation(
    agent,
    grid,
    rng,
)

initial_dx = agent.x - start_position[0]
initial_dy = agent.y - start_position[1]

assert (initial_dx, initial_dy) in expected_offsets
assert (initial_dx, initial_dy) != (0, 0)

assert state.previous_position == start_position
assert state.step_count == 0

print("[PASS] Test 4: Initialization")


# ==========================================
# Test 5. Inaccessible area
# ==========================================

blocked_mask = np.ones(
    small_config.grid_shape,
    dtype=bool,
)

blocked_grid = TerrainGrid(
    small_config,
    valid,
    blocked_mask,
)

old_position = agent.position
old_history = agent.history.copy()

records = run_random_walking_continuous(
    agent=agent,
    grid=blocked_grid,
    state=state,
    num_steps=5,
    rng=rng,
)

assert agent.position == old_position
assert agent.history == old_history

assert len(records) == 5
assert all(record.success is False for record in records)

assert state.step_count == 5
assert np.isclose(
    agent.elapsed_seconds,
    5 * 3600 / steps_per_hour,
)

print("[PASS] Test 5: Inaccessible area")


print("\nAll paper-rule tests passed!")
