# Backend

지형 전처리 CLI, 거리 기반 모델(Ring Model) CLI, 승인된 현장 보고를 확률 지도에 반영하는 모듈을 제공합니다. 보고 텍스트 구조화와 API 연결은 후속 구현 범위입니다.


## 지형 격자 생성

1. 지도 지역 정보에서 격자 정의 JSON을 내보내 `data/processed/grid.json`으로 저장합니다.
2. [요세미티 자료 카탈로그](../data/catalog/yosemite.md)에서 확인한 GeoTIFF를 `data/raw/`에 저장합니다. 다운로드 가능한 HTTPS URL도 입력으로 사용할 수 있습니다.
3. 저장소 루트에서 Python 3.13으로 실행합니다. 예시의 버전은 카탈로그에 기록된 배포본 ETag입니다.

```bash
python3.13 -m venv backend/.venv
source backend/.venv/bin/activate
python -m pip install -r backend/requirements.txt
python backend/app/terrain.py \
  --dem data/raw/USGS_13_n38w120.tif \
  --grid data/processed/grid.json \
  --vertical-datum NAVD88 \
  --source-version 951230e8ff59a05ae1b3a94eaebe19e7-87 \
  --output data/processed/yosemite-terrain.npz
PYTHONPATH=backend python -m unittest discover -s backend/tests
```

고도는 미터 단위로 입력합니다. 원본을 bilinear 방식으로 정렬한 다음 중심 차분으로 경사(도)를 구합니다. 격자 가장자리나 인접 고도가 결측인 셀은 경사 계산에서 제외합니다. 수직 기준 변환은 수행 범위 밖입니다. 격자를 촘촘히 설정해도 원본의 해상도와 정확도는 그대로입니다.

NPZ 필드와 평가 기준은 [평가 초안](../docs/evaluation.md)을 참고하세요.

## 거리 기반 모델 (Ring Model)

마지막 확인 위치(LKP)를 중심으로 ISRID 거리 분위수(25·50·75·95%) 고리에 확률을 나눈 격자를 만듭니다. 거리만 사용하며 지형과 경과시간은 반영하지 않습니다.

```bash
python backend/app/ring_model.py \
  --grid data/processed/grid.json \
  --subject-type hiker_temperate_mountain \
  --lkp-lonlat -119.6 37.74 \
  --output data/processed/ring.npz
```

LKP는 `--lkp-xy X Y`(격자와 같은 투영좌표, m)로도 지정할 수 있습니다. 좌표는 예시입니다.

| 항목 | 규칙 |
| --- | --- |
| 고리별 확률 | 25 / 25 / 25 / 20%. 나머지 5%는 LKP 중심 50 × 50 km 정사각형에서 95% 고리를 뺀 면적에 균등 배분 (Sava 외, 2016) |
| 고리 안 분배 | 면적당 밀도 균등 (고리 확률 ÷ 고리 면적 × 셀 면적) |
| 격자 밖 확률 | 버린 뒤 합이 1이 되도록 다시 정규화. 격자 안에 남은 비율은 `in_grid_mass`에 기록 |

출력 NPZ는 `probability`(북→남 행, 서→동 열, 합 1)와 JSON 문자열 `metadata`(격자, LKP, 대상, 거리값과 출처, `in_grid_mass`)를 담습니다. 같은 경로의 기존 결과는 덮어쓰지 않습니다.

거리값은 `backend/app/ring_profiles.json`에서 대상·기후·지형별로 읽습니다(단위 m). 등산객의 온대·건조 산악 값만 채워져 있고, Sava 외(2016) Table 1(마일)을 km로 환산해 Doherty 외(2014)와 대조했습니다. 치매·자살 우려자는 Koester(2008) 표가 필요해 비어 있으며, 값이 비어 있으면 실행하지 않습니다. 발견점 등 평가 정답으로 거리값을 조정하지 않습니다. Yosemite 기준 링은 교차검증의 학습 폴드 안에서만 계산합니다.

- 개발 격자(6 km)는 등산객 95% 거리(약 18~19 km)보다 작아 확률의 절반 미만만 들어옵니다. `in_grid_mass`로 확인합니다.
- 바깥 5%의 밀도는 격자 크기와 무관합니다. LKP에서 25 km보다 먼 셀은 확률이 0입니다.
- 프론트는 NPZ를 직접 읽지 못합니다. 지도에서 보려면 시간별 결과 JSON으로 변환해야 하며 변환 스크립트는 포함하지 않았습니다.

## 지형과 이동 조건

지도에서 내보낸 격자 JSON으로 OSM 도로·수계와 복합 수역을 가져옵니다.

```bash
python backend/app/fetch_terrain.py --grid data/processed/yosemite-grid.json --output data/raw/yosemite-terrain-v2.geojson
```

준비된 기본 파일은 개발 서버와 빌드에서 자동으로 제공됩니다. 지도 또는 통행 설정 메뉴에서 통행 상태를 바꾸고 이유를 적용합니다. 구역 지정은 두 모서리로 사각형을 만듭니다. 고급 설정에서 사용자 GeoJSON 추가와 백업·모델 입력 저장을 사용할 수 있습니다. 수정은 IndexedDB에 저장되고 마지막 확인 정보는 localStorage에 저장됩니다. 브라우저 저장소를 차단하거나 지우면 백업 파일이 필요합니다.

```bash
python backend/app/access.py data/processed/findwise-terrain-access.geojson data/processed/access.npz
```

출력 배열은 같은 격자의 `access`(0 미확인, 1 가능, 2 불가)와 `linear_features`(선형 지형 여부)입니다. 모든 접촉 셀을 포함합니다. 기본 자료에서는 불가 판정이 가능·미확인보다 우선하며, 이후 적용한 사용자 수정이 우선합니다. 모델은 미확인 영역을 허용할지 명시하고 공통 이동 함수를 호출합니다. 이 함수는 한 칸 이내 이동, 출발·도착 셀, 대각선 양옆 셀을 확인합니다.

복합 수역은 분할·역방향 경계를 연결하고 섬을 내부 구멍으로 보존합니다. 불완전하거나 교차한 경계는 오류로 중단합니다. 태그 범위 밖의 수역과 실제 통행 조건은 추가 검토가 필요합니다. 데이터 출처는 OpenStreetMap contributors이며 [ODbL 이용 조건](https://www.openstreetmap.org/copyright)을 따릅니다. 지도 내보내기에는 적용 이력과 격자·설정 버전이 포함됩니다. 변경 근거 미리보기는 적용 후에 저장됩니다.


모델에서의 호출 예시는 다음과 같습니다. `allow_unknown`은 반드시 명시합니다.

```python
from app.movement import can_move
allowed = can_move(access, (row, column), (next_row, next_column), allow_unknown=False)
```

출발 셀이 차단된 경우 이동과 제자리 유지 모두 허용하지 않습니다. 이는 초기 위치 검증을 요구하는 규칙입니다. 수역 셀의 판정은 설정 기반이며 실제 현장 통행 가능성을 보증하지 않습니다.


모델 결과의 `terrain_revision`은 내보낸 지형 패키지의 `revision`과 같아야 합니다. 프론트는 정보가 없거나 버전이 다를 때 경고를 표시합니다. 클라이언트의 표시 토글을 모델의 통행 조건으로 해석하지 않습니다.

## 현장 보고 반영 (`app/radio`)

승인된 현장 이벤트를 확률 격자에 반영하는 모듈입니다. 보고 텍스트 구조화와 API 연결은 아직 없습니다.

| 파일 | 역할 |
| --- | --- |
| `app/radio/schema.py` | 무전 보고·이벤트 스키마 (유형, 확인 강도, 상태, JSON 변환) |
| `app/radio/update_map.py` | 격자 정의, 이벤트 반영, 우선 수색 구역 |

### 반영 규칙

| 이벤트 | 지도 변화 |
| --- | --- |
| 수색 완료 | 영역 셀 × (1 − POD) 후 정규화. 확률이 0이 되지 않음(POD 상한 0.95) |
| 흔적 발견 | 발견 지점 주변 가중치 증가 후 정규화 |
| 진입 불가·위험 요소 | 확률은 유지하고 표식만 추가 |

- 승인 또는 수정 후 승인 상태의 이벤트만 반영합니다. 승인 대기·거절은 이력만 남깁니다.
- 같은 `event_id`는 한 번만 반영합니다.
- 위치(좌표·영역)를 알 수 없으면 반영하지 않고 이력에 사유를 남깁니다.
- POD(꼼꼼히 0.8 / 보통 0.5 / 대충 0.3)와 흔적 파라미터(반경 300 m, 배율 3.0)는 임시 값입니다.
- 진입 불가·위험 요소 표식은 위의 통행 조건(`access`)과 아직 연결되어 있지 않습니다. 모델의 이동 제한에는 쓰이지 않습니다.

### 사용 예

```python
import numpy as np
from app.radio.schema import Confidence, EventType, FieldEvent, Location, Status
from app.radio.update_map import GridSpec, apply_event, new_state, top_zones

grid = GridSpec.from_json_file("data/processed/grid.json")  # 지도에서 내보낸 격자 JSON
state = new_state(np.ones(grid.shape))  # 균등 확률 예시; 실제 사용 시 모델 결과로 대체

event = FieldEvent(
    "e1", EventType.SEARCHED,
    Location(value="동쪽 계곡", x=270000, y=4182000, radius_m=200),  # 임의 좌표
    Confidence.THOROUGH, status=Status.APPROVED,
)
state = apply_event(state, event, grid)  # 새 MapState를 돌려줌 (입력은 바뀌지 않음)
zones = top_zones(state.prob, grid, n=3)  # 우선 수색 구역 Top-3
```

### 격자 규약

- 좌표는 격자와 같은 투영좌표(m)이며, `origin`은 북서쪽 모서리입니다.
- 배열은 북→남 행 순서, 각 행은 서→동입니다. 인덱스는 `row * columns + column`입니다.
- 격자 값은 코드에 고정하지 않고 `GridSpec.from_dict()`/`from_json_file()`로 읽습니다.

### 테스트

```bash
PYTHONPATH=backend python -m unittest discover -s backend/tests
```