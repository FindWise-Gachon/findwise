
import numpy as np

from .agent import Agent
from .behaviors import RW_OFFSETS, random_walking_candidate


# 1. Create an agent
agent = Agent(x=1500, y=1500)

# 2. Create a reproducible random generator
rng = np.random.default_rng(seed=42)

print("Initial position:", agent.position)

# 3. Generate 10 random walking candidates
print("\nRandom Walking candidates:")

for i in range(10):
    candidate = random_walking_candidate(agent, rng)

    print(f"Step {i + 1}: {candidate}")

    dx = candidate[0] - agent.x
    dy = candidate[1] - agent.y

    assert (dx, dy) in RW_OFFSETS

# 4. Verify the agent has not moved
assert agent.position == (1500, 1500)
assert agent.history == []

print("\nAll Random Walking candidate tests passed!")
