
import numpy as np

from .agent import Agent
from .behaviors import (
    random_walking_candidate,
    smooth_position,
)


# Test 1: Straight movement
result = smooth_position(
    previous_position=(0, 0),
    current_position=(1, 0),
    provisional_position=(2, 0),
)

print("Test 1: Straight movement")
print("Smoothed position:", result)

assert np.allclose(result, (2.0, 0.0))


# Test 2: Direction change
result = smooth_position(
    previous_position=(0, 0),
    current_position=(1, 0),
    provisional_position=(1, 1),
)

print("\nTest 2: Direction change")
print("Smoothed position:", result)

assert np.allclose(result, (1.45, 0.55))


# Test 3: Connect with Random Walking
agent = Agent(x=1500, y=1500)
rng = np.random.default_rng(seed=42)

previous_position = (1499, 1500)
current_position = agent.position

candidate = random_walking_candidate(agent, rng)

result = smooth_position(
    previous_position=previous_position,
    current_position=current_position,
    provisional_position=candidate,
)

print("\nTest 3: Random Walking + Smoothing")
print("Previous position:", previous_position)
print("Current position:", current_position)
print("RW candidate:", candidate)
print("Smoothed position:", result)

assert agent.position == (1500, 1500)
assert agent.history == []

print("\nAll smoothing tests passed!")
