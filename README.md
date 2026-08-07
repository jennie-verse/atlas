# Atlas

여러 개인용 웹앱이 비공개 저장소 `webapp-data`에 저장한 JSON 데이터를 한곳에서 검색하는 정적 웹앱입니다. `tide`(운영 중)와 `clip`(은퇴, 과거 기록) 데이터를 지원하며, 검색 결과를 누르면 원문을 클립보드에 복사합니다.

빌드 도구나 서버가 필요하지 않습니다. 이 폴더를 그대로 GitHub Pages에 올리면 `https://jennie-verse.github.io/atlas/`에서 실행됩니다.

## 사용

- 저장된 GitHub 토큰으로 `webapp-data`를 검색합니다.
- 검색 결과를 탭하면 원문이 클립보드에 복사됩니다.
- 앱 시작 시 캐시를 먼저 보여준 뒤 백그라운드에서 최신 데이터를 가져옵니다.

자세한 파일 구조와 데이터 처리 방식은 [구조와 수정 위치](docs/README-KO.md), 처음 설정과 사용법은 [사용 안내](docs/USER-GUIDE-KO.md)를 보세요.

## 구성

`src/` 검색·동기화·파서 로직 · `assets/` 스타일 · `icons/` PWA 아이콘 · `docs/` 한국어 안내 · `manifest.webmanifest` · `sw.js` · `.nojekyll`
