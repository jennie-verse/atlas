# Atlas

Atlas는 여러 개인용 웹앱이 GitHub 비공개 저장소 `webapp-data`에 저장한 JSON 데이터를 한곳에서 검색하는 정적 웹앱입니다. 현재는 `tide/`(운영 중)와 `clip/`(은퇴, 과거 기록) 데이터를 지원하며, 검색 결과를 누르면 원문을 클립보드에 복사합니다.

빌드 도구나 서버가 필요하지 않습니다. `atlas/` 폴더를 그대로 GitHub Pages에 올리면 `https://jennie-verse.github.io/atlas/` 하위 경로에서 실행됩니다. 데이터 요청은 공용 모듈 `../shared/v1/sync.js`를 통해 `api.github.com`에만 전송됩니다.

## 파일 구조

```text
atlas/
├─ index.html                 화면의 의미 구조와 PWA 메타데이터
├─ manifest.webmanifest       홈 화면 설치 정보와 PNG 아이콘 경로
├─ sw.js                      정적 파일 오프라인 캐시
├─ .nojekyll                  GitHub Pages의 Jekyll 처리 비활성화
├─ assets/
│  └─ app.css                 Soft Rose 테마, 반응형·접근성 스타일
├─ src/
│  └─ app.js                  검색, 동기화, 파서, 캐시, 설정 로직
├─ icons/
│  └─ icon-source.svg         PNG 변환용 원본 아이콘
└─ docs/
   ├─ README-KO.md            구조와 수정 위치
   └─ USER-GUIDE-KO.md        처음 설정 및 사용 안내
```

`fonts/lexend-400.woff2`, `fonts/lexend-700.woff2`와 PNG 아이콘 3개는 후속 도구가 추가할 파일입니다. 파일이 없어도 Verdana 등의 대체 글꼴로 앱 기능은 정상 작동합니다.

## 데이터 처리 구조

앱 시작 시 `atlas.cache.v1` 캐시를 먼저 읽어 즉시 결과를 표시한 다음, 저장된 토큰과 네트워크가 있으면 백그라운드에서 최신 데이터를 가져옵니다.

저장소 루트의 폴더를 조회한 뒤 `PARSERS`에 등록된 폴더만 처리합니다. 현재 파서는 두 개입니다.

### tide (현재 운영 중인 데이터원)

`tide/archive/<YYYY-MM>.json` 파일들을 읽습니다. 각 파일은 다음 모양의 배열입니다.

```json
[{ "id": "...", "kind": "clip", "text": "...", "createdAt": "...", "archivedAt": "..." }]
```

1. 파일 이름이 `YYYY-MM.json` 형식인 것만 읽습니다.
2. 같은 `id`가 여러 달 파일에 있으면 `archivedAt`이 가장 최신인 항목을 선택합니다.
3. `kind`가 `dump`면 라벨을 `Dump`, 그 외에는 `Clip`으로 표시합니다.
4. 본문 첫 줄을 제목으로 씁니다. 비어 있으면 `Untitled note` 또는 `Untitled clip`을 씁니다.

**tide는 마지막으로 손댄 뒤 7일이 지나 만료된 항목만 아카이브합니다.** 지금 tide 화면에 남아 있는 항목은 저장소에 올라가 있지 않으므로 Atlas 검색 대상이 아닙니다. Atlas는 "이미 흘려보낸 것을 다시 찾는" 검색기입니다.

### clip (은퇴한 앱, 과거 기록 전용)

`clip/data.<context>.json` 파일들을 읽습니다. clip 앱은 은퇴했지만 `webapp-data`의 `clip/` 폴더가 남아 있는 동안 과거 기록을 계속 검색할 수 있도록 파서를 유지합니다. 결과를 탭했을 때 열리는 앱은 `../tide/`입니다.

1. 같은 `id`가 여러 파일에 있으면 `updatedAt`이 가장 최신인 항목을 선택합니다.
2. tombstone의 `at`이 선택된 항목의 `updatedAt`보다 최신이면 결과에서 제외합니다.

`clip/` 폴더를 저장소에서 지우면 `listDir`이 빈 배열을 돌려주므로 이 파서는 오류 없이 조용히 비활성화됩니다. 그때 `PARSERS`에서 `clip` 항목을 지워도 됩니다.

### 공통

JSON을 읽을 수 없거나 구조가 잘못된 파일은 건너뛰며 Settings의 Last error에는 파일 이름만 표시합니다.

새 앱을 지원하려면 `src/app.js`의 `PARSERS` 객체에 새 폴더 이름, 앱 URL, `listFiles(config, folderPath)`, `parse(files)` 구현을 추가합니다. `listFiles`는 그 앱의 파일 배치 규칙(하위 폴더 여부, 파일명 형식)을 스스로 정합니다. 저장소 탐색이나 화면 렌더링 코드는 수정할 필요가 없습니다.

## 바꾸기 쉬운 값

- GitHub 소유자·저장소·브랜치: `src/app.js`의 `CONFIG_BASE`
- 토큰·캐시·글자 크기 localStorage 키: `src/app.js`의 `STORAGE_KEYS`
- 최근 항목 표시 개수: `src/app.js`의 `RECENT_LIMIT`
- 지원 앱과 파서: `src/app.js`의 `PARSERS`
- 기본 글자 크기와 6단계 값: `src/app.js`의 `DEFAULT_FONT_SIZE`, `FONT_SIZES`
- 대표색·배경·경계선·상태색: `assets/app.css`의 `:root`
- Service Worker 캐시 버전: `sw.js`의 `CACHE_NAME`
- 프리캐시 파일 목록: `sw.js`의 `PRECACHE_URLS`
- 앱 이름·설명·아이콘 경로: `manifest.webmanifest`와 `index.html`

Service Worker 파일이나 프리캐시 대상의 내용을 바꾸어 배포할 때는 `CACHE_NAME`도 `atlas-v4`처럼 올려야 이전 캐시가 제거됩니다. (`fetch` 처리가 cache-first이므로 이 값을 올리지 않으면 홈 화면 앱에 옛 `src/app.js`가 계속 남습니다.)

## 보안과 개인정보

- 토큰은 코드에 포함하지 않으며 공용 규약 키 `sync.token.v1`에 이 기기 브라우저의 localStorage로 저장됩니다.
- Settings 화면에는 토큰 원문을 다시 표시하지 않고 마지막 4자리만 표시합니다.
- 클립 내용과 라벨은 DOM의 `textContent`로만 렌더링합니다. 데이터에 HTML이나 `<script>` 문자열이 있어도 실행되지 않습니다.
- 외부 CDN, 외부 폰트, 분석 스크립트, `eval`, `new Function`을 사용하지 않습니다.
- Atlas는 읽기만 하므로 GitHub fine-grained token은 `webapp-data` 저장소의 Contents: Read-only 권한만 주는 구성을 권장합니다.

## 아이콘과 글꼴 후속 준비

`icons/icon-source.svg`를 이용해 아래 파일을 추가합니다.

- `icons/icon-192.png`
- `icons/icon-512.png`
- `icons/apple-touch-icon.png`

Lexend 글꼴 파일을 준비할 때는 아래 경로를 그대로 사용합니다.

- `fonts/lexend-400.woff2`
- `fonts/lexend-700.woff2`

HTML, manifest, CSS, Service Worker에는 이 경로가 미리 반영되어 있습니다.
