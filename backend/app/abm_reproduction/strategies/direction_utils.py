"""3 forward cells in an agent-aligned 3x3 neighborhood.

The paper specifies agent-aligned body coordinates and rounding, but not a
unique diagonal-grid rasterization. We use an 8-heading discrete stencil.
"""

def forward_cells(agent, previous_position):
    vx = agent.x - previous_position[0]
    vy = agent.y - previous_position[1]
    if vx == 0 and vy == 0:
        return ()  # Heading undefined; strategies explicitly handle it.
    sx = (vx > 0) - (vx < 0)
    sy = (vy > 0) - (vy < 0)
    if sx and sy:
        offsets = ((0, sy), (sx, sy), (sx, 0))
    elif sx:
        offsets = ((sx, -1), (sx, 0), (sx, 1))
    else:
        offsets = ((-1, sy), (0, sy), (1, sy))
    return tuple((agent.x + dx, agent.y + dy) for dx, dy in offsets)
