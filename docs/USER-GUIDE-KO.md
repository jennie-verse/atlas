# Atlas 사용 안내

## 처음 설정하기

1. Safari에서 Atlas를 엽니다.
2. 오른쪽 위의 설정 버튼을 눌러 설정(Settings)을 엽니다.
3. GitHub에서 `webapp-data` 비공개 저장소만 읽을 수 있는 fine-grained personal access token을 준비합니다. 권한은 Contents: Read-only를 권장합니다.
4. 개인 액세스 토큰(Personal access token) 입력란에 토큰을 붙여 넣습니다.
5. 저장(Save)을 누릅니다. 저장되면 토큰 원문 대신 끝 4자리만 표시됩니다.
6. 데이터(Data)의 새로고침(Refresh)을 누릅니다.
7. 마지막 갱신(Last refreshed)에 시간이 표시되고 마지막 오류(Last error)가 `No errors`이면 준비가 끝났습니다.
8. 왼쪽 위 뒤로 버튼을 눌러 검색 화면으로 돌아갑니다.

토큰은 다른 개인용 웹앱과 같은 `sync.token.v1` 규약을 사용합니다. 같은 브라우저 저장 공간을 공유하는 앱에서는 이미 저장한 토큰을 Atlas가 읽을 수 있습니다. Safari 탭과 홈 화면에 추가한 앱은 iOS에서 저장 공간이 분리될 수 있으므로 각각 설정해야 할 수 있습니다.

## 검색하기

- 검색 입력창(Search text or labels)에 글자를 입력하면 즉시 결과가 줄어듭니다.
- 영문 대소문자를 구분하지 않습니다.
- 한글 부분 일치 검색을 지원합니다.
- 클립의 본문 `text`와 라벨 `label`을 함께 검색합니다.
- 검색어가 없으면 최신 항목 20개를 표시합니다.

## 복사하고 원래 앱 열기

- 결과의 본문 영역을 누르면 전체 클립 원문이 클립보드에 복사되고 `Copied` 토스트가 나타납니다.
- 오른쪽의 열기 버튼을 누르면 같은 탭에서 Tide를 엽니다.
- Safari가 클립보드 권한을 허용하지 않으면 복사 실패 안내가 표시됩니다. 이 경우 결과 글자를 길게 눌러 수동으로 선택·복사하세요.

## 글자 크기 바꾸기

1. 설정(Settings)을 엽니다.
2. 글자 크기(Text size)에서 6, 8, 10, 12, 14, 17 중 하나를 선택합니다.
3. 선택값은 이 기기의 localStorage에 저장되어 다음 실행에도 유지됩니다.
4. 초기화(Reset)를 누르면 기본 12px로 돌아갑니다.

검색 입력란과 토큰 입력란은 iPhone Safari 자동 확대를 막기 위해 어떤 단계에서도 16px로 유지됩니다. 글자만 작아지며 버튼의 터치 영역은 44×44px 이상으로 유지됩니다.

## 오프라인에서 사용하기

한 번 정상적으로 데이터를 받은 뒤에는 캐시된 항목을 오프라인에서도 검색하고 복사할 수 있습니다. 화면에 `Offline — showing cached data`가 표시되면 현재 결과는 마지막 캐시입니다. 네트워크가 돌아오면 저장된 토큰이 있을 때 Atlas가 다시 갱신을 시도합니다.

처음 방문한 상태이거나 아직 공용 모듈과 정적 파일이 캐시되지 않았다면 오프라인 실행은 불가능할 수 있습니다.

## 토큰 지우기

1. 설정(Settings)을 엽니다.
2. 지우기(Clear)를 누릅니다.
3. 확인 창에서 지우기를 승인합니다.

토큰을 지워도 마지막 검색 데이터 캐시는 남습니다. 캐시 결과는 계속 검색할 수 있지만 새로고침하려면 토큰을 다시 저장해야 합니다.

## 오류 확인하기

문제가 생기면 설정(Settings) → 데이터(Data) → 마지막 오류(Last error)를 확인합니다.

- `Token may be expired or lacks permission`: 토큰이 만료되었거나 `webapp-data` 저장소의 Contents: Read-only 권한이 없습니다. 새 토큰을 저장한 뒤 Refresh를 다시 누르세요.
- `Network request failed. Cached data is still available.`: 네트워크 연결을 확인하세요. 기존 캐시는 계속 사용할 수 있습니다.
- `Skipped unreadable files: 파일명`: 표시된 JSON 파일을 파싱하지 못했습니다. GitHub 저장소에서 해당 파일의 JSON 형식과 `items`, `deleted` 배열을 확인하세요.
- `No data found`: 토큰과 권한이 맞는지 확인하고 Refresh를 누르세요. `webapp-data` 루트에 `tide/archive/` 폴더와 `YYYY-MM.json` 파일이 있는지도 확인하세요.
- **Tide에서 방금 담은 항목은 검색되지 않는 것이 정상입니다.** Tide는 마지막으로 손댄 뒤 7일이 지나 만료된 항목만 저장소에 보관합니다. Atlas는 그렇게 흘려보낸 기록을 다시 찾는 검색기입니다. 핀(Pin)을 꽂은 항목은 만료되지 않으므로 Atlas에도 올라오지 않습니다.
- `Copy failed…`: Safari의 클립보드 접근이 차단되었습니다. HTTPS 주소에서 실행 중인지 확인하고 결과를 길게 눌러 수동 복사하세요.

## 홈 화면에 추가하기

Safari에서 공유(Share) → 홈 화면에 추가(Add to Home Screen)를 선택합니다. 홈 화면 아이콘으로 실행하면 standalone 모드로 열립니다. 아이콘 PNG 파일이 배포된 뒤 추가해야 올바른 Atlas 아이콘이 표시됩니다.
