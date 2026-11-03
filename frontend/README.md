# FindWise Frontend

React + TypeScript + Vite + MapLibre GL JS. 사용자가 제공한 디자인을 바탕으로 요세미티 지도 작업 공간을 구현했습니다.

## Run / 실행

저장소 루트에서 [.nvmrc](../.nvmrc)에 고정된 Node.js 22.21.1을 사용합니다.

```bash
nvm install
nvm use
cd frontend
npm ci
npm run dev
```

터미널에 표시된 Local 주소를 엽니다. 다른 개발 서버가 실행 중이면 포트 번호가 달라질 수 있습니다. 인터넷 연결과 WebGL 지원 브라우저가 필요합니다.

## Checks / 검사

`frontend/`에서 실행합니다.

```bash
npm run lint
npm test
npm run build
npm run preview
```

## 구현된 기능

- 요세미티 기본 지도와 위성 영상 전환.
- 실제 고도 타일 기반 등고선·음영기복 독립 토글.
- 등고선 선명도 조절, 확대 수준별 100/50/20m 간격.
- 확대·축소, 북쪽 정렬, 초기 위치 이동.
- 지역·출처 패널, 범례, 오류 안내와 재시도. 로딩이 끝나도 오류가 발생한 시도의 경고는 유지됩니다.
- 브라우저에 지도 설정 저장 및 초기화.

분석 모듈에서 좌표를 입력하거나 지도에서 시작점을 선택하면 셀 중심까지의 투영 거리 순위를 계산합니다. 색상은 가까운 셀부터 상위 5%, 5–20%, 20–50%, 50–100%를 나타냅니다. 실행 조건 JSON의 시작 좌표를 같은 격자 설정에서 다시 입력하면 순위가 재현됩니다.

등산로·하천의 독립 레이어, 확률 추정, 현장 보고는 후속 기능입니다. 기본 지도에 포함된 길·하천은 배경과 함께 표시됩니다.

## Code / 코드 위치

- src/App.tsx: 작업 공간과 UI 상태.
- src/App.css, src/index.css: 화면 스타일.
- src/map/MapView.tsx: 지도 생명주기와 레이어 표시.
- `src/map/config.ts`에 지역·자료 제공처·기본 설정·분석 격자 정의를 둡니다.
- `src/map/grid.ts`는 격자 기하와 좌표를 계산하고 `src/map/status.ts`는 연결 상태를 관리합니다.

## Sources / 자료 출처

- Base: OpenStreetMap, https://www.openstreetmap.org/copyright
- Satellite: Esri World Imagery, https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer
- Elevation: Mapzen / AWS Terrain Tiles, https://registry.opendata.aws/terrain-tiles/
- Contour generation: maplibre-contour, https://github.com/onthegomap/maplibre-contour

온라인 자료를 요청하며 원본 타일을 저장소에 포함하지 않습니다. 서비스 운영·대규모 사용 전에는 각 제공처의 이용 조건·할당량을 확인해야 합니다. 표시용 고도자료를 검증된 6m 분석 지형으로 간주하지 않습니다.

## Verification / 확인

PR에서 린트·테스트·프로덕션 빌드를 실행합니다. MapLibre 6의 워커는 Vite 워커 에셋으로 연결합니다. 빌드 시 지도 번들 크기 경고가 표시될 수 있습니다.

## 분석 격자 기반

- 기본 개발 영역은 요세미티의 6 × 6km 범위이며 EPSG:32611 (WGS84 / UTM 11N)을 사용합니다.
- 북서쪽 원점 [268800, 4183680]m, 6m 셀, 1,000행 × 1,000열.
- 배열은 북→남 행 순서, 각 행은 서→동. index = row * columns + column.
- 서·북 경계 포함, 동·남 경계 제외. 범위 밖 좌표를 가장자리 셀로 강제 배정하지 않습니다.
- grid.ts에서 범위·인덱스·좌표 변환을 계산합니다. 정의는 config.ts에서 변경합니다.
- 격자선은 확대 수준 16 이상에서 화면에 보이는 구간만 생성합니다. 셀 클릭·고도 조회는 없습니다.
- 지역 정보 패널에서 격자 메타데이터를 JSON으로 내보낼 수 있습니다.
- 고도 재표본화·결측 마스크는 백엔드 지형 CLI에서 생성합니다. 브라우저의 거리 순위는 개발 격자의 모든 셀을 사용합니다. 6m는 계산 간격입니다.
- 범위는 개발용 예시입니다. 실제 평가 범위는 발견점을 보지 않고 입력 조건으로 정해야 합니다.

`npm test`로 좌표 변환, 격자 경계와 간격, 설정별 메타데이터, 연결 오류 유지와 재시도 상태를 검증합니다.

## 시간별 결과 형식

분석 모듈에서 현재 격자에 맞는 JSON을 불러옵니다. 지도 하단 슬라이더는 파일에 있는 시점만 표시합니다. 마지막 확인 시각과 시점별 실제 시각은 브라우저 현지 시간대로 표시합니다. 합성 예제는 UI 확인용입니다.

```json
{
  "schema_version": 1,
  "grid_id": "yosemite-valley-dev-6m-v1",
  "model_version": "example-v1",
  "lkp": [-119.59, 37.745],
  "last_seen_utc": "2026-01-01T00:00:00.000Z",
  "frames": [
    { "elapsed_seconds": 3600, "cells": [[500500, 0.4]] },
    { "elapsed_seconds": 7200, "cells": [[500500, 0.15], [500501, 0.2]] }
  ]
}
```

각 셀 값은 행 우선 인덱스와 확률 질량 쌍입니다. 파일은 32 MiB 이하이며 두 시점 이상을 시간순으로 담습니다. 한 시점의 셀 인덱스는 고유하고 확률 합은 1 이하입니다. 생략된 셀은 투명하게 표시합니다. 전체 시점의 최대 셀 확률을 공통 범례에 사용하며 입력 값을 재정규화하지 않습니다. 격자 정의를 변경할 때는 격자 ID도 갱신합니다.
