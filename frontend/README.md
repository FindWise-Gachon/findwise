# FindWise Frontend

React + TypeScript + Vite + MapLibre GL JS. 사용자가 제공한 디자인을 바탕으로 요세미티 지도 작업 공간을 구현했습니다.

## Run / 실행

```bash
cd frontend
npm ci
npm run dev
```

터미널에 표시된 Local 주소를 엽니다. 다른 개발 서버가 실행 중이면 포트 번호가 달라질 수 있습니다. 인터넷 연결과 WebGL 지원 브라우저가 필요합니다.

## Build / 빌드

```bash
npm run build
npm run preview
```

## 구현된 기능

- 요세미티 기본 지도와 위성 영상 전환.
- 실제 고도 타일 기반 등고선·음영기복 독립 토글.
- 등고선 선명도 조절, 확대 수준별 100/50/20m 간격.
- 확대·축소, 북쪽 정렬, 초기 위치 이동.
- 지역·출처 패널, 범례, 오류 안내·재시도.
- 브라우저에 지도 설정 저장 및 초기화.

등산로·하천의 독립 레이어, 분석 격자, 히트맵, 모델, 현장 보고는 아직 연결하지 않았습니다. 기본 지도에 포함된 길·하천은 배경과 함께 표시됩니다.

## Code / 코드 위치

- src/App.tsx: 작업 공간과 UI 상태.
- src/App.css, src/index.css: 화면 스타일.
- src/map/MapView.tsx: 지도 생명주기와 레이어 표시.
- src/map/config.ts: 지역·자료 제공처·기본 설정.

## Sources / 자료 출처

- Base: OpenStreetMap, https://www.openstreetmap.org/copyright
- Satellite: Esri World Imagery, https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer
- Elevation: Mapzen / AWS Terrain Tiles, https://registry.opendata.aws/terrain-tiles/
- Contour generation: maplibre-contour, https://github.com/onthegomap/maplibre-contour

온라인 자료를 요청하며 원본 타일을 저장소에 포함하지 않습니다. 서비스 운영·대규모 사용 전에는 각 제공처의 이용 조건·할당량을 확인해야 합니다. 표시용 고도자료를 검증된 6m 분석 지형으로 간주하지 않습니다.

## Verification / 확인

프로덕션 빌드 성공. 로컬 브라우저에서 기본·위성 전환, 등고선·음영기복 토글, 설정 유지, 지역 패널을 확인했습니다. MapLibre 6의 worker를 Vite worker asset으로 연결했습니다. 지도 번들 크기 경고는 남아 있으며 향후 초기 로딩 최적화 대상입니다.
