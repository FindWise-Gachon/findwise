# 행동 전략 패키지 (RT·DT·SP·VE·BT)

Hashimoto 외 논문의 실종자 행동 전략 중 RT(경로 따라가기), DT(방향 유지), SP(머물기), VE(높은 곳 오르기), BT(되돌아가기)를 구현한다. 대상 논문은 Sci. Rep. 12:5873(2022)과 16:34104(2026)이다.

- **기존 RW 코드는 고치지 않는다.** `agent`, `grid`, `behaviors`, `simulation`, `config`는 import만 한다.
- 의존 방향은 이 패키지 → 기존 모듈뿐이다.
- 함수 구성은 RW와 같다. 행동마다 후보 함수(`*_candidate`), 한 스텝 함수(`*_step`), 연속 실행 함수(`run_*_continuous`)가 있다.

| 전략 | 파일 | 상태 |
|---|---|---|
| RW 무작위 보행 | `../behaviors.py`, `../simulation.py` | 기존 구현 |
| RT 경로 따라가기 | `route_traveling.py` | 구현
| DT 방향 유지 | `direction_traveling.py` | 구현
| SP 머물기 | `staying_put.py` | 구현 |
| VE 높은 곳 오르기 | `view_enhancing.py` | 구현 |
| BT 되돌아가기 | `backtracking.py` | 구현 |
| CT 등고선 따라가기 | — | **미구현** (아래 참고) |

## 사용 예

```python
import numpy as np
from app.abm_reproduction.agent import Agent
from app.abm_reproduction.simulation import initialize_simulation, run_random_walking_continuous
from app.abm_reproduction.strategies import (
    BacktrackState,
    run_backtracking_continuous,
    run_staying_put_continuous,
    run_view_enhancing_continuous,
)

rng = np.random.default_rng(seed=42)
agent = Agent(x=1500, y=1500)
state = initialize_simulation(agent, grid, rng)      # grid: TerrainGrid
backtrack = BacktrackState()                        # BT 진행 위치, 실행 내내 유지

run_random_walking_continuous(agent, grid, state, 850, rng)
run_view_enhancing_continuous(agent, grid, elevation, state, 850, rng)  # elevation: (rows, cols) 미터
run_staying_put_continuous(agent, grid, state, 850, rng)
run_backtracking_continuous(agent, grid, state, backtrack, 850, rng)
```

고도 배열은 `TerrainGrid`와 모양이 같아야 하고 `[y, x]`(행, 열)로 읽는다. 격자 밖, `valid_mask`가 False인 셀, NaN은 고도를 모르는 칸으로 본다.

**RT, DT의 연속 실행 함수**
```python
from app.abm_reproduction.strategies import (
    BacktrackState,
    run_route_traveling_continuous,
    run_direction_traveling_continuous,
    run_backtracking_continuous,
    run_staying_put_continuous,
    run_view_enhancing_continuous,
)
```
RT, DT의 실행 예시는 다음과 같다.
실제 인자 순서는 구현된 함수 정의를 기준으로 확인한다.

- RT: 선형 지형 정보를 이용한 경로 따라가기
- DT: 현재 진행 방향을 유지하는 이동


## 전략별 규칙
**RT.** 현재 진행 방향을 기준으로 주변 셀의 선형 지형을 확인한다. 진행 가능한 전방 후보 중 선형 지형에 해당하는 셀을 이용해 다음 이동 후보를 결정한다. 주변에 적절한 선형 지형이 없으면 RW 방식으로 후보를 생성한다.

**DT.** 현재 에이전트의 진행 방향을 기준으로 전방 이동 후보를 계산한다. 무작위 방향이 아닌, 기존 진행 방향을 유지하는 방향으로 이동을 시도한다.

**SP.** 후보는 현재 위치다. 평활화 식을 적용해도 직전 이동의 0.45배만 남고, 한 스텝 이동은 각 축 최대 1칸이므로 반올림하면 0이 된다. 그래서 평활화와 `move_to` 없이 제자리에 둔다. history와 진행 방향(`dx`, `dy`)은 바뀌지 않는다.

**VE.** 주변 8칸 중 고도가 가장 높은 칸을 후보로 고른 뒤, RW와 같이 평활화 → 반올림 → `move_to` 순서로 이동한다. 현재 칸이 가장 높거나 같으면 제자리다.

**BT.** 처음에는 x(t−1)로 간다. 바로 앞 스텝도 BT였으면 한 칸 더 이전 위치로 가서 지나온 길을 거꾸로 따라간다. `agent.history`를 스택처럼 쓰고, 다음 목표 인덱스는 `BacktrackState`에 둔다.
- `move_to`는 history 끝에만 위치를 추가하므로 앞쪽 인덱스는 바뀌지 않는다.
- 바로 앞 스텝이 BT였는지는 `state.step_count`로 판단한다. 모든 연속 실행 함수가 한 스텝마다 1씩 올리므로 RW 코드를 고칠 필요가 없다. 같은 `SimulationState`와 `BacktrackState`를 실행 내내 넘겨야 한다.

## 논문에 없어 정한 규칙

- VE: 가장 높은 칸이 여러 개면 무작위로 고른다.
- VE: 진입 불가 칸도 비교에 포함한다. 그 칸이 가장 높으면 이동이 막혀 제자리다. 논문의 "진입 불가 칸으로 가려 하면 제자리" 규칙을 따른 것이다. 고도를 모르는 칸은 비교에서 뺀다.
- BT: 평활화를 적용하지 않고 기록된 위치로 바로 옮긴다. 평활화를 적용하면 첫 스텝에서 관성과 상쇄돼(−0.1칸) 제자리가 되고, 실제 위치가 기록 경로와 어긋난다.
- BT: history를 모두 되짚으면(출발점 도착) 제자리다. 이동이 막히면 다음 스텝에 같은 목표를 다시 시도한다.
- BT: RW가 반올림으로 제자리에 머문 스텝도 history에 남으므로, BT도 그 스텝에서 한 번 머문다.

## CT(등고선 따라가기)를 구현하지 않은 이유

- 2026 논문 본문에는 "앞쪽 3칸 중 현재 위치와의 고도 차가 임계값 미만인 칸 중에서 선택"이라고만 나오고, **임계값 수치가 없다.**
- 정식 정의와 임계값은 부록(Supplementary Information, doi:10.1038/s41598-026-54411-5)에 있다고 하는데, 아직 확인하지 못했다.
- 초록은 "고도 변화를 최소화하는 칸으로", 본문은 "임계값 미만 중 선택"이라고 써서 선택 규칙도 서로 다르다.
- 임의의 값으로 구현하면 재현 결과로 오해될 수 있어 구현하지 않았다. 부록을 확인한 뒤 `contouring.py`로 추가한다.
- 2026 등산객 프로필(DPT 3시간)에서 CT는 40%로 비중이 가장 크다. **CT 없이는 2026 결과를 재현할 수 없다.**
- CT는 RT·DT와 같이 진행 방향 기준 "앞쪽 3칸" 계산이 필요하다. 이 헬퍼도 아직 없다.

## 아직 없는 것과 주의점


- 공간·시간 결정 지점에서 행동 전략을 선택하고 PMF(확률질량함수)에 따라 행동을 재추첨하는 통합 제어 로직은 아직 확인되지 않았다. 현재는 호출자가 행동별 연속 실행 함수를 직접 선택하는 구조다.

- 로컬 웹 미리보기는 지역별 지형 격자를 RT에 연결하고, 선택한 전략을 반복 실행해 시간별 확률 분포를 집계한다. 행동 비율에 따라 전략을 전환하는 통합 실행과 논문 결과 재현 검증은 후속 작업이다.

- CT(등고선 따라가기)는 아직 구현하지 않았다.
- 통행 판정은 기존 `TerrainGrid.is_accessible()`(도착 셀만 확인, `(x, y)` 순서)를 쓴다. 백엔드 공통 이동 함수 `app/movement.py`의 `can_move()`는 `(row, column)` 순서이고, 대각선 이동 시 양옆 셀도 확인한다. 두 판정을 통일하는 일은 팀에서 따로 정한다.
[y]
## 테스트

`backend/`에서 실행한다.

```bash
python -m app.abm_reproduction.strategies.test_staying_put
python -m app.abm_reproduction.strategies.test_view_enhancing
python -m app.abm_reproduction.strategies.test_backtracking
```

'findwise/'에서 실행, 6가지 행동 전략 전체 테스트
```bash
python -m unittest discover -s backend/app/abm_reproduction -t backend -p "test_*.py" -v
```