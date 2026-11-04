# 테스트
# 가상 지형 생성 (특정 셀 하나를 진입 불가 영역으로 설정)

import numpy as np

from .config import ABMConfig
from .grid import TerrainGrid
from .agent import Agent


# 1. Create grid configuration
config = ABMConfig()

# 2. Create test terrain masks
valid = np.ones(config.grid_shape, dtype=bool)
inaccessible = np.zeros(config.grid_shape, dtype=bool)

# 3. Mark one cell as inaccessible
inaccessible[1500, 1502] = True

# 4. Create terrain grid
grid = TerrainGrid(config, valid, inaccessible)

# 5. Create agent
agent = Agent(x=1500, y=1500)

print("Initial position:", agent.position)

# Test 1: Move to an accessible cell
success = agent.move_to(1501, 1500, grid)

print("\nTest 1: Normal movement")
print("Success:", success)
print("Position:", agent.position)
print("Direction:", (agent.dx, agent.dy))
print("History:", agent.history)

# Test 2: Try to enter an inaccessible cell
success = agent.move_to(1502, 1500, grid)

print("\nTest 2: Blocked movement")
print("Success:", success)
print("Position:", agent.position)
print("History:", agent.history)

# Test 3: Try to move outside the grid
success = agent.move_to(3000, 1500, grid)

print("\nTest 3: Outside movement")
print("Success:", success)
print("Position:", agent.position)
print("History:", agent.history)

# 6. Verify expected results
assert agent.position == (1501, 1500)
assert agent.history == [(1500, 1500)]

print("\nAll movement tests passed!")
