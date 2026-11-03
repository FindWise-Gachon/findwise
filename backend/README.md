# Backend

지형 전처리 CLI를 제공합니다. 확률 모델, 보고 처리, API는 후속 구현 범위입니다.

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
