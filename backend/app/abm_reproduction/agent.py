# 논문에서 사용하는 여섯 행동 이름 정의
# 무작위 보행 / 경로를 따라 이동 / 일정 방향으로 이동 /
# 제자리에 머무르기 / 시야 확보를 위한 행동 / 이전 경로 되짚기

# 에이전트의 위치를 격자 인덱스로 저장
# x: column, y: row

# 에이전트의 이동 방향 표현 변수
# 예) dx=1, dy=0 - 오른쪽 방향 의미

# history 에이전트가 이전에 방문한 위치를 저장

# move to 
# 에이전트의 위치를 변경하는 함수
# 현재 위치를 history에 저장한 다음 새로운 위치로 이동

# TerrainGrid 가져옴
# 에이전트가 이동하려는 위치를 grid.is_accessible()에 전달
# True: 이동 진행, False: 이동하지 않고 함수 종료



from dataclasses import dataclass, field
from enum import Enum
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .grid import TerrainGrid


class Behavior(str, Enum):
    """Six behavior categories used in the reference ABM."""

    RANDOM_WALKING = "RW"
    ROUTE_TRAVELING = "RT"
    DIRECTION_TRAVELING = "DT"
    STAYING_PUT = "SP"
    VIEW_ENHANCING = "VE"
    BACKTRACKING = "BT"


@dataclass
class Agent:
    """State of one simulated missing person."""

    # Current position: (column, row)
    x: int
    y: int

    # Current movement direction
    dx: int = 0
    dy: int = 0

    # Current behavior
    behavior: Behavior = Behavior.RANDOM_WALKING

    # Elapsed simulation time (seconds)
    elapsed_seconds: float = 0.0

    # Previously visited cells
    history: list[tuple[int, int]] = field(default_factory=list)

    @property
    def position(self) -> tuple[int, int]:
        return (self.x, self.y)

    def move_to(
        self,
        new_x: int,
        new_y: int,
        grid: "TerrainGrid",
    ) -> bool:
        """Attempt a move using the movement policy of the grid."""

        if not grid.can_move(self.position, (new_x, new_y)):
            return False

        self.history.append(self.position)

        self.dx = new_x - self.x
        self.dy = new_y - self.y

        self.x = new_x
        self.y = new_y

        return True

