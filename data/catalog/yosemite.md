# 요세미티 분석 자료 후보

## USGS 3DEP 지형

- [The National Map 1/3 arc-second 타일 n38w120](https://rockyweb.usgs.gov/vdelivery/Datasets/Staged/Elevation/13/TIFF/current/n38w120/)을 개발 영역의 분석용 DEM으로 선택했습니다. [USGS 배포본](https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/13/TIFF/current/n38w120/USGS_13_n38w120.tif)은 451,129,925바이트입니다.
- 2026-11-03 확인한 객체의 Last-Modified는 2025-05-15, ETag는 `951230e8ff59a05ae1b3a94eaebe19e7-87`입니다. 이 ETag는 배포 객체의 버전 식별값입니다. 파일을 별도로 보관할 경우 취득일과 SHA-256을 함께 기록합니다.
- 실제 배포본의 수평 좌표계는 EPSG:4269(NAD83), 결측 표지는 -999999입니다. 원본 간격은 1/3각초(약 10m급)입니다. USGS는 미국 본토 표준 DEM의 수직 기준을 일반적으로 NAVD88로 안내합니다. 다른 타일을 사용할 때는 개별 메타데이터를 확인합니다. [USGS 좌표·수직 기준 안내](https://www.usgs.gov/faqs/what-projection-horizontal-datum-vertical-datum-and-resolution-a-usgs-digital-elevation-model)
- [3DEP 자료 이용 안내](https://www.usgs.gov/3d-elevation-program/science/faqs)를 따르고 출처를 표시합니다. 브라우저의 지형 타일은 화면 표시용으로 계속 사용합니다.

## YOSAR 평가 후보

- [YOSAR FeatureServer](https://services5.arcgis.com/ZY2TU3F6m1lSbSrn/ArcGIS/rest/services/YOSAR_MissingPersonData_v1/FeatureServer)는 Paul J. Doherty와 Jared Doke의 2000–2010년 자료이며 제공처 표기는 CC BY-NC-SA 4.0입니다. 사용 범위와 공유 조건을 확인한 뒤 연구에 사용합니다.
- 0번 레이어(현재 API 이름 `Located`)는 발견 위치, 1번 `Missing`은 수색 초기 계획 지점(IPP)입니다. `IPPType`·`IPPClassif`로 의미를 확인하고 마지막 확인 위치와 동일하다고 가정하지 않습니다.
- 서비스 지오메트리는 EPSG:3857입니다. 분석용 추출에서는 좌표계를 명시하고 `Georef_Unc`의 단위와 의미를 확인한 뒤 불확실성 분석에 사용합니다. `IncidYear`와 `CaseNumber` 조합을 잠정 사건 키로 사용하며 `SARNumber`는 교차 확인에 씁니다.
- 2026-11-03 조회 결과 `Missing` 213개 행과 `Located` 218개 행의 고유 사건 키 213개가 모두 일치했습니다. 209개 키는 일대일 연결 후보이며, 4개 키에는 발견 지점이 여러 개 있습니다. 조회된 행에는 키나 좌표가 누락되거나 `Georef_Unc`가 비어 있거나 0 이하인 사례가 없었습니다. 위치 의미와 오차 단위 확인은 별도 검토가 필요합니다.
- 원본 사건 정보와 발견점은 Git에서 제외합니다. 개인 식별 속성은 수집 대상에서 제외하고, 발견점과 결과에서 파생된 거리·시간은 평가 단계에만 전달합니다.
