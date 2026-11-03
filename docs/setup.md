# 개발환경 / Development setup

## 환경

- Node.js 22.21.1에서 설치·빌드·격자 테스트를 확인했습니다. 같은 버전을 권장합니다.
- 웹: React, TypeScript, Vite, MapLibre, maplibre-contour, Proj4js.
- 인터넷 연결과 WebGL 지원 브라우저가 필요합니다.
- Python 서버·DB·Docker는 아직 사용하지 않습니다.

## 실행

```bash
cd frontend
npm ci
npm run dev
```

터미널에 표시된 Local 주소를 엽니다. 기본 포트가 사용 중이면 다른 포트가 표시됩니다.

## 검증

```bash
npm test
npm run build
```

격자 테스트는 투영 기준점, 6m 간격, 경계의 포함/제외, 배열 인덱스, 좌표 왕복 변환을 확인합니다. 지도 번들 크기 경고는 남아 있으며 초기 로딩 최적화 대상입니다.

## 코드 위치

frontend/src/App.tsx는 화면, map/MapView.tsx는 지도 표시, map/config.ts는 지역·제공처·격자 설정, map/grid.ts는 격자와 좌표 계산입니다. backend는 후속 분석 서버용입니다.

## 지도 확인

기본/위성 전환 → 등고선·음영기복 토글 → 분석 범위 표시 → 격자 확인을 위해 확대 순서로 확인합니다. 6m 격자선은 확대 수준 16 이상에서만 표시됩니다. 격자 클릭은 지원하지 않습니다. 지역 정보에서 격자 정의를 JSON으로 저장할 수 있습니다.

실제 분석 고도값·확률값은 아직 없습니다. 6 × 6km 범위는 개발용으로 선택했으며 실제 사건의 수색 영역이나 유효 지형 확보 범위를 뜻하지 않습니다.
