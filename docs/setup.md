# 개발환경 및 GitHub 연결

## 현재 상태

frontend, backend, data, docs와 문서만 준비되었다. npm install, 서버 실행, Docker 실행 명령은 아직 없다. GitHub 원격 생성·삭제·업로드는 이 문서의 작성으로 실행되지 않는다.

## 다음 구현에서 고정할 환경

- 웹: React + TypeScript + Vite 후보. 지도 렌더러는 독립 래퍼를 두고 실제 위성·등고선 자료 형식과 성능을 확인한 뒤 확정한다.
- 전처리/API: Python, Rasterio와 FastAPI 후보. 지도만 표시하는 첫 화면에는 API를 억지로 요구하지 않는다.
- Node/Python 버전은 실제 의존성 호환 확인 후 지정하고 잠금 파일을 커밋한다.
- Docker·DB는 현재 필수가 아니다.

## GitHub에 처음 올리는 방법

기존 조직 FindWise-Gachon 아래 findwise 저장소 하나를 사용한다. 기존 자료 모음 폴더 전체가 아니라 이 findwise 폴더의 내용만 올린다.

### 원격에 README가 이미 있는 경우 (권장)

1. GitHub에서 새 findwise 저장소의 Code → HTTPS 주소를 복사한다.
2. 별도의 빈 위치에 그 주소로 clone한다.
3. 이 폴더의 내용(.github, .gitignore 등 숨김 파일 포함)을 복제한 저장소로 복사한다. .git 디렉터리는 복사하지 않는다.
4. git status와 변경 내용을 확인한다.
5. 최초 구조를 커밋하고 push한다. 원격 README를 무시하고 강제 push하지 않는다.

### 원격이 완전히 비어 있는 경우

이 폴더에서 git init -b main → git add . → git commit 순으로 진행하고, GitHub에서 확인한 원격 주소를 origin으로 추가한 다음 git push -u origin main을 실행한다. 주소를 추정하지 말고 실제 저장소의 Code 메뉴에서 확인한다.

## 보류한 설정

팀 권한, 승인 인원, 브랜치 보호, 자동 배포는 나중에 구성한다. 실행 코드가 생긴 뒤 빌드·테스트 CI를 추가한다. 현재 존재하지 않는 검사 이름을 필수 검사로 등록하지 않는다.

## 자료 관리

원본은 data/raw, 가공 자료는 data/processed, 캐시는 data/cache에 둔다. 모두 Git 추적에서 제외한다. 공유 가능한 작은 합성 자료만 data/samples에 넣는다. 자산 목록은 data/catalog에 두고 출처·이용 조건·파일 검증값을 기록한다.

## 코드 배치

웹 프로젝트는 frontend, Python 코드는 backend에 생성합니다. 하위 프로젝트를 저장소 루트에 중복 생성하지 않습니다. 기능별 하위 폴더는 실행 코드가 생길 때 추가합니다.
