# deepseek-remote-work

[DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness)(DSH) **사이드바에 원격 머신 전환을 추가하는** 플러그인입니다. 한 대의 DSH에 붙어서 PC·작업실 서버·컨테이너 등 **여러 머신에서 도는 세션을 같은 내비게이션 안에서 오가는** 것을 목표로 합니다.

기기를 바꾼다는 감각을 사이드바의 **작업 대상 전환**으로 만들려는 시도입니다. 새 화면을 추가하는 게 아니라, 내비게이션에 "어느 머신을 보고 있느냐"라는 축을 하나 더하는 것입니다.

## 왜 만드는가

DSH 세션은 그 서버의 파일시스템과 작업 디렉터리에 묶여 있습니다. 그래서 다른 머신에서 무언가 하려면 결국 ssh 를 타고 들어갑니다. 그런데 세션·히스토리·화면은 각자 로컬에 흩어집니다.

DSH 코어는 이미 이 길을 열어두고 있습니다 — `dsh --profile acp` 는 ACP(JSON-RPC stdio) 서버로, 원격 에이전트를 **세션 생성·재개·목록·종료** 단위로 조종하게 합니다. 즉 원격 실행은 새 발명이 아니라 코드가 미리 열어둔 자리입니다. 이 플러그인은 그 자리에 **전환과 목록**을 붙입니다.

## 동작 방식

```
브라우저 ──▶ [이 DSH] ── ssh ──▶ [원격] dsh --profile acp
                 │                    │
                 └── /remote-work/api ◀┘ initialize + session/list
```

- **명부는 서버**에 영속합니다 (`$DSH_HOME/remote-work/hosts.json`, 0600). 모든 기기가 같은 목록을 봅니다.
- **선택은 브라우저**에 둡니다 (localStorage). 폰에서 골랐다고 PC 화면이 따라 바뀌면 안 되기 때문입니다.
- 세션 목록은 요청마다 원격에 잠깐 붙었다 떼고, 그 ssh 는 `-t` 없이 실행됩니다(PTY 가 NDJSON 줄을 망가뜨립니다).

## 설치

```bash
dsh plugin --profile web add github:ByungHyun21/deepseek-remote-work
systemctl --user restart dsh-web   # 패치 방식이라 재시작이 필요합니다
```

사이드바 내비게이션에 **작업 대상** 행이 생깁니다(자동화 작업 ↔ 더 보기 사이). 눌러 열리는 패널에서 호스트를 등록·선택하고, 선택한 원격의 세션 목록을 오른쪽에서 봅니다. 맨 위 기본 항목은 **이 서버**이고, 그 상태에서는 작업 공간 목록을 건드리지 않습니다.

### 왜 이 자리인가 (슬롯을 세 번 옮겨 붙이며 확인한 것)

| 좌석 | 결과 |
|---|---|
| `sidebar.workspaces` | **single 좌석**이고 ui-workspace 가 점유 중 → 옆에 끼어들 수 없다. 작업 공간 목록을 원격으로 '바꾸는' 방식은 이 구조상 불가 |
| `sidebar.panellist.actions` | 사이드바 자리가 아니라 **더 보기 메뉴의 행**이다 |
| `sidebar.footer.action` | 최하단이라 요구와 다른 자리에 붙는다 |
| `sidebar.panellist` + `main` | **지금 방식.** nav 패널 행(자동화 작업과 더 보기 사이) + 행을 눌렀을 때 열리는 keyed 패널 |

`더 보기 ↓ 작업 공간` 사이에는 슬롯이 없습니다. 사이드바 계약에 *"브랜드 행·새 세션·패널 행·더 보기 버튼은 셸이 소유하고, 작업 공간 헤더 아래부터 리스트 바닥까지만 남의 자리"* 라고 명시되어 있습니다. 자동화 작업과 같은 종류의 행으로 앉히는 것이 그 구역에 올라갈 수 있는 유일한 정상 경로입니다.

### 화면 디자인

**이 플러그인은 셸의 화면 두 개를 기준으로 삼는다** — 자동화 작업(`dsh-client-ui-schedule` 의 `TaskManagerPage`)과 플러그인(`dsh-client-ui-plugin-manager` 의 `PluginManagerPage`). 새 화면을 잘 만드는 일보다 **이미 있는 화면처럼 보이게 하는 일**이 목표라서, 값은 그 두 곳에서 옮겨 적는다:

| 조각 | 기준 |
|---|---|
| 본문 폭·여백 | 가운데 정렬 `max-width:960px`, `padding:0 clamp(24px,4vw,48px) 48px`, `padding-top:28px` (darwin 은 `--dsh-frame-top-clearance` 를 더한다) |
| 제목 | 20px/500 한 줄 + 그 아래 13px 설명 (`label-secondary`) |
| 행 | 12px 라운드, hover 와 선택 모두 `--dsw-alias-interactive-bg-hover` (선택에만 색을 얹으면 옆 화면과 다른 앱이 된다) |
| 눌렀을 때 영역 | 플러그인 화면의 stretched-link (`:after{inset:0}`) — button 안에 button 을 넣지 않는다 |
| 버튼 | 공용 Button 의 값: `--dsw-radius-md`, 32px, 13/20, hover 는 `--dsw-alias-button-primary-hover` (자체 `filter:brightness` 금지) |
| 아이콘 버튼 | 28×28, `--dsw-radius-sm`, `--dsw-alias-label-caption` → hover 시 `label-secondary` |
| 입력 | 자동화 작업 설정 카드(`ruleRows`) 배선 — hairline 으로 갈린 48px 행, 라벨 왼쪽·값 오른쪽, hover 에서만 배경 |
| 안내·실패 | `notice` 카드(`--dsw-specific-sidebar-fill`, 10px 라운드) 위에 실패는 `state-error-primary` |
| 빈 상태 | glyph(`label-caption`) + title(14px/400) + action 버튼 |
| 로딩 | 스켈레톤(`--dsw-alias-bg-skeleton`, 2s pulse) |
| 디테일 | 오른쪽 47% + 왼쪽 hairline(`border-l4`) + 자체 스크롤, `--gutter` 24/20/16 |
| 끊점 | 두 화면과 같은 1100 · 760 · 400 (760 아래에서 목록을 접고 디테일을 펼친다) |
| 초점 | `.dshr-page :focus-visible` 에 `--dsw-focus-ring-color` 링 — 입력·stretched-link 은 자체 링 |

색과 라운드는 전부 셸의 `--dsw-*` 별칭이라 테마·다크모드를 자동으로 따라간다. 리터럴 색(`#`·`rgb()`)과 `filter:brightness` 는 시험이 막는다 (`test/client.test.mjs` 의 디자인 회귀 항목). 공용 UI 키트(`dsh-client-ui-primitives`)는 각 플러그인 번들에 인라인되어 별도 브라우저 모듈로 뜨지 않으므로, 그 `Button`/`Icon` 을 `require` 하는 길은 없고 위 값을 CSS 로 옮겨 쓰는 것이 현재 방식이다.

### 원격 쪽 준비 (호스트마다 한 번)

원격은 **DSH가 설치되어 있고 ssh 키로 붙을 수 있는** 상태여야 합니다.

```bash
# 1) 이 서버에서 원격으로 키를 복사
ssh-copy-id yoon@원격

# 2) 원격에 dsh 설치 — 설치 스크립트를 막으면 안 됩니다
npm install -g --allow-scripts=@deepseek-ai/dsh-subprocess-local,koffi,node-pty,@google/genai,protobufjs @deepseek-ai/dsh

# 3) 비로그인 셸 PATH 에 dsh 가 있는지 확인 (없으면 remoteCommand 에 절대 경로)
ssh yoon@원격 'command -v dsh'

# 4) 붙는지 확인
ssh yoon@원격 'dsh --profile acp --help'
```

`npm install -g` 가 설치 스크립트를 차단하는 환경이 있습니다. 특히 `dsh-subprocess-local`(spawn 헬퍼)과 `node-pty`(터미널)가 막히면 원격에서 도구가 제대로 돕지 않습니다.

## 설정

[cordis.patch.yml](cordis.patch.yml) 의 `remote-work.config` 행을 고칩니다.

| 설정 | 기본값 | 설명 |
|---|---|---|
| `timeoutMs` | `25000` | ssh 붙기 + 악수 + 목록 조회 전체 상한 |
| `sshBin` | `ssh` | ssh 래퍼가 따로 있으면 경로 지정 |
| `remoteCommand` | `dsh --profile acp` | 원격 실행 명령. PATH 에 없으면 절대 경로 |
| `maxHosts` | `12` | 명부 용량 |

끄는 스위치는 없고, 명부가 비어 있으면 "이 서버" 항목만 보입니다.

## 보안 자세

- 명부는 `$DSH_HOME/remote-work/hosts.json`(0600, 원자적 tmp+rename)에 저장하고, **자격 증명은 넣지 않습니다**. ssh 의 자기 설정(`~/.ssh/config`, ssh-agent, `authorized_keys`)을 쓰도록 두었습니다.
- 명부에 들어올 수 있는 값은 좁게 검증합니다. `-`로 시작하는 값은 거절하는데, 이는 명부 파일을 직접 편집한 경우까지 막습니다 — 앞이 `-` 인 값은 ssh 가 옵션으로 오해합니다(`-oProxyCommand=…`).
- `BatchMode=yes` 라서 비밀번호 프롬프트가 뜨면 즉시 실패합니다. 키 인증이 필수입니다.
- 이 라우트는 **로그인한 브라우저가 원격 머신에 ssh 를 보내게 합니다.** DSH 웹 표면 자체를 신뢰하는 사설망 배치를 전제로 하며, 사설망 밖이라면 리버스 프록시+TLS 를 앞에 두세요.

## 지금 안 되는 것 (정직하게)

- **세션 열기가 없습니다.** 행을 눌러도 아무 일도 일어나지 않습니다. ACP 는 과거 트랜스크립트를 재생하지 않아, 목록을 눌러 대화를 보려면 다른 결정이 필요합니다. 현재로서는 붙는 동안의 스트림만 볼 수 있고, 원격 세션은 자기 머신 디스크(`~/.dsh/storages/…`)에 남습니다 — 이력 화면은 그 파일을 읽는 별개의 축이 될 것입니다.
- 여러 브라우저가 같은 원격 세션을 동시에 보는지는 미검증입니다. 프롬프트를 보낸 연결만 업데이트를 받을 가능성이 높습니다.
- Windows 원격은 미검증입니다(셸·PATH 차이).
- 화면 문구는 한국어로 하드코딩되어 있습니다. `deepseek-harness-kr` 같은 언어팩과 붙일 때의 동작은 아직 정리하지 않았습니다.

## 테스트

```bash
npm test   # node:test — 런타임 의존성 불필요
```

- `test/hosts.test.mjs` — 명부 검증, `-` 주입 거절, 파일 라운드트립, 용량
- `test/acp.test.mjs` — NDJSON 프레임 분해, ssh argv 규격(`-t` 금지 포함)
- `test/client.test.mjs` — 브라우저 모듈 계약, 좌석 두 자리, 그리고 **디자인 회귀**: 리터럴 색 금지, 셸 토큰 사용, 버튼 hover 가 `brightness` 로 새지 않는지, 제목 20px/500, 행 hover=선택, 설정 카드 배선, 끊점 1100/760/400

고쳐가며 시험할 때: `dsh plugin add file:…` 는 패키지를 **복사**하므로, 소스를 고치면 `remove` 후 다시 `add` 해야 반영됩니다. 다른 포트·다른 `DSH_HOME`으로 띄우면 실제 서버를 건드리지 않고 확인할 수 있습니다.

```bash
DSH_HOME=/tmp/dsh-rw-test dsh --profile web --no-open --host 127.0.0.1 --port 3099
```

## 라이선스

MIT — [LICENSE](LICENSE). 이 저장소의 코드는 다른 프로젝트에서 복사하지 않았습니다. 원격 조종 채널로 사용한 [ACP](https://agentclientprotocol.com) 와 DSH 의 `dsh-acp` 프로필은 DSH 자체 기능입니다.
