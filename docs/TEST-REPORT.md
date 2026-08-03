# Atlas — Test Report

검토일: 2026-08-03
검토 방식: 로컬 정적 서버(`python3 -m http.server`, `Deliverable/` 루트에서 실행)로 `http://localhost:4175/atlas/`를 열어 확인. `../shared/v1/sync.js` 상대 경로가 GitHub Pages와 동일한 폴더 구조(`Deliverable/atlas`, `Deliverable/shared`)에서 정상 해석되는 것을 전제로 함.

## 1. 코드 검토에서 발견해 고친 문제

ChatGPT가 만든 원본 코드 자체에는 아래 항목에서 **결함이 없었습니다** (신뢰하지 말고 검토하라는 지시에 따라 전부 확인함). 다만 원본은 후속 작업이 필요한 파일(폰트, 아이콘)을 의도적으로 비워둔 상태였고, 이 작업에서 해당 파일을 채워 넣었습니다.

| 항목 | 결과 |
|---|---|
| `sync.js` 함수 시그니처 일치 여부 (`readFile`, `listDir` 호출부) | 문제 없음. `config {owner, repo, token, branch}` + `path` 형태로 정확히 호출 |
| `innerHTML`/`outerHTML`/`insertAdjacentHTML` 사용 여부 | 없음. 클립 텍스트·라벨은 전부 `textContent`로만 렌더링 |
| CSP 및 외부 요청 범위 | `connect-src`가 `'self' https://api.github.com`으로 제한, 외부 CDN·폰트·분석 스크립트 없음 |
| 토큰 노출 (console, 화면 전체 표시) | 없음. `console.*` 호출 자체가 코드에 없고, 화면에는 끝 4자리만 표시 |
| 존재하지 않는 파일 참조 | **발견됨 — 고침.** `index.html`/`manifest.webmanifest`/`sw.js`가 참조하는 `icons/apple-touch-icon.png`, `icons/icon-192.png`, `icons/icon-512.png`, `fonts/lexend-400.woff2`, `fonts/lexend-700.woff2`가 원본에는 없었음 (문서에 "후속 도구가 추가할 파일"로 명시되어 있었으므로 의도된 상태). 아래 2번 항목에서 추가함 |
| `clip` 데이터 파서 vs 실제 저장 형식 | 문제 없음. `Published/clip/app.js`의 `buildSyncPayload`(`pushNow`)가 쓰는 `{context, updatedAt, items[], deleted[]}` 형식과 `PARSERS.clip.parse`의 기대 형식이 정확히 일치. 병합 규칙(같은 id는 updatedAt 최신 우선, tombstone.at이 updatedAt보다 나중이면 제외)도 `mergeRemote`와 동일하게 구현됨 |
| `eval`/`new Function` 사용 | 없음 |

## 2. 이번에 직접 보완한 작업

1. **폰트**: `Published/focus/public/fonts/lexend-400.woff2`, `lexend-700.woff2`를 `atlas/fonts/`에 복사. 라이선스 `Published/petal/licenses/Lexend-OFL.txt`를 `atlas/licenses/`에 복사.
2. **아이콘**: `icons/icon-source.svg`를 `rsvg-convert`로 180×180(`apple-touch-icon.png`), 192×192(`icon-192.png`), 512×512(`icon-512.png`) PNG로 변환.
3. **Service Worker**: `sw.js`의 `PRECACHE_URLS`에 새로 추가된 `licenses/Lexend-OFL.txt`를 반영하고, 캐시 내용이 바뀌었으므로 `CACHE_NAME`을 `atlas-v2` → `atlas-v3`로 올림 (이전 캐시 자동 제거).
4. **테스트 서버 설정**: `.claude/launch.json`에 `atlas-preview`(포트 4175, `Deliverable/` 루트 기준 `python3 -m http.server`) 항목 추가 — GitHub Pages와 동일하게 `atlas/`와 `shared/`가 형제 폴더로 서빙되도록 구성.

## 3. 통과 항목 (로컬 확인 완료)

### 기능
- [x] 콘솔 오류 0건 (초기 로드, 토큰 저장, 잘못된 토큰 새로고침, 검색, 복사, 글자 크기 변경, 리사이즈 전 구간)
- [x] 토큰 없는 상태: "Connect Atlas" 안내와 Open Settings 버튼이 오류 없이 표시됨
- [x] 잘못된 토큰으로 새로고침: 조용히 실패하지 않고 Settings의 Last error에 "Token may be expired or lacks permission" 표시 + 토스트 알림
- [x] 가짜 캐시 데이터(핀 고정 항목, 라벨, HTML 태그가 포함된 텍스트)로 목록 렌더링 확인 — `<script>alert(1)</script>` 텍스트가 그대로 문자로 표시되고 실행되지 않음 (XSS 방지 확인)
- [x] 한글 검색어("한글") 입력 시 즉시 필터링되어 정확히 1건 매칭
- [x] 검색창 지우기(X 버튼) 동작
- [x] 복사 버튼 클릭 시 오류 없이 동작 (헤드리스 브라우저 클립보드 권한 제약으로 실제 클립보드 값 검증은 불가했으나, 성공/실패 어느 경로에서도 콘솔 오류 없음을 확인)
- [x] Service Worker가 `./sw.js`로 정상 등록됨 (`navigator.serviceWorker.getRegistrations()`로 확인)
- [x] `../shared/v1/sync.js`가 GitHub Pages와 동일한 상대 경로 구조에서 200 OK로 로드됨

### 화면
- [x] 375px 폭 (iPhone 세로 기준): 버튼 겹침·글자 잘림 없음
- [x] 768px 폭 (iPad 세로 기준): 레이아웃 정상, 설정 화면 최대폭 제한 적용됨
- [x] 글자 크기 6단계(6/8/10/12/14/17px) 각각 확인 — 6px에서도 `.open-app-link`(44×44px), `.icon-button`(48×48px) 터치 영역이 그대로 유지됨을 `getBoundingClientRect()`로 측정 확인
- [x] 17px 단계에서도 두 줄 텍스트가 자연스럽게 줄바꿈되고 버튼과 겹치지 않음
- [x] 한글·영문 혼용 텍스트("한글 검색 테스트 문장입니다", "xss-test" 라벨 등) 줄바꿈·정렬 정상
- [x] 라이트 모드만 지원 (`color-scheme: light` 고정) — 요청 범위에 다크 모드가 없어 별도 대응 안 함

### 코드/PWA
- [x] manifest 아이콘 경로(`./icons/icon-192.png`, `icon-512.png`, `apple-touch-icon.png`) 전부 실제 파일과 일치
- [x] `sw.js` 프리캐시 목록이 실제 파일 목록과 일치 (누락/오참조 없음)
- [x] `.nojekyll` 파일 존재 확인 (GitHub Pages Jekyll 비활성화)

## 4. 실기기(iPhone/iPad Safari)에서 직접 확인해야 할 항목 (Pending)

로컬 데스크톱 브라우저 자동화로는 검증할 수 없는 항목입니다.

- [ ] 실제 `webapp-data` 저장소 + 유효한 read-only 토큰으로 `clip` 폴더의 실 데이터를 가져와 검색·복사가 실제 동작하는지
- [ ] 여러 기기(예: iPhone Safari 탭 vs 홈 화면 앱)에서 만든 `data.<contextId>.json` 파일들이 실제로 병합되어 나오는지, 그리고 한쪽에서 삭제한 클립이 tombstone으로 다른 기기 결과에서 제외되는지
- [ ] Safari에서 클립보드 복사(`navigator.clipboard.writeText`)가 실제로 클립보드에 값을 넣는지 (헤드리스 환경 권한 제약으로 로컬 검증 불가)
- [ ] Add to Home Screen 후 standalone 모드 아이콘이 새로 만든 PNG로 올바르게 표시되는지
- [ ] iPhone/iPad 가로 화면, Dynamic Island/Notch/홈 인디케이터 Safe Area 가림 여부
- [ ] 키보드가 열린 상태에서 검색창·토큰 입력창 사용성 (특히 iPad 외장 키보드 미사용 시)
- [ ] 기기를 완전히 껐다 켠 뒤에도 localStorage 캐시·토큰·글자 크기 설정이 유지되는지
- [ ] 오프라인 상태에서 Service Worker 캐시로 재실행이 실제로 되는지 (첫 방문 후 캐시가 채워진 다음)
- [ ] Safari 폰트 폴백: Lexend 로드 실패를 가정한 시나리오(예: 파일 손상)에서 Verdana로 자연스럽게 전환되는지 실기기 렌더링으로 육안 확인
