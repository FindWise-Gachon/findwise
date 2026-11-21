# 한국 지도 생성 모듈 실행 가이드

FindWise 한국 지도 생성 모듈은 DEM(수치표고모델)과 OSM 데이터를 이용해 지도 데이터를 생성합니다.

**Python 가상환경(`.venv`)과 BAT 실행 파일**을 통해 실행할 수 있습니다.

## 1. 사전 준비

### 필수 프로그램
- **Python 3.10**: Python 실행 및 가상환경 생성

지도 데이터를 웹페이지에서 확인하려면 Node.js도 필요합니다.

### 필요한 데이터
- DEM 파일 (`.tif`)
- OSM 원본 파일 (`.osm.pbf`)
- Osmium Tool 실행 파일 및 필요한 DLL

원본 DEM 및 OSM 데이터는 용량 문제로 GitHub에 포함되지 않을 수 있으므로 별도로 준비해야 합니다.

## 2. 프로젝트 폴더 구성

```text
findwise/
├── run_kr_map.bat
├── requirements.txt
├── .venv/                 # 실행 시 자동 생성
├── tools/
│   └── osmium/            # Osmium 실행 파일 및 DLL
├── backend/
│   └── app/
│       └── map_module/    
├── data/
│   ├── raw/               # 원본 DEM 및 OSM 데이터
│   └── processed/         # 생성된 중간 데이터
└── frontend/
    ├── korea-map.html
    └── public/
        └── terrain/       # 웹 지도 데이터
```

`.venv`는 GitHub에서 공유하지 않으며 각 컴퓨터에서 자동 생성됩니다.

## 3. 지도 데이터 생성

프로젝트 최상위 폴더에서 `run_kr_map.bat`를 실행합니다.

처음 실행할 때 `.venv` 가상환경을 자동으로 생성하고 `requirements.txt`에 명시된 Python 패키지를 설치합니다.

이후 실행에서는 기존 가상환경을 재사용합니다.

### 실행 시 입력 항목

**① DEM 파일 선택**

```text
Available DEM files:
1. BUKHANSAN_ASTGTM2.tif
2. seoraksan_srtm.tif

Select DEM (1 or 2):
```

사용할 DEM에 해당하는 번호를 입력합니다.

**② 생성할 지역 이름 입력**

```text
Enter region name: bukhansan-test
```

기존에 생성된 지역 이름과 중복되지 않는 이름을 입력합니다.

DEM의 수직 기준면(Vertical Datum)과 원본 버전(Source Version)은 선택한 DEM에 맞게 BAT 파일에서 자동 지정합니다.

현재 지원하는 DEM은 BAT 파일에 등록된 북한산 및 설악산 데이터입니다.

## 4. 생성 결과

파이프라인 실행이 완료되면 다음 폴더에 결과가 저장됩니다.

- `data/processed/<region>/`: 중간 처리 데이터
- `frontend/public/terrain/<region>/`: 웹 지도 표시용 데이터

생성된 결과에는 고도, 경사도, 등산로, 하천 등의 정보가 포함됩니다.

## 5. 웹 지도 확인

프론트엔드 서버를 실행합니다.

```powershell
cd frontend
npm run dev
```

```text
http://localhost:5173/korea-map.html?region=bukhansan-test
```

`region` 값에는 지도 생성 시 입력한 지역 이름을 사용합니다.

## 6. 참고 사항

- Python 3.10은 설치되어 있어야 합니다.
- 인터넷 연결이 필요할 수 있는 Python 패키지 설치는 최초 실행 시 진행됩니다.
- Osmium Tool은 별도로 준비해야 하며, `tools/osmium/`에 실행 파일과 필요한 DLL이 있어야 합니다.
- 현재 OSM 원본 파일 경로는 Python 코드에 설정된 경로와 일치해야 합니다.
- 이미 존재하는 지역 이름으로 실행하면 오류가 발생할 수 있습니다.
- 새로운 DEM을 추가하려면 BAT 파일의 DEM 선택 목록과 메타데이터 설정을 수정해야 합니다.
- `.venv/`, 원본 데이터, 생성된 데이터 등은 일반적으로 GitHub에 업로드하지 않습니다.

## 7. 주요 파일 역할

| 파일 | 역할 |
|---|---|
| `run_kr_map.bat` | 지도 생성 자동 실행 |
| `requirements.txt` | 필요한 Python 패키지 목록 |
| `.venv/` | 프로젝트 전용 Python 실행 환경 |
| `prepare_region.py` | 지도 데이터 생성 파이프라인 |
| `tools/osmium/` | OSM 데이터 처리 도구 |
| `korea-map.html` | 생성된 한국 지도 표시 페이지 |
